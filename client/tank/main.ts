import { Application, Assets, Container, RenderLayer, Text, type Texture } from 'pixi.js';
import { imageUrl, motionOf, type Drawing, type Motion, type TankCommand, type TankCommandValue } from '../../shared/types.ts';
import { connectLive, feedFish, fetchDrawings, layEgg, sendTankCommand } from '../shared/api.ts';
import { Glow, loadGlow, type GlowTextures } from './glow.ts';
import { makeEgg } from './babies.ts';
import { Egg } from './behaviors/egg.ts';
import { Documentary, aboutOf } from './documentary.ts';
import { Events } from './events.ts';
import { Seasons, seasonOf, type Season } from './seasons.ts';
import { Sounds } from './sounds.ts';
import { Decor } from './behaviors/decor.ts';
import { Plant } from './behaviors/plant.ts';
import { Swimmer } from './behaviors/swimmer.ts';
import { CAPS, bucketOf, createCreature } from './creatures.ts';
import { Food } from './food.ts';
import { loadCutout, type Cutout } from './parts.ts';
import { Scene } from './scene.ts';
import { newWorld, type Creature, type Hideout } from './world.ts';

interface Entry {
  creature: Creature;
  texture: Texture;
  /** Drawings with animated parts are split into their own textures, freed with the entry. */
  cutout?: Cutout;
  /** Glowing paint, and (for an egg) the textures waiting for the baby. */
  glow?: Glow;
  glowTextures?: GlowTextures | null;
  fade: number;
  removing: boolean;
}

interface Label {
  text: Text;
  entry: Entry;
  remaining: number;
}

const FADE_SECONDS = 1.5;
const FLOOR = 0.86;

const app = new Application();
await app.init({ resizeTo: window, antialias: true, background: 0x0a3456, autoDensity: true, resolution: devicePixelRatio });
document.body.append(app.canvas);

const scene = new Scene();
const food = new Food();
const world = newWorld(scene, food);
const creatureLayer = new Container({ sortableChildren: true });
/** Night creatures sit above the night tint, so they stay bright while the rest of the tank dims. */
const nightLayer = new Container({ sortableChildren: true });
const labelLayer = new Container();
food.view.zIndex = 500;
creatureLayer.addChild(food.view);
const emptyMessage = new Text({
  text: `The tank is empty.\nDraw something at ${location.host}/draw/`,
  style: { fontFamily: 'Trebuchet MS, sans-serif', fontSize: 32, fill: 0xffffff, align: 'center' },
  anchor: 0.5,
  alpha: 0.75,
});
const seasons = new Seasons();
const params = new URLSearchParams(location.search);
/** Far-off visitors swim between the water and the creatures; close ones in front. */
const eventBack = new Container();
const eventFront = new Container();
scene.back.addChild(seasons.back, eventBack);
/** Everything in the tank, so documentary mode can zoom in on it; labels and the name card stay on top. */
const camera = new Container();
/** Glowing paint is drawn above the night tint (while staying with its creature), so it shines in the dark. */
const glowLayer = new RenderLayer();
camera.addChild(scene.back, creatureLayer, eventFront, scene.front, nightLayer, glowLayer, seasons.glow);
const documentary = new Documentary(camera, params.has('doc') ? 5 : undefined);
// Packs of rare events: the ocean ones always, plus seasonal ones. ?events=a,b picks them by hand.
const packsFor = (season: Season) => params.get('events')?.split(',') ?? ['ocean', ...(season.halloween ? ['spooky'] : [])];
const events = new Events(
  { back: eventBack, front: eventFront },
  packsFor(seasons.season),
  params.has('event') ? 3 : undefined,
);
const sounds = new Sounds();
scene.onBloop = () => sounds.bubble();
app.stage.addChild(camera, documentary.spotlight, labelLayer, documentary.card, emptyMessage);
// A handle for poking at the tank from the browser console.
Object.assign(window, {
  doodlearium: { app, world, entries: () => entries, layEgg: (pair?: Swimmer[]) => tryForEgg(true, pair, true), film: () => film(), visit: (name?: string) => events.trigger(world, name) },
});

const entries = new Map<string, Entry>();
/** Old versions of edited drawings, fading out while the new version fades in. */
const retiring: Entry[] = [];
const loading = new Set<string>();
const labels: Label[] = [];
/** Every drawing the server has, by id, for parents' names. */
const known = new Map<string, Drawing>();
let nextRandomLabel = 12;

