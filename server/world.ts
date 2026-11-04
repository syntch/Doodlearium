import { randomUUID } from 'node:crypto';
import { readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Placement, Saved, Spec } from '../shared/sim/creature.ts';
import { SEASONS, clamp, seasonOf, type Season } from '../shared/sim/math.ts';
import {
  packFlake,
  packPose,
  type Frame,
  type MapSummary,
  type RosterEntry,
  type Settings,
  type Show,
  type Upcoming,
  type Visit,
} from '../shared/sim/protocol.ts';
import { ARRIVE_SECONDS, SHOWS, SHOW_KINDS, STAY_MINUTES, showSeconds, type ShowKind } from '../shared/sim/explorers.ts';
import { Tank } from '../shared/sim/tank.ts';
import { FILM_SECONDS, pickVisitor } from '../shared/sim/visitors.ts';
import { habitatOf, motionOf, type Drawing, type SpeciesWhere, type TankCommand, type TankCommandValue } from '../shared/types.ts';
import { hasWeather } from '../shared/world/biomes.ts';
import { LIVE_PLACES, allWorlds, placeById, placeName, worldOf, type Place } from '../shared/world/places.ts';
import { populate, tourOf, turnover, type Individual, type PinnedOf } from '../shared/world/population.ts';
import { chosenWorldsOf, worldsOfDrawing } from './packs.ts';
import { record } from './history.ts';
import { DATA_DIR, listDrawings } from './store.ts';
import { UPDATE_EXIT, freshUpdate } from './update.ts';
import { broadcast, broadcastTo, clientCount, sendToOne, watchers, type Screen } from './ws.ts';

/**
 * The world. Every place (the Lake, the Pond...) is a tank of its own, and the server runs every creature's
 * brain in all of them, ten times a second, whether anyone is watching or not; each screen gets where
 * everything is in the place it's showing, and only draws. Who lives where comes from the drawings, each a
 * species (see shared/world/population.ts). It also runs the happenings (documentaries, visitors, eggs, the
 * ⚙️ menu's commands, scheduled or not), keeps the world across restarts (data/world.json) and writes the
 * notable moments into the history.
 */

const WORLD_FILE = join(DATA_DIR, 'world.json');
const TICK_MS = 100;
const SAVE_MS = 30_000;

/** Blended eggs (two different species) are a treat: at most one every few hours. */
export const EGG_GAP = Number(process.env.EGG_GAP_MINUTES ?? 360) * 60_000;
/** Two of the same species can have a baby more often, though not too often in any one place. */
const SPECIES_EGG_GAP = EGG_GAP / 4;
export const HATCH_TIME = Number(process.env.HATCH_SECONDS ?? 180) * 1000;

const MINUTE = 60_000;
const rand = (min: number, max: number) => min + Math.random() * (max - min);

/** A ⚙️ menu command waiting for its time (place: where it was asked for, for the ones that need one). */
interface Scheduled {
  id: string;
  at: number;
  command: TankCommand;
  value: TankCommandValue;
  place?: string;
}

interface PlaceSave {
  time: number;
  saved: Record<string, Saved>;
  nextVisit: { at: number; name: string };
}

interface WorldSave {
  places: Record<string, PlaceSave>;
  individuals: Individual[];
  settings: Settings;
  grown: string[];
  scheduled: Scheduled[];
  lastSeason: Season;
  journeys?: Record<string, Journey>;
  /** From before there were places: the one tank, which is now the Lake. */
  time?: number;
  saved?: Record<string, Saved>;
  nextVisit?: { at: number; name: string };
}

/** An explorer's travels: where it is, where it's been lately, and its next trip. */
interface Journey {
  place: string;
  next: { at: number; to: string };
  visited: string[];
  lastShow?: ShowKind;
}

/** For trying explorers out: EXPLORER_MINUTES=1 sends them off every minute. */
const STAY = Number(process.env.EXPLORER_MINUTES) || 0;
const stayFor = () => (STAY || rand(...STAY_MINUTES)) * MINUTE;

/** One place's tank and what's going on in it. */
class Spot {
  readonly tank: Tank;
  doc: { id: string; until: number } | null = null;
  visit: Visit | null = null;
  visitEnds = 0;
  nextVisit = { at: Date.now() + rand(6, 16) * MINUTE, name: '' };
  nextTurnover = Date.now() + rand(20, 40) * MINUTE;
  lastEgg = 0;
  /** Originals that just dropped in, so screens can say hello. */
  fresh = new Set<string>();
  rosterSent = '';
  feeding: { until: number; eaten: Map<string, number> } | null = null;
  /** The next rain (or snow) shower, for places with a sky. */
  nextShower = Date.now() + rand(20, 45) * MINUTE;
  /** An explorer who just arrived, putting on a show (and, for a treasure hunt, when the snacks spill out). */
  show: Show | null = null;
  showEnds = 0;
  treasure: number[] = [];

  constructor(public place: Place) {
    this.tank = new Tank(place.biome);
  }

  /** Land places, and water places with sky above the water (but no weather out in space or in a station). */
  get hasSky() {
    return hasWeather(this.place.biome) && (this.tank.world.land === true || this.tank.world.waterTop > 0);
  }

