import { Application, Assets, Container, Graphics, RenderLayer, Text, Texture } from 'pixi.js';
import { NO_GC } from './nogc.ts';
import { FOLLOW_IDLE_MS, Follow, KIND_NAMES, PRIORITIES, loadFollow, saveFollow } from './follow.ts';
import { UPCOMING_KINDS } from '../../shared/sim/protocol.ts';
import { imageUrl, motionOf, type Drawing, type Motion, type TankCommand, type TankCommandValue } from '../../shared/types.ts';
import { newPose, type Kind, type Personality, type Pose } from '../../shared/sim/creature.ts';
import { unpackPose, type MapSummary, type RosterEntry, type Settings, type Show, type Upcoming } from '../../shared/sim/protocol.ts';
import { WORLD_H, WORLD_W, groundBand, sandY } from '../../shared/sim/world.ts';
import { depthScale, seededRandom } from '../../shared/sim/math.ts';
import { MAP_H, MAP_W, allWorlds, placeById, worldById, worldOf } from '../../shared/world/places.ts';
import {
  arrangeStill,
  connectLive,
  feedFish,
  fetchDrawings,
  fetchUpdateInfo,
  layEgg,
  loadWorlds,
  scheduleTankCommand,
  sendTankCommand,
  showEverywhere,
  startUpdate,
} from '../shared/api.ts';
import { Cover, Glow, loadGlow, type GlowTextures } from './glow.ts';
import { PORTHOLE, WorldMap, type MapLooks } from './map.ts';
import { spaceHaze } from './spacescene.ts';
import { lookOf } from '../../shared/world/looks.ts';
import { BIOME_NAMES } from '../../shared/world/biomes.ts';
import { ALL_VISITORS } from '../../shared/sim/visitors.ts';
import { makeEgg } from './babies.ts';
import { Documentary, aboutOf } from './documentary.ts';
import { Events } from './events.ts';
import { Seasons } from './seasons.ts';
import { Shows } from './shows.ts';
import { Sounds } from './sounds.ts';
import { createCreature } from './creatures.ts';
import { Food } from './food.ts';
import { loadCutout, type Cutout } from './parts.ts';
import { Scene } from './scene.ts';
import { Timeline } from './timeline.ts';
import { setHaze, shapeFor, type Creature, type World } from './world.ts';

/**
 * A place in the world (the Lake, the Pond...), drawn from the server's world: the server decides where
 * everyone is and what happens (shared/sim, server/world.ts), so every screen showing a place shows the same
 * thing. This page draws it, about a fifth of a second behind, with all the wiggling, bending, glowing and
 * bubbling done here.
 */

/** A species' pictures, loaded once and shared by every one of it on screen. */
interface Look {
  key: string;
  drawing: Drawing;
  refs: number;
  ready: Promise<Loaded | null>;
}

interface Loaded {
  texture: Texture;
  /** Drawings with animated parts are split into their own textures. */
  cutout?: Cutout;
  /** With parts: the body and parts put back together, for the map's portholes (made when first needed). */
  whole?: Texture;
  glowTextures: GlowTextures | null;
}