function relayoutIfResized() {
  const { width, height } = app.screen;
  if (width === world.width && height === world.height) return;
  world.width = width;
  world.height = height;
  world.floorY = height * FLOOR;
  scene.layout(world);
  seasons.layout(world);
  for (const { creature } of entries.values()) creature.layout(world);
  emptyMessage.position.set(width / 2, height * 0.42);
}
relayoutIfResized();

async function addDrawing(drawing: Drawing, dropIn: boolean) {
  known.set(drawing.id, drawing);
  if (entries.has(drawing.id) || loading.has(drawing.id)) return;
  loading.add(drawing.id);
  let texture: Texture;
  let cutout: Cutout | undefined;
  try {
    if (drawing.parts?.length) {
      cutout = await loadCutout(drawing, imageUrl(drawing));
      texture = cutout.body;
    } else {
      texture = await Assets.load<Texture>(imageUrl(drawing));
    }
  } catch (err) {
    console.warn(`Could not load ${drawing.id}`, err);
    return;
  } finally {
    loading.delete(drawing.id);
  }
  const glowTextures = drawing.glow ? await loadGlow(drawing).catch(() => null) : null;

  const egg = (drawing.hatchAt ?? 0) > Date.now();
  const creature = egg ? new Egg(drawing, texture, world, dropIn) : createCreature(drawing, texture, world, dropIn, cutout?.pieces);
  const entry: Entry = { creature, texture, cutout, glowTextures, fade: 0, removing: false };
  if (!egg) attachGlow(entry);
  creature.view.alpha = 0;
  entries.set(drawing.id, entry);
  (drawing.nocturnal ? nightLayer : creatureLayer).addChild(creature.view);
  enforceCap(drawing);

  if (egg) {
    entry.fade = dropIn ? 1 : 0;
    if (dropIn) showLabel(entry, 10, '', `🥚 An egg from ${parentNames(drawing)}!`);
  } else if (dropIn) {
    entry.fade = 1;
    const { x } = creature.labelAnchor();
    scene.burst(x, 0);
    // A night creature added in daytime says hello, then goes back to sleep until dark.
    showLabel(entry, 8, isAwake(entry) ? '' : '🌙 comes out at night');
  }
}

function attachGlow(entry: Entry) {
  const body = entry.creature.body;
  if (entry.glowTextures && body) entry.glow = new Glow(body, entry.glowTextures, glowLayer, entry.creature.moving);
}

const isAwake = (entry: Entry) => entry.creature instanceof Egg || !entry.creature.drawing.nocturnal || scene.isNight;

const parentNames = (d: Drawing) => (d.parents ?? []).map((id) => known.get(id)?.name ?? '?').join(' & ');

/** The egg cracks and the baby swims out right where it was. */
function hatch(entry: Entry) {
  const egg = entry.creature as Egg;
  const at = egg.position;
  const baby = createCreature(egg.drawing, entry.texture, world, false, entry.cutout?.pieces);
  if (baby instanceof Swimmer) baby.placeAt(at);
  (egg.drawing.nocturnal ? nightLayer : creatureLayer).addChild(baby.view);
  baby.view.alpha = entry.fade;
  egg.view.destroy({ children: true });
  entry.creature = baby;
  attachGlow(entry);
  scene.burst(at.x, at.y, 16);
  sounds.chime();
  for (const l of labels.filter((l) => l.entry === entry)) l.remaining = 0;
  updateLabels(0);
  showLabel(entry, 12, `🐣 just hatched! Baby of ${parentNames(egg.drawing)}`);
}

let nextEggTry = 0;
/**
 * Two fish that just schooled together sometimes lay an egg. The server keeps eggs rare, whichever tank asks.
 * force (from the console) skips the dice and the waiting, but not the server's limit.
 */
function tryForEgg(force = false, pair?: Swimmer[], now = false): Promise<string> {
  if (!force && (document.hidden || world.time < nextEggTry || Math.random() < 0.5)) return Promise.resolve('');
  const parents = (pair ?? [...world.fish].sort(() => Math.random() - 0.5)).filter(
    (f) => !f.drawing.parents && motionOf(f.drawing) === 'fish',
  );
  if (parents.length < 2) return Promise.resolve('🥚 It takes two 🐟 Fish (not babies) in the tank to lay an egg.');
  const [mum, dad] = parents;
  nextEggTry = world.time + 600;
  const nest = (mum.x + dad.x) / 2 / world.width;
  return makeEgg(mum.drawing, dad.drawing, nest)
    .then((egg) => layEgg(egg, now))
    .then((ok) => (ok ? `🥚 ${mum.drawing.name} and ${dad.drawing.name} laid an egg!` : '🥚 Not time for another egg yet.'))
    .catch((err) => {
      console.warn('Could not lay an egg', err);
      return "🥚 Couldn't lay an egg.";
    });
}