  get id() {
    return this.place.id;
  }
}

/** Every open place's tank, in every world (places open and close as worlds come and go: see openSpots). */
const spots = new Map<string, Spot>();

/** Opens a tank for every place there is now, and closes the ones whose world (or place) has gone. */
function openSpots() {
  for (const p of LIVE_PLACES) {
    const had = spots.get(p.id);
    // A place whose kind changed starts over as the new kind.
    if (!had || had.place.biome !== p.biome) spots.set(p.id, new Spot(p));
    else (had as { place: Place }).place = p;
  }
  for (const id of [...spots.keys()]) if (!placeById(id)) spots.delete(id);
}

/** A world was made, changed, installed or removed: open and close places, and move everyone to suit. */
export function worldsChanged() {
  openSpots();
  resync();
  broadcast({ type: 'map', places: mapSummary(), species: speciesCounts() });
}
let individuals: Individual[] = [];
let journeys: Record<string, Journey> = {};
/** Explorers are wherever their travels have taken them. */
const pinnedOf: PinnedOf = (d) => (d.explorer ? journeys[d.id]?.place : undefined);
let settings: Settings = { hour: null, season: null, blacklight: false };
let scheduled: Scheduled[] = [];
const grown = new Set<string>();
let lastSeason: Season = seasonOf();
let upcomingSent = '';
let last = Date.now();
let lastMinute = 0;
let lastMap = 0;
const lastLogged: Record<string, number> = {};
let wasNight = false;

