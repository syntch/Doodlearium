import { Application, Assets, Container, RenderLayer, Text, type Texture } from 'pixi.js';
import { imageUrl, motionOf, type Drawing, type Motion, type TankCommand, type TankCommandValue } from '../../shared/types.ts';
import { newPose, type Kind, type Personality, type Pose } from '../../shared/sim/creature.ts';
import { unpackPose, type RosterEntry, type Settings, type Upcoming } from '../../shared/sim/protocol.ts';
import { FLOOR_Y, WORLD_H, WORLD_W } from '../../shared/sim/world.ts';
import { connectLive, feedFish, fetchDrawings, layEgg, scheduleTankCommand, sendTankCommand } from '../shared/api.ts';
import { Glow, loadGlow, type GlowTextures } from './glow.ts';
import { makeEgg } from './babies.ts';
import { Documentary, aboutOf } from './documentary.ts';
import { Events } from './events.ts';
import { Seasons } from './seasons.ts';
import { Sounds } from './sounds.ts';
import { createCreature } from './creatures.ts';
import { Food } from './food.ts';
import { loadCutout, type Cutout } from './parts.ts';
import { Scene } from './scene.ts';
import { Timeline } from './timeline.ts';
import type { Creature, World } from './world.ts';

/**
 * The tank, drawn from the server's world: the server decides where everyone is and what happens
 * (shared/sim, server/world.ts), so every screen shows the same tank. This page draws it, about a fifth of
 * a second behind, with all the wiggling, bending, glowing and bubbling done here.
 */

interface Entry {
  drawing: Drawing;
  kind: Kind;
  personality?: Personality;
  creature: Creature;
  texture: Texture;
  /** Drawings with animated parts are split into their own textures, freed with the entry. */
  cutout?: Cutout;
  /** Glowing paint, and (for an egg) the textures waiting for the baby. */
  glow?: Glow;
  glowTextures?: GlowTextures | null;
  /** Where it is right now (plants and decorations: where they always are). */
  pose: Pose;
  still: boolean;
  fade: number;
  removing: boolean;
}

interface Label {
  text: Text;
  entry: Entry;
  remaining: number;
}

const FADE_SECONDS = 1.5;
/** Night creatures come out once it's getting properly dark (the same rule as shared/sim/tank.ts). */
const NIGHT = 0.25;

const app = new Application();
await app.init({ resizeTo: window, antialias: true, background: 0x0a3456, autoDensity: true, resolution: devicePixelRatio });
document.body.append(app.canvas);

const scene = new Scene();
const food = new Food();
const world: World = { width: WORLD_W, height: WORLD_H, floorY: FLOOR_Y, time: 0, scene, current: 0 };
const timeline = new Timeline();
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
/** Far-off visitors swim between the water and the creatures; close ones in front. */
const eventBack = new Container();
const eventFront = new Container();
scene.back.addChild(seasons.back, eventBack);
/** Everything in the tank, in tank units, so documentary mode can zoom in on it. */
const camera = new Container();
/** Scales the tank to fit the screen; labels and the name card stay on top at screen size. */
const fit = new Container();
fit.addChild(camera);
/** Glowing paint is drawn above the night tint (while staying with its creature), so it shines in the dark. */
const glowLayer = new RenderLayer();
camera.addChild(scene.back, creatureLayer, eventFront, scene.front, nightLayer, glowLayer, seasons.glow);
const documentary = new Documentary(camera);
const events = new Events({ back: eventBack, front: eventFront });
const sounds = new Sounds();
scene.onBloop = () => sounds.bubble();
app.stage.addChild(fit, documentary.spotlight, labelLayer, documentary.card, emptyMessage);
// A handle for poking at the tank from the browser console.
Object.assign(window, {
  doodlearium: { app, world, timeline, entries: () => entries, pose: (id: string) => entries.get(id)?.pose },
});

const entries = new Map<string, Entry>();
/** Old versions of edited drawings, fading out while the new version fades in. */
const retiring: Entry[] = [];
const loading = new Set<string>();
const labels: Label[] = [];
/** Every drawing the server has, by id, for parents' names. */
const known = new Map<string, Drawing>();
/** Who the server says is in the tank. */
let roster: RosterEntry[] = [];
let nextRandomLabel = 12;