let nextSchoolAt = 40 + Math.random() * 40;
/** Every couple of minutes a few fish team up and follow a leader for a while. */
function updateSchool() {
  const school = world.school;
  if (school) {
    if (world.time > school.until || !world.fish.includes(school.leader)) {
      if (world.time > school.until && school.members[0]) void tryForEgg(false, [school.leader, school.members[0]]);
      world.school = null;
    }
    else school.members = school.members.filter((m) => world.fish.includes(m));
    return;
  }
  if (world.time < nextSchoolAt || world.sleepiness > 0.4) return;
  nextSchoolAt = world.time + 70 + Math.random() * 80;
  const candidates = world.fish.filter((f) => f.style.schools && f.personality !== 'shy').sort(() => Math.random() - 0.5);
  if (candidates.length < 3) return;
  const [leader, ...rest] = candidates;
  world.school = { leader, members: rest.slice(0, 2 + Math.floor(Math.random() * 4)), until: world.time + 25 };
}

function removeDrawing(id: string) {
  const entry = entries.get(id);
  if (entry) entry.removing = true;
}

async function replaceDrawing(drawing: Drawing) {
  const old = entries.get(drawing.id);
  if (old) {
    entries.delete(drawing.id);
    old.removing = true;
    retiring.push(old);
  }
  await addDrawing(drawing, false);
  const updated = entries.get(drawing.id);
  if (updated) showLabel(updated, 6);
}

/** One misbehaving drawing must never freeze the whole tank: it is taken out instead. */
function safeUpdate(entry: Entry, dt: number) {
  try {
    entry.creature.update(dt, world);
  } catch (err) {
    console.error(`Removing ${entry.creature.drawing.name} after an animation error`, err);
    entry.removing = true;
    entry.fade = 0;
  }
}

function destroyEntry({ creature, cutout, glow, glowTextures }: Entry) {
  if (glow) glow.destroy();
  else {
    for (const t of glowTextures ? [glowTextures, ...glowTextures.pieces] : []) {
      t.glow?.destroy(true);
      t.uv?.destroy(true);
    }
  }
  creature.view.destroy({ children: true });
  if (cutout) cutout.destroy();
  else void Assets.unload(imageUrl(creature.drawing));
}

/** Keeps only the newest N of the drawing's type in the tank. */
function enforceCap(drawing: Drawing) {
  const sameType = [...entries.values()]
    .filter((e) => !e.removing && bucketOf(e.creature.drawing) === bucketOf(drawing))
    .sort((a, b) => b.creature.drawing.createdAt - a.creature.drawing.createdAt);
  for (const old of sameType.slice(CAPS[bucketOf(drawing)])) old.removing = true;
}

/** Brings the tank in line with the server: on first connect and after every reconnect. */
async function sync() {
  const drawings = await fetchDrawings();
  for (const d of drawings) known.set(d.id, d);
  const ids = new Set(drawings.map((d) => d.id));
  for (const id of entries.keys()) if (!ids.has(id)) removeDrawing(id);
  const newestFirst = [...drawings].sort((a, b) => b.createdAt - a.createdAt);
  const counts = { swimmer: 0, crawler: 0, plant: 0, decor: 0, baby: 0 };
  for (const d of newestFirst) {
    if (counts[bucketOf(d)]++ >= CAPS[bucketOf(d)]) continue;
    const shown = entries.get(d.id)?.creature.drawing;
    if (shown && shown.updatedAt !== d.updatedAt) void replaceDrawing(d);
    else void addDrawing(d, false);
  }
}