const drawingOf = (id: string) => listDrawings().find((d) => d.id === id);
/** Members' ids are the species' id, a ~, and a few letters. */
const speciesOf = (id: string) => id.split('~')[0];
const isNamed = (id: string) => !id.includes('~');
/** "Clowny" for the original, "a Clowny" for the others (capitalised to start a sentence). */
function nameOf(id: string, start = false) {
  const name = drawingOf(speciesOf(id))?.name;
  if (!name) return start ? 'Someone' : 'someone';
  return isNamed(id) ? name : `${start ? 'A' : 'a'} ${name}`;
}
const listNames = (names: string[]) => (names.length < 2 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`);
const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const season = (): Season => (settings.season && SEASONS[settings.season]) || seasonOf();
const spotOf = (id: string | undefined | null) => (id ? spots.get(id) : undefined);
/** For the history's who: the species a creature is one of. */
const who = (...ids: string[]) => [...new Set(ids.map(speciesOf))];
const at = (spot: Spot) => `at ${placeName(spot.id)}`;

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
  // A save from before places: its one tank is the Lake, and everyone who lived there still does.
  const places = save.places ?? {
    lake: { time: save.time ?? 0, saved: save.saved ?? {}, nextVisit: save.nextVisit ?? { at: 0, name: '' } },
  };
  individuals = save.individuals ?? listDrawings().map((d) => ({ id: d.id, species: d.id, place: 'lake', named: true }));
  if (save.settings) settings = save.settings;
  for (const id of save.grown ?? []) grown.add(id);
  scheduled = save.scheduled ?? [];
  if (save.lastSeason) lastSeason = save.lastSeason;
  journeys = save.journeys ?? {};
  applySettings();

  openSpots();
  individuals = populate(listDrawings(), individuals, undefined, worldsOfDrawing, pinnedOf);
  for (const spot of spots.values()) {
    const ps = places[spot.id];
    spot.tank.world.time = ps?.time ?? 0;
    if (ps?.nextVisit?.name && pickVisitor(season(), ps.nextVisit.name)) spot.nextVisit = ps.nextVisit;
    else spot.nextVisit.name = pickVisitor(season(), undefined, spot.place.biome, spot.tank.isNight)?.name ?? '';
    spot.tank.sync(specsFor(spot.id), ps?.saved);
    spot.tank.step(0);
  }
  wasNight = spots.get('lake')!.tank.isNight;
  // Everyone who's already grown up when this starts has been written about already (or was before history).
  if (!save.grown) for (const spot of spots.values()) for (const id of spot.tank.creatures.keys()) if (spot.tank.grownUp(id)) grown.add(id);

  setInterval(tick, TICK_MS);
  setInterval(() => void saveWorld(), SAVE_MS);
  const updated = await freshUpdate().catch(() => undefined);
  if (updated?.ok && updated.changes?.length) record('update', [], `🔄 Doodlearium was updated: ${updated.message}`);
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => {
      void saveWorld().finally(() => process.exit(0));
    });
  }
}

/** What a creature is, for its place's tank. */
function toSpec(i: Individual, d: Drawing): Spec {
  return {
    id: i.id,
    drawing: d,
    hatchAt: i.hatchAt ?? d.hatchAt,
    nest: i.nest ?? d.nest,
    // Babies grow up over a week from hatching: blended ones (the drawing's own egg) and members from eggs.
    grownFrom: i.hatchAt ?? (d.parents ? (d.hatchAt ?? d.createdAt) : undefined),
    placement: i.placement,
  };
}

/** The family moved or resized a plant or decoration (or, with null, put it back where it grew). */
export function arrange(place: string, id: string, placement: Placement | null) {
  const spot = spotOf(place);
  const i = individuals.find((x) => x.id === id && x.place === place);
  const kind = spot?.tank.creatures.get(id)?.kind;
  if (!spot || !i || (kind !== 'plant' && kind !== 'decor')) return false;
  if (placement) i.placement = placement;
  else delete i.placement;
  spot.tank.sync(specsFor(place));
  void saveWorld();
  return true;
}

function specsFor(place: string): Spec[] {
  const byId = new Map(listDrawings().map((d) => [d.id, d]));
  return individuals.filter((i) => i.place === place && byId.has(i.species)).map((i) => toSpec(i, byId.get(i.species)!));
}

/** Re-works out who lives where (after a drawing comes, goes or changes) and brings every place in line. */
function resync(fresh = new Set<string>()) {
  const before = new Map(individuals.filter((i) => i.named).map((i) => [i.id, i.place]));
  individuals = populate(listDrawings(), individuals, fresh, worldsOfDrawing, pinnedOf);
  for (const i of individuals) {
    const was = before.get(i.id);
    // (Explorers' trips have lines of their own.)
    if (i.named && was && was !== i.place && !drawingOf(i.id)?.explorer) {
      // Off to another world: say which.
      const there = worldOf(i.place);
      const far = placeById(was) && worldOf(was).id !== there.id ? ` in ${there.name}` : '';
      const from = placeById(was) ? ` from ${placeName(was)}` : '';
      record('travels', [i.id], `🧳 ${nameOf(i.id, true)} went on its travels${from}, to ${placeName(i.place)}${far}.`, i.place);
    }
  }
  for (const spot of spots.values()) spot.tank.sync(specsFor(spot.id), {}, true);
}

/** What a screen needs when it connects. */
export function onConnect(screen: Screen) {
  screen.send({ type: 'worlds', worlds: allWorlds() });
  screen.send({ type: 'upcoming', items: upcoming() });
  screen.send({ type: 'map', places: mapSummary(), species: speciesCounts() });
  onWatch(screen);
}

/** What a screen needs when it starts showing a place. */
export function onWatch(screen: Screen) {
  const spot = spotOf(screen.place);
  if (!spot) return;
  screen.send({ type: 'roster', place: spot.id, creatures: roster(spot, false) });
  screen.send({ type: 'frame', frame: frame(spot) });
}

/** The ⚙️ menu's 🔄 Update: every screen is told, the world saved, and the launcher takes over (see update.ts). */
export function stopForUpdate() {
  broadcast({ type: 'updating' });
  void saveWorld().finally(() => setTimeout(() => process.exit(UPDATE_EXIT), 300));
}

let saving = Promise.resolve();
function saveWorld() {
  const places: Record<string, PlaceSave> = {};
  for (const spot of spots.values()) {
    places[spot.id] = { time: spot.tank.world.time, saved: spot.tank.save(), nextVisit: spot.nextVisit };
  }
  const data: WorldSave = { places, individuals, settings, grown: [...grown], scheduled, lastSeason, journeys };
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
  for (const spot of spots.values()) spot.tank.step(dt);
  for (const s of scheduled.filter((s) => s.at <= now)) runCommand(s.command, s.value, s.place);
  scheduled = scheduled.filter((s) => s.at > now);
  for (const spot of spots.values()) {
    updateDoc(spot, now);
    updateVisit(spot, now);
    updateWeather(spot, now);
    updateShow(spot);
    readNotes(spot, now);
    if (now >= spot.nextTurnover) {
      spot.nextTurnover = now + rand(20, 40) * MINUTE;
      individuals = turnover(individuals, spot.id);
      resync();
    }
  }
  updateNight();
  updateExplorers(now);
  if (now - lastMinute > MINUTE) {
    lastMinute = now;
    everyMinute();
  }
  if (clientCount() > 0) {
    for (const spot of spots.values()) {
      if (!watchers(spot.id).length) continue;
      const list = roster(spot, true);
      const signature = list.map((c) => `${c.id}:${c.kind}:${c.still?.[1] ?? ''}:${c.still?.[2] ?? ''}:${c.still?.[3] ?? ''}:${c.arranged ?? ''}`).join(',');
      if (signature !== spot.rosterSent || spot.fresh.size) {
        spot.rosterSent = signature;
        broadcastTo(spot.id, { type: 'roster', place: spot.id, creatures: list });
      }
      broadcastTo(spot.id, { type: 'frame', frame: frame(spot) });
    }
    const items = upcoming();
    const sig = JSON.stringify(items);
    if (sig !== upcomingSent) {
      upcomingSent = sig;
      broadcast({ type: 'upcoming', items });
    }
    if (now - lastMap >= 1000) {
      lastMap = now;
      broadcast({ type: 'map', places: mapSummary(), species: speciesCounts() });
    }
  }
  for (const spot of spots.values()) {
    spot.fresh.clear();
    spot.tank.world.effects.length = 0;
  }
}

function roster(spot: Spot, markFresh: boolean): RosterEntry[] {
  return [...spot.tank.creatures.values()].map((c) => ({
    id: c.id,
    species: c.drawing.id,
    ...(isNamed(c.id) ? { named: true } : {}),
    kind: c.kind,
    personality: c.personality,
    // Plants and decorations never move, so where they are comes with the roster instead of every frame.
    ...(c.kind === 'plant' || c.kind === 'decor' ? { still: packPose(c.id, c.pose) } : {}),
    ...(spot.tank.specOf(c.id)?.placement ? { arranged: true } : {}),
    ...(c.kind === 'egg' ? { hatchAt: spot.tank.specOf(c.id)?.hatchAt } : {}),
    ...(markFresh && spot.fresh.has(c.id) ? { fresh: true } : {}),
  }));
}

function frame(spot: Spot): Frame {
  const tank = spot.tank;
  return {
    place: spot.id,
    t: tank.world.time,
    darkness: tank.darkness,
    blacklight: tank.blacklight,
    current: tank.world.current,
    season: season(),
    settings,
    doc: spot.doc,
    visit: spot.visit,
    show: spot.show,
    weather: [round3(tank.weather.rain), round3(tank.weather.snow), round3(tank.weather.rainbow)],
    poses: [...tank.creatures.values()].filter((c) => c.kind !== 'plant' && c.kind !== 'decor').map((c) => packPose(c.id, c.pose)),
    flakes: tank.food.flakes.map(packFlake),
    effects: tank.world.effects,
  };
}

const round3 = (v: number) => Math.round(v * 1000) / 1000;

/** Every place at a glance, for the map: how many live there, and a few of its swimmers' species. */
function mapSummary(): MapSummary {
  const summary: MapSummary = {};
  for (const spot of spots.values()) {
    const creatures = [...spot.tank.creatures.values()];
    const species = new Set(creatures.filter((c) => c.kind === 'swimmer' || c.kind === 'crawler' || c.kind === 'walker' || c.kind === 'flier').map((c) => c.drawing.id));
    summary[spot.id] = { count: creatures.length, species: [...species].slice(0, 6) };
  }
  return summary;
}

/** How many of each species there are in the whole world. */
function speciesCounts() {
  const counts: Record<string, number> = {};
  for (const i of individuals) counts[i.species] = (counts[i.species] ?? 0) + 1;
  return counts;
}

/** Where each species lives: the original's place, and how many of it are in each place. */
export function whereSpecies(): Record<string, SpeciesWhere> {
  const where: Record<string, SpeciesWhere> = {};
  for (const i of individuals) {
    const w = (where[i.species] ??= { home: '', places: {} });
    if (i.named) w.home = i.place;
    w.places[i.place] = (w.places[i.place] ?? 0) + 1;
  }
  return where;
}

/** An explorer's arrival and its longest show, in seconds. */
const LONGEST_SHOW = Math.max(...SHOW_KINDS.map(showSeconds));

/** What's coming up anywhere, soonest first: visitors, explorers, hatching eggs and anything scheduled. */
function upcoming(): Upcoming[] {
  const now = Date.now();
  const items: Upcoming[] = [];
  for (const spot of spots.values()) {
    const visitor = spot.nextVisit.name ? pickVisitor(season(), spot.nextVisit.name) : undefined;
    if (visitor && !spot.visit) items.push({ at: spot.nextVisit.at, icon: visitor.icon, text: `${capital(visitor.text)} ${visitor.text.startsWith('some ') ? 'drop' : 'drops'} by ${placeName(spot.id)}`, place: spot.id, kind: 'visitor', seconds: visitor.seconds });
  }
  for (const i of individuals) {
    const d = drawingOf(i.species);
    const hatchAt = i.hatchAt ?? (i.named ? d?.hatchAt : undefined);
    if (!d || !hatchAt || hatchAt <= now) continue;
    const parents = i.hatchAt ? `two ${d.name}s` : listNames((d.parents ?? []).map((id) => nameOf(id)));
    items.push({ at: hatchAt, icon: '🐣', text: `The egg from ${parents} hatches ${at(spots.get(i.place)!)}`, place: i.place, kind: 'egg', seconds: 15 });
  }
  for (const s of scheduled) {
    const seconds = s.command === 'explorer' ? LONGEST_SHOW : s.command === 'visit' ? 40 : 25;
    items.push({ at: s.at, icon: '⏰', text: describe(s.command, s.value, s.place), ...(s.place ? { place: s.place } : {}), kind: 'planned', seconds });
  }
  for (const [id, j] of Object.entries(journeys)) {
    const d = drawingOf(id);
    if (d && placeById(j.next.to)) items.push({ at: j.next.at, icon: '🧭', text: `${d.name} arrives at ${placeName(j.next.to)}`, place: j.next.to, kind: 'explorer', seconds: LONGEST_SHOW });
  }
  // Plenty, so a screen following the action can see what's worth waiting for (Coming up shows the first few).
  return items.sort((a, b) => a.at - b.at).slice(0, 40);
}

// --- the ⚙️ menu --------------------------------------------------------------------------------------

function applySettings() {
  for (const spot of spots.values()) {
    spot.tank.hour = settings.hour;
    spot.tank.blacklightOn = settings.blacklight;
  }
}

/** Commands for one place; the rest (time, season, blacklight) are for the whole world. */
const LOCAL: TankCommand[] = ['film', 'visit', 'current', 'school', 'puff', 'egg', 'rain', 'snow', 'rainbow', 'explorer'];

/** Does a ⚙️ menu command (in place, for the ones that happen somewhere); returns a line to show the person who asked. */
export function runCommand(command: TankCommand, value: TankCommandValue, place?: string): string {
  const spot = spotOf(place) ?? spots.get('lake')!;
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
      return startDoc(spot) ? '🎬 Rolling!' : '🎬 Nobody is out to film right now.';
    case 'visit':
      startVisit(spot, typeof value === 'string' ? value : undefined);
      break;
    case 'current':
      spot.tank.startCurrent();
      break;
    case 'school':
      spot.tank.startSchool();
      break;
    case 'puff':
      for (const f of spot.tank.world.fish) f.puffUp();
      break;
    case 'egg':
      return askForEgg(spot, true);
    case 'rain':
    case 'snow':
    case 'rainbow':
      if (!spot.hasSky) return `☁️ There's no weather ${at(spot)}: try a place with sky above it.`;
      startShower(spot, command);
      break;
    case 'explorer':
      return callExplorer(spot, typeof value === 'string' ? value : undefined);
  }
  applySettings();
  return '';
}