const screenSize = { width: 0, height: 0 };
function relayoutIfResized() {
  const { width, height } = app.screen;
  if (width === screenSize.width && height === screenSize.height) return;
  Object.assign(screenSize, { width, height });
  // The whole tank fits on every screen; a screen of another shape sees more water above or sand below.
  // A tall phone would make it tiny, so there it's a bit bigger and the far ends are cut off.
  const s = Math.min(width / WORLD_W, height / WORLD_H) * (width < height ? Math.min(1.6, height / WORLD_H / (width / WORLD_W)) : 1);
  fit.scale.set(s);
  fit.position.set((width - WORLD_W * s) / 2, (height - WORLD_H * s) / 2);
  scene.layout(world, { left: -fit.x / s, top: -fit.y / s, right: (width - fit.x) / s, bottom: (height - fit.y) / s });
  seasons.layout(world);
  emptyMessage.position.set(width / 2, height * 0.42);
  // The coming-up card goes under the buttons, however many rows they wrap onto.
  coming.style.top = `${document.querySelector('nav')!.getBoundingClientRect().bottom + 8}px`;
}
const coming = document.querySelector<HTMLDivElement>('#coming')!;
relayoutIfResized();

const parentNames = (d: Drawing) => (d.parents ?? []).map((id) => known.get(id)?.name ?? '?').join(' & ');

/** Brings the screen in line with who the server says is in the tank. */
function applyRoster() {
  const ids = new Set(roster.map((r) => r.id));
  for (const [id, entry] of entries) if (!ids.has(id)) entry.removing = true;
  let missing = false;
  for (const r of roster) {
    const drawing = known.get(r.id);
    if (!drawing) {
      missing = true;
      continue;
    }
    const entry = entries.get(r.id);
    if (!entry) void addEntry(drawing, r);
    else if (entry.removing) continue;
    else if (entry.drawing.updatedAt !== drawing.updatedAt) void replaceEntry(drawing, r);
    else if (entry.kind === 'egg' && r.kind !== 'egg') hatch(entry, r);
    else {
      entry.personality = r.personality;
      if (r.still) unpackPose(r.still, entry.pose);
    }
  }
  if (missing) void refreshDrawings();
}

let refreshing: Promise<void> | null = null;
/** Fetches the drawings again (one the server mentioned isn't known here yet). */
function refreshDrawings() {
  refreshing ??= fetchDrawings()
    .then((drawings) => {
      for (const d of drawings) known.set(d.id, d);
      for (const r of roster) if (!known.has(r.id)) console.warn(`The tank has ${r.id}, but it isn't in the drawings`);
      applyRoster();
    })
    .catch((err) => console.warn('Could not load drawings', err))
    .finally(() => setTimeout(() => (refreshing = null), 2000));
  return refreshing;
}

async function addEntry(drawing: Drawing, r: RosterEntry) {
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
  // It may have hatched (or gone) while loading.
  const now = roster.find((x) => x.id === drawing.id);
  if (!now || entries.has(drawing.id)) {
    if (cutout) cutout.destroy();
    else void Assets.unload(imageUrl(drawing));
    return;
  }

  const creature = createCreature(drawing, now.kind, texture, cutout?.pieces);
  const pose = newPose();
  if (now.still) unpackPose(now.still, pose);
  const entry: Entry = {
    drawing, kind: now.kind, personality: now.personality, creature, texture, cutout, glowTextures, pose,
    still: Boolean(now.still), fade: 0, removing: false,
  };
  if (now.kind !== 'egg') attachGlow(entry);
  creature.view.alpha = 0;
  entries.set(drawing.id, entry);
  (drawing.nocturnal ? nightLayer : creatureLayer).addChild(creature.view);

  if (r.fresh && now.kind === 'egg') {
    entry.fade = 1;
    showLabel(entry, 10, '', `🥚 An egg from ${parentNames(drawing)}!`);
  } else if (r.fresh) {
    entry.fade = 1;
    // A night creature added in daytime says hello, then goes back to sleep until dark.
    showLabel(entry, 8, isAwake(entry) ? '' : '🌙 comes out at night');
  }
}

function attachGlow(entry: Entry) {
  const body = entry.creature.body;
  if (entry.glowTextures && body) entry.glow = new Glow(body, entry.glowTextures, glowLayer, entry.creature.moving);
}

const isAwake = (entry: Entry) => entry.kind === 'egg' || !entry.drawing.nocturnal || scene.darkness >= NIGHT;