function showLabel(entry: Entry, seconds: number, note = '', title?: string) {
  if (labels.some((l) => l.entry === entry)) return;
  const { name, artist } = entry.creature.drawing;
  const text = new Text({
    text: title ?? `${name}\nby ${artist}${note ? `\n${note}` : ''}`,
    style: {
      fontFamily: 'Trebuchet MS, sans-serif',
      fontSize: Math.max(16, world.height * 0.022),
      fontWeight: 'bold',
      fill: 0xffffff,
      align: 'center',
      stroke: { color: 0x06243b, width: 4, join: 'round' },
    },
    anchor: { x: 0.5, y: 1 },
    alpha: 0,
  });
  labelLayer.addChild(text);
  labels.push({ text, entry, remaining: seconds });
}

function updateLabels(dt: number) {
  for (let i = labels.length - 1; i >= 0; i--) {
    const label = labels[i];
    label.remaining -= dt;
    const creature = label.entry.creature;
    if (label.remaining <= 0 || creature.view.destroyed || entries.get(creature.drawing.id) !== label.entry) {
      label.text.destroy();
      labels.splice(i, 1);
      continue;
    }
    const { x, y } = camera.toGlobal(creature.labelAnchor());
    const half = label.text.width / 2 + 4;
    label.text.position.set(Math.min(Math.max(x, half), world.width - half), Math.max(label.text.height + 4, y));
    label.text.alpha = Math.min(1, label.remaining, creature.view.alpha + 0.5);
  }

  nextRandomLabel -= dt;
  if (nextRandomLabel <= 0 && !documentary.filming) {
    nextRandomLabel = 15 + Math.random() * 15;
    const visible = [...entries.values()].filter((e) => !e.removing && e.fade > 0.9);
    if (visible.length) showLabel(visible[Math.floor(Math.random() * visible.length)], 5);
  }
}

/** Who the documentary can film: anything out and about that moves. */
const filmable = () =>
  [...entries.values()]
    .filter((e) => !e.removing && e.fade > 0.9 && !(e.creature instanceof Egg) && ['swimmer', 'crawler'].includes(e.creature.drawing.type))
    .map((e) => e.creature);

const describe = (c: Creature) => {
  const d = c.drawing;
  const lines = [];
  if (d.parents) lines.push(`baby of ${parentNames(d)}`);
  const days = Math.floor((Date.now() - d.createdAt) / 86_400_000);
  lines.push(days < 1 ? 'new to the tank today' : `in the tank for ${days} day${days === 1 ? '' : 's'}`);
  if (d.nocturnal) lines.push('a night creature 🌙');
  return lines;
};

function film() {
  for (const l of labels) l.remaining = Math.min(l.remaining, 0.5);
  documentary.start(world, filmable(), describe);
}

let currentIn = 150 + Math.random() * 150;
let currentFor = 0;
let currentDir = 1;
function startCurrent() {
  currentFor = 25;
  currentDir = Math.random() < 0.5 ? -1 : 1;
  currentIn = 200 + Math.random() * 250;
}

/** Every few minutes a gentle current sweeps through for a little while. */
function updateCurrent(dt: number) {
  currentIn -= dt;
  if (currentIn <= 0 && currentFor <= 0) startCurrent();
  currentFor = Math.max(0, currentFor - dt);
  // Swells up and dies away smoothly.
  world.current = currentDir * world.height * 0.03 * Math.sin((currentFor / 25) * Math.PI) ** 2;
}

app.ticker.add((ticker) => {
  const dt = Math.min(ticker.deltaMS / 1000, 0.1);
  world.time += dt;
  relayoutIfResized();
  scene.update(dt, world);
  seasons.update(dt, world, scene.darkness);
  updateCurrent(dt);
  events.update(dt, world);

  world.sleepiness = Math.min(1, scene.darkness / 0.5);
  // Glow paint is brightest in the dark; blacklight paint only shines under the blacklight.
  const glowLevel = 0.4 + scene.darkness * 1.2 + scene.blacklight * 0.3;
  const uvLevel = scene.blacklight * 1.1;
  world.fish = [];
  const hideouts: Hideout[] = [];
  for (const entry of entries.values()) {
    if (entry.removing || entry.fade <= 0.5) continue;
    const c = entry.creature;
    if (c instanceof Swimmer) world.fish.push(c);
    else if (c instanceof Plant || c instanceof Decor) hideouts.push(c.hideout());
  }
  world.hideouts = hideouts;
  updateSchool();
  food.update(dt, world);

  for (const [id, entry] of entries) {
    const { creature } = entry;
    const wanted = !entry.removing && isAwake(entry);
    entry.fade = Math.max(0, Math.min(1, entry.fade + (wanted ? dt : -dt) / FADE_SECONDS));
    creature.view.alpha = entry.fade;
    if (entry.removing && entry.fade === 0) {
      destroyEntry(entry);
      entries.delete(id);
      continue;
    }
    if (!wanted && entry.fade === 0) continue; // asleep until night
    if (creature instanceof Egg && creature.ready) hatch(entry);
    safeUpdate(entry, dt);
    entry.glow?.update(glowLevel, uvLevel);
  }
  for (let i = retiring.length - 1; i >= 0; i--) {
    const entry = retiring[i];
    entry.fade = Math.max(0, entry.fade - dt / FADE_SECONDS);
    entry.creature.view.alpha = entry.fade;
    safeUpdate(entry, dt);
    entry.glow?.update(glowLevel, uvLevel);
    if (entry.fade === 0) {
      destroyEntry(entry);
      retiring.splice(i, 1);
    }
  }

  documentary.update(dt, world, filmable, describe);
  updateLabels(dt);
  emptyMessage.visible = entries.size === 0 && loading.size === 0;
});