/** Runs a command later. */
export function schedule(command: TankCommand, value: TankCommandValue, at: number, place?: string) {
  scheduled.push({ id: randomUUID(), at, command, value, ...(LOCAL.includes(command) && spotOf(place) ? { place } : {}) });
  void saveWorld();
}

function describe(command: TankCommand, value: TankCommandValue, place?: string) {
  const where = place ? ` ${at(spots.get(place)!)}` : '';
  switch (command) {
    case 'time':
      return value === null ? 'Back to the real time' : `Time changes to ${value}:00`;
    case 'season':
      return value === null ? 'Holiday by the date' : `${capital(String(value))} decorations`;
    case 'blacklight':
      return value ? 'Blacklight on' : 'Blacklight off';
    case 'film':
      return `A documentary${where}`;
    case 'visit':
      return `${capital((value && pickVisitor(season(), String(value))?.text) || 'a visitor')} drops by${where}`;
    case 'current':
      return `A current sweeps through${where}`;
    case 'school':
      return `A school of fish${where}`;
    case 'puff':
      return `The puffers puff up${where}`;
    case 'egg':
      return `An egg is laid${where}`;
    case 'rain':
      return `A rain shower${where}`;
    case 'snow':
      return `Snow${where}`;
    case 'rainbow':
      return `A rainbow${where}`;
    case 'explorer':
      return `${(value && drawingOf(String(value))?.name) || 'An explorer'} drops in${where}`;
  }
}

