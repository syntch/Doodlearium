import { Application, Assets, Container, Text, type Texture } from 'pixi.js';
import { imageUrl, motionOf, type Drawing } from '../../shared/types.ts';
import { connectLive, feedFish, fetchDrawings, layEgg } from '../shared/api.ts';
import { makeEgg } from './babies.ts';
import { Egg } from './behaviors/egg.ts';
import { Documentary } from './documentary.ts';
import { Events } from './events.ts';
import { Seasons } from './seasons.ts';
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
camera.addChild(scene.back, creatureLayer, eventFront, scene.front, nightLayer, seasons.glow);
const documentary = new Documentary(camera, params.has('doc') ? 5 : undefined);
// Packs of rare events: the ocean ones always, plus seasonal ones. ?events=a,b picks them by hand.
const events = new Events(
  { back: eventBack, front: eventFront },
  params.get('events')?.split(',') ?? ['ocean', ...(seasons.season.halloween ? ['spooky'] : [])],
  params.has('event') ? 3 : undefined,
);
const sounds = new Sounds();
scene.onBloop = () => sounds.bubble();
app.stage.addChild(camera, labelLayer, documentary.card, emptyMessage);
// A handle for poking at the tank from the browser console.
Object.assign(window, {
  doodlearium: { app, world, layEgg: () => tryForEgg(true), film: () => film(), visit: (name?: string) => events.trigger(world, name) },
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

  const egg = (drawing.hatchAt ?? 0) > Date.now();
  const creature = egg ? new Egg(drawing, texture, world, dropIn) : createCreature(drawing, texture, world, dropIn, cutout?.pieces);
  const entry: Entry = { creature, texture, cutout, fade: 0, removing: false };
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

const isAwake = (entry: Entry) => entry.creature instanceof Egg || !entry.creature.drawing.nocturnal || scene.isNight;

const parentNames = (d: Drawing) => (d.parents ?? []).map((id) => known.get(id)?.name ?? '?').join(' & ');

/** The egg cracks and the baby swims out right where it was. */
function hatch(entry: Entry) {
  const egg = entry.creature as Egg;
  const at = egg.position;
  const baby = createCreature(egg.drawing, entry.texture, world, false);
  if (baby instanceof Swimmer) baby.placeAt(at);
  (egg.drawing.nocturnal ? nightLayer : creatureLayer).addChild(baby.view);
  baby.view.alpha = entry.fade;
  egg.view.destroy({ children: true });
  entry.creature = baby;
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
function tryForEgg(force = false, pair?: Swimmer[]) {
  if (!force && (document.hidden || world.time < nextEggTry || Math.random() < 0.5)) return;
  const parents = (pair ?? [...world.fish].sort(() => Math.random() - 0.5)).filter(
    (f) => !f.drawing.parents && motionOf(f.drawing) === 'fish',
  );
  if (parents.length < 2) return;
  const [mum, dad] = parents;
  nextEggTry = world.time + 600;
  const nest = (mum.x + dad.x) / 2 / world.width;
  void makeEgg(mum.drawing, dad.drawing, nest)
    .then(layEgg)
    .catch((err) => console.warn('Could not lay an egg', err));
}

let nextSchoolAt = 40 + Math.random() * 40;
/** Every couple of minutes a few fish team up and follow a leader for a while. */
function updateSchool() {
  const school = world.school;
  if (school) {
    if (world.time > school.until || !world.fish.includes(school.leader)) {
      if (world.time > school.until && school.members[0]) tryForEgg(false, [school.leader, school.members[0]]);
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

function destroyEntry({ creature, cutout }: Entry) {
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
    const { x, y } = camera.toGlobal(label.entry.creature.labelAnchor());
    const half = label.text.width / 2 + 4;
    label.text.position.set(Math.min(Math.max(x, half), world.width - half), Math.max(label.text.height + 4, y));
    label.text.alpha = Math.min(1, label.remaining, label.entry.creature.view.alpha + 0.5);
    if (label.remaining <= 0 || entries.get(label.entry.creature.drawing.id) !== label.entry) {
      label.text.destroy();
      labels.splice(i, 1);
    }
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
/** Every few minutes a gentle current sweeps through for a little while. */
function updateCurrent(dt: number) {
  currentIn -= dt;
  if (currentIn <= 0 && currentFor <= 0) {
    currentFor = 25;
    currentDir = Math.random() < 0.5 ? -1 : 1;
    currentIn = 200 + Math.random() * 250;
  }
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
  }
  for (let i = retiring.length - 1; i >= 0; i--) {
    const entry = retiring[i];
    entry.fade = Math.max(0, entry.fade - dt / FADE_SECONDS);
    entry.creature.view.alpha = entry.fade;
    safeUpdate(entry, dt);
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
    else removeDrawing(msg.id);
  },
  () => void sync().catch((err) => console.warn('Sync failed', err)),
);

// Clicking the tank drops food right there, in every open tank.
app.canvas.addEventListener('click', (e) => {
  const at = camera.toLocal({ x: e.clientX, y: e.clientY });
  void feedFish(Math.min(1, Math.max(0, at.x / world.width))).catch(() => {});
});

// Keys for trying things out: D films a documentary, V brings a visitor, S toggles sound.
addEventListener('keydown', (e) => {
  if (e.key === 'd') film();
  else if (e.key === 'v') events.trigger(world);
  else if (e.key === 's') toggleSound();
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
addEventListener('pointermove', () => {
  document.body.classList.remove('idle');
  clearTimeout(idleTimer);
  idleTimer = window.setTimeout(() => document.body.classList.add('idle'), 3000);
});

async function keepAwake() {
  try {
    await navigator.wakeLock?.request('screen');
  } catch {}
}
void keepAwake();
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') void keepAwake();
});