connectLive(
  (msg) => {
    if (msg.type === 'drawing:added') void addDrawing(msg.drawing, true);
    else if (msg.type === 'drawing:updated') void replaceDrawing(msg.drawing);
    else if (msg.type === 'feed') {
      food.drop(world, msg.x);
      [0, 0.25, 0.5].forEach((delay) => setTimeout(() => sounds.plop(), delay * 1000 + Math.random() * 150));
    }
    else if (msg.type === 'tank') runCommand(msg.command, msg.value);
    else removeDrawing(msg.id);
  },
  () => void sync().catch((err) => console.warn('Sync failed', err)),
);

// Clicking the tank drops food right there, in every open tank. On a touch screen, the first tap only
// brings the buttons back.
let tapWoke = false;
app.canvas.addEventListener('click', (e) => {
  if (!menu.hidden) {
    showMenu(false);
    return;
  }
  if (tapWoke) return;
  const at = camera.toLocal({ x: e.clientX, y: e.clientY });
  void feedFish(Math.min(1, Math.max(0, at.x / world.width))).catch(() => {});
});

// Keys for trying things out: D films a documentary, V brings a visitor, S toggles sound, B the blacklight.
addEventListener('keydown', (e) => {
  if (e.key === 'd') film();
  else if (e.key === 'v') events.trigger(world);
  else if (e.key === 's') toggleSound();
  else if (e.key === 'b') void command('blacklight', !scene.blacklightOn);
  else if (e.key === 'Escape') showMenu(false);
});

// --- the ⚙️ menu: time, holidays, the blacklight and happenings, on this screen or every tank -------------

const menu = document.querySelector<HTMLDivElement>('#menu')!;
const menuStatus = document.querySelector<HTMLParagraphElement>('#menu-status')!;
const everyTank = document.querySelector<HTMLInputElement>('#every-tank')!;
try {
  everyTank.checked = localStorage.getItem('doodlearium.everyTank') !== 'off';
} catch {}
everyTank.onchange = () => {
  try {
    localStorage.setItem('doodlearium.everyTank', everyTank.checked ? 'on' : 'off');
  } catch {}
};

function showMenu(open: boolean) {
  menu.hidden = !open;
  wake();
}
document.querySelector<HTMLButtonElement>('#menu-toggle')!.onclick = () => showMenu(Boolean(menu.hidden));
document.querySelector<HTMLButtonElement>('#menu-close')!.onclick = () => showMenu(false);

const NO_SEASON: Season = { snow: false, halloween: false, lights: false, valentine: false };
const SEASONS: Record<string, Season> = {
  none: NO_SEASON,
  halloween: { ...NO_SEASON, halloween: true },
  christmas: { ...NO_SEASON, snow: true, lights: true },
  snow: { ...NO_SEASON, snow: true },
  valentine: { ...NO_SEASON, valentine: true },
};

let statusTimer = 0;
function say(text: string) {
  menuStatus.textContent = text;
  clearTimeout(statusTimer);
  statusTimer = window.setTimeout(() => (menuStatus.textContent = ''), 6000);
}