// --- happenings -------------------------------------------------------------------------------------

/** Now and then a shower passes over the places with a sky: snow in winter, rain the rest of the year. */
function updateWeather(spot: Spot, now: number) {
  if (now < spot.nextShower) return;
  spot.nextShower = now + rand(20, 45) * MINUTE;
  if (spot.hasSky) startShower(spot, season().snow ? 'snow' : 'rain');
}

function startShower(spot: Spot, kind: 'rain' | 'snow' | 'rainbow') {
  spot.tank.startWeather(kind, rand(90, 180));
  if (!now_ok(`weather:${spot.id}`, 15)) return;
  const text = { rain: `🌧️ A rain shower passed over ${at(spot)}.`, snow: `❄️ It snowed ${at(spot)}.`, rainbow: `🌈 A rainbow came out ${at(spot)}.` }[kind];
  record('weather', [], text, spot.id);
}

/** Who documentary mode can film: anything out and about that moves. */
const filmable = (spot: Spot) => [...spot.tank.creatures.values()].filter((c) => (c.kind === 'swimmer' || c.kind === 'crawler' || c.kind === 'walker' || c.kind === 'flier') && c.pose.out);

function startDoc(spot: Spot) {
  const candidates = filmable(spot);
  // The named originals get filmed more often than the crowd.
  const named = candidates.filter((c) => isNamed(c.id));
  const pool = named.length && Math.random() < 0.6 ? named : candidates;
  const pick = pool[Math.floor(Math.random() * pool.length)];
  if (!pick) return false;
  if (spot.doc) spot.tank.creatures.get(spot.doc.id)?.star?.(false);
  pick.star?.(true);
  spot.doc = { id: pick.id, until: spot.tank.world.time + FILM_SECONDS };
  record('documentary', who(pick.id), `🎬 ${nameOf(pick.id, true)} starred in a nature documentary ${at(spot)}, showing off for the camera.`, spot.id);
  return true;
}

function updateDoc(spot: Spot, now: number) {
  const { tank } = spot;
  if (spot.doc && (tank.world.time > spot.doc.until || !tank.creatures.has(spot.doc.id))) {
    tank.creatures.get(spot.doc.id)?.star?.(false);
    spot.doc = null;
  }
}

