import { randomUUID } from 'node:crypto';
import { readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Saved } from '../shared/sim/creature.ts';
import { SEASONS, clamp, seasonOf, type Season } from '../shared/sim/math.ts';
import { packFlake, packPose, type Frame, type RosterEntry, type Settings, type Upcoming, type Visit } from '../shared/sim/protocol.ts';
import { SimSwimmer } from '../shared/sim/swimmer.ts';
import { Tank } from '../shared/sim/tank.ts';
import { FILM_SECONDS, pickVisitor } from '../shared/sim/visitors.ts';
import type { Drawing, ServerMessage, TankCommand, TankCommandValue } from '../shared/types.ts';
import { record } from './history.ts';
import { DATA_DIR, listDrawings } from './store.ts';
import { broadcast, clientCount, sendToOne } from './ws.ts';

/**
 * The one real tank. The server runs every creature's brain here, ten times a second, whether anyone is
 * watching or not, and sends each screen where everything is; screens only draw. It also runs the
 * happenings (documentaries, visitors, eggs, the ⚙️ menu's commands, scheduled or not), keeps the world
 * across restarts (data/world.json) and writes the notable moments into the history.
 */

const WORLD_FILE = join(DATA_DIR, 'world.json');
const TICK_MS = 100;
const SAVE_MS = 30_000;

/** Eggs are a treat: at most one every few hours. */
export const EGG_GAP = Number(process.env.EGG_GAP_MINUTES ?? 360) * 60_000;
export const HATCH_TIME = Number(process.env.HATCH_SECONDS ?? 180) * 1000;

const MINUTE = 60_000;
const rand = (min: number, max: number) => min + Math.random() * (max - min);

/** A ⚙️ menu command waiting for its time. */
interface Scheduled {
  id: string;
  at: number;
  command: TankCommand;
  value: TankCommandValue;
}

interface WorldSave {
  time: number;
  saved: Record<string, Saved>;
  settings: Settings;
  grown: string[];
  nextVisit: { at: number; name: string };
  nextDoc: number;
  scheduled: Scheduled[];
  lastSeason: Season;
}

export const tank = new Tank();
let settings: Settings = { hour: null, season: null, blacklight: false };
let doc: { id: string; until: number } | null = null;
let visit: Visit | null = null;
let visitEnds = 0;
let nextVisit = { at: Date.now() + rand(6, 14) * MINUTE, name: '' };
let nextDoc = Date.now() + rand(2, 4) * MINUTE;
let scheduled: Scheduled[] = [];
const grown = new Set<string>();
let lastSeason: Season = seasonOf();
/** Drawings that dropped in since the last roster went out, so screens can say hello. */
const fresh = new Set<string>();
let rosterSent = '';
let upcomingSent = '';
let last = Date.now();
let lastMinute = 0;
const lastLogged: Record<string, number> = {};
let feeding: { until: number; eaten: Map<string, number> } | null = null;
let wasNight = false;