/** Does a menu command here; commands from other screens arrive through the live feed. */
function runCommand(cmd: TankCommand, value: TankCommandValue) {
  switch (cmd) {
    case 'time':
      scene.hour = typeof value === 'number' ? value % 24 : null;
      break;
    case 'season': {
      const season = (typeof value === 'string' && SEASONS[value]) || seasonOf();
      seasons.set(season, world);
      events.packs = packsFor(season);
      break;
    }
    case 'blacklight':
      scene.blacklightOn = value === true;
      break;
    case 'film':
      film();
      break;
    case 'visit':
      events.trigger(world, typeof value === 'string' ? value : undefined);
      break;
    case 'current':
      startCurrent();
      break;
    case 'school':
      world.school = null;
      nextSchoolAt = 0;
      break;
    case 'puff':
      for (const f of world.fish) f.puffUp();
      break;
    case 'egg':
      // Laid by whichever tank was asked; every tank then sees it arrive.
      void tryForEgg(true, undefined, true).then((text) => text && say(text));
      break;
  }
  // Keep this screen's menu showing what's on.
  const group = menu.querySelector(`[data-group="${cmd}"]`);
  if (group) {
    const shown = value === null ? 'auto' : value === true ? 'on' : value === false ? 'off' : String(value);
    for (const b of group.querySelectorAll('button')) b.setAttribute('aria-pressed', String(b.dataset.value === shown));
  }
}

/** A menu button: sent to every tank (this one included) or just done here. */
async function command(cmd: TankCommand, value: TankCommandValue = null) {
  if (everyTank.checked && cmd !== 'egg') {
    try {
      await sendTankCommand(cmd, value);
      return;
    } catch {
      say("Couldn't reach the other tanks, so just this one.");
    }
  }
  runCommand(cmd, value);
}

const parseValue = (v: string | undefined): TankCommandValue =>
  v === undefined || v === 'auto' ? null : v === 'on' ? true : v === 'off' ? false : Number.isFinite(Number(v)) ? Number(v) : v;

menu.querySelectorAll<HTMLButtonElement>('[data-cmd]').forEach((b) => {
  b.onclick = () => {
    const cmd = b.dataset.cmd!;
    if (cmd === 'feed') {
      void feedFish().then((ok) => say(ok ? '🍤 Dinner time!' : '🍤 The fish are still eating.')).catch(() => {});
      return;
    }
    if (cmd === 'egg') say('🥚 Looking for two fish…');
    void command(cmd as TankCommand, parseValue(b.dataset.value));
  };
});
// Show what the address asked for.
if (scene.blacklightOn) runCommand('blacklight', true);

// --- who's who: hover over (or tap) a creature to see its details ----------------------------------------

const STYLE_NAMES: Record<Motion, string> = {
  fish: '🐟 Fish',
  puffer: '🐡 Puffer',
  eel: '🐍 Eel',
  jelly: '🪼 Jellyfish',
  seahorse: '🦄 Seahorse',
  flapper: '🐢 Glider',
  vessel: '🚢 Vessel',
  crawler: '🦀 Crawler',
  plant: '🌿 Plant',
  decor: '🏰 Decoration',
};

const info = document.querySelector<HTMLDivElement>('#info')!;
let infoTimer = 0;

/** Where each texture is solid, at a small size, so hovering only counts on the drawing itself. */
const solidMaps = new WeakMap<Texture, { data: Uint8ClampedArray; w: number; h: number }>();
function solidMap(texture: Texture) {
  let map = solidMaps.get(texture);
  if (map) return map;
  const scale = Math.min(1, 96 / Math.max(texture.width, texture.height));
  const w = Math.max(1, Math.round(texture.width * scale));
  const h = Math.max(1, Math.round(texture.height * scale));
  const c = Object.assign(document.createElement('canvas'), { width: w, height: h }).getContext('2d', { willReadFrequently: true })!;
  try {
    c.drawImage(texture.source.resource as CanvasImageSource, 0, 0, w, h);
    map = { data: c.getImageData(0, 0, w, h).data, w, h };
  } catch {
    map = { data: new Uint8ClampedArray(w * h * 4).fill(255), w, h };
  }
  solidMaps.set(texture, map);
  return map;
}