function startVisit(spot: Spot, name?: string, planned = false) {
  let info = pickVisitor(season(), name, spot.place.biome);
  // A night visitor planned a while back, and it's light now: someone else comes instead.
  if (planned && info?.night && !spot.tank.isNight) info = pickVisitor(season(), undefined, spot.place.biome, false);
  if (!info) return;
  spot.visit = { name: info.name, seed: Math.floor(Math.random() * 1e9), startedAt: spot.tank.world.time };
  spot.visitEnds = spot.tank.world.time + info.seconds;
  record('visitor', [], `${info.icon} ${capital(info.text)} came by ${placeName(spot.id)}.`, spot.id);
}

function updateVisit(spot: Spot, now: number) {
  if (spot.visit && spot.tank.world.time > spot.visitEnds) {
    spot.visit = null;
    spot.nextVisit = { at: now + rand(8, 20) * MINUTE, name: pickVisitor(season(), undefined, spot.place.biome, spot.tank.isNight)?.name ?? '' };
  }
  if (!spot.visit && spot.nextVisit.name && now >= spot.nextVisit.at) startVisit(spot, spot.nextVisit.name, true);
}

// --- explorers ----------------------------------------------------------------------------------------

/** The explorers there are (an egg has to hatch before it can go anywhere). */
const explorers = () => listDrawings().filter((d) => d.explorer && !((d.hatchAt ?? 0) > Date.now()));

/** Everywhere an explorer can go: the worlds picked for it (or its packs), or else every world there is. */
function tour(d: Drawing) {
  const chosen = chosenWorldsOf(d);
  return tourOf(d, chosen.length ? chosen : allWorlds().map((w) => w.id)).map((p) => p.id);
}

/** Its next stop: somewhere it hasn't been lately, if there's anywhere. */
function nextStop(d: Drawing, j: Journey) {
  const places = tour(d).filter((id) => id !== j.place);
  const fresh = places.filter((id) => !j.visited.includes(id));
  const pool = fresh.length ? fresh : places;
  return pool[Math.floor(Math.random() * pool.length)] ?? '';
}

/** Keeps every explorer's travels going: plans the next trip, and sets off when it's time. */
function updateExplorers(now: number) {
  const list = explorers();
  for (const id of Object.keys(journeys)) if (!list.some((d) => d.id === id)) delete journeys[id];
  for (const d of list) {
    const here = individuals.find((i) => i.id === d.id)?.place;
    if (!here) continue;
    let j = journeys[d.id];
    if (!j) {
      // A new explorer: it starts wherever the world put it, and its first trip comes before long.
      j = journeys[d.id] = { place: here, next: { at: now + (STAY || rand(5, 10)) * MINUTE, to: '' }, visited: [here] };
      j.next.to = nextStop(d, j);
    }
    // Its place closed (a world went), or its next stop did.
    if (j.place !== here) j.place = here;
    if (j.next.to && !placeById(j.next.to)?.live) j.next.to = nextStop(d, j);
    if (now < j.next.at) continue;
    if (j.next.to && tour(d).includes(j.next.to)) travel(d, j.next.to);
    else j.next = { at: now + stayFor(), to: nextStop(d, j) };
  }
}

/** Off it goes to another place (or world), and arrives with a show. */
function travel(d: Drawing, to: string, kind?: ShowKind) {
  const j = journeys[d.id];
  const spot = spotOf(to);
  if (!j || !spot) return;
  const from = j.place;
  j.place = to;
  j.visited = [...j.visited.filter((v) => v !== to), to].slice(-6);
  j.next = { at: Date.now() + stayFor(), to: '' };
  j.next.to = nextStop(d, j);
  if (from !== to) resync();
  startShow(spot, d, from, kind);
}

function startShow(spot: Spot, d: Drawing, from: string, kind?: ShowKind) {
  const j = journeys[d.id];
  const options = SHOW_KINDS.filter((k) => k !== j?.lastShow);
  const show = kind ?? options[Math.floor(Math.random() * options.length)];
  if (j) j.lastShow = show;
  const startedAt = spot.tank.world.time;
  spot.show = { kind: show, who: d.id, from, seed: Math.floor(Math.random() * 1e9), startedAt };
  spot.showEnds = startedAt + showSeconds(show);
  spot.treasure = show === 'treasure' ? [4, 7, 10, 13].map((t) => startedAt + ARRIVE_SECONDS + t) : [];
  spot.tank.creatures.get(d.id)?.star?.(true);
  if (show === 'parade') spot.tank.startParade(d.id, showSeconds(show));
  const there = worldOf(spot.id);
  const far = from !== spot.id && placeById(from) && worldOf(from).id !== there.id;
  const trip = from !== spot.id && placeById(from) ? `travelled from ${placeName(from)}${far ? ` in ${worldOf(from).name}` : ''} to ${placeName(spot.id)}${far ? ` in ${there.name}` : ''}` : `dropped in ${at(spot)}`;
  record('explorer', [d.id], `🧭 ${d.name} ${trip}, and ${SHOWS[show].text}! ${SHOWS[show].icon}`, spot.id);
}