/** The egg cracks and the baby swims out (the server has put it where the egg was). */
function hatch(entry: Entry, r: RosterEntry) {
  const egg = entry.creature;
  const baby = createCreature(entry.drawing, r.kind, entry.texture, entry.cutout?.pieces);
  (entry.drawing.nocturnal ? nightLayer : creatureLayer).addChild(baby.view);
  baby.view.alpha = entry.fade;
  egg.view.destroy({ children: true });
  entry.creature = baby;
  entry.kind = r.kind;
  entry.personality = r.personality;
  attachGlow(entry);
  sounds.chime();
  for (const l of labels.filter((l) => l.entry === entry)) l.remaining = 0;
  updateLabels(0);
  showLabel(entry, 12, `🐣 just hatched! Baby of ${parentNames(entry.drawing)}`);
}

async function replaceEntry(drawing: Drawing, r: RosterEntry) {
  const old = entries.get(drawing.id);
  if (old) {
    entries.delete(drawing.id);
    old.removing = true;
    retiring.push(old);
  }
  await addEntry(drawing, r);
  const updated = entries.get(drawing.id);
  if (updated) showLabel(updated, 6);
}

/** One misbehaving drawing must never freeze the whole tank: it is taken out instead. */
function safeUpdate(entry: Entry, dt: number) {
  try {
    entry.creature.update(dt, world, entry.pose);
  } catch (err) {
    console.error(`Hiding ${entry.drawing.name} after an animation error`, err);
    entry.removing = true;
    entry.fade = 0;
  }
}

function destroyEntry({ creature, cutout, glow, glowTextures, drawing }: Entry) {
  if (glow) glow.destroy();
  else {
    for (const t of glowTextures ? [glowTextures, ...glowTextures.pieces] : []) {
      t.glow?.destroy(true);
      t.uv?.destroy(true);
    }
  }
  creature.view.destroy({ children: true });
  if (cutout) cutout.destroy();
  else void Assets.unload(imageUrl(drawing));
}

