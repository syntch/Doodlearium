import { Application, Assets, Container, Text, type Texture } from 'pixi.js';
import { imageUrl, type Drawing } from '../../shared/types.ts';
import { connectLive, feedFish, fetchDrawings } from '../shared/api.ts';
import { Swimmer } from './behaviors/swimmer.ts';
import { CAPS, createCreature } from './creatures.ts';
import { Food } from './food.ts';
import { Scene } from './scene.ts';
import type { Creature, World } from './world.ts';

interface Entry {
  creature: Creature;
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
const world: World = { width: 0, height: 0, floorY: 0, time: 0, scene, food, fish: [], school: null };
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
app.stage.addChild(scene.back, creatureLayer, scene.front, nightLayer, labelLayer, emptyMessage);
// A handle for poking at the tank from the browser console.
Object.assign(window, { doodlearium: { world } });

const entries = new Map<string, Entry>();
/** Old versions of edited drawings, fading out while the new version fades in. */
const retiring: Entry[] = [];
const loading = new Set<string>();
const labels: Label[] = [];
let nextRandomLabel = 12;

function relayoutIfResized() {
  const { width, height } = app.screen;
  if (width === world.width && height === world.height) return;
  world.width = width;
  world.height = height;
  world.floorY = height * FLOOR;
  scene.layout(world);
  for (const { creature } of entries.values()) creature.layout(world);
  emptyMessage.position.set(width / 2, height * 0.42);
}
relayoutIfResized();

async function addDrawing(drawing: Drawing, dropIn: boolean) {
  if (entries.has(drawing.id) || loading.has(drawing.id)) return;
  loading.add(drawing.id);
  let texture: Texture;
  try {
    texture = await Assets.load<Texture>(imageUrl(drawing));
  } catch (err) {
    console.warn(`Could not load ${drawing.id}`, err);
    return;
  } finally {
    loading.delete(drawing.id);
  }

  const creature = createCreature(drawing, texture, world, dropIn);
  const entry: Entry = { creature, fade: 0, removing: false };
  creature.view.alpha = 0;
  entries.set(drawing.id, entry);
  (drawing.nocturnal ? nightLayer : creatureLayer).addChild(creature.view);
  enforceCap(drawing);

  if (dropIn) {
    entry.fade = 1;
    const { x } = creature.labelAnchor();
    scene.burst(x, 0);
    // A night creature added in daytime says hello, then goes back to sleep until dark.
    showLabel(entry, 8, isAwake(entry) ? '' : '🌙 comes out at night');
  }
}

const isAwake = (entry: Entry) => !entry.creature.drawing.nocturnal || scene.isNight;

let nextSchoolAt = 40 + Math.random() * 40;
/** Every couple of minutes a few fish team up and follow a leader for a while. */
function updateSchool() {
  const school = world.school;
  if (school) {
    if (world.time > school.until || !world.fish.includes(school.leader)) world.school = null;
    else school.members = school.members.filter((m) => world.fish.includes(m));
    return;
  }
  if (world.time < nextSchoolAt) return;
  nextSchoolAt = world.time + 70 + Math.random() * 80;
  const candidates = world.fish.filter((f) => f.personality !== 'shy').sort(() => Math.random() - 0.5);
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

function destroyEntry({ creature }: Entry) {
  creature.view.destroy({ children: true });
  void Assets.unload(imageUrl(creature.drawing));
}

/** Keeps only the newest N of the drawing's type in the tank. */
function enforceCap(drawing: Drawing) {
  const sameType = [...entries.values()]
    .filter((e) => !e.removing && e.creature.drawing.type === drawing.type)
    .sort((a, b) => b.creature.drawing.createdAt - a.creature.drawing.createdAt);
  for (const old of sameType.slice(CAPS[drawing.type])) old.removing = true;
}

/** Brings the tank in line with the server: on first connect and after every reconnect. */
async function sync() {
  const drawings = await fetchDrawings();
  const ids = new Set(drawings.map((d) => d.id));
  for (const id of entries.keys()) if (!ids.has(id)) removeDrawing(id);
  const newestFirst = [...drawings].sort((a, b) => b.createdAt - a.createdAt);
  const counts = { swimmer: 0, plant: 0, decor: 0 };
  for (const d of newestFirst) {
    if (counts[d.type]++ >= CAPS[d.type]) continue;
    const shown = entries.get(d.id)?.creature.drawing;
    if (shown && shown.updatedAt !== d.updatedAt) void replaceDrawing(d);
    else void addDrawing(d, false);
  }
}

function showLabel(entry: Entry, seconds: number, note = '') {
  if (labels.some((l) => l.entry === entry)) return;
  const { name, artist } = entry.creature.drawing;
  const text = new Text({
    text: `${name}\nby ${artist}${note ? `\n${note}` : ''}`,
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
    const { x, y } = label.entry.creature.labelAnchor();
    label.text.position.set(x, Math.max(label.text.height + 4, y));
    label.text.alpha = Math.min(1, label.remaining, label.entry.creature.view.alpha + 0.5);
    if (label.remaining <= 0 || entries.get(label.entry.creature.drawing.id) !== label.entry) {
      label.text.destroy();
      labels.splice(i, 1);
    }
  }

  nextRandomLabel -= dt;
  if (nextRandomLabel <= 0) {
    nextRandomLabel = 15 + Math.random() * 15;
    const visible = [...entries.values()].filter((e) => !e.removing && e.fade > 0.9);
    if (visible.length) showLabel(visible[Math.floor(Math.random() * visible.length)], 5);
  }
}

app.ticker.add((ticker) => {
  const dt = Math.min(ticker.deltaMS / 1000, 0.1);
  world.time += dt;
  relayoutIfResized();
  scene.update(dt, world);

  world.fish = [];
  for (const entry of entries.values()) {
    if (entry.creature instanceof Swimmer && !entry.removing && entry.fade > 0.5) world.fish.push(entry.creature);
  }
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

  updateLabels(dt);
  emptyMessage.visible = entries.size === 0 && loading.size === 0;
});

connectLive(
  (msg) => {
    if (msg.type === 'drawing:added') void addDrawing(msg.drawing, true);
    else if (msg.type === 'drawing:updated') void replaceDrawing(msg.drawing);
    else if (msg.type === 'feed') food.drop(world, msg.x);
    else removeDrawing(msg.id);
  },
  () => void sync().catch((err) => console.warn('Sync failed', err)),
);

// Clicking the tank drops food right there, in every open tank.
app.canvas.addEventListener('click', (e) => void feedFish(e.clientX / innerWidth).catch(() => {}));

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