/** The show goes on (a treasure hunt spills snacks as it goes), then ends. */
function updateShow(spot: Spot) {
  const { show, tank } = spot;
  if (!show) return;
  const explorer = tank.creatures.get(show.who);
  while (spot.treasure.length && tank.world.time >= spot.treasure[0]) {
    spot.treasure.shift();
    const x = clamp((explorer?.pose.x ?? tank.world.width / 2) / tank.world.width + (Math.random() - 0.5) * 0.3, 0.05, 0.95);
    tank.food.drop(tank.world, x);
    broadcastTo(spot.id, { type: 'feed', x });
  }
  if (tank.world.time < spot.showEnds && explorer) return;
  if (spot.doc?.id !== show.who) explorer?.star?.(false);
  tank.startParade(null);
  spot.show = null;
  spot.treasure = [];
}

/** The ⚙️ menu's 🧭: an explorer comes here now (one that's here already puts on another show). */
function callExplorer(spot: Spot, id?: string) {
  const able = explorers().filter((d) => (!id || d.id === id) && tour(d).includes(spot.id));
  if (!able.length) {
    return explorers().length
      ? `🧭 No explorer can live ${at(spot)}: try another place.`
      : '🧭 There are no explorers yet: tick 🧭 Explorer when you draw an animal.';
  }
  if (spot.show) return '🧭 There\u2019s a show on here already!';
  const away = able.filter((d) => journeys[d.id]?.place !== spot.id);
  const d = (away.length ? away : able)[Math.floor(Math.random() * (away.length || able.length))];
  if (!journeys[d.id]) {
    const here = individuals.find((i) => i.id === d.id)?.place ?? spot.id;
    journeys[d.id] = { place: here, next: { at: 0, to: '' }, visited: [here] };
  }
  travel(d, spot.id);
  return `🧭 Here comes ${d.name}!`;
}

/** Feeding time, from a click on a screen or a Feed button: in one place, or (no place) everywhere. */
export function feed(x: number, place?: string) {
  const list = spotOf(place) ? [spotOf(place)!] : [...spots.values()];
  for (const spot of list) {
    spot.tank.food.drop(spot.tank.world, x);
    broadcastTo(spot.id, { type: 'feed', x });
    if (!spot.feeding) spot.feeding = { until: Date.now() + 40_000, eaten: new Map() };
  }
}

/**
 * Two fish have a baby. Two of the same species lay an egg of their kind right here; two different species
 * make a whole new one, which needs a screen to blend their pictures (it then lays the egg, see babies.ts).
 * force (the ⚙️ menu) picks any two grown-up fish and skips the wait between eggs.
 */
function askForEgg(spot: Spot, force: boolean, pair?: [string, string]): string {
  const { tank } = spot;
  let ids =
    pair ??
    [...tank.creatures.values()]
      .filter((c) => c.kind !== 'egg' && c.pose.out && tank.canParent(c.drawing))
      .sort(() => Math.random() - 0.5)
      .map((c) => c.id);
  if (ids.length < 2) return '🥚 It takes two grown-up animals (fish, or animals on land) to have a baby.';
  // The ⚙️ menu's egg is the exciting kind, a new species, when there are two to pick from.
  if (!pair) {
    const other = ids.find((id) => tank.specOf(id)!.drawing.id !== tank.specOf(ids[0])!.drawing.id);
    if (other) ids = [ids[0], other];
  }
  const [mum, dad] = ids;
  const a = tank.creatures.get(mum)!;
  const b = tank.creatures.get(dad)!;
  const nest = clamp((a.pose.x + b.pose.x) / 2 / tank.world.width, 0.05, 0.95);
  const now = Date.now();

  if (a.drawing.id === b.drawing.id) {
    if (!force && now - spot.lastEgg < SPECIES_EGG_GAP) return '🥚 Not time for another egg yet.';
    spot.lastEgg = now;
    const species = a.drawing;
    const id = `${species.id}~${Math.random().toString(36).slice(2, 8)}`;
    // On land, only fliers lay eggs: everyone else has their baby right away, and it grows up over a week.
    const born = tank.world.land && habitatOf(motionOf(species)) !== 'flier';
    individuals.push({ id, species: species.id, place: spot.id, hatchAt: born ? now : now + HATCH_TIME, nest });
    resync();
    if (born) {
      record('hatch', who(mum, dad), `🍼 Two ${species.name}s had a baby ${at(spot)}!`, spot.id);
      return `🍼 Two ${species.name}s are having a baby!`;
    }
    record('egg', who(mum), `🥚 Two ${species.name}s laid an egg ${at(spot)}.`, spot.id);
    return `🥚 Two ${species.name}s are laying an egg!`;
  }

  const lastEgg = Math.max(0, ...listDrawings().filter((d) => d.parents).map((d) => d.createdAt));
  if (!force && now - lastEgg < EGG_GAP) return '🥚 Not time for another egg yet.';
  if (!sendToOne({ type: 'egg:make', parents: [a.drawing.id, b.drawing.id], nest, place: spot.id, now: force })) {
    return '🥚 Open the aquarium on a screen to lay an egg.';
  }
  return `🥚 ${nameOf(mum, true)} and ${nameOf(dad)} are laying an egg!`;
}