/** True if the point is on the creature's drawing (or very near it), not the empty water around it. */
function touches(entry: Entry, x: number, y: number) {
  const body = entry.creature.body as (Container & { texture?: Texture; anchor?: { x: number; y: number } }) | undefined;
  const texture = body?.texture;
  if (!body || !texture) return true;
  const p = body.toLocal({ x, y });
  // Meshes are laid out in texture pixels; sprites around their anchor.
  const u = p.x / texture.width + (body.anchor?.x ?? 0);
  const v = p.y / texture.height + (body.anchor?.y ?? 0);
  if (u < 0 || u > 1 || v < 0 || v > 1) return false;
  const map = solidMap(texture);
  // A little slack around the edges, since the drawing bends as it swims.
  for (const [du, dv] of [[0, 0], [2, 0], [-2, 0], [0, 2], [0, -2]]) {
    const px = Math.min(map.w - 1, Math.max(0, Math.floor(u * map.w) + du));
    const py = Math.min(map.h - 1, Math.max(0, Math.floor(v * map.h) + dv));
    if (map.data[(py * map.w + px) * 4 + 3] > 40) return true;
  }
  return false;
}

/** The creature under a point on screen; night creatures and nearer ones are on top. */
function creatureAt(x: number, y: number) {
  let best: Entry | null = null;
  let bestZ = -Infinity;
  for (const entry of entries.values()) {
    const view = entry.creature.view;
    if (entry.removing || entry.fade < 0.5) continue;
    const b = view.getBounds();
    if (x < b.x || x > b.x + b.width || y < b.y || y > b.y + b.height || !touches(entry, x, y)) continue;
    const z = view.zIndex + (view.parent === nightLayer ? 10_000 : 0);
    if (z > bestZ) {
      best = entry;
      bestZ = z;
    }
  }
  return best;
}

function showInfo(x: number, y: number) {
  const entry = creatureAt(x, y);
  info.hidden = !entry;
  if (!entry) return;
  const c = entry.creature;
  const d = c.drawing;
  const lines =
    c instanceof Egg
      ? [`an egg from ${parentNames(d)}`, `hatching in about ${Math.max(1, Math.ceil(((d.hatchAt ?? 0) - Date.now()) / 60_000))} min`]
      : [STYLE_NAMES[motionOf(d)], ...describe(c), aboutOf(c), d.glow ? '✨ has glowing paint' : ''];
  const b = document.createElement('b');
  b.textContent = c instanceof Egg ? '🥚 Egg' : d.name;
  const by = document.createElement('div');
  by.textContent = `by ${d.artist}`;
  info.replaceChildren(b, by, ...lines.filter(Boolean).map((t) => Object.assign(document.createElement('div'), { textContent: t })));
  const w = info.offsetWidth;
  const h = info.offsetHeight;
  info.style.left = `${Math.min(x + 16, innerWidth - w - 8)}px`;
  info.style.top = `${y + h + 24 > innerHeight ? y - h - 12 : y + 18}px`;
}

app.canvas.addEventListener('pointermove', (e) => {
  if (e.pointerType === 'mouse') showInfo(e.clientX, e.clientY);
});
app.canvas.addEventListener('pointerleave', () => (info.hidden = true));
app.canvas.addEventListener('pointerdown', (e) => {
  tapWoke = e.pointerType !== 'mouse' && document.body.classList.contains('idle');
  if (e.pointerType === 'mouse') return;
  // Touch screens: a tap shows who's there for a few seconds.
  showInfo(e.clientX, e.clientY);
  clearTimeout(infoTimer);
  infoTimer = window.setTimeout(() => (info.hidden = true), 3500);
});

const soundButton = document.querySelector<HTMLButtonElement>('#sound')!;
const showSound = () => (soundButton.textContent = sounds.enabled ? '🔊' : '🔇');
function toggleSound() {
  sounds.toggle();
  showSound();
}
soundButton.onclick = toggleSound;
showSound();

// --- TV niceties: fullscreen on double-click, hide the idle cursor, keep the screen awake ---

addEventListener('dblclick', () => {
  if (document.fullscreenElement) void document.exitFullscreen();
  else void document.documentElement.requestFullscreen().catch(() => {});
});

let idleTimer = 0;
/** Brings back the buttons and cursor, which hide again once nobody's touched anything for a few seconds. */
function wake() {
  document.body.classList.remove('idle');
  clearTimeout(idleTimer);
  idleTimer = window.setTimeout(() => {
    if (!menu.hidden) return;
    document.body.classList.add('idle');
    info.hidden = true;
  }, 3500);
}
addEventListener('pointermove', wake);
// On the window, so it runs after the canvas has seen whether this tap woke things up.
addEventListener('pointerdown', wake);
wake();

async function keepAwake() {
  try {
    await navigator.wakeLock?.request('screen');
  } catch {}
}
void keepAwake();
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') void keepAwake();
});