function showLabel(entry: Entry, seconds: number, note = '', title?: string) {
  if (labels.some((l) => l.entry === entry)) return;
  const { name, artist } = entry.drawing;
  const text = new Text({
    text: title ?? `${name}\nby ${artist}${note ? `\n${note}` : ''}`,
    style: {
      fontFamily: 'Trebuchet MS, sans-serif',
      fontSize: Math.max(16, screenSize.height * 0.022),
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
    if (label.remaining <= 0 || creature.view.destroyed || entries.get(label.entry.drawing.id) !== label.entry) {
      label.text.destroy();
      labels.splice(i, 1);
      continue;
    }
    const { x, y } = camera.toGlobal(creature.labelAnchor());
    const half = label.text.width / 2 + 4;
    label.text.position.set(Math.min(Math.max(x, half), screenSize.width - half), Math.max(label.text.height + 4, y));
    label.text.alpha = Math.min(1, label.remaining, creature.view.alpha + 0.5);
  }

  nextRandomLabel -= dt;
  if (nextRandomLabel <= 0 && !documentary.filming) {
    nextRandomLabel = 15 + Math.random() * 15;
    const visible = [...entries.values()].filter((e) => !e.removing && e.fade > 0.9);
    if (visible.length) showLabel(visible[Math.floor(Math.random() * visible.length)], 5);
  }
}

const describe = (d: Drawing) => {
  const lines = [];
  if (d.parents) lines.push(`baby of ${parentNames(d)}`);
  const days = Math.floor((Date.now() - d.createdAt) / 86_400_000);
  lines.push(days < 1 ? 'new to the tank today' : `in the tank for ${days} day${days === 1 ? '' : 's'}`);
  if (d.nocturnal) lines.push('a night creature 🌙');
  return lines;
};

const cardLines = (c: Creature) => {
  const entry = entries.get(c.drawing.id);
  return [...describe(c.drawing), aboutOf(c.drawing, entry?.personality)];
};

/** What the ⚙️ menu shows as on, last time it was updated. */
let settingsShown = '';

app.ticker.add((ticker) => {
  const dt = Math.min(ticker.deltaMS / 1000, 0.1);
  relayoutIfResized();
  timeline.advance(dt, (e) => scene.play(e));
  world.time = timeline.time;
  const frame = timeline.latest;
  if (frame) {
    scene.darkness = frame.darkness;
    scene.blacklight = frame.blacklight;
    world.current = frame.current;
    seasons.set(frame.season, world);
    showSettings(frame.settings);
  }
  scene.update(dt, world);
  seasons.update(dt, world, scene.darkness);
  events.update(dt, world, frame?.visit ?? null);
  food.draw(timeline.flakes(), world.time);

  // Glow paint is brightest in the dark; blacklight paint only shines under the blacklight.
  const glowLevel = 0.4 + scene.darkness * 1.2 + scene.blacklight * 0.3;
  const uvLevel = scene.blacklight * 1.1;
  for (const [id, entry] of entries) {
    const { creature } = entry;
    const placed = entry.still || timeline.pose(id, entry.pose) !== null;
    const wanted = !entry.removing && placed && isAwake(entry);
    entry.fade = Math.max(0, Math.min(1, entry.fade + (wanted ? dt : -dt) / FADE_SECONDS));
    creature.view.alpha = entry.fade;
    if (entry.removing && entry.fade === 0) {
      destroyEntry(entry);
      entries.delete(id);
      continue;
    }
    if (!placed || (!wanted && entry.fade === 0)) continue; // asleep until night
    safeUpdate(entry, dt);
    entry.glow?.update(glowLevel, uvLevel);
  }
  for (let i = retiring.length - 1; i >= 0; i--) {
    const entry = retiring[i];
    entry.fade = Math.max(0, entry.fade - dt / FADE_SECONDS);
    entry.creature.view.alpha = entry.fade;
    if (!entry.still) timeline.pose(entry.drawing.id, entry.pose);
    safeUpdate(entry, dt);
    entry.glow?.update(glowLevel, uvLevel);
    if (entry.fade === 0) {
      destroyEntry(entry);
      retiring.splice(i, 1);
    }
  }

  const starring = frame?.doc ? entries.get(frame.doc.id) : undefined;
  documentary.update(dt, world, screenSize, starring && !starring.removing ? starring.creature : null, cardLines);
  if (documentary.filming) for (const l of labels) l.remaining = Math.min(l.remaining, 0.5);
  updateLabels(dt);
  showComingUp();
  emptyMessage.visible = roster.length === 0;
});

connectLive(
  (msg) => {
    switch (msg.type) {
      case 'frame':
        timeline.push(msg.frame);
        break;
      case 'roster':
        roster = msg.creatures;
        applyRoster();
        break;
      case 'upcoming':
        upcoming = msg.items;
        break;
      case 'drawing:added':
      case 'drawing:updated':
        known.set(msg.drawing.id, msg.drawing);
        applyRoster();
        break;
      case 'drawing:removed':
        known.delete(msg.id);
        break;
      case 'feed':
        [0, 0.25, 0.5].forEach((delay) => setTimeout(() => sounds.plop(), delay * 1000 + Math.random() * 150));
        break;
      case 'egg:make':
        void makeEggFor(msg.parents, msg.nest, msg.now);
        break;
    }
  },
  () => void refreshDrawings(),
);

/** The server asked this screen to blend two parents into a baby (that takes a browser) and lay its egg. */
async function makeEggFor([mumId, dadId]: [string, string], nest: number, now: boolean) {
  const mum = known.get(mumId);
  const dad = known.get(dadId);
  if (!mum || !dad) return;
  try {
    await layEgg(await makeEgg(mum, dad, nest), now);
  } catch (err) {
    console.warn('Could not lay an egg', err);
  }
}

// Clicking the tank drops food right there (on every screen). On a touch screen, the first tap only
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
  if (e.target instanceof HTMLInputElement) return;
  if (e.key === 'd') void command('film');
  else if (e.key === 'v') void command('visit');
  else if (e.key === 's') toggleSound();
  else if (e.key === 'b') void command('blacklight', !(timeline.latest?.settings.blacklight ?? false));
  else if (e.key === 'Escape') showMenu(false);
});

// --- the ⚙️ menu: time, holidays, the blacklight and happenings, now or later -----------------------------

const menu = document.querySelector<HTMLDivElement>('#menu')!;
const menuStatus = document.querySelector<HTMLParagraphElement>('#menu-status')!;
const later = document.querySelector<HTMLInputElement>('#later')!;
const laterTime = document.querySelector<HTMLInputElement>('#later-time')!;
laterTime.oninput = () => (later.checked = true);

function showMenu(open: boolean) {
  menu.hidden = !open;
  wake();
}
document.querySelector<HTMLButtonElement>('#menu-toggle')!.onclick = () => showMenu(Boolean(menu.hidden));
document.querySelector<HTMLButtonElement>('#menu-close')!.onclick = () => showMenu(false);

let statusTimer = 0;
function say(text: string) {
  menuStatus.textContent = text;
  clearTimeout(statusTimer);
  statusTimer = window.setTimeout(() => (menuStatus.textContent = ''), 6000);
}