const nameOf = (id: string) => listDrawings().find((d) => d.id === id)?.name ?? 'someone';
const drawingOf = (id: string) => listDrawings().find((d) => d.id === id);
const listNames = (names: string[]) => (names.length < 2 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`);
const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const season = (): Season => (settings.season && SEASONS[settings.season]) || seasonOf();

/** Logs at most one of a kind of moment every few minutes, so the history isn't all chases. */
function now_ok(kind: string, minutes: number) {
  const now = Date.now();
  if (now - (lastLogged[kind] ?? 0) < minutes * MINUTE) return false;
  lastLogged[kind] = now;
  return true;
}

export async function startWorld() {
  let save: Partial<WorldSave> = {};
  try {
    save = JSON.parse(await readFile(WORLD_FILE, 'utf8'));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') console.warn('Could not read the saved world; starting fresh', err);
  }
  tank.world.time = save.time ?? 0;
  if (save.settings) settings = save.settings;
  for (const id of save.grown ?? []) grown.add(id);
  if (save.nextVisit?.name) nextVisit = save.nextVisit;
  else nextVisit.name = pickVisitor(season()).name;
  if (save.nextDoc) nextDoc = Math.max(save.nextDoc, Date.now() + MINUTE);
  scheduled = save.scheduled ?? [];
  if (save.lastSeason) lastSeason = save.lastSeason;
  applySettings();
  tank.sync(listDrawings(), save.saved);
  tank.step(0);
  wasNight = tank.isNight;
  // Everyone who's already grown up when this starts has been written about already (or was before history).
  if (!save.grown) for (const d of listDrawings()) if (tank.grownUp(d)) grown.add(d.id);

  setInterval(tick, TICK_MS);
  setInterval(() => void saveWorld(), SAVE_MS);
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => {
      void saveWorld().finally(() => process.exit(0));
    });
  }
}

/** What a screen needs when it connects. */
export function welcome(send: (message: ServerMessage) => void) {
  send({ type: 'roster', creatures: roster(false) });
  send({ type: 'frame', frame: frame() });
  send({ type: 'upcoming', items: upcoming() });
}

let saving = Promise.resolve();
function saveWorld() {
  const saved: Record<string, Saved> = {};
  for (const [id, c] of tank.creatures) if ('save' in c) saved[id] = (c as SimSwimmer).save();
  const data: WorldSave = {
    time: tank.world.time,
    saved,
    settings,
    grown: [...grown],
    nextVisit,
    nextDoc,
    scheduled,
    lastSeason,
  };
  saving = saving.then(async () => {
    const tmp = `${WORLD_FILE}.tmp`;
    await writeFile(tmp, JSON.stringify(data));
    await rename(tmp, WORLD_FILE);
  }).catch((err) => console.warn('World not saved', err));
  return saving;
}

function tick() {
  const now = Date.now();
  const dt = clamp((now - last) / 1000, 0, 0.25);
  last = now;
  tank.step(dt);
  for (const s of scheduled.filter((s) => s.at <= now)) runCommand(s.command, s.value);
  scheduled = scheduled.filter((s) => s.at > now);
  updateDoc(now);
  updateVisit(now);
  readNotes(now);
  if (now - lastMinute > MINUTE) {
    lastMinute = now;
    everyMinute();
  }
  if (clientCount() > 0) {
    const list = roster(true);
    const signature = list.map((c) => `${c.id}:${c.kind}:${c.still?.[1] ?? ''}:${c.still?.[3] ?? ''}`).join(',');
    if (signature !== rosterSent || fresh.size) {
      rosterSent = signature;
      broadcast({ type: 'roster', creatures: list });
      fresh.clear();
    }
    broadcast({ type: 'frame', frame: frame() });
    const items = upcoming();
    const sig = JSON.stringify(items);
    if (sig !== upcomingSent) {
      upcomingSent = sig;
      broadcast({ type: 'upcoming', items });
    }
  }
  tank.world.effects.length = 0;
}

function roster(markFresh: boolean): RosterEntry[] {
  return [...tank.creatures.values()].map((c) => ({
    id: c.drawing.id,
    kind: c.kind,
    personality: c.personality,
    // Plants and decorations never move, so where they are comes with the roster instead of every frame.
    ...(c.kind === 'plant' || c.kind === 'decor' ? { still: packPose(c.drawing.id, c.pose) } : {}),
    ...(markFresh && fresh.has(c.drawing.id) ? { fresh: true } : {}),
  }));
}

function frame(): Frame {
  return {
    t: tank.world.time,
    darkness: tank.darkness,
    blacklight: tank.blacklight,
    current: tank.world.current,
    season: season(),
    settings,
    doc,
    visit,
    poses: [...tank.creatures.values()].filter((c) => c.kind !== 'plant' && c.kind !== 'decor').map((c) => packPose(c.drawing.id, c.pose)),
    flakes: tank.food.flakes.map(packFlake),
    effects: tank.world.effects,
  };
}

/** What's coming up, soonest first: visitors, documentaries, hatching eggs and anything scheduled. */
function upcoming(): Upcoming[] {
  const now = Date.now();
  const visitor = pickVisitorInfo(nextVisit.name);
  const items: Upcoming[] = [
    ...(visitor && !visit ? [{ at: nextVisit.at, icon: visitor.icon, text: `${capital(visitor.text)} drops by` }] : []),
    ...(doc ? [] : [{ at: nextDoc, icon: '🎬', text: 'A documentary' }]),
    ...listDrawings()
      .filter((d) => (d.hatchAt ?? 0) > now)
      .map((d) => ({ at: d.hatchAt!, icon: '🐣', text: `The egg from ${listNames((d.parents ?? []).map(nameOf))} hatches` })),
    ...scheduled.map((s) => ({ at: s.at, icon: '⏰', text: describe(s.command, s.value) })),
  ];
  return items.sort((a, b) => a.at - b.at).slice(0, 8);
}

const pickVisitorInfo = (name: string) => (name ? pickVisitor(season(), name) : undefined);

// --- the ⚙️ menu --------------------------------------------------------------------------------------

function applySettings() {
  tank.hour = settings.hour;
  tank.blacklightOn = settings.blacklight;
}

/** Does a ⚙️ menu command; returns a line to show the person who asked. */
export function runCommand(command: TankCommand, value: TankCommandValue): string {
  switch (command) {
    case 'time':
      settings = { ...settings, hour: typeof value === 'number' ? ((value % 24) + 24) % 24 : null };
      break;
    case 'season':
      settings = { ...settings, season: typeof value === 'string' && value in SEASONS ? value : null };
      break;
    case 'blacklight':
      settings = { ...settings, blacklight: value === true };
      if (value === true && now_ok('blacklight', 30)) record('blacklight', [], '🟣 Someone switched on the blacklight, and the glowing paint lit up.');
      break;
    case 'film':
      return startDoc() ? '🎬 Rolling!' : '🎬 Nobody is out to film right now.';
    case 'visit':
      startVisit(typeof value === 'string' ? value : undefined);
      break;
    case 'current':
      tank.startCurrent();
      break;
    case 'school':
      tank.startSchool();
      break;
    case 'puff':
      for (const f of tank.world.fish) f.puffUp();
      break;
    case 'egg':
      return askForEgg(true);
  }
  applySettings();
  return '';
}

/** Runs a command later. */
export function schedule(command: TankCommand, value: TankCommandValue, at: number) {
  scheduled.push({ id: randomUUID(), at, command, value });
  void saveWorld();
}

function describe(command: TankCommand, value: TankCommandValue) {
  switch (command) {
    case 'time':
      return value === null ? 'Back to the real time' : `Time changes to ${value}:00`;
    case 'season':
      return value === null ? 'Holiday by the date' : `${capital(String(value))} decorations`;
    case 'blacklight':
      return value ? 'Blacklight on' : 'Blacklight off';
    case 'film':
      return 'A documentary';
    case 'visit':
      return `${capital(pickVisitorInfo(String(value ?? ''))?.text ?? 'a visitor')} drops by`;
    case 'current':
      return 'A current sweeps through';
    case 'school':
      return 'A school of fish';
    case 'puff':
      return 'The puffers puff up';
    case 'egg':
      return 'An egg is laid';
  }
}

// --- happenings -------------------------------------------------------------------------------------

/** Who documentary mode can film: anything out and about that moves. */
const filmable = () => [...tank.creatures.values()].filter((c) => (c.kind === 'swimmer' || c.kind === 'crawler') && c.pose.out);

function startDoc() {
  const candidates = filmable();
  const pick = candidates[Math.floor(Math.random() * candidates.length)];
  if (!pick) return false;
  if (doc) tank.creatures.get(doc.id)?.star?.(false);
  pick.star?.(true);
  doc = { id: pick.drawing.id, until: tank.world.time + FILM_SECONDS };
  record('documentary', [pick.drawing.id], `🎬 ${pick.drawing.name} starred in a nature documentary, showing off for the camera.`);
  return true;
}

function updateDoc(now: number) {
  if (doc && (tank.world.time > doc.until || !tank.creatures.has(doc.id))) {
    tank.creatures.get(doc.id)?.star?.(false);
    doc = null;
    nextDoc = now + rand(5, 10) * MINUTE;
  }
  if (!doc && now >= nextDoc && !startDoc()) nextDoc = now + MINUTE;
}

function startVisit(name?: string) {
  const info = pickVisitor(season(), name);
  if (!info) return;
  visit = { name: info.name, seed: Math.floor(Math.random() * 1e9), startedAt: tank.world.time };
  visitEnds = tank.world.time + info.seconds;
  record('visitor', [], `${info.icon} ${capital(info.text)} came by the tank.`);
}

function updateVisit(now: number) {
  if (visit && tank.world.time > visitEnds) {
    visit = null;
    nextVisit = { at: now + rand(6, 14) * MINUTE, name: pickVisitor(season()).name };
  }
  if (!visit && now >= nextVisit.at) startVisit(nextVisit.name);
}

/** Feeding time, from a click on a tank or a Feed button. */
export function feed(x: number) {
  tank.food.drop(tank.world, x);
  broadcast({ type: 'feed', x });
  if (!feeding) feeding = { until: Date.now() + 40_000, eaten: new Map() };
}

/**
 * Asks a screen to make a baby from two fish (blending pictures needs a browser) and lay its egg.
 * force (the ⚙️ menu) picks any two grown-up fish and skips the wait between eggs.
 */
function askForEgg(force: boolean, pair?: [string, string]): string {
  const ids = pair ?? (tank.world.fish.filter((f) => tank.canParent(f.drawing)).sort(() => Math.random() - 0.5).map((f) => f.drawing.id) as string[]);
  if (ids.length < 2) return '🥚 It takes two 🐟 Fish (not babies) in the tank to lay an egg.';
  const [mum, dad] = ids;
  const lastEgg = Math.max(0, ...listDrawings().filter((d) => d.parents).map((d) => d.createdAt));
  if (!force && Date.now() - lastEgg < EGG_GAP) return '🥚 Not time for another egg yet.';
  const a = tank.creatures.get(mum)?.pose;
  const b = tank.creatures.get(dad)?.pose;
  const nest = a && b ? (a.x + b.x) / 2 / tank.world.width : 0.5;
  if (!sendToOne({ type: 'egg:make', parents: [mum, dad], nest, now: force })) return '🥚 Open the tank on a screen to lay an egg.';
  return `🥚 ${nameOf(mum)} and ${nameOf(dad)} are laying an egg!`;
}

/** Turns the simulation's notes into history (only the notable ones) and babies. */
function readNotes(now: number) {
  const world = tank.world;
  for (const note of world.notes) {
    switch (note.kind) {
      case 'chase':
        if (note.seconds > 5 && now_ok('chase', 10)) {
          record(
            'chase',
            [note.hunter, note.prey],
            note.hid
              ? `🙈 ${nameOf(note.hunter)} went prowling after ${nameOf(note.prey)}, who hid until the coast was clear.`
              : `🦈 ${nameOf(note.hunter)} chased ${nameOf(note.prey)} around the tank, but never caught up.`,
          );
        }
        break;
      case 'scare':
        if (now_ok('scare', 10)) {
          record('scare', [note.who, note.hunter], `🐡 ${nameOf(note.who)} puffed up into a spiky ball to scare off ${nameOf(note.hunter)}.`);
        }
        break;
      case 'school':
        if (now_ok('school', 15)) {
          record('school', [note.leader, ...note.members], `🐟 ${nameOf(note.leader)} led a school with ${listNames(note.members.map(nameOf))}.`);
        }
        break;
      case 'school-end': {
        const [a, b] = [drawingOf(note.leader), drawingOf(note.first)];
        if (a && b && tank.canParent(a) && tank.canParent(b) && Math.random() < 0.5) askForEgg(false, [a.id, b.id]);
        break;
      }
      case 'hatch': {
        const d = drawingOf(note.who);
        record('hatch', [note.who, ...(d?.parents ?? [])], `🐣 ${d?.name ?? 'A baby'} hatched! A baby of ${listNames((d?.parents ?? []).map(nameOf))}.`);
        break;
      }
      case 'ate':
        feeding?.eaten.set(note.who, (feeding.eaten.get(note.who) ?? 0) + 1);
        break;
      case 'out':
        if (now_ok(`out:${note.who}`, 8 * 60)) record('night-out', [note.who], `🌙 ${nameOf(note.who)} came out for the night.`);
        break;
    }
  }
  world.notes.length = 0;

  if (feeding && now > feeding.until) {
    const [top] = [...feeding.eaten].sort((a, b) => b[1] - a[1]);
    if (top && now_ok('feed', 20)) {
      record('feed', [top[0]], `🍤 Dinner time! ${nameOf(top[0])} gobbled up the most, ${top[1]} flake${top[1] === 1 ? '' : 's'}.`);
    }
    feeding = null;
  }

  if (tank.isNight !== wasNight) {
    wasNight = tank.isNight;
    if (now_ok(wasNight ? 'night' : 'morning', 60)) record(wasNight ? 'night' : 'morning', [], wasNight ? '🌙 Night fell over the tank.' : '🌅 Morning came to the tank.');
  }
}

const HOLIDAYS: [keyof Season, string][] = [
  ['halloween', '🎃 Halloween came to the tank: jack-o\'-lanterns glowed on the sand.'],
  ['snow', '❄️ Winter came, and snow began drifting down through the water.'],
  ['lights', '🎄 Twinkling holiday lights went up along the top of the tank.'],
  ['valentine', '💕 Valentine\'s week: hearts floated up from the sand.'],
];

function everyMinute() {
  const today = seasonOf();
  for (const [key, text] of HOLIDAYS) if (today[key] && !lastSeason[key]) record('holiday', [], text);
  lastSeason = today;
  for (const c of tank.creatures.values()) {
    const d = c.drawing;
    if (c.kind !== 'egg' && tank.grownUp(d) && !grown.has(d.id)) {
      grown.add(d.id);
      record('grown', [d.id], `🎂 ${d.name} is all grown up: a whole week old!`);
    }
  }
}

// --- drawings coming and going (from the routes) ------------------------------------------------------

export function drawingAdded(drawing: Drawing) {
  tank.add(drawing, true);
  fresh.add(drawing.id);
  tank.sync(listDrawings());
}

export function drawingUpdated() {
  tank.sync(listDrawings());
}

export function drawingRemoved() {
  tank.sync(listDrawings());
}