interface Entry {
  /** This creature (a species' original has the drawing's id; the others, "a Clowny", have their own). */
  id: string;
  named: boolean;
  drawing: Drawing;
  look: Look;
  kind: Kind;
  personality?: Personality;
  hatchAt?: number;
  creature: Creature;
  texture: Texture;
  cutout?: Cutout;
  /** Glowing paint, and (for an egg) the textures waiting for the baby. */
  glow?: Glow;
  /** Its dimmed copy among the glows, so it hides glows behind it (see Cover). */
  cover?: Cover;
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
await app.init({ resizeTo: window, antialias: true, background: 0x0a3456, autoDensity: true, resolution: Math.min(devicePixelRatio, 2), ...NO_GC });
// 60 frames a second is plenty for drifting creatures; fast screens would otherwise draw 120-240.
app.ticker.maxFPS = 60;
document.body.append(app.canvas);
/** 🎯 Following the action (see the section below). */
const follow = new Follow(loadFollow());
// A TV's browser can drop the graphics card's state (sleep, power saving, memory); Pixi's restore can leave
// creatures and scenery as scattered shards, so start the screen afresh instead (it remembers its place).
app.canvas.addEventListener('webglcontextlost', (e) => {
  e.preventDefault();
  setTimeout(() => location.reload(), 1500);
});
app.canvas.addEventListener('webglcontextrestored', () => location.reload());

const scene = new Scene();
let mapSummary: MapSummary | null = null;
/** The map only shows species this screen has heard of (the drawings may still be loading). */
const knownOnly = (summary: MapSummary): MapSummary =>
  Object.fromEntries(Object.entries(summary).map(([id, s]) => [id, { ...s, species: s.species.filter((sp) => known.has(sp)) }]));
const food = new Food();
const PLACE_KEY = 'doodlearium:place';
const WORLD_KEY = 'doodlearium:world';
// Which worlds (and places) there are, before anything looks a place up.
await loadWorlds().catch(() => {});
/** The place on screen (null: the map): ?place= (for a bookmark), else the one watched last; the map at first. */
let place: string | null = (() => {
  const asked = new URLSearchParams(location.search).get('place');
  if (asked && placeById(asked)?.live) return asked;
  try {
    const last = localStorage.getItem(PLACE_KEY);
    if (last && placeById(last)?.live) return last;
  } catch {}
  return null;
})();
/** The world whose map this screen shows: its place's, else ?world=, else the one shown last; Earth at first. */
let currentWorld: string = (() => {
  if (place) return worldOf(place).id;
  const asked = new URLSearchParams(location.search).get('world');
  if (worldById(asked ?? undefined)) return asked!;
  try {
    const last = localStorage.getItem(WORLD_KEY);
    if (worldById(last ?? undefined)) return last!;
  } catch {}
  return 'earth';
})();
const firstPlace = placeById(place ?? 'lake')!;
const world: World = { width: WORLD_W, height: WORLD_H, ...shapeFor(firstPlace.biome, firstPlace.look), time: 0, scene, current: 0 };
const timeline = new Timeline();
const creatureLayer = new Container({ sortableChildren: true });
/** Night creatures sit above the night tint, so they stay bright while the rest of the tank dims. */
const nightLayer = new Container({ sortableChildren: true });
const labelLayer = new Container();
food.view.zIndex = 500;
creatureLayer.addChild(food.view);
const emptyMessage = new Text({
  text: `Nobody lives here yet.\nDraw something at ${location.host}/draw/`,
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
const glowLayer = new RenderLayer({ sortableChildren: true });
camera.addChild(scene.back, creatureLayer, eventFront, scene.front, nightLayer, glowLayer, seasons.glow);
const documentary = new Documentary(camera);
const events = new Events({ back: eventBack, front: eventFront, among: creatureLayer });
const sounds = new Sounds();
const shows = new Shows({ back: eventBack, front: eventFront, among: creatureLayer }, sounds);
/** The explorer show whose hello has been said. */
let helloFor = -1;
scene.onBloop = () => sounds.bubble();
/** The map of the world on show; a place's view shows through its porthole while zooming in and out. */
const mapLooks: MapLooks = {
  use(species) {
    const d = known.get(species);
    if (!d) return null;
    const look = useLook(d);
    const motion = motionOf(d);
    const stand = motion === 'plant' || motion === 'decor' ? 'still' : ['walker', 'hopper', 'slitherer', 'crawler'].includes(motion) ? 'walks' : 'swims';
    return { texture: look.ready.then((l) => (l ? wholePicture(l) : null)), release: () => releaseLook(look), stand };
  },
};
function makeMap(id: string) {
  const map = new WorldMap(mapLooks, worldById(id) ?? allWorlds()[0]);
  map.onPick = (place) => enterPlace(place);
  if (mapSummary) map.setSummary(knownOnly(mapSummary));
  return map;
}
let worldMap = makeMap(currentWorld);
/** Draws the map afresh (the world changed, or its places did). */
function replaceMap(id: string) {
  const old = worldMap;
  worldMap = makeMap(id);
  app.stage.addChildAt(worldMap.view, app.stage.getChildIndex(old.view));
  old.view.destroy({ children: true });
}
const porthole = new Graphics();
const mapHint = new Text({
  text: 'Tap a place to dive in',
  style: { fontFamily: 'Trebuchet MS, sans-serif', fontSize: 22, fontWeight: 'bold', fill: 0xffffff, stroke: { color: 0x1d4b6b, width: 5, join: 'round' } },
  anchor: { x: 0.5, y: 1 },
});
app.stage.addChild(worldMap.view, fit, porthole, documentary.spotlight, labelLayer, documentary.card, emptyMessage, mapHint);
// A handle for poking at the tank from the browser console.
Object.assign(window, {
  doodlearium: {
    app, world, timeline, map: () => worldMap, travelTo: (id: string) => travelTo(id), entries: () => entries, looks: () => looks, pose: (id: string) => entries.get(id)?.pose,
    enterPlace: (id: string) => enterPlace(id), showMap: () => showMap(), zoom: () => zoom,
  },
});

const entries = new Map<string, Entry>();
const looks = new Map<string, Look>();
/** Old versions of edited drawings, fading out while the new version fades in. */
const retiring: Entry[] = [];
const loading = new Set<string>();
const labels: Label[] = [];
/** Every drawing the server has, by id, for parents' names. */
const known = new Map<string, Drawing>();
/** Who the server says is in this place. */
let roster: RosterEntry[] = [];
/** How many of each species there are in the whole world. */
let speciesCounts: Record<string, number> = {};
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
  mapHint.position.set(width / 2, height - (width < height ? 44 : 16));
  // The coming-up card goes under the buttons, however many rows they wrap onto.
  coming.style.top = `${document.querySelector('nav')!.getBoundingClientRect().bottom + 8}px`;
}
const coming = document.querySelector<HTMLDivElement>('#coming')!;
const mapButton = document.querySelector<HTMLButtonElement>('#map-button')!;
relayoutIfResized();

const parentNames = (d: Drawing) => (d.parents ?? []).map((id) => known.get(id)?.name ?? '?').join(' & ');
/** "Clowny" for the original, "a Clowny" for the rest. */
const nameOf = (e: Entry) => (e.named ? e.drawing.name : `a ${e.drawing.name}`);
/** "Clownies"-ish: good enough for "two Clownys". */
const plural = (name: string) => (/(s|sh|ch|x)$/i.test(name) ? `${name}es` : `${name}s`);

/** Starts loading a species' pictures (or shares the ones already loaded). Give it back with releaseLook. */
function useLook(drawing: Drawing): Look {
  const key = `${drawing.id}@${drawing.updatedAt ?? drawing.createdAt}`;
  let look = looks.get(key);
  if (!look) {
    const ready = (async (): Promise<Loaded | null> => {
      try {
        let texture: Texture;
        let cutout: Cutout | undefined;
        if (drawing.parts?.length) {
          cutout = await loadCutout(drawing, imageUrl(drawing));
          texture = cutout.body;
        } else {
          texture = await Assets.load<Texture>(imageUrl(drawing));
        }
        const glowTextures = drawing.glow ? await loadGlow(drawing).catch(() => null) : null;
        return { texture, cutout, glowTextures };
      } catch (err) {
        console.warn(`Could not load ${drawing.id}`, err);
        return null;
      }
    })();
    look = { key, drawing, refs: 0, ready };
    looks.set(key, look);
  }
  look.refs++;
  return look;
}

/** The whole drawing in one texture: its body with its parts put back where they were drawn. */
function wholePicture(loaded: Loaded) {
  if (!loaded.cutout) return loaded.texture;
  if (!loaded.whole) {
    const body = loaded.cutout.body.source.resource as HTMLCanvasElement;
    const canvas = Object.assign(document.createElement('canvas'), { width: body.width, height: body.height });
    const c = canvas.getContext('2d')!;
    c.drawImage(body, 0, 0);
    for (const piece of loaded.cutout.pieces) c.drawImage(piece.canvas, piece.x, piece.y);
    loaded.whole = Texture.from(canvas);
  }
  return loaded.whole;
}

function releaseLook(look: Look) {
  if (--look.refs > 0) return;
  looks.delete(look.key);
  void look.ready.then((loaded) => {
    if (!loaded) return;
    for (const t of loaded.glowTextures ? [loaded.glowTextures, ...loaded.glowTextures.pieces] : []) {
      t.glow?.destroy(true);
      t.uv?.destroy(true);
      t.halo?.glow?.destroy(true);
      t.halo?.uv?.destroy(true);
    }
    loaded.whole?.destroy(true);
    if (loaded.cutout) loaded.cutout.destroy();
    else void Assets.unload(imageUrl(look.drawing));
  });
}

/** Brings the screen in line with who the server says is in the tank. */
function applyRoster() {
  const ids = new Set(roster.map((r) => r.id));
  for (const [id, entry] of entries) if (!ids.has(id)) entry.removing = true;
  let missing = false;
  for (const r of roster) {
    const drawing = known.get(r.species);
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
      // Not while it's being moved here (the server's catching up).
      if (r.still && !holding(entry)) unpackPose(r.still, entry.pose);
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
      if (mapSummary) worldMap.setSummary(knownOnly(mapSummary));
      for (const r of roster) if (!known.has(r.species)) console.warn(`${place} has ${r.id}, but ${r.species} isn't in the drawings`);
      applyRoster();
    })
    .catch((err) => console.warn('Could not load drawings', err))
    .finally(() => setTimeout(() => (refreshing = null), 2000));
  return refreshing;
}

async function addEntry(drawing: Drawing, r: RosterEntry) {
  const { id } = r;
  if (entries.has(id) || loading.has(id)) return;
  loading.add(id);
  const shownPlace = place;
  const look = useLook(drawing);
  const loaded = await look.ready;
  loading.delete(id);
  // It may have hatched (or gone, or the screen moved on) while loading.
  const now = roster.find((x) => x.id === id);
  if (!loaded || !now || entries.has(id) || place !== shownPlace) {
    releaseLook(look);
    return;
  }
  const { texture, cutout, glowTextures } = loaded;

  const creature = createCreature(drawing, now.kind, texture, cutout?.pieces);
  const pose = newPose();
  if (now.still) unpackPose(now.still, pose);
  const entry: Entry = {
    id, named: Boolean(now.named), drawing, look, kind: now.kind, personality: now.personality, hatchAt: now.hatchAt,
    creature, texture, cutout, glowTextures, pose, still: Boolean(now.still), fade: 0, removing: false,
  };
  if (now.kind !== 'egg') attachGlow(entry);
  creature.view.alpha = 0;
  entries.set(id, entry);
  (drawing.nocturnal ? nightLayer : creatureLayer).addChild(creature.view);

  if (r.fresh && now.kind === 'egg') {
    entry.fade = 1;
    showLabel(entry, 10, '', `🥚 An egg from ${entry.named ? parentNames(drawing) : `two ${plural(drawing.name)}`}!`);
  } else if (r.fresh) {
    entry.fade = 1;
    // A night creature added in daytime says hello, then goes back to sleep until dark.
    showLabel(entry, 8, isAwake(entry) ? '' : '🌙 comes out at night');
  }
}

function attachGlow(entry: Entry) {
  const body = entry.creature.body;
  if (entry.glowTextures && body) entry.glow = new Glow(body, entry.glowTextures, glowLayer, entry.creature.moving);
  if (body && 'texture' in body && 'tint' in body) entry.cover = new Cover(body as Container & { tint: number; texture: Texture }, glowLayer);
}

/** Puts a creature's glow and its cover at its depth among the glows (night creatures, above the tint, on top). */
function layerGlow(entry: Entry, anyGlow: boolean, dim: number) {
  const view = entry.creature.view;
  const night = view.parent === nightLayer;
  const z = view.zIndex * 2 + (night ? 100_000 : 0);
  entry.cover?.update(anyGlow, z, night ? 0 : dim);
  entry.glow?.order(z + 1);
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
  showLabel(entry, 12, entry.named ? `🐣 just hatched! Baby of ${parentNames(entry.drawing)}` : '🐣 just hatched!', entry.named ? undefined : `🐣 A baby ${entry.drawing.name} just hatched!`);
}

async function replaceEntry(drawing: Drawing, r: RosterEntry) {
  const old = entries.get(r.id);
  if (old) {
    entries.delete(r.id);
    old.removing = true;
    retiring.push(old);
  }
  await addEntry(drawing, r);
  const updated = entries.get(r.id);
  if (updated?.named) showLabel(updated, 6);
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

function destroyEntry({ creature, glow, cover, look }: Entry) {
  glow?.destroy(true);
  cover?.destroy();
  creature.view.destroy({ children: true });
  releaseLook(look);
}

function showLabel(entry: Entry, seconds: number, note = '', title?: string) {
  if (labels.some((l) => l.entry === entry)) return;
  const text = new Text({
    text: title ?? `${nameOf(entry)}\nby ${entry.drawing.artist}${note ? `\n${note}` : ''}`,
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
    if (label.remaining <= 0 || creature.view.destroyed || entries.get(label.entry.id) !== label.entry) {
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
    // The originals are introduced more often than the crowd.
    const visible = [...entries.values()].filter((e) => !e.removing && e.fade > 0.9 && (e.named || Math.random() < 0.3));
    if (visible.length) showLabel(visible[Math.floor(Math.random() * visible.length)], 5);
  }
}

/** An explorer just arrived: it's carried in and puts on its show (see shows.ts), and says hello once down. */
function updateShow(dt: number, show: Show | null) {
  if (!show && !shows.showing) return;
  const explorer = show ? entries.get(show.who) : undefined;
  const here = explorer && !explorer.removing ? explorer : undefined;
  const movers = [...entries.values()].filter((e) => e !== explorer && !e.removing && !e.still && e.kind !== 'egg' && e.fade > 0).map((e) => e.creature);
  shows.update(dt, world, show, here?.creature, movers, here?.drawing.name ?? known.get(show?.who ?? '')?.name ?? 'Someone');
  if (show && here && helloFor !== show.seed && shows.landed(world)) {
    helloFor = show.seed;
    const from = show.from !== place && placeById(show.from);
    const far = from && placeById(place ?? '')?.world !== from.world ? ` in ${worldById(from.world)?.name ?? ''}` : '';
    for (const l of labels.filter((l) => l.entry === here)) l.remaining = 0;
    updateLabels(0);
    showLabel(here, 9, from ? `🧭 explorer, just in from ${from.name}${far}` : '🧭 explorer');
  }
}

const describe = (e: Entry) => {
  const d = e.drawing;
  const lines = [];
  if (d.explorer) lines.push('an explorer 🧭, off to see the worlds');
  if (d.parents) lines.push(`baby of ${parentNames(d)}`);
  const count = speciesCounts[d.id] ?? 0;
  if (!e.named && count > 1) lines.push(`one of ${count} ${plural(d.name)} in the world`);
  else {
    const days = Math.floor((Date.now() - d.createdAt) / 86_400_000);
    lines.push(days < 1 ? 'new to the world today' : `in the world for ${days} day${days === 1 ? '' : 's'}`);
  }
  if (d.nocturnal) lines.push('a night creature 🌙');
  return lines;
};

const entryOf = (c: Creature) => [...entries.values()].find((e) => e.creature === c);
const cardLines = (c: Creature) => {
  const entry = entryOf(c);
  return entry ? [...describe(entry), aboutOf(c.drawing, entry.personality)] : [];
};
const cardName = (c: Creature) => {
  const entry = entryOf(c);
  return entry ? nameOf(entry) : c.drawing.name;
};

/** What the ⚙️ menu shows as on, last time it was updated. */
let settingsShown = '';

app.ticker.add((ticker) => {
  const dt = Math.min(ticker.deltaMS / 1000, 0.1);
  relayoutIfResized();
  updateZoom(dt);
  timeline.advance(dt, (e) => scene.play(e));
  world.time = timeline.time;
  const frame = timeline.latest;
  if (frame) {
    scene.darkness = frame.darkness;
    scene.blacklight = frame.blacklight;
    scene.weather = frame.weather ?? [0, 0, 0];
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
  // Covers only matter while something glows; the night tint dims them as it dims the creatures.
  const anyGlow = [...entries.values(), ...retiring].some((e) => e.glow);
  const dim = Math.max(scene.darkness, 0.78 * scene.blacklight);
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
    layerGlow(entry, anyGlow, dim);
  }
  for (let i = retiring.length - 1; i >= 0; i--) {
    const entry = retiring[i];
    entry.fade = Math.max(0, entry.fade - dt / FADE_SECONDS);
    entry.creature.view.alpha = entry.fade;
    if (!entry.still) timeline.pose(entry.id, entry.pose);
    safeUpdate(entry, dt);
    entry.glow?.update(glowLevel, uvLevel);
    layerGlow(entry, anyGlow, dim);
    if (entry.fade === 0) {
      destroyEntry(entry);
      retiring.splice(i, 1);
    }
  }

  updateShow(dt, frame?.show ?? null);

  filmWhenIdle(frame?.doc ?? null);
  // The camera only follows the star on a screen nobody is using, or one that asked for the film.
  const starring = frame?.doc && ((idle() && !follow.busy) || filmAsked) ? entries.get(frame.doc.id) : undefined;
  documentary.update(dt, world, screenSize, starring && !starring.removing ? starring.creature : null, cardLines, cardName);
  if (documentary.filming) for (const l of labels) l.remaining = Math.min(l.remaining, 0.5);
  updateLabels(dt);
  showComingUp();
  emptyMessage.visible = roster.length === 0 && zoom === 1;
});

const send = connectLive(
  (msg) => {
    switch (msg.type) {
      case 'frame':
        if (msg.frame.place === place) timeline.push(msg.frame);
        break;
      case 'roster':
        if (msg.place !== place) break;
        roster = msg.creatures;
        applyRoster();
        break;
      case 'upcoming':
        upcoming = msg.items;
        break;
      case 'map':
        speciesCounts = msg.species;
        mapSummary = msg.places;
        worldMap.setSummary(knownOnly(msg.places));
        break;
      case 'show':
        enterPlace(msg.place);
        break;
      case 'worlds':
        worldsChanged();
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
        void makeEggFor(msg.parents, msg.nest, msg.place, msg.now);
        break;
    }
  },
  () => {
    send({ type: 'watch', place });
    void refreshDrawings();
  },
);

// --- the map and places: zooming through a porthole into a place, and back out ----------------------------


const ZOOM_SECONDS = 1.1;
/** 0 on the map, 1 in a place; eases between the two. */
let zoom = place ? 1 : 0;
let zoomTo = zoom;
/** The place whose porthole the zoom goes through. */
let focus = place ?? 'lake';
/** Going from one place to another: back out to the map, then into this one. */
let nextPlace: string | null = null;

function remember(view: string) {
  try {
    localStorage.setItem(PLACE_KEY, view);
  } catch {}
}

/** Dives into a place from the map (or, from another place, back out and in again; in another world, travel). */
function enterPlace(id: string) {
  if (!placeById(id)?.live) return;
  if (worldOf(id).id !== currentWorld || travel) {
    travelTo(worldOf(id).id, id);
    return;
  }
  if (place === id) {
    zoomTo = 1;
    nextPlace = null;
    return;
  }
  if (place && zoom > 0) {
    nextPlace = id;
    showMap();
    return;
  }
  focus = id;
  watch(id);
  zoomTo = 1;
  remember(id);
}

function showMap() {
  if (arranging) arrange(false);
  zoomTo = 0;
  info.hidden = true;
  remember('map');
}
mapButton.onclick = () => showMap();

// --- travelling between worlds -----------------------------------------------------------------------------

const TRAVEL_SECONDS = 3.2;
/** Off to another world: out to the stars, a rocket across, and into the new world's map. */
let travel: { t: number; to: string; then?: string; swapped: boolean } | null = null;
/** Going to travel once this screen is back out on the map. */
let travelNext: { to: string; then?: string } | null = null;
const stars = new Graphics();
const rocket = new Text({ text: '🚀', style: { fontSize: 64 }, anchor: 0.5 });
const trail = new Graphics();
const travelLayer = new Container();
travelLayer.addChild(stars, trail, rocket);
travelLayer.visible = false;
app.stage.addChild(travelLayer);
const worldsBar = document.querySelector<HTMLDivElement>('#worlds')!;
const tripStars = Array.from({ length: 120 }, (_, i) => {
  const rand = seededRandom(`trip${i}`);
  return { x: rand(), y: rand(), speed: rand(0.6, 1.4), len: rand(0.5, 1), size: rand(1, 2.5), alpha: rand(0.4, 1) };
});

function travelTo(to: string, then?: string) {
  if (!worldById(to)) return;
  if (to === currentWorld && !travel) {
    if (then) enterPlace(then);
    return;
  }
  if (travel) {
    // Already on the way: go on from there.
    travel.to = to;
    travel.then = then;
    return;
  }
  if (place && zoom > 0) {
    travelNext = { to, then };
    showMap();
    return;
  }
  travel = { t: 0, to, then, swapped: false };
  sounds.whoosh();
  renderWorlds();
}

/** How big the map is drawn while travelling (1: as usual), and moves the stars and the rocket along. */
function updateTravel(dt: number) {
  if (!travel) return 1;
  travel.t = Math.min(1, travel.t + dt / TRAVEL_SECONDS);
  const t = travel.t;
  const { width, height } = screenSize;
  // Halfway, while the stars cover everything, the new world's map takes the old one's place.
  if (t >= 0.5 && !travel.swapped) {
    travel.swapped = true;
    currentWorld = travel.to;
    try {
      localStorage.setItem(WORLD_KEY, currentWorld);
    } catch {}
    replaceMap(currentWorld);
  }
  const cover = t < 0.3 ? ease(t / 0.3) : t > 0.7 ? 1 - ease((t - 0.7) / 0.3) : 1;
  travelLayer.visible = true;
  travelLayer.alpha = cover;
  const g = stars.clear().rect(0, 0, width, height).fill(0x050818);
  // Stars stream past, faster in the middle of the trip.
  const speed = Math.sin(t * Math.PI);
  for (const st of tripStars) {
    const x = ((((st.x - t * (1 + speed * 3) * st.speed) % 1) + 1) % 1) * width;
    g.rect(x, st.y * height, 4 + speed * 60 * st.len, st.size).fill({ color: 0xffffff, alpha: st.alpha });
  }
  // The rocket crosses with a sparkly trail.
  const u = Math.min(1, Math.max(0, (t - 0.2) / 0.6));
  const at = (k: number) => ({ x: -80 + k * (width + 160), y: height * 0.5 + Math.sin(k * Math.PI * 2) * height * 0.08 });
  // The emoji points up and to the right; this turns it to head along its path (with a little swing).
  const turn = (k: number) => Math.PI / 4 + Math.cos(k * Math.PI * 2) * 0.25;
  const here = at(u);
  rocket.position.set(here.x, here.y);
  rocket.rotation = turn(u);
  rocket.visible = u > 0 && u < 1;
  const tr = trail.clear();
  for (let i = 1; i < 14; i++) {
    const k = Math.max(0, u - i * 0.012);
    // Out of its tail: straight back from where it was heading then.
    const back = turn(k) - Math.PI / 4 + Math.PI;
    const p = at(k);
    tr.circle(p.x + Math.cos(back) * 30, p.y + Math.sin(back) * 30, 10 - i * 0.6).fill({ color: i % 2 ? 0xffd98a : 0xff7ad9, alpha: (1 - i / 14) * 0.8 });
  }
  if (t >= 1) {
    const then = travel.then;
    travel = null;
    travelLayer.visible = false;
    renderWorlds();
    if (then) enterPlace(then);
    return 1;
  }
  // The old map shrinks away into the stars, and the new one grows out of them.
  return t < 0.5 ? 1 - 0.8 * ease(Math.min(1, t / 0.4)) : 0.2 + 0.8 * ease(Math.max(0, (t - 0.6) / 0.4));
}

/** The worlds strip along the bottom of the map (only when there's more than one world). */
function renderWorlds() {
  const worlds = allWorlds();
  worldsBar.hidden = worlds.length < 2 || zoomTo !== 0 || !!travel;
  if (worldsBar.hidden) return;
  const key = JSON.stringify([currentWorld, worlds.map((w) => [w.id, w.name, w.icon])]);
  if (worldsBar.dataset.key === key) return;
  worldsBar.dataset.key = key;
  worldsBar.replaceChildren(
    ...worlds.map((w) => {
      const b = document.createElement('button');
      b.textContent = `${w.icon} ${w.name}`;
      b.title = w.id === currentWorld ? `You're in ${w.name}` : `Travel to ${w.name}`;
      b.setAttribute('aria-pressed', String(w.id === currentWorld));
      b.onclick = () => travelTo(w.id);
      return b;
    }),
  );
}

/** A world was made, changed, installed or removed: redraw the map, and leave a place (or world) that's gone. */
function worldsChanged() {
  if (place && !placeById(place)) showMap();
  if (!worldById(currentWorld)) {
    travelTo('earth');
    return;
  }
  if (!travel) replaceMap(currentWorld);
  delete worldsBar.dataset.key;
  renderWorlds();
}

/** Shows a place's creatures (null: none, on the map): everyone here goes and the new place's creatures load. */
function watch(id: string | null) {
  if (id === place) return;
  place = id;
  for (const entry of [...entries.values(), ...retiring]) destroyEntry(entry);
  entries.clear();
  retiring.length = 0;
  for (const l of labels) l.text.destroy();
  labels.length = 0;
  roster = [];
  timeline.clear();
  if (id) {
    const p = placeById(id)!;
    Object.assign(world, { land: false, groundDepth: undefined, gravity: undefined }, shapeFor(p.biome, p.look));
    const space = lookOf(p.biome, p.look);
    setHaze(Boolean(world.land), space && spaceHaze(space));
    screenSize.width = 0;
    relayoutIfResized();
  }
  send({ type: 'watch', place });
}

const ease = (t: number) => t * t * (3 - 2 * t);

/** Moves the zoom along: the map's camera dives toward the porthole, and the place shows through it. */
function updateZoom(dt: number) {
  zoom += Math.max(-dt / ZOOM_SECONDS, Math.min(dt / ZOOM_SECONDS, zoomTo - zoom));
  if (zoom === 0 && zoomTo === 0) {
    if (place) watch(null);
    if (travelNext) {
      const { to, then } = travelNext;
      travelNext = null;
      travelTo(to, then);
    } else if (nextPlace) {
      const id = nextPlace;
      nextPlace = null;
      enterPlace(id);
    }
  }
  const { width, height } = screenSize;
  const e = ease(zoom);
  // The whole map fits; a tall phone sees just the places, bigger.
  const portrait = width < height;
  const frame = worldMap.frame();
  const s0 = (portrait ? Math.min(height / MAP_H, width / frame.span) : Math.min(width / MAP_W, height / MAP_H) * 0.98) * updateTravel(dt);
  const c0 = { x: portrait ? frame.x : MAP_W / 2, y: portrait ? frame.y : MAP_H / 2 };
  // Zoomed all the way in, the porthole covers the screen.
  const s1 = (Math.hypot(width, height) / 2 / PORTHOLE) * 1.05;
  const s = s0 * Math.pow(s1 / s0, e);
  const c1 = worldMap.centre(focus);
  // Head for the porthole first, then dive in.
  const k = ease(Math.min(1, zoom * 1.7));
  const cx = c0.x + (c1.x - c0.x) * k;
  const cy = c0.y + (c1.y - c0.y) * k;
  const map = worldMap.view;
  map.visible = zoom < 1;
  map.scale.set(s);
  map.position.set(width / 2 - cx * s, height / 2 - cy * s);
  if (map.visible) worldMap.update(dt, performance.now() / 1000);

  // The place shows through the porthole as it grows, then fills the screen.
  fit.visible = zoom > 0;
  fit.alpha = Math.min(1, Math.max(0, (e - 0.1) / 0.35));
  if (zoom < 1) {
    porthole.clear().circle(map.x + c1.x * s, map.y + c1.y * s, PORTHOLE * s).fill(0xffffff);
    porthole.visible = true;
    fit.mask = porthole;
  } else if (fit.mask) {
    fit.mask = null;
    porthole.visible = false;
  }
  const inPlace = zoom === 1;
  labelLayer.visible = inPlace;
  documentary.card.visible = inPlace;
  documentary.spotlight.visible = inPlace;
  mapHint.alpha = 1 - Math.min(1, zoom * 4);
  mapHint.visible = zoom < 0.25;
  // Above the worlds strip, when it's showing (it fades away with the buttons when nobody's touched the screen for a while).
  mapHint.y = screenSize.height - (screenSize.width < screenSize.height ? 44 : 16) - (worldsBar.hidden || document.body.classList.contains('idle') ? 0 : worldsBar.offsetHeight + 10);
  mapButton.hidden = zoomTo === 0;
  renderWorlds();
}

/** The server asked this screen to blend two parents into a baby (that takes a browser) and lay its egg. */
async function makeEggFor([mumId, dadId]: [string, string], nest: number, where: string, now: boolean) {
  const mum = known.get(mumId);
  const dad = known.get(dadId);
  if (!mum || !dad) return;
  try {
    await layEgg({ ...(await makeEgg(mum, dad, nest)), place: where }, now);
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
  if (tapWoke || zoom < 1 || !place || arranging) return;
  const at = camera.toLocal({ x: e.clientX, y: e.clientY });
  void feedFish(Math.min(1, Math.max(0, at.x / world.width)), place).catch(() => {});
});

// Pinching out (or Ctrl + scroll out) goes back to the map.
app.canvas.addEventListener('wheel', (e) => {
  if (!e.ctrlKey) return;
  e.preventDefault();
  if (e.deltaY > 0 && zoomTo === 1) showMap();
}, { passive: false });
const fingers = new Map<number, { x: number; y: number }>();
let pinchFrom = 0;
const spread = () => {
  const [a, b] = [...fingers.values()];
  return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
};
app.canvas.addEventListener('pointerdown', (e) => {
  if (e.pointerType !== 'touch') return;
  fingers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  pinchFrom = spread();
});
app.canvas.addEventListener('pointermove', (e) => {
  if (!fingers.has(e.pointerId)) return;
  fingers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (pinchFrom && spread() < pinchFrom * 0.65 && zoomTo === 1) {
    pinchFrom = 0;
    showMap();
  }
});
for (const type of ['pointerup', 'pointercancel'] as const) app.canvas.addEventListener(type, (e) => fingers.delete(e.pointerId));

// --- 🎬 documentaries: for a screen nobody's using, like a screensaver -------------------------------------

/** How long with nobody touching the screen before documentaries start. */
const IDLE_MS = 5 * 60_000;
let lastActive = performance.now();
let nextIdleFilm = 0;
/** This screen asked for the documentary that's on (⚙️ or D), so it follows it even while in use. */
let filmAsked = false;
/** When it asked: the film takes a moment to start, so filmAsked holds until then. */
let filmAskedAt = 0;
const idle = () => performance.now() - lastActive >= IDLE_MS;
for (const type of ['pointerdown', 'pointermove', 'wheel', 'keydown', 'touchstart'] as const) {
  addEventListener(type, () => {
    lastActive = performance.now();
    nextIdleFilm = 0;
    follow.stop();
  }, { passive: true, capture: true });
}

/** Once the screen has been left alone a while, films a documentary where it is, and another every so often. */
function filmWhenIdle(doc: { id: string } | null) {
  if (!doc && performance.now() - filmAskedAt > 5000) filmAsked = false;
  if (!idle() || doc || zoomTo !== 1 || !place || follow.busy) return;
  const now = performance.now();
  if (now < nextIdleFilm) return;
  nextIdleFilm = now + (6 + Math.random() * 8) * 60_000;
  void sendTankCommand('film', null, place).catch(() => {});
}

// --- 🎯 following the action: a screen left alone flies to what's about to happen -------------------------

setInterval(() => {
  if (!follow.settings.on || performance.now() - lastActive < FOLLOW_IDLE_MS || arranging || !menu.hidden) return;
  const to = follow.next(upcoming, zoomTo === 1 ? place : null, (p) => Boolean(placeById(p)?.live));
  if (to) enterPlace(to);
}, 1000);

/** The ⚙️ menu's choices for it: on or off, and how much each sort of happening matters. */
function renderFollow() {
  const on = document.querySelector<HTMLInputElement>('#follow-on')!;
  on.checked = follow.settings.on;
  document.querySelector('#follow-summary')!.textContent = follow.settings.on ? '✓ On for this screen' : 'Off for this screen';
  on.onchange = () => {
    follow.settings.on = on.checked;
    saveFollow(follow.settings);
    renderFollow();
  };
  document.querySelector('#follow-kinds')!.replaceChildren(
    ...UPCOMING_KINDS.map((kind) => {
      const row = Object.assign(document.createElement('div'), { className: 'follow-row' });
      row.append(Object.assign(document.createElement('span'), { textContent: KIND_NAMES[kind] }));
      for (const p of PRIORITIES) {
        const b = Object.assign(document.createElement('button'), { textContent: p.label, title: p.title });
        b.setAttribute('aria-pressed', String(follow.settings.priorities[kind] === p.id));
        b.onclick = () => {
          follow.settings.priorities[kind] = p.id;
          saveFollow(follow.settings);
          renderFollow();
        };
        row.append(b);
      }
      return row;
    }),
  );
}
renderFollow();

// Keys for trying things out: D films a documentary, V brings a visitor, S toggles sound, B the blacklight.
addEventListener('keydown', (e) => {
  if (e.target instanceof HTMLInputElement) return;
  if (e.key === 'd') void command('film');
  else if (e.key === 'v') void command('visit');
  else if (e.key === 's') toggleSound();
  else if (e.key === 'b') void command('blacklight', !(timeline.latest?.settings.blacklight ?? false));
  else if (e.key === 'm') {
    if (zoomTo === 1) showMap();
    else enterPlace(focus);
  }
  else if (e.key === 'Escape') {
    if (panelOpen && matchMedia('(max-width: 700px)').matches) openPanel(null);
    else showMenu(false);
    if (arranging) arrange(false);
  }
});

// --- the ⚙️ menu: time, holidays, the blacklight and happenings, now or later -----------------------------

const menu = document.querySelector<HTMLDivElement>('#menu')!;
const menuStatus = document.querySelector<HTMLParagraphElement>('#menu-status')!;
const later = document.querySelector<HTMLInputElement>('#later')!;
const laterTime = document.querySelector<HTMLInputElement>('#later-time')!;
laterTime.oninput = () => (later.checked = true);

const panel = document.querySelector<HTMLDivElement>('#menu-panel')!;
const panelStatus = document.querySelector<HTMLParagraphElement>('#panel-status')!;
const laterBox = document.querySelector<HTMLLabelElement>('#later-box')!;
/** Panels whose buttons make something happen, so they can be planned for later. */
const PLANNABLE = ['happen', 'visitors', 'sky'];
let panelOpen: string | null = null;

function showMenu(open: boolean) {
  menu.hidden = !open;
  if (!open) openPanel(null);
  else placeMenu();
  wake();
}
/** Just under the buttons, which wrap onto more rows on a phone. */
function placeMenu() {
  const bar = document.querySelector('nav')!.getBoundingClientRect();
  menu.style.setProperty('--menu-top', `${Math.round(bar.bottom + 8)}px`);
}
addEventListener('resize', () => {
  if (!menu.hidden) placeMenu();
});
document.querySelector<HTMLButtonElement>('#menu-toggle')!.onclick = () => showMenu(Boolean(menu.hidden));
document.querySelector<HTMLButtonElement>('#menu-close')!.onclick = () => showMenu(false);
document.querySelector<HTMLButtonElement>('#panel-close')!.onclick = () => showMenu(false);
document.querySelector<HTMLButtonElement>('#panel-back')!.onclick = () => openPanel(null);

/** Opens one category's panel beside the list (over it, on a phone), or closes it (null). */
function openPanel(id: string | null) {
  panelOpen = id;
  panel.hidden = !id;
  menu.classList.toggle('panel-open', Boolean(id));
  for (const cat of menu.querySelectorAll<HTMLButtonElement>('.cat')) {
    cat.classList.toggle('open', cat.dataset.panel === id);
    cat.setAttribute('aria-expanded', String(cat.dataset.panel === id));
  }
  for (const section of panel.querySelectorAll<HTMLElement>('section')) {
    const on = section.dataset.panel === id;
    section.hidden = !on;
    if (on) document.querySelector('#panel-title')!.textContent = section.dataset.title ?? '';
  }
  laterBox.hidden = !id || !PLANNABLE.includes(id);
  if (id === 'visitors') renderVisitors();
  panel.scrollTop = 0;
}
for (const cat of menu.querySelectorAll<HTMLButtonElement>('.cat')) {
  cat.onclick = () => openPanel(panelOpen === cat.dataset.panel ? null : cat.dataset.panel!);
}

/** A visitor's button name: "a hot-air balloon" → "Hot-air balloon". */
const visitorLabel = (text: string) => {
  const bare = text.replace(/^(a|an|some|the) /, '');
  return bare[0].toUpperCase() + bare.slice(1);
};

/** Visitors that suit the place showing come first; any of them can be called anywhere, though. */
function renderVisitors() {
  const biome = zoomTo === 1 && place ? placeById(place)?.biome : undefined;
  const suits = (v: (typeof ALL_VISITORS)[number]) => Boolean(biome) && (!v.biomes || v.biomes.includes(biome!));
  const button = (v: (typeof ALL_VISITORS)[number]) => {
    const b = Object.assign(document.createElement('button'), { textContent: `${v.icon} ${visitorLabel(v.text)}` });
    b.dataset.cmd = 'visit';
    b.dataset.value = v.name;
    if (v.night) b.title = 'Usually only comes after dark';
    return b;
  };
  const here = ALL_VISITORS.filter(suits);
  document.querySelector('#visit-here')!.replaceChildren(
    ...(here.length ? here.map(button) : [Object.assign(document.createElement('span'), { className: 'note', textContent: biome ? 'None in particular.' : 'Pick a place on the map first.' })]),
  );
  document.querySelector('#visit-other')!.replaceChildren(...ALL_VISITORS.filter((v) => !suits(v)).map(button));
}

let statusTimer = 0;
function say(text: string) {
  menuStatus.textContent = panelStatus.textContent = text;
  clearTimeout(statusTimer);
  statusTimer = window.setTimeout(() => (menuStatus.textContent = panelStatus.textContent = ''), 6000);
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
/** Commands that happen in one place (the rest are for the whole world). */
// 🔭 Visit from the gallery (?place=…&film=<id>): once the place is in, film that creature.
{
  const star = new URLSearchParams(location.search).get('film');
  const where = place;
  if (star && where) {
    setTimeout(async () => {
      filmAsked = true;
      filmAskedAt = performance.now();
      const text = await sendTankCommand('film', star, where).catch(() => '');
      if (text && !text.startsWith('🎬 Rolling')) say(text);
    }, 2500);
    // Not again on a reload.
    history.replaceState(null, '', `/tank/?place=${encodeURIComponent(where)}`);
  }
}

const LOCAL: string[] = ['film', 'visit', 'current', 'school', 'puff', 'egg', 'show', 'rain', 'snow', 'rainbow', 'explorer'];

async function command(cmd: TankCommand, value: TankCommandValue = null) {
  const here = zoomTo === 1 ? (place ?? undefined) : undefined;
  if (LOCAL.includes(cmd) && !here) {
    say('🗺️ Pick a place on the map first.');
    return;
  }
  if (cmd === 'film' && !later.checked) {
    filmAsked = true;
    filmAskedAt = performance.now();
  }
  try {
    if (later.checked && laterTime.value) {
      const at = nextTime(laterTime.value);
      await scheduleTankCommand(cmd, value, at.getTime(), here);
      later.checked = false;
      say(`⏰ Planned for ${clock(at)}.`);
    } else {
      const text = await sendTankCommand(cmd, value, here);
      if (text) say(text);
    }
  } catch {
    say("Couldn't reach the tank's server.");
  }
}

const parseValue = (v: string | undefined): TankCommandValue =>
  v === undefined || v === 'auto' ? null : v === 'on' ? true : v === 'off' ? false : Number.isFinite(Number(v)) ? Number(v) : v;

menu.addEventListener('click', (e) => {
  const b = (e.target as Element).closest<HTMLButtonElement>('[data-cmd]');
  if (!b) return;
  {
    const cmd = b.dataset.cmd!;
    const here = zoomTo === 1 ? (place ?? undefined) : undefined;
    if (cmd === 'feed') {
      if (later.checked) {
        say("🍤 Feeding can't be planned ahead (yet): it's now or never!");
        return;
      }
      // On the map, everyone everywhere gets fed.
      void feedFish(undefined, here).then((ok) => say(ok ? '🍤 Dinner time!' : '🍤 The fish are still eating.')).catch(() => {});
      return;
    }
    if (cmd === 'show') {
      if (!here) say('🗺️ Pick a place on the map first.');
      else void showEverywhere(here).then(() => say(`📺 Every screen is going to ${placeById(here)!.name}.`)).catch(() => say("Couldn't reach the server."));
      return;
    }
    void command(cmd as TankCommand, parseValue(b.dataset.value));
  }
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
  const names: string[] = [];
  for (const [group, value] of Object.entries(shown)) {
    for (const b of menu.querySelectorAll(`[data-group="${group}"] button`)) {
      const on = (b as HTMLElement).dataset.value === value;
      b.setAttribute('aria-pressed', String(on));
      if (on) names.push(b.textContent!.replace(/ \(B\)$/, ''));
    }
  }
  // The category says what's on, so a glance at the list is enough.
  document.querySelector('#sky-summary')!.textContent = names.filter((n) => n !== '💡 Off').join(' · ');
}

// --- 🔄 updates: a newer version from GitHub, in one tap --------------------------------------------------

const updateCheck = document.querySelector<HTMLButtonElement>('#update-check')!;
const updateNow = document.querySelector<HTMLButtonElement>('#update-now')!;
const updateNote = document.querySelector<HTMLParagraphElement>('#update-note')!;
const updateSummary = document.querySelector<HTMLElement>('#update-summary')!;

const day = (iso: string) => new Date(iso).toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' });

updateCheck.onclick = async () => {
  updateCheck.disabled = true;
  updateNow.hidden = true;
  updateNote.textContent = 'Checking GitHub…';
  try {
    const info = await fetchUpdateInfo(true);
    const lines: string[] = [];
    const changes = info.changes ?? [];
    if (!info.can) lines.push(info.why ?? "This server can't update itself.");
    else if (info.error) lines.push(info.error);
    else if (!changes.length) lines.push(`✓ Up to date${info.version ? ` (the version from ${day(info.version.date)})` : ''}.`);
    else {
      lines.push(`${changes.length} new change${changes.length === 1 ? '' : 's'}:`, ...changes.slice(0, 6).map((c) => `• ${c}`));
      if (changes.length > 6) lines.push(`…and ${changes.length - 6} more`);
      if (info.dirty) lines.push('(Some files were changed by hand on the server. If they get in the way, the update says so and nothing changes.)');
      updateNow.hidden = false;
      updateSummary.innerHTML = '<span class="badge">✨ A new version is ready</span>';
    }
    const last = info.last;
    if (last && !last.ok && Date.now() - last.at < 7 * 24 * 3600_000) lines.push(`Last time: ${last.message}`);
    updateNote.textContent = lines.join('\n');
  } catch {
    updateNote.textContent = "Couldn't reach the server.";
  } finally {
    updateCheck.disabled = false;
  }
};

updateNow.onclick = async () => {
  if (!confirm('Update Doodlearium now? Every screen reloads when it is back, in a minute or so.')) return;
  updateNow.disabled = true;
  try {
    await startUpdate();
    updateNow.hidden = true;
    updateNote.textContent = '🔄 Updating… every screen reloads when it is back.';
    updateSummary.textContent = '🔄 Updating…';
  } catch (err) {
    updateNote.textContent = err instanceof Error ? err.message : 'Update failed.';
  } finally {
    updateNow.disabled = false;
  }
};

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
  const key = JSON.stringify([currentWorld, lines]);
  if (key === comingShown) return;
  comingShown = key;
  coming.hidden = !lines.length;
  const title = Object.assign(document.createElement('b'), { textContent: 'Coming up' });
  coming.replaceChildren(
    title,
    ...lines.map((l, i) => {
      const div = document.createElement('div');
      div.append(`${l.text} `, Object.assign(document.createElement('span'), { textContent: l.when, className: l.soon ? 'soon' : '' }));
      // Tap one to go there.
      const where = items[i].place;
      if (where && placeById(where)?.live) {
        div.className = 'go';
        // In another world: say which.
        const far = worldOf(where).id !== currentWorld ? ` (in ${worldOf(where).name})` : '';
        if (far) div.firstChild!.textContent = `${l.text}${far} `;
        div.title = `Go to ${placeById(where)!.name}${far}`;
        div.onclick = () => enterPlace(where);
      }
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
  walker: '🐕 Walker',
  hopper: '🐇 Hopper',
  slitherer: '🐍 Slitherer',
  flier: '🐦 Flier',
  waterfowl: '🦆 Waterfowl',
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

/**
 * The creature under a point on screen; night creatures and nearer ones are on top. only narrows who counts,
 * and roughly skips the check for paint under the point (anywhere in its box will do).
 */
function creatureAt(x: number, y: number, only?: (entry: Entry) => boolean, roughly = false) {
  let best: Entry | null = null;
  let bestZ = -Infinity;
  for (const entry of entries.values()) {
    const view = entry.creature.view;
    if (entry.removing || entry.fade < 0.5 || (only && !only(entry))) continue;
    const b = view.getBounds();
    if (x < b.x || x > b.x + b.width || y < b.y || y > b.y + b.height || (!roughly && !touches(entry, x, y))) continue;
    const z = view.zIndex + (view.parent === nightLayer ? 10_000 : 0);
    if (z > bestZ) {
      best = entry;
      bestZ = z;
    }
  }
  return best;
}

function showInfo(x: number, y: number) {
  const entry = zoom === 1 && !arranging ? creatureAt(x, y) : null;
  info.hidden = !entry;
  if (!entry) return;
  const d = entry.drawing;
  const egg = entry.kind === 'egg';
  const lines = egg
    ? [
        entry.named ? `an egg from ${parentNames(d)}` : `an egg from two ${plural(d.name)}`,
        `hatching in about ${Math.max(1, Math.ceil(((entry.hatchAt ?? d.hatchAt ?? 0) - Date.now()) / 60_000))} min`,
      ]
    : [STYLE_NAMES[motionOf(d)], ...describe(entry), aboutOf(d, entry.personality), d.glow ? '✨ has glowing paint' : ''];
  const b = document.createElement('b');
  b.textContent = egg ? '🥚 Egg' : entry.named ? d.name : `A ${d.name}`;
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

// --- arranging: the family can move plants and decorations about, and make them bigger or smaller ---------

const arrangeBar = document.querySelector<HTMLDivElement>('#arrange')!;
const arrangeTip = document.querySelector<HTMLSpanElement>('#arrange-tip')!;
const arrangeButtons = ['#arrange-smaller', '#arrange-bigger', '#arrange-reset'].map((s) => document.querySelector<HTMLButtonElement>(s)!);
const outlines = new Graphics();
labelLayer.addChild(outlines);
let arranging = false;
/** The plant or decoration being arranged, and (while a finger or the mouse is down) how it's held. */
let picked: Entry | null = null;
let dragging: { pointer: number; dx: number; dy: number } | null = null;
/** Until then, the server's roster doesn't move the picked one back (it hasn't heard yet). */
let holdUntil = 0;
let sendTimer = 0;

const holding = (entry: Entry) => entry === picked && (dragging !== null || Date.now() < holdUntil);
const isStill = (entry: Entry) => entry.kind === 'plant' || entry.kind === 'decor';

function arrange(on: boolean) {
  arranging = on && place !== null && zoomTo === 1;
  arrangeBar.hidden = !arranging;
  document.body.classList.toggle('arranging', arranging);
  picked = null;
  dragging = null;
  info.hidden = true;
  if (arranging) showMenu(false);
  showPicked();
}
document.querySelector<HTMLButtonElement>('#arrange-button')!.onclick = () => {
  if (place && zoomTo === 1) arrange(true);
  else say('🗺️ Pick a place on the map first.');
};
document.querySelector<HTMLButtonElement>('#arrange-done')!.onclick = () => arrange(false);

function showPicked(text?: string) {
  const name = picked && (picked.named ? picked.drawing.name : `A ${picked.drawing.name}`);
  arrangeTip.textContent = text ?? (name ? `✋ ${name}: drag it about, or make it bigger or smaller` : '✋ Tap a plant or decoration, then drag it where you like');
  for (const b of arrangeButtons) b.disabled = !picked;
}

/** Its size at the back of the place (nearer, it looks bigger). */
const backScale = (entry: Entry) => entry.pose.sx / depthScale(entry.pose.z);

function placeAt(entry: Entry, x: number, z: number, scale: number) {
  const s = scale * depthScale(z);
  Object.assign(entry.pose, { x, z, y: sandY(world, z, x), sx: s, sy: s });
}

/** Tells the server (a moment after the last change, so a burst of resizing is one message). */
function sendPlacement(entry: Entry, reset = false) {
  holdUntil = Date.now() + 3000;
  clearTimeout(sendTimer);
  const where = place;
  sendTimer = window.setTimeout(() => {
    if (!where) return;
    const placement = reset ? null : { x: entry.pose.x / world.width, z: entry.pose.z, scale: backScale(entry) };
    void arrangeStill(where, entry.id, placement).catch(() => showPicked("Couldn't reach the server."));
  }, reset ? 0 : 250);
}

function resize(by: number) {
  if (!picked) return;
  const big = Math.max(picked.drawing.width, picked.drawing.height);
  const scale = Math.min(900 / big, Math.max(20 / big, backScale(picked) * by));
  placeAt(picked, picked.pose.x, picked.pose.z, scale);
  sendPlacement(picked);
}
arrangeButtons[0].onclick = () => resize(1 / 1.15);
arrangeButtons[1].onclick = () => resize(1.15);
arrangeButtons[2].onclick = () => {
  if (!picked) return;
  holdUntil = 0;
  sendPlacement(picked, true);
};

app.canvas.addEventListener('pointerdown', (e) => {
  if (!arranging) return;
  picked = creatureAt(e.clientX, e.clientY, isStill) ?? creatureAt(e.clientX, e.clientY, isStill, true);
  showPicked();
  if (!picked) return;
  const at = camera.toLocal({ x: e.clientX, y: e.clientY });
  dragging = { pointer: e.pointerId, dx: at.x - picked.pose.x, dy: at.y - picked.pose.y };
  app.canvas.setPointerCapture(e.pointerId);
});
app.canvas.addEventListener('pointermove', (e) => {
  if (!dragging || !picked || e.pointerId !== dragging.pointer) return;
  const at = camera.toLocal({ x: e.clientX, y: e.clientY });
  const x = Math.min(world.width, Math.max(0, at.x - dragging.dx));
  // Up and down is how far back it sits on the sand.
  const z = Math.min(1, Math.max(0, 1 - (at.y - dragging.dy - world.floorAt(x) - 4) / groundBand(world)));
  placeAt(picked, x, z, backScale(picked));
});
for (const type of ['pointerup', 'pointercancel'] as const) {
  app.canvas.addEventListener(type, (e) => {
    if (!dragging || e.pointerId !== dragging.pointer) return;
    dragging = null;
    if (picked) sendPlacement(picked);
  });
}
app.canvas.addEventListener('wheel', (e) => {
  if (!arranging || e.ctrlKey || !picked) return;
  e.preventDefault();
  resize(e.deltaY < 0 ? 1.08 : 1 / 1.08);
}, { passive: false });

// --- 📍 where this is: the place and its world, in the corner with the buttons ---------------------------

const whereBox = document.querySelector<HTMLDivElement>('#where')!;
let whereShown = '';
let whereFresh = 0;
app.ticker.add(() => {
  const here = zoomTo === 1 && place ? placeById(place) : undefined;
  const key = here?.id ?? '';
  if (key === whereShown) return;
  whereShown = key;
  whereBox.hidden = !here;
  if (!here) return;
  const world = worldOf(here.id);
  whereBox.replaceChildren(
    Object.assign(document.createElement('b'), { textContent: `${BIOME_NAMES[here.biome]?.split(' ')[0] ?? '📍'} ${here.name}` }),
    Object.assign(document.createElement('span'), { textContent: `${world.icon} ${world.name}` }),
  );
  // Arriving somewhere, it says where for a few seconds, even on a screen nobody's touching.
  whereBox.classList.add('fresh');
  clearTimeout(whereFresh);
  whereFresh = window.setTimeout(() => whereBox.classList.remove('fresh'), 6000);
});

// Outlines show what can be moved, and which one is picked.
app.ticker.add(() => {
  outlines.clear();
  if (!arranging) return;
  outlines.zIndex = 1;
  for (const entry of entries.values()) {
    if (!isStill(entry) || entry.removing) continue;
    const b = entry.creature.view.getBounds();
    const on = entry === picked;
    outlines.roundRect(b.x - 4, b.y - 4, b.width + 8, b.height + 8, 8).stroke(on ? { width: 3, color: 0xffd166 } : { width: 1.5, color: 0xffffff, alpha: 0.45 });
  }
});

// --- TV niceties: fullscreen on double-click, hide the idle cursor, keep the screen awake ---

addEventListener('dblclick', (e) => {
  // Clicking a button quickly (➕ Bigger, again and again) isn't asking for full screen, and nor is
  // tidying up the decorations: only a double-click on the world itself is.
  const target = e.target as Element | null;
  if (arranging || target?.closest('button, a, input, select, textarea, label, .menu, .chrome, .arrange')) return;
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