/** The next time the clock shows hh:mm (today, or tomorrow if that's passed). */
function nextTime(hhmm: string) {
  const [h, m] = hhmm.split(':').map(Number);
  const at = new Date();
  at.setHours(h, m, 0, 0);
  if (at.getTime() < Date.now()) at.setDate(at.getDate() + 1);
  return at;
}

const clock = (d: Date) => d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

/** A menu button: done in the tank now (every screen sees it), or at the time picked. */
async function command(cmd: TankCommand, value: TankCommandValue = null) {
  try {
    if (later.checked && laterTime.value) {
      const at = nextTime(laterTime.value);
      await scheduleTankCommand(cmd, value, at.getTime());
      later.checked = false;
      say(`⏰ Planned for ${clock(at)}.`);
    } else {
      const text = await sendTankCommand(cmd, value);
      if (text) say(text);
    }
  } catch {
    say("Couldn't reach the tank's server.");
  }
}

const parseValue = (v: string | undefined): TankCommandValue =>
  v === undefined || v === 'auto' ? null : v === 'on' ? true : v === 'off' ? false : Number.isFinite(Number(v)) ? Number(v) : v;

menu.querySelectorAll<HTMLButtonElement>('[data-cmd]').forEach((b) => {
  b.onclick = () => {
    const cmd = b.dataset.cmd!;
    if (cmd === 'feed') {
      if (later.checked) {
        say("🍤 Feeding can't be planned ahead (yet): it's now or never!");
        return;
      }
      void feedFish().then((ok) => say(ok ? '🍤 Dinner time!' : '🍤 The fish are still eating.')).catch(() => {});
      return;
    }
    void command(cmd as TankCommand, parseValue(b.dataset.value));
  };
});

/** Keeps the menu showing what's on in the tank. */
function showSettings(settings: Settings) {
  const key = JSON.stringify(settings);
  if (key === settingsShown) return;
  settingsShown = key;
  const shown: Record<string, string> = {
    time: settings.hour === null ? 'auto' : String(settings.hour),
    season: settings.season ?? 'auto',
    blacklight: settings.blacklight ? 'on' : 'off',
  };
  for (const [group, value] of Object.entries(shown)) {
    for (const b of menu.querySelectorAll(`[data-group="${group}"] button`)) {
      b.setAttribute('aria-pressed', String((b as HTMLElement).dataset.value === value));
    }
  }
}

// --- coming up: the next few happenings, so the family can tune in -----------------------------------------

let upcoming: Upcoming[] = [];
let comingShown = '';
const SOON = 2 * 60_000;

function when(at: number) {
  const left = at - Date.now();
  if (left < 60_000) return 'any moment now';
  if (left < 60 * 60_000) return `in ${Math.round(left / 60_000)} min`;
  const d = new Date(at);
  const today = new Date().toDateString() === d.toDateString();
  return `${today ? '' : `${d.toLocaleDateString([], { weekday: 'short' })} `}at ${clock(d)}`;
}

function showComingUp() {
  const items = upcoming.filter((u) => u.at > Date.now() - 60_000).sort((a, b) => a.at - b.at).slice(0, 3);
  const lines = items.map((u) => ({ text: `${u.icon} ${u.text}`, when: when(u.at), soon: u.at - Date.now() < SOON }));
  const key = JSON.stringify(lines);
  if (key === comingShown) return;
  comingShown = key;
  coming.hidden = !lines.length;
  const title = Object.assign(document.createElement('b'), { textContent: 'Coming up' });
  coming.replaceChildren(
    title,
    ...lines.map((l) => {
      const div = document.createElement('div');
      div.append(`${l.text} `, Object.assign(document.createElement('span'), { textContent: l.when, className: l.soon ? 'soon' : '' }));
      return div;
    }),
  );
  // Something about to happen stays on screen even when the buttons hide.
  coming.classList.toggle('soon-up', lines.some((l) => l.soon));
}

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
  const d = entry.drawing;
  const egg = entry.kind === 'egg';
  const lines = egg
    ? [`an egg from ${parentNames(d)}`, `hatching in about ${Math.max(1, Math.ceil(((d.hatchAt ?? 0) - Date.now()) / 60_000))} min`]
    : [STYLE_NAMES[motionOf(d)], ...describe(d), aboutOf(d, entry.personality), d.glow ? '✨ has glowing paint' : ''];
  const b = document.createElement('b');
  b.textContent = egg ? '🥚 Egg' : d.name;
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