/** Turns a place's simulation notes into history (only the notable ones) and babies. */
function readNotes(spot: Spot, now: number) {
  const { tank } = spot;
  const k = (kind: string) => `${spot.id}:${kind}`;
  for (const note of tank.world.notes) {
    switch (note.kind) {
      case 'chase':
        if (note.seconds > 5 && now_ok(k('chase'), 10)) {
          record(
            'chase',
            who(note.hunter, note.prey),
            note.hid
              ? `🙈 ${nameOf(note.hunter, true)} went prowling after ${nameOf(note.prey)}, who hid until the coast was clear.`
              : `🦈 ${nameOf(note.hunter, true)} chased ${nameOf(note.prey)} around ${placeName(spot.id)}, but never caught up.`,
            spot.id,
          );
        }
        break;
      case 'scare':
        if (now_ok(k('scare'), 10)) {
          record('scare', who(note.who, note.hunter), `🐡 ${nameOf(note.who, true)} puffed up into a spiky ball to scare off ${nameOf(note.hunter)}.`, spot.id);
        }
        break;
      case 'school':
        if (now_ok(k('school'), 15)) {
          record('school', who(note.leader, ...note.members), `🐟 ${nameOf(note.leader, true)} led a school with ${listNames(note.members.map((m) => nameOf(m)))} ${at(spot)}.`, spot.id);
        }
        break;
      case 'school-end': {
        const [a, b] = [tank.creatures.get(note.leader)?.drawing, tank.creatures.get(note.first)?.drawing];
        if (a && b && tank.canParent(a) && tank.canParent(b) && Math.random() < 0.5) askForEgg(spot, false, [note.leader, note.first]);
        break;
      }
      case 'hatch': {
        const d = drawingOf(speciesOf(note.who));
        if (isNamed(note.who)) {
          record('hatch', [note.who, ...(d?.parents ?? [])], `🐣 ${d?.name ?? 'A baby'} hatched ${at(spot)}! A baby of ${listNames((d?.parents ?? []).map((id) => nameOf(id)))}.`, spot.id);
        } else if (d) {
          record('hatch', [d.id], `🐣 A baby ${d.name} hatched ${at(spot)}!`, spot.id);
        }
        break;
      }
      case 'ate':
        spot.feeding?.eaten.set(note.who, (spot.feeding.eaten.get(note.who) ?? 0) + 1);
        break;
      case 'out':
        if (isNamed(note.who) && now_ok(`out:${note.who}`, 8 * 60)) record('night-out', [note.who], `🌙 ${nameOf(note.who)} came out for the night ${at(spot)}.`, spot.id);
        break;
    }
  }
  tank.world.notes.length = 0;

  if (spot.feeding && now > spot.feeding.until) {
    const [top] = [...spot.feeding.eaten].sort((a, b) => b[1] - a[1]);
    if (top && now_ok(k('feed'), 20)) {
      record('feed', who(top[0]), `🍤 Dinner time ${at(spot)}! ${nameOf(top[0], true)} gobbled up the most, ${top[1]} ${spot.tank.world.land ? 'seed' : 'flake'}${top[1] === 1 ? '' : 's'}.`, spot.id);
    }
    spot.feeding = null;
  }
}

/** Night and morning come to everywhere at once. */
function updateNight() {
  const isNight = spots.get('lake')!.tank.isNight;
  if (isNight === wasNight) return;
  wasNight = isNight;
  if (now_ok(wasNight ? 'night' : 'morning', 60)) record(wasNight ? 'night' : 'morning', [], wasNight ? '🌙 Night fell over the world.' : '🌅 Morning came to the world.');
}

const HOLIDAYS: [keyof Season, string][] = [
  ['halloween', '🎃 Halloween came: jack-o\'-lanterns glowed on the sand.'],
  ['snow', '❄️ Winter came, and snow began drifting down through the water.'],
  ['lights', '🎄 Twinkling holiday lights went up along the water.'],
  ['valentine', '💕 Valentine\'s week: hearts floated up from the sand.'],
];

function everyMinute() {
  const today = seasonOf();
  for (const [key, text] of HOLIDAYS) if (today[key] && !lastSeason[key]) record('holiday', [], text);
  lastSeason = today;
  // Only the originals' birthdays make the history: there'd be no end of them otherwise.
  for (const spot of spots.values()) {
    for (const c of spot.tank.creatures.values()) {
      if (isNamed(c.id) && c.kind !== 'egg' && spot.tank.grownUp(c.id) && !grown.has(c.id)) {
        grown.add(c.id);
        record('grown', [c.id], `🎂 ${c.drawing.name} is all grown up: a whole week old!`, spot.id);
      }
    }
  }
}

// --- drawings coming and going (from the routes) ------------------------------------------------------

/** A new species: its original moves in (and members turn up). Returns the place the original lives. */
export function drawingAdded(drawing: Drawing): string {
  resync(new Set([drawing.id]));
  const place = individuals.find((i) => i.id === drawing.id)?.place ?? '';
  spotOf(place)?.fresh.add(drawing.id);
  return place;
}

/** An edited drawing: if it now lives somewhere new, it arrives there with company, as a new one would. */
export function drawingUpdated(drawing: Drawing) {
  resync(new Set([drawing.id]));
}

export function drawingRemoved() {
  resync();
}

