import {
  MAX_ATTACHMENTS,
  MAX_DEN_FOR,
  DEN_MOTIONS,
  MAX_PARTS,
  PART_MOTIONS,
  isHinged,
  glowUrl,
  imageUrl,
  motionOf,
  partsUrl,
  behindUrl,
  type AttachmentKind,
  type Drawing,
  type Motion,
  type PartMotion,
  type SpeciesSize,
  type Trait,
  type Traits,
  LAND_MOTIONS,
  TRAITS,
} from '../../shared/types.ts';
import { SWIM_STYLES } from '../../shared/sim/styles.ts';
import { fetchDrawings, fetchPacks, loadWorlds, setupFeedButton, submitDrawing, updateDrawing } from '../shared/api.ts';
import { BIOMES, BIOME_NAMES, defaultGroup, defaultHabitats, suits, type Biome } from '../../shared/world/biomes.ts';
import { LIVE_PLACES, allWorlds, placeById, worldById } from '../../shared/world/places.ts';
import { createMapPanel, type MapPanel } from '../tank/mappanel.ts';
import { enclosedHoles, exportDrawing, inkBounds, type PlacedAttachment, type PlacedPart } from './export.ts';
import { MATERIALS, MATERIAL_LABELS, MATERIAL_TURNS, floodFill, floodRegion, materialPreview, type Material } from './fill.ts';
import { readPhoto, removePaper } from './photo.ts';
import { Selection, applyTransform, maskHas, type TransformOp } from './selection.ts';
import { PART_INFO, behindArea, carryParts, cloneCanvas, findHinge, partsFromImage, type EditorPart } from './parts.ts';

// Which worlds (and places) there are, before anything looks a place up. Switched-off ones too, so a
// drawing that lives in one keeps it when it's saved.
const offWorlds = new Set((await loadWorlds(true).catch(() => [])).filter((w) => w.off).map((w) => w.id));

/** Colour and the name shown when hovering it. 'clear' paints and fills see-through. */
const COLORS: [string, string][] = [
  ['#1b1b1b', 'Black'], ['#ffffff', 'White'], ['#e63946', 'Red'], ['#ff8c1a', 'Orange'],
  ['#ffd60a', 'Yellow'], ['#52b788', 'Green'], ['#2ec4b6', 'Teal'], ['#3a86ff', 'Blue'],
  ['#8338ec', 'Purple'], ['#ff70a6', 'Pink'], ['#8d5a3b', 'Brown'], ['#8d99ae', 'Grey'],
  ['rainbow', 'Rainbow'], ['clear', 'Invisible (see-through)'],
];
const SIZES = [4, 10, 22, 40];
/** The same four size buttons double as the size of extras. */
const EXTRA_SCALES = [0.6, 1, 1.5, 2.2];

/** There's no emoji for one round googly eye, so it's drawn: white, outlined, with its pupil hanging low. */
const GOOGLY_ICON =
  '<svg class="icon" viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="8.6" fill="#fff" stroke="#111" stroke-width="1.6"/>' +
  '<circle cx="10.6" cy="12.6" r="4.4" fill="#111"/><circle cx="9.2" cy="11.2" r="1.1" fill="#fff"/></svg>';

/** icon is HTML: an emoji, or a small picture. */
const EXTRAS: { kind: AttachmentKind; icon: string; label: string; hint: string }[] = [
  { kind: 'bubbles', icon: '🫧', label: 'Bubbles', hint: 'Bubbles float up from here' },
  { kind: 'sparkles', icon: '✨', label: 'Sparkles', hint: 'Twinkling sparkles in your colour' },
  { kind: 'glow', icon: '💡', label: 'Glow', hint: 'A soft light, best at night' },
  { kind: 'googly', icon: GOOGLY_ICON, label: 'Googly eye', hint: 'A wobbly googly eye' },
  { kind: 'flag', icon: '🚩', label: 'Flag', hint: 'A flag waving in the current, in your colour' },
  { kind: 'propeller', icon: '🌀', label: 'Propeller', hint: 'A spinning propeller' },
];
const EXTRA_ICONS = Object.fromEntries(EXTRAS.map((e) => [e.kind, e.icon])) as Record<AttachmentKind, string>;

type Tool = 'brush' | 'eraser' | 'fill' | 'extras' | 'select';
/** Glow paint always glows; blacklight (uv) paint only glows when the tank's blacklight is on. */
type Paint = 'normal' | 'glow' | 'uv';
type Mirror = 'off' | 'updown' | 'leftright';
type Point = { x: number; y: number; pressure: number };

/** Everything on the paper is a replayable list of operations, so undo works the same for every tool. */
type Op =
  /** behind: painted behind a moving part (see behindCanvas), not on the drawing. */
  | { type: 'stroke'; color: string; size: number; erase: boolean; mirror: Mirror; points: Point[]; paint?: Paint; behind?: boolean }
  /** behind: filled behind a moving part, within this area. */
  | { type: 'fill'; x: number; y: number; color: string; material: Material; mirror: Mirror; paint?: Paint; turn?: number; behind?: HTMLCanvasElement }
  /** A picture pasted on top of the drawing. */
  | { type: 'paste'; image: HTMLCanvasElement; x: number; y: number }
  | { type: 'attach'; attachment: PlacedAttachment }
  | { type: 'detach'; target: PlacedAttachment }
  | { type: 'part'; part: EditorPart }
  | { type: 'unpart'; target: EditorPart }
  /** A hand-drawn hinge; result is the part with it, made once so later ops can find it. */
  | { type: 'hinge'; target: EditorPart; hinge: [number, number, number, number]; result?: EditorPart }
  /** A part made faster, slower, bigger or smaller. */
  | { type: 'tune'; target: EditorPart; speed: number; amount: number; flip?: boolean; lift?: boolean; result?: EditorPart }
  /** A part given a painted background behind it. */
  | { type: 'behind'; target: EditorPart; result: EditorPart }
  | TransformOp;

const paper = document.querySelector<HTMLCanvasElement>('#paper')!;
const ctx = paper.getContext('2d', { willReadFrequently: true })!;
const guide = document.querySelector<HTMLDivElement>('#guide')!;
const markers = document.querySelector<HTMLDivElement>('#markers')!;
const hint = document.querySelector<HTMLParagraphElement>('#hint')!;
const facingButton = document.querySelector<HTMLButtonElement>('#facing')!;
const mirrorButton = document.querySelector<HTMLButtonElement>('#mirror')!;
const toast = document.querySelector<HTMLParagraphElement>('#toast')!;
const nameInput = document.querySelector<HTMLInputElement>('#name')!;
const artistInput = document.querySelector<HTMLInputElement>('#artist')!;
const sendButton = document.querySelector<HTMLButtonElement>('#send')!;
const nocturnalInput = document.querySelector<HTMLInputElement>('#nocturnal')!;
const explorerInput = document.querySelector<HTMLInputElement>('#explorer')!;
const explorerLabel = document.querySelector<HTMLLabelElement>('#explorer-label')!;
const groupInput = document.querySelector<HTMLInputElement>('#group')!;
const homeSelect = document.querySelector<HTMLSelectElement>('#home')!;
const speciesSizesEl = document.querySelector<HTMLSpanElement>('#species-size')!;
const habitatsEl = document.querySelector<HTMLSpanElement>('#habitats')!;
const worldsEl = document.querySelector<HTMLSpanElement>('#worlds')!;
const worldsLabel = document.querySelector<HTMLSpanElement>('#worlds-label')!;
const choosePlacesButton = document.querySelector<HTMLButtonElement>('#choose-places')!;
const placePicker = document.querySelector<HTMLDivElement>('#place-picker')!;
const pickerWorldsEl = document.querySelector<HTMLDivElement>('#picker-worlds')!;
const pickerHint = document.querySelector<HTMLParagraphElement>('#picker-hint')!;

const state = {
  motion: 'fish' as Motion,
  tool: 'brush' as Tool,
  color: COLORS[0][0],
  sizeIndex: 1,
  material: 'solid' as Material,
  paint: 'normal' as Paint,
  /** Which way each material is turned (an index into MATERIAL_TURNS). */
  turns: {} as Partial<Record<Material, number>>,
  extra: 'bubbles' as AttachmentKind,
  mirror: 'off' as Mirror,
  facingLeft: false,
};
const ops: Op[] = [];
let current: Extract<Op, { type: 'stroke' }> | null = null;
/** When editing an existing drawing: the drawing, its image under the new ops, and its saved extras. */
let editing: Drawing | null = null;
/** Under the new ops; holes are its see-through areas, when re-editing a saved drawing. */
let base: {
  image: HTMLImageElement | HTMLCanvasElement;
  x: number;
  y: number;
  holes?: HTMLCanvasElement;
  glow?: Record<'glow' | 'uv', HTMLCanvasElement>;
  behind?: HTMLImageElement;
} | null = null;
let baseAttachments: PlacedAttachment[] = [];
let baseParts: EditorPart[] = [];
const selection = new Selection(paper.width, paper.height);
/** Where the drawing has been made see-through on purpose, so "Fill inside white" leaves it be. */
const holesCanvas = Object.assign(document.createElement('canvas'), { width: paper.width, height: paper.height });
const holesView = document.querySelector<HTMLDivElement>('#holes')!;
const holes = holesCanvas.getContext('2d', { willReadFrequently: true })!;
/** Like holes: where glow paint and blacklight paint are. Shown on the paper as a soft halo. */
const glowCanvases = {
  glow: Object.assign(document.createElement('canvas'), { width: paper.width, height: paper.height }),
  uv: Object.assign(document.createElement('canvas'), { width: paper.width, height: paper.height }),
};
const glowCtx = {
  glow: glowCanvases.glow.getContext('2d', { willReadFrequently: true })!,
  uv: glowCanvases.uv.getContext('2d', { willReadFrequently: true })!,
};
const glowViews = {
  glow: document.querySelector<HTMLCanvasElement>('#glow-view')!.getContext('2d')!,
  uv: document.querySelector<HTMLCanvasElement>('#uv-view')!.getContext('2d')!,
};
/**
 * What's painted behind moving parts, showing where they were as they move. Only what's within a part
 * that has a painted background is kept.
 */
const behindCanvas = Object.assign(document.createElement('canvas'), { width: paper.width, height: paper.height });
const behindCtx = behindCanvas.getContext('2d')!;
const behindView = document.querySelector<HTMLCanvasElement>('#behind-view')!.getContext('2d')!;
const overlay = document.querySelector<HTMLCanvasElement>('#selection-overlay')!.getContext('2d')!;
/** The paper as committed, under a selection that is being moved around. */
const snapshot = Object.assign(document.createElement('canvas'), { width: paper.width, height: paper.height });
let selectMode: 'add' | 'remove' = 'add';
/** A selection drag in progress: where it started and where the selection was then. */
let drag: { x: number; y: number; dx: number; dy: number } | null = null;
let selectStroke: Point | null = null;
/** Where a selection stroke started and how far it has strayed, to tell a tap from painting. */
let selectStart: { x: number; y: number; moved: number } | null = null;
/** The part whose hinge is being drawn, and the line so far. */
let hingeFor: EditorPart | null = null;
let hingeLine: [number, number, number, number] | null = null;
/** The part whose background is being painted. */
let behindFor: EditorPart | null = null;
/** The part tapped, or pointed at, in the list of moving parts: it's picked out on the paper. */
let pickedPart: EditorPart | null = null;
let hoverPart: EditorPart | null = null;

try {
  artistInput.value = localStorage.getItem('doodlearium.artist') ?? '';
} catch {}
setupFeedButton(document.querySelector<HTMLButtonElement>('#feed')!);

// --- toolbar -------------------------------------------------------------

const press = (buttons: Iterable<Element>, isOn: (b: HTMLElement) => boolean) => {
  for (const b of buttons) b.setAttribute('aria-pressed', String(isOn(b as HTMLElement)));
};

const colorsEl = document.querySelector<HTMLDivElement>('#colors')!;
const colorButtons = COLORS.map(([color, name]) => {
  const b = document.createElement('button');
  b.dataset.color = color;
  b.title = name;
  if (color === 'rainbow' || color === 'clear') b.className = color;
  else b.style.background = color;
  b.onclick = () => pickColor(color);
  colorsEl.append(b);
  return b;
});
const customColor = document.createElement('input');
customColor.type = 'color';
customColor.title = 'Pick any colour';
customColor.oninput = () => pickColor(customColor.value);
colorsEl.append(customColor);

function pickColor(color: string) {
  state.color = color;
  if (state.tool === 'eraser') setTool('brush');
  press(colorButtons, (b) => b.dataset.color === color);
  renderMaterials();
  renderPaintKind();
}

const paintEl = document.querySelector<HTMLDivElement>('#paint-kind')!;
const paintButtons = paintEl.querySelectorAll<HTMLButtonElement>('[data-paint]');
paintButtons.forEach(
  (b) =>
    (b.onclick = () => {
      state.paint = b.dataset.paint as Paint;
      press(paintButtons, (x) => x === b);
    }),
);
function renderPaintKind() {
  // What's painted behind a part doesn't glow.
  paintEl.hidden = !(state.tool === 'brush' || state.tool === 'fill') || state.color === 'clear' || !!behindFor;
}

const sizesEl = document.querySelector<HTMLDivElement>('#sizes')!;
const sizeButtons = SIZES.map((size, index) => {
  const b = document.createElement('button');
  b.title = `Size ${index + 1}`;
  const dot = document.createElement('span');
  const px = Math.max(4, Math.min(26, size * 0.65));
  dot.style.width = dot.style.height = `${px}px`;
  b.append(dot);
  b.onclick = () => {
    state.sizeIndex = index;
    press(sizeButtons, (s) => s === b);
  };
  sizesEl.append(b);
  return b;
});

const materialsEl = document.querySelector<HTMLDivElement>('#materials')!;
const materialButtons = MATERIALS.map((material) => {
  const b = document.createElement('button');
  b.title = MATERIAL_LABELS[material];
  b.onclick = () => {
    state.material = material;
    press(materialButtons, (m) => m === b);
    renderMaterials();
  };
  materialsEl.append(b);
  return b;
});
/** Turns the picked material: scales point another way, planks run up and down... */
const turnButton = document.createElement('button');
turnButton.className = 'turn';
turnButton.onclick = () => {
  const options = MATERIAL_TURNS[state.material]!;
  state.turns[state.material] = ((state.turns[state.material] ?? 0) + 1) % options.length;
  renderMaterials();
};
materialsEl.append(turnButton);

/** The quarter turns for the picked material. */
const materialTurn = (material = state.material) => MATERIAL_TURNS[material]?.[state.turns[material] ?? 0]?.turn ?? 0;

/** Material swatches are shown in the current colour, so brick in blue looks like blue brick. */
function renderMaterials() {
  // See-through has no pattern, so there's nothing to pick.
  materialsEl.hidden = state.tool !== 'fill' || state.color === 'clear';
  if (materialsEl.hidden) return;
  MATERIALS.forEach((material, i) => {
    const color = state.color === 'rainbow' || material === 'rainbow' ? 'rainbow' : state.color;
    materialButtons[i].innerHTML = `<img alt="" src="${materialPreview(material, color, materialTurn(material))}" />${MATERIAL_LABELS[material]}`;
  });
  const options = MATERIAL_TURNS[state.material];
  turnButton.hidden = !options;
  if (options) {
    const option = options[state.turns[state.material] ?? 0];
    turnButton.innerHTML = `<span class="arrow">${option.label}</span>Turn`;
    turnButton.title = `${option.title}. Tap to turn it.`;
  }
}

const extrasEl = document.querySelector<HTMLDivElement>('#extras')!;
const extraButtons = EXTRAS.map((extra) => {
  const b = document.createElement('button');
  b.innerHTML = `${extra.icon} ${extra.label}`;
  b.title = extra.hint;
  b.onclick = () => {
    state.extra = extra.kind;
    press(extraButtons, (x) => x === b);
    renderHint();
  };
  extrasEl.append(b);
  return b;
});

const selectBar = document.querySelector<HTMLDivElement>('#select-bar')!;
const toolButtons = document.querySelectorAll<HTMLButtonElement>('[data-tool]');
toolButtons.forEach((b) => (b.onclick = () => setTool(b.dataset.tool as Tool)));

function setTool(tool: Tool) {
  // Painting behind a part is done with the brush, eraser and fill.
  if (behindFor && (tool === 'select' || tool === 'extras')) finishBehind();
  if (tool !== 'select') finishSelection();
  state.tool = tool;
  press(toolButtons, (b) => b.dataset.tool === tool);
  sizesEl.hidden = tool === 'fill';
  materialsEl.hidden = tool !== 'fill';
  extrasEl.hidden = tool !== 'extras';
  selectBar.hidden = tool !== 'select';
  colorsEl.hidden = tool === 'select' || tool === 'eraser';
  paper.style.cursor = tool === 'fill' ? 'cell' : tool === 'extras' ? 'copy' : tool === 'select' ? 'crosshair' : 'none';
  renderSelectBar();
  renderMaterials();
  renderPaintKind();
  renderHint();
}

function renderHint() {
  if (hingeFor) {
    hint.textContent = `📍 ${PART_INFO[hingeFor.motion].attach ?? 'Draw a line on the drawing where this part is attached.'}`;
    return;
  }
  if (behindFor) {
    const done = document.createElement('button');
    done.textContent = '✓ Done';
    done.onclick = finishBehind;
    hint.replaceChildren(
      `🖼️ Paint what shows where this ${PART_INFO[behindFor.motion].label.toLowerCase()} was, as it moves: more of the body, or the sky... Anything left checked shows nothing there. `,
      done,
    );
    return;
  }
  const extra = EXTRAS.find((e) => e.kind === state.extra)!;
  hint.textContent =
    state.tool === 'fill'
      ? 'Tap inside a shape to fill it.'
      : state.tool === 'extras'
        ? `${extra.hint}. Tap the drawing to add one, tap it again to remove it. Extras come alive in the world!`
        : state.tool === 'select'
          ? 'Tap a shape or paint over a part to select it. Drag it to move it, or use the buttons to resize, turn, flip, copy, delete or ✨ animate it.'
          : '';
}

const MIRROR_LABELS: Record<Mirror, string> = { off: '🪞 Mirror: off', updown: '🪞 Mirror: ↕', leftright: '🪞 Mirror: ↔' };
mirrorButton.onclick = () => {
  state.mirror = state.mirror === 'off' ? 'updown' : state.mirror === 'updown' ? 'leftright' : 'off';
  mirrorButton.textContent = MIRROR_LABELS[state.mirror];
  mirrorButton.setAttribute('aria-pressed', String(state.mirror !== 'off'));
  renderGuide();
};

facingButton.onclick = () => {
  state.facingLeft = !state.facingLeft;
  renderGuide();
  schedulePreview();
};

const MOTION_LABELS: Record<Motion, string> = {
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

const PLACEHOLDERS: Record<Motion, string> = {
  fish: 'Name it (e.g. Bubbles)',
  puffer: 'Name it (e.g. Spike)',
  eel: 'Name it (e.g. Noodle)',
  jelly: 'Name it (e.g. Wobbles)',
  seahorse: 'Name it (e.g. Sir Prance)',
  flapper: 'Name it (e.g. Shelly)',
  vessel: 'Name it (e.g. Yellow Sub)',
  crawler: 'Name it (e.g. Pinchy)',
  plant: 'Name it (e.g. Swirly Weed)',
  decor: 'Name it (e.g. Castle)',
  walker: 'Name it (e.g. Woolly)',
  hopper: 'Name it (e.g. Thumper)',
  slitherer: 'Name it (e.g. Wiggles)',
  flier: 'Name it (e.g. Tweety)',
  waterfowl: 'Name it (e.g. Quackers)',
};

/** Styles that have a head, so the Facing button matters. */
const hasFacing = (motion: Motion) => motion !== 'jelly' && motion !== 'plant' && motion !== 'decor';

function setMotion(motion: Motion) {
  const restyled = motion !== state.motion;
  state.motion = motion;
  if (restyled) {
    traits = {};
    setWhere(defaultHabitats(motion), defaultGroup(motion), '', speciesSize);
  }
  renderKind();
  renderGuide();
  changed();
}


// --- what is it: how it gets about, its body, and what else it does -------------------------------------

type Base = 'swim' | 'crawl' | 'land' | 'fly' | 'plant' | 'decor';
/** Bodies are the stored styles; one that has none to pick is just its style. */
const BASES: { id: Base; icon: string; label: string; title: string; first: Motion; bodies: [Motion, string, string][] }[] = [
  {
    id: 'swim',
    icon: '🐟',
    label: 'Swims',
    title: 'Lives in the water',
    first: 'fish',
    bodies: [
      ['fish', '🐟 Wiggly tail', 'Swims with a wiggly tail'],
      ['eel', '🐍 Long and wavy', 'Long and skinny, the whole body waves'],
      ['jelly', '🪼 Pulses like a jelly', 'Pulses upward, tentacles trailing'],
      ['seahorse', '🦄 Upright', 'Upright and hovering'],
      ['flapper', '🐢 Glides', 'Glides smoothly, edges rippling (turtles, rays). Give flippers their own flap with ⬚ Select → ✨ Make it move'],
      ['vessel', '🚢 Stays stiff', 'Stays rigid (submarines, boats); extras still animate'],
    ],
  },
  { id: 'crawl', icon: '🦀', label: 'Crawls', title: 'Walks along the sand (crabs, snails)', first: 'crawler', bodies: [] },
  {
    id: 'land',
    icon: '🐕',
    label: 'On land',
    title: 'Gets about on land (and along the bottom of ponds)',
    first: 'walker',
    bodies: [
      ['walker', '🐕 Walks', 'Walks about, grazing and napping (dogs, cows, chickens). Mark its legs with ⬚ Select → ✨ Make it move → 🦵 Leg (and arms → 🦾 Arm)'],
      ['hopper', '🐇 Hops', 'Hops along (bunnies, frogs, grasshoppers)'],
      ['slitherer', '🐍 Slithers', 'Slides along in ripples (snakes, worms, caterpillars); swims like an eel in the water'],
    ],
  },
  {
    id: 'fly',
    icon: '🐦',
    label: 'Flies',
    title: 'Flies through the sky and lands to rest (birds, butterflies, bees). Give wings their own flap with ⬚ Select → ✨ Make it move',
    first: 'flier',
    bodies: [],
  },
  { id: 'plant', icon: '🌿', label: 'Plant', title: 'Grows from the ground and sways', first: 'plant', bodies: [] },
  { id: 'decor', icon: '🏰', label: 'Decoration', title: 'Sits still on the ground', first: 'decor', bodies: [] },
];
const baseOf = (m: Motion): Base =>
  m === 'crawler' ? 'crawl' : m === 'plant' ? 'plant' : m === 'decor' ? 'decor' : m === 'flier' || m === 'waterfowl' ? 'fly' : LAND_MOTIONS.includes(m) ? 'land' : 'swim';

const TRAIT_INFO: Record<Trait, [string, string]> = {
  puffs: ['🐡 Puffs up into a spiky ball', 'Now and then (and when a hunter comes near) it blows up into a round, spiky ball'],
  schools: ['🐟🐟 Swims in schools', 'Joins up with others to swim along together'],
  darts: ['⚡ Darts off quickly', 'Sometimes zooms off, and hides when a hunter prowls'],
  machine: ['⚙️ Is a machine', 'Patrols rather than wanders, tidies food off the sand, and puffs exhaust bubbles'],
};
/** What it does differently from the usual for its body (swimmers only; reset when the body changes). */
let traits: Traits = {};
const usualTraits = () => SWIM_STYLES[state.motion] ?? SWIM_STYLES.fish!;
const hasTrait = (t: Trait) => traits[t] ?? Boolean(usualTraits()[t]);

const kindButton = document.querySelector<HTMLButtonElement>('#kind-button')!;
const kindLabel = document.querySelector<HTMLElement>('#kind-label')!;
const kindPicker = document.querySelector<HTMLDivElement>('#kind-picker')!;
const kindBases = document.querySelector<HTMLDivElement>('#kind-bases')!;
const kindBodiesWrap = document.querySelector<HTMLDivElement>('#kind-bodies-wrap')!;
const kindBodies = document.querySelector<HTMLDivElement>('#kind-bodies')!;
const swimTraits = document.querySelector<HTMLSpanElement>('#kind-swim-traits')!;
const paddlesInput = document.querySelector<HTMLInputElement>('#paddles')!;

function renderKind() {
  const base = baseOf(state.motion);
  const info = BASES.find((b) => b.id === base)!;
  kindBases.replaceChildren(
    ...BASES.map((b) => {
      const button = document.createElement('button');
      button.innerHTML = `<b>${b.icon}</b>${b.label}`;
      button.title = b.title;
      button.setAttribute('aria-pressed', String(b.id === base));
      button.onclick = () => b.id !== base && setMotion(b.first);
      return button;
    }),
  );
  kindBodiesWrap.hidden = !info.bodies.length;
  document.querySelector('#kind-bodies-title')!.textContent = base === 'land' ? 'How it moves' : 'Its body';
  kindBodies.replaceChildren(
    ...info.bodies.map(([motion, label, title]) => {
      const button = document.createElement('button');
      // An old Puffer is a wiggly-tailed swimmer that puffs.
      const on = motion === state.motion || (motion === 'fish' && state.motion === 'puffer');
      button.textContent = label;
      button.title = title;
      button.setAttribute('aria-pressed', String(on));
      button.onclick = () => !on && setMotion(motion);
      return button;
    }),
  );
  swimTraits.replaceChildren(
    ...(base === 'swim'
      ? TRAITS.map((t) => {
          const label = document.createElement('label');
          label.title = TRAIT_INFO[t][1];
          const box = Object.assign(document.createElement('input'), { type: 'checkbox', checked: hasTrait(t) });
          box.onchange = () => {
            if (box.checked === Boolean(usualTraits()[t])) delete traits[t];
            else traits[t] = box.checked;
            renderKind();
            changed();
          };
          label.append(box, ` ${TRAIT_INFO[t][0]}`);
          return label;
        })
      : []),
  );
  document.querySelector<HTMLLabelElement>('#paddles-label')!.hidden = base !== 'fly';
  paddlesInput.checked = state.motion === 'waterfowl';
  // "🐟 Fish + 🐡": the style, and anything it does that its body usually doesn't.
  const extra = TRAITS.filter((t) => traits[t] === true).map((t) => TRAIT_INFO[t][0].split(' ')[0]);
  kindLabel.textContent = [MOTION_LABELS[state.motion], ...extra].join(' + ');
}
paddlesInput.onchange = () => setMotion(paddlesInput.checked ? 'waterfowl' : 'flier');

function openKinds(open: boolean) {
  kindPicker.hidden = !open;
  kindButton.setAttribute('aria-expanded', String(open));
}
kindButton.onclick = () => openKinds(kindPicker.hidden === true);
document.querySelector<HTMLButtonElement>('#kind-done')!.onclick = () => openKinds(false);
addEventListener('pointerdown', (e) => {
  if (!kindPicker.hidden && !(e.target as Element).closest('.kind-wrap')) openKinds(false);
});

// --- where it lives: its habitats, whether it comes in a group, and (optionally) the original's home ------

/** The places it can live, in the order they were picked (the preview shows the first). */
let habitats: Biome[] = [];
/** Roughly how big its kind grows (undefined: medium). */
let speciesSize: SpeciesSize | undefined;

/** Worlds picked for it (none: wherever its drawing packs are, else Earth). */
let chosenWorlds: string[] = [];
/** Exact places picked on the map (none: anywhere in its worlds that suits it). */
let chosenPlaces: string[] = [];
/** The worlds its drawing packs give it (when changing a drawing that's in some). */
let packWorlds: string[] = [];
const followed = () => (packWorlds.length ? packWorlds : ['earth']).filter((id) => worldById(id));
/** The worlds it lives in. */
const livesIn = () => {
  const list = (chosenWorlds.length ? chosenWorlds : followed()).filter((id) => worldById(id));
  return list.length ? list : ['earth'];
};
/** The kinds of place open in its worlds (the chips to pick from). */
const openBiomes = () => BIOMES.filter((b) => LIVE_PLACES.some((p) => p.biome === b && livesIn().includes(p.world)));
/** The ones that suit the style: no Lake or Ocean for fliers and waterfowl, which have no sky to fly in there. */
const choices = () => openBiomes().filter((b) => suits(state.motion, b));

/** Sets where it lives; worlds and exact places only when given (a new style keeps them, but drops places that don't suit it). */
function setWhere(list: Biome[], group: boolean, home = '', size?: SpeciesSize, where?: { worlds?: string[]; places?: string[] }) {
  if (where) {
    chosenWorlds = where.worlds ?? [];
    chosenPlaces = where.places ?? [];
  }
  chosenPlaces = chosenPlaces.filter((id) => {
    const p = placeById(id);
    return p && suits(state.motion, p.biome) && livesIn().includes(p.world);
  });
  const picked = choices().filter((b) => list.includes(b));
  if (!picked.length) list = defaultHabitats(state.motion);
  habitats = choices().filter((b) => list.includes(b)).sort((a, b) => list.indexOf(a) - list.indexOf(b));
  // Somewhere to live in its worlds, even if its style's usual kinds aren't there.
  if (!habitats.length) habitats = choices().slice(0, 1);
  groupInput.checked = group;
  speciesSize = size;
  renderWhere(home);
}

/** Its worlds changed: keep the kinds and places that are still there. */
function worldsChanged() {
  setWhere(habitats, groupInput.checked, homeSelect.value, speciesSize);
  if (!placePicker.hidden) void showPicker();
  schedulePreview();
}

const SPECIES_SIZES: [SpeciesSize | undefined, string][] = [['small', 'Small'], [undefined, 'Medium'], ['big', 'Big']];

// --- 🏠 Dens: a decoration that some creatures live in -------------------------------------------------

const denBox = document.querySelector<HTMLDivElement>('#den-box')!;
const denForEl = document.querySelector<HTMLDivElement>('#den-for')!;
const denAdd = document.querySelector<HTMLSelectElement>('#den-add')!;
const denDoor = document.querySelector<HTMLDivElement>('#den-door')!;
const denPicture = document.querySelector<HTMLImageElement>('#den-picture')!;
const denMark = document.querySelector<HTMLSpanElement>('#den-mark')!;
const denHint = document.querySelector<HTMLParagraphElement>('#den-hint')!;
/** Who lives in it (drawing ids), and where its door is (across and down the picture, 0..1). */
let denFor: string[] = [];
let denDoorAt: [number, number] | null = null;
/** The creatures that could live in a den, for the list. */
let denChoices: Drawing[] | null = null;

async function renderDen() {
  denBox.hidden = state.motion !== 'decor';
  if (denBox.hidden) return;
  denChoices ??= (await fetchDrawings().catch(() => [] as Drawing[])).filter((d) => !d.off && DEN_MOTIONS.includes(motionOf(d)));
  const named = (id: string) => denChoices!.find((d) => d.id === id)?.name ?? 'Someone';
  denForEl.replaceChildren(
    ...denFor.map((id) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = `${named(id)} ✕`;
      b.title = 'Take it off the list';
      b.onclick = () => {
        denFor = denFor.filter((x) => x !== id);
        void renderDen();
      };
      return b;
    }),
  );
  const left = denChoices.filter((d) => !denFor.includes(d.id)).sort((a, b) => a.name.localeCompare(b.name));
  denAdd.replaceChildren(new Option(denFor.length ? '+ Someone else…' : '+ Who lives in it?', ''), ...left.map((d) => new Option(d.name, d.id)));
  denAdd.hidden = denFor.length >= MAX_DEN_FOR || !left.length;
  denDoor.hidden = !denFor.length;
  denMark.hidden = !denDoorAt;
  if (denDoorAt) {
    denMark.style.left = `${denDoorAt[0] * 100}%`;
    denMark.style.top = `${denDoorAt[1] * 100}%`;
  }
  const open = currentParts().some((p) => p.motion === 'front');
  denHint.textContent = !denFor.length
    ? 'Is it a home? Pick who lives in it: a hive for bees, a cave for a bear.'
    : !denDoorAt
      ? '👆 Tap the picture where they go in.'
      : open
        ? 'They can be seen inside, behind its 🚪 In front parts.'
        : 'They go in out of sight. To see them inside (a cave, say), use ✨ Make it move → 🚪 In front on the parts that cover them.';
}

denAdd.onchange = () => {
  if (denAdd.value) denFor = [...denFor, denAdd.value];
  void renderDen();
};
denDoor.onclick = (e) => {
  const r = denPicture.getBoundingClientRect();
  if (!r.width || !r.height) return;
  denDoorAt = [Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), Math.min(1, Math.max(0, (e.clientY - r.top) / r.height))];
  void renderDen();
};

/** The finished picture, to tap its door on. */
function refreshDenPicture() {
  if (state.motion !== 'decor') return;
  const exported = exportCurrent();
  if (exported) denPicture.src = exported.dataUrl;
}

function denPayload() {
  return state.motion === 'decor' && denFor.length && denDoorAt ? { for: denFor, door: denDoorAt } : undefined;
}

function renderWhere(home = homeSelect.value) {
  void renderDen();
  // Only animals explore; an explorer is one of a kind, and goes wherever its travels take it.
  explorerLabel.hidden = state.motion === 'plant' || state.motion === 'decor';
  if (explorerLabel.hidden) explorerInput.checked = false;
  groupInput.closest('label')!.hidden = explorerInput.checked;
  homeSelect.closest('label')!.hidden = explorerInput.checked;
  // The worlds, when there's more than one: ticked are where it lives. Changing them away from what its
  // packs say makes them its own choice; back to the same, and it follows its packs again.
  const worlds = allWorlds();
  worldsLabel.hidden = worldsEl.hidden = worlds.length < 2;
  worldsEl.replaceChildren(
    ...worlds.map((w) => {
      const b = document.createElement('button');
      b.type = 'button';
      const on = livesIn().includes(w.id);
      b.textContent = `${w.icon} ${w.name}${offWorlds.has(w.id) ? ' 💤' : ''}`;
      b.setAttribute('aria-pressed', String(on));
      b.title = offWorlds.has(w.id) ? 'Switched off for now (on the Worlds page)' : chosenWorlds.length ? 'Chosen for this drawing' : packWorlds.length ? 'From its drawing packs' : 'Where new drawings live';
      b.onclick = () => {
        const next = on ? livesIn().filter((id) => id !== w.id) : [...livesIn(), w.id];
        // Always somewhere to live.
        if (!next.length) return;
        const same = next.length === followed().length && next.every((id) => followed().includes(id));
        chosenWorlds = same ? [] : next;
        if (!on) {
          // Moving into a new world: if none of its kinds are ticked yet, tick the ones its style usually likes there.
          const there = LIVE_PLACES.filter((p) => p.world === w.id).map((p) => p.biome);
          if (!habitats.some((h) => there.includes(h))) habitats = [...habitats, ...defaultHabitats(state.motion).filter((h) => there.includes(h))];
        }
        worldsChanged();
      };
      return b;
    }),
  );
  habitatsEl.replaceChildren(
    ...choices().map((biome) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = BIOME_NAMES[biome];
      b.setAttribute('aria-pressed', String(habitats.includes(biome)));
      b.onclick = () => {
        // Always somewhere to live.
        if (habitats.includes(biome) && habitats.length > 1) habitats = habitats.filter((h) => h !== biome);
        else if (!habitats.includes(biome)) habitats = [...habitats, biome];
        renderWhere();
        schedulePreview();
      };
      return b;
    }),
  );
  speciesSizesEl.replaceChildren(
    ...SPECIES_SIZES.map(([size, label]) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = label;
      b.setAttribute('aria-pressed', String(speciesSize === size));
      b.onclick = () => {
        speciesSize = size;
        renderWhere();
        schedulePreview();
      };
      return b;
    }),
  );
  const places = chosenPlaces.length
    ? LIVE_PLACES.filter((p) => chosenPlaces.includes(p.id))
    : LIVE_PLACES.filter((p) => habitats.includes(p.biome) && livesIn().includes(p.world));
  // Grouped by world when it lives in more than one.
  const byWorld = livesIn().map((id) => [worldById(id)!, places.filter((p) => p.world === id)] as const).filter(([, list]) => list.length);
  homeSelect.replaceChildren(
    new Option('Anywhere it suits', ''),
    ...(byWorld.length > 1
      ? byWorld.map(([w, list]) => {
          const group = document.createElement('optgroup');
          group.label = `${w.icon} ${w.name}`;
          group.append(...list.map((p) => new Option(`At ${p.name}`, p.id)));
          return group;
        })
      : places.map((p) => new Option(`At ${p.name}`, p.id))),
  );
  homeSelect.value = places.some((p) => p.id === home) ? home : '';
  const only = chosenPlaces.length === 1 ? placeById(chosenPlaces[0])!.name : `${chosenPlaces.length} places`;
  choosePlacesButton.textContent = chosenPlaces.length ? `📍 Only at ${only}…` : '📍 Choose places…';
  choosePlacesButton.setAttribute('aria-expanded', String(!placePicker.hidden));
}

// --- 📍 the place picker: tap exactly which places it lives at, on each of its worlds' maps --------------------

let picker: MapPanel | null = null;
let pickerWorld = 'earth';

async function showPicker() {
  placePicker.hidden = false;
  if (!livesIn().includes(pickerWorld)) pickerWorld = livesIn()[0];
  picker ??= await createMapPanel(document.querySelector<HTMLDivElement>('#picker-map')!);
  pickerWorldsEl.hidden = livesIn().length < 2;
  pickerWorldsEl.replaceChildren(
    ...livesIn().map((id) => {
      const w = worldById(id)!;
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = `${w.icon} ${w.name}`;
      b.setAttribute('aria-pressed', String(id === pickerWorld));
      b.onclick = () => {
        pickerWorld = id;
        void showPicker();
      };
      return b;
    }),
  );
  const map = picker.show(worldById(pickerWorld)!);
  const marks = () => {
    map.setMarks(Object.fromEntries(map.world.places.map((p) => [p.id, chosenPlaces.includes(p.id) ? 'chosen' : suits(state.motion, p.biome) ? 'free' : 'unsuited'] as const)));
    const names = chosenPlaces.map((id) => placeById(id)?.name).filter(Boolean);
    pickerHint.textContent = names.length
      ? `Lives only at ${names.join(', ')}. Tap a place again to take it out.`
      : 'Tap the places it should live at. With none picked, it lives anywhere in its worlds that suits it. Faded places don’t suit its style.';
  };
  map.onPick = (id) => {
    const p = placeById(id);
    if (!p || !suits(state.motion, p.biome)) return;
    chosenPlaces = chosenPlaces.includes(id) ? chosenPlaces.filter((x) => x !== id) : [...chosenPlaces, id];
    marks();
    renderWhere();
    schedulePreview();
  };
  marks();
  renderWhere();
}

choosePlacesButton.onclick = () => {
  if (placePicker.hidden) void showPicker();
  else {
    placePicker.hidden = true;
    renderWhere();
  }
};

/** What to send: nothing where it's just the style's usual, so it keeps following the style. */
function wherePayload() {
  const usual = defaultHabitats(state.motion).filter((b) => openBiomes().includes(b));
  const same = usual.length === habitats.length && usual.every((b) => habitats.includes(b));
  return {
    habitats: same ? undefined : habitats,
    group: groupInput.checked === defaultGroup(state.motion) ? undefined : groupInput.checked,
    home: homeSelect.value || undefined,
    size: speciesSize,
    worlds: chosenWorlds.length ? chosenWorlds : undefined,
    places: chosenPlaces.length ? chosenPlaces : undefined,
  };
}

function renderGuide() {
  const m = state.motion;
  facingButton.hidden = !hasFacing(m);
  facingButton.textContent = state.facingLeft ? '← Facing' : 'Facing →';
  nameInput.placeholder = PLACEHOLDERS[m];
  const mirrorLine = state.mirror === 'off' ? '' : `<div class="mirror-line ${state.mirror}"></div>`;
  const way = (text: string) => (state.facingLeft ? `⟵ ${text}` : `${text} ⟶`);
  const top = (text: string) => `<div class="arrow">${text}</div>`;
  const ground = (text: string) => `<div class="ground">${text}</div>`;
  const guides: Record<Motion, string> = {
    fish: top(way('head this way')),
    puffer: top(way('head this way')),
    eel: top(way('head this way')),
    flapper: top(way('head this way')),
    vessel: top(way('front this way')),
    seahorse: top(way('head at the top, facing')),
    jelly: top('bell on top, tentacles hanging down'),
    crawler: top(way('walks this way')) + ground('walks on the sand'),
    plant: ground('grows up from the ground'),
    decor: ground('sits on the ground'),
    walker: top(way('head this way')) + ground('feet on the ground'),
    hopper: top(way('head this way')) + ground('feet on the ground'),
    slitherer: top(way('head this way')) + ground('slides along the ground'),
    flier: top(way('head this way')),
    waterfowl: top(way('head this way')) + ground('floats on its belly'),
  };
  guide.innerHTML = mirrorLine + guides[m];
}

/** Called whenever the drawing, its style or its extras change. */
function changed() {
  schedulePreview();
  scheduleParts();
  scheduleDraft();
}

// --- 💾 the drawing so far is kept in this browser, so a closed tab (or a crash) doesn't lose it ----------

const DRAFT_KEY = 'doodlearium.draft';
interface Draft {
  at: number;
  paper: string;
  holes?: string;
  glow?: { glow: string; uv: string };
  attachments: PlacedAttachment[];
  motion: Motion;
  traits: Traits;
  name: string;
  facingLeft: boolean;
  nocturnal: boolean;
}
let draftTimer = 0;
/** Not while the draft is being put back (that would save it half-loaded). */
let restoringDraft = false;

function scheduleDraft() {
  // Changing a saved drawing isn't a draft: it's on the server already.
  if (editing || restoringDraft) return;
  clearTimeout(draftTimer);
  draftTimer = window.setTimeout(saveDraft, 1500);
}

function saveDraft() {
  try {
    const attachments = currentAttachments();
    if (!inkBounds(paper) && !attachments.length) {
      localStorage.removeItem(DRAFT_KEY);
      return;
    }
    const glow = inkBounds(glowCanvases.glow) || inkBounds(glowCanvases.uv);
    const draft: Draft = {
      at: Date.now(),
      paper: paper.toDataURL('image/png'),
      holes: inkBounds(holesCanvas) ? holesCanvas.toDataURL('image/png') : undefined,
      glow: glow ? { glow: glowCanvases.glow.toDataURL('image/png'), uv: glowCanvases.uv.toDataURL('image/png') } : undefined,
      attachments,
      motion: state.motion,
      traits,
      name: nameInput.value,
      facingLeft: state.facingLeft,
      nocturnal: nocturnalInput.checked,
    };
    localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
  } catch {
    // Private windows, full storage: carry on without one.
  }
}

/** Puts back the drawing that was on the paper last time, if there is one. Moving parts come back as plain drawing. */
async function restoreDraft() {
  let draft: Draft | null = null;
  try {
    draft = JSON.parse(localStorage.getItem(DRAFT_KEY) ?? 'null');
  } catch {}
  if (!draft?.paper) return;
  // Nothing saves over it while it's coming back (the empty page would).
  clearTimeout(draftTimer);
  restoringDraft = true;
  const load = async (src: string) => {
    const image = new Image();
    image.src = src;
    await image.decode();
    const canvas = Object.assign(document.createElement('canvas'), { width: paper.width, height: paper.height });
    canvas.getContext('2d')!.drawImage(image, 0, 0);
    return canvas;
  };
  try {
    base = {
      image: await load(draft.paper),
      x: 0,
      y: 0,
      holes: draft.holes ? await load(draft.holes) : undefined,
      glow: draft.glow ? { glow: await load(draft.glow.glow), uv: await load(draft.glow.uv) } : undefined,
    };
    baseAttachments = draft.attachments ?? [];
    setMotion(draft.motion);
    traits = { ...draft.traits };
    renderKind();
    nameInput.value = draft.name ?? '';
    state.facingLeft = Boolean(draft.facingLeft);
    nocturnalInput.checked = Boolean(draft.nocturnal);
    renderGuide();
    redraw();
    showToast('🖍️ Welcome back! Here’s the drawing you were working on (🗑 Clear to start a new one).');
  } catch {
    base = null;
  } finally {
    restoringDraft = false;
  }
}

document.querySelector<HTMLButtonElement>('#undo')!.onclick = undo;
document.querySelector<HTMLButtonElement>('#clear')!.onclick = () => {
  if ((ops.length || base) && !confirm('Clear the whole drawing?')) return;
  ops.length = 0;
  base = null;
  baseAttachments = [];
  baseParts = [];
  selection.clear();
  closePhotoPanel();
  if (behindFor) finishBehind();
  redraw();
  // A cleared paper isn't worth keeping as a draft.
  clearTimeout(draftTimer);
  try {
    localStorage.removeItem(DRAFT_KEY);
  } catch {}
  changed();
};
const KEY_TOOLS: Record<string, Tool> = { b: 'brush', e: 'eraser', f: 'fill', x: 'extras', s: 'select' };
addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (!kindPicker.hidden) openKinds(false);
    else if (behindFor) finishBehind();
  }
  // Typing a name, or naming it on the Ready step: the keys are for that.
  if ((e.target as Element).closest?.('input, select, textarea') || drawStep.hidden) return;
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
    e.preventDefault();
    undo();
    return;
  }
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  const tool = KEY_TOOLS[e.key.toLowerCase()];
  if (tool) setTool(tool);
  else if (e.key === '[' || e.key === ']') {
    sizeButtons[Math.max(0, Math.min(SIZES.length - 1, state.sizeIndex + (e.key === ']' ? 1 : -1)))].click();
  }
});

function undo() {
  // While selecting, undo first takes back the pending move, then the selection itself.
  if (selection.moved) selection.resetPlacement();
  else if (!selection.empty) selection.clear();
  else ops.pop();
  redraw();
  if (behindFor && !currentParts().includes(behindFor)) finishBehind();
}

// --- painting ------------------------------------------------------------

function toCanvas(e: PointerEvent): Point {
  const rect = paper.getBoundingClientRect();
  return {
    x: ((e.clientX - rect.left) / rect.width) * paper.width,
    y: ((e.clientY - rect.top) / rect.height) * paper.height,
    pressure: e.pointerType === 'pen' ? e.pressure || 0.5 : 0.5,
  };
}

/** The point itself plus its reflection when mirror drawing is on. */
function withMirror<T extends { x: number; y: number }>(p: T, mirror: Mirror): T[] {
  if (mirror === 'updown') return [p, { ...p, y: paper.height - p.y }];
  if (mirror === 'leftright') return [p, { ...p, x: paper.width - p.x }];
  return [p];
}

paper.addEventListener('pointerdown', (e) => {
  if (e.button !== 0) return;
  const p = toCanvas(e);
  if (hingeFor) {
    paper.setPointerCapture(e.pointerId);
    hingeLine = [p.x, p.y, p.x, p.y];
    return;
  }
  if (state.tool === 'fill') {
    const op: Op = {
      type: 'fill',
      x: p.x,
      y: p.y,
      color: state.color,
      material: state.material,
      mirror: state.mirror,
      paint: state.paint,
      turn: materialTurn(),
      behind: behindFor ? behindArea(behindFor.mask) : undefined,
    };
    ops.push(op);
    applyFill(op);
    changed();
    return;
  }
  if (state.tool === 'extras') {
    placeOrRemoveExtra(p);
    return;
  }
  paper.setPointerCapture(e.pointerId);
  if (state.tool === 'select') {
    if (selectMode === 'add' && selection.contains(p.x, p.y)) {
      startMove();
      drag = { x: p.x, y: p.y, dx: selection.dx, dy: selection.dy };
    } else {
      // Painting more of the selection starts from where the part is now.
      commitSelection();
      selectStroke = p;
      selectStart = { x: p.x, y: p.y, moved: 0 };
      paintSelection(p);
    }
    return;
  }
  current = {
    type: 'stroke',
    color: state.color,
    size: SIZES[state.sizeIndex],
    erase: state.tool === 'eraser',
    mirror: state.mirror,
    points: [p],
    paint: state.tool === 'eraser' ? 'normal' : state.paint,
    behind: behindFor ? true : undefined,
  };
  ops.push(current);
  drawSegment(current, 0);
});
paper.addEventListener('pointermove', (e) => {
  if (hingeLine) {
    const p = toCanvas(e);
    hingeLine[2] = p.x;
    hingeLine[3] = p.y;
    renderParts();
    return;
  }
  if (drag) {
    const p = toCanvas(e);
    selection.dx = drag.dx + p.x - drag.x;
    selection.dy = drag.dy + p.y - drag.y;
    renderSelection();
    return;
  }
  if (selectStroke) {
    const p = toCanvas(e);
    if (selectStart) selectStart.moved = Math.max(selectStart.moved, Math.hypot(p.x - selectStart.x, p.y - selectStart.y));
    paintSelection(p);
    return;
  }
  if (!current) return;
  const coalesced = e.getCoalescedEvents?.();
  for (const event of coalesced?.length ? coalesced : [e]) {
    current.points.push(toCanvas(event));
    drawSegment(current, current.points.length - 1);
  }
});
const endStroke = () => {
  if (current || drag) changed();
  if (hingeLine && hingeFor) {
    const [x1, y1, x2, y2] = hingeLine;
    if (Math.hypot(x2 - x1, y2 - y1) > 10) {
      ops.push({ type: 'hinge', target: hingeFor, hinge: hingeLine });
      showToast('Hinge moved! Check it in ▶ Preview.');
    }
    hingeFor = null;
    hingeLine = null;
    renderHint();
    changed();
  }
  if (selectStroke && selectStart && selectStart.moved < 6 && selectMode === 'add') {
    // A tap selects the whole shape under it, outline and all.
    const image = ctx.getImageData(0, 0, paper.width, paper.height);
    const i = (Math.floor(selectStart.y) * paper.width + Math.floor(selectStart.x)) * 4;
    if (image.data[i + 3] >= 128) selection.addRegion(floodRegion(image, [selectStart]), 3);
  }
  selectStart = null;
  if (selectStroke) {
    if (selectMode === 'add') selection.fillHoles();
    renderSelection();
    renderSelectBar();
  }
  current = null;
  drag = null;
  selectStroke = null;
};
paper.addEventListener('pointerup', endStroke);
paper.addEventListener('pointercancel', endStroke);

/** Draws the segment ending at point i (a dot when i is 0). Pen pressure scales width from 0.4x to 2.4x. */
function drawSegment(stroke: Extract<Op, { type: 'stroke' }>, i: number) {
  const p = stroke.points[i];
  const prev = stroke.points[Math.max(0, i - 1)];
  const invisible = stroke.color === 'clear';
  const width = brushWidth(stroke.size, p.pressure, stroke.erase);
  const line = (c: CanvasRenderingContext2D) => {
    c.lineCap = 'round';
    c.lineJoin = 'round';
    c.lineWidth = width;
    const froms = withMirror(prev, stroke.mirror);
    const tos = withMirror(p, stroke.mirror);
    c.beginPath();
    froms.forEach((from, k) => {
      c.moveTo(from.x, from.y);
      c.lineTo(tos[k].x + (i === 0 ? 0.01 : 0), tos[k].y);
    });
    c.stroke();
  };
  const target = stroke.behind ? behindCtx : ctx;
  target.globalCompositeOperation = stroke.erase || invisible ? 'destination-out' : 'source-over';
  target.strokeStyle = stroke.color === 'rainbow' ? `hsl(${(i * 4) % 360} 85% 58%)` : invisible ? '#000' : stroke.color;
  line(target);
  if (stroke.behind) {
    showBehind();
    return;
  }
  // Invisible paint marks a see-through spot; real paint over one covers it up again.
  if (invisible || !stroke.erase) {
    holes.globalCompositeOperation = invisible ? 'source-over' : 'destination-out';
    holes.strokeStyle = '#000';
    line(holes);
    showHoles();
  }
  // Glow paint marks its kind of glow; anything else painted (or erased) over it puts it out.
  const paint = invisible || stroke.erase ? 'normal' : (stroke.paint ?? 'normal');
  for (const kind of ['glow', 'uv'] as const) {
    const c = glowCtx[kind];
    c.globalCompositeOperation = paint === kind ? 'source-over' : 'destination-out';
    c.strokeStyle = '#000';
    line(c);
  }
  showGlow();
}

/** On-paper width of a brush stroke; pen pressure scales it from 0.4x to 2.4x. */
function brushWidth(size: number, pressure: number, erase: boolean) {
  return size * (0.4 + pressure * 2) * (erase ? 1.5 : 1);
}

function applyFill(op: Extract<Op, { type: 'fill' }>) {
  ctx.globalCompositeOperation = 'source-over';
  const material = op.material === 'solid' && op.color === 'rainbow' ? 'rainbow' : op.material;
  if (op.behind) {
    fillBehind(op, op.behind, material);
    return;
  }
  const area = floodFill(ctx, withMirror(op, op.mirror), material, op.color, op.turn ?? 0);
  const image = holes.getImageData(0, 0, holesCanvas.width, holesCanvas.height);
  const alpha = op.color === 'clear' ? 255 : 0;
  for (let i = 0; i < area.length; i++) if (area[i] === 1) image.data[i * 4 + 3] = alpha;
  holes.putImageData(image, 0, 0);
  showHoles();
  const paint = op.color === 'clear' ? 'normal' : (op.paint ?? 'normal');
  for (const kind of ['glow', 'uv'] as const) {
    const c = glowCtx[kind];
    const marks = c.getImageData(0, 0, paper.width, paper.height);
    const value = paint === kind ? 255 : 0;
    for (let i = 0; i < area.length; i++) if (area[i] === 1) marks.data[i * 4 + 3] = value;
    c.putImageData(marks, 0, 0);
  }
  showGlow();
}

/** A fill behind a part fills only within the part's area (empty, it fills all of it). */
function fillBehind(op: Extract<Op, { type: 'fill' }>, area: HTMLCanvasElement, material: Material) {
  const within = Object.assign(document.createElement('canvas'), { width: paper.width, height: paper.height });
  const w = within.getContext('2d', { willReadFrequently: true })!;
  w.drawImage(behindCanvas, 0, 0);
  w.globalCompositeOperation = 'destination-in';
  w.drawImage(area, 0, 0);
  w.globalCompositeOperation = 'source-over';
  floodFill(w, withMirror(op, op.mirror), material, op.color, op.turn ?? 0);
  w.globalCompositeOperation = 'destination-in';
  w.drawImage(area, 0, 0);
  behindCtx.globalCompositeOperation = 'destination-out';
  behindCtx.drawImage(area, 0, 0);
  behindCtx.globalCompositeOperation = 'source-over';
  behindCtx.drawImage(within, 0, 0);
  showBehind();
}

/** A light checkerboard, for what's see-through behind a part. */
const checks = (() => {
  const c = Object.assign(document.createElement('canvas'), { width: 24, height: 24 });
  const g = c.getContext('2d')!;
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, 24, 24);
  g.fillStyle = '#dde3ea';
  g.fillRect(0, 0, 12, 12);
  g.fillRect(12, 12, 12, 12);
  return behindView.createPattern(c, 'repeat')!;
})();

/** While painting behind a part: its area shows what's painted behind it instead of the part. */
function showBehind() {
  behindView.globalCompositeOperation = 'source-over';
  behindView.clearRect(0, 0, paper.width, paper.height);
  if (!behindFor) return;
  behindView.drawImage(behindArea(behindFor.mask), 0, 0);
  behindView.globalCompositeOperation = 'source-in';
  behindView.fillStyle = checks;
  behindView.fillRect(0, 0, paper.width, paper.height);
  behindView.globalCompositeOperation = 'source-over';
  behindView.drawImage(behindWithin([behindFor]), 0, 0);
}

/** What's painted behind the given parts, within their areas. */
function behindWithin(parts: EditorPart[]) {
  const out = Object.assign(document.createElement('canvas'), { width: paper.width, height: paper.height });
  const o = out.getContext('2d')!;
  for (const part of parts) o.drawImage(behindArea(part.mask), 0, 0);
  o.globalCompositeOperation = 'source-in';
  o.drawImage(behindCanvas, 0, 0);
  return out;
}

function startBehind(part: EditorPart) {
  hingeFor = null;
  if (!part.behind) {
    const result = { ...part, behind: true };
    ops.push({ type: 'behind', target: part, result });
    part = result;
  }
  behindFor = part;
  if (state.tool === 'select' || state.tool === 'extras') setTool('brush');
  renderPaintKind();
  renderHint();
  showBehind();
  changed();
}

function finishBehind() {
  behindFor = null;
  renderPaintKind();
  renderHint();
  showBehind();
  renderParts();
  schedulePreview();
}

let glowTimer = 0;
/** The paper's own colours, wherever there's glow paint, softly blurred on top of the paper by CSS. */
function showGlow() {
  clearTimeout(glowTimer);
  glowTimer = window.setTimeout(() => {
    for (const kind of ['glow', 'uv'] as const) {
      const v = glowViews[kind];
      v.globalCompositeOperation = 'copy';
      v.drawImage(paper, 0, 0);
      v.globalCompositeOperation = 'destination-in';
      v.drawImage(glowCanvases[kind], 0, 0);
    }
  }, 40);
}

function redraw() {
  ctx.globalCompositeOperation = 'source-over';
  ctx.clearRect(0, 0, paper.width, paper.height);
  behindCtx.globalCompositeOperation = 'source-over';
  behindCtx.clearRect(0, 0, paper.width, paper.height);
  if (base?.behind) behindCtx.drawImage(base.behind, base.x, base.y);
  holes.globalCompositeOperation = 'source-over';
  holes.clearRect(0, 0, holesCanvas.width, holesCanvas.height);
  if (base) ctx.drawImage(base.image, base.x, base.y);
  if (base?.holes) holes.drawImage(base.holes, base.x, base.y);
  for (const kind of ['glow', 'uv'] as const) {
    glowCtx[kind].globalCompositeOperation = 'source-over';
    glowCtx[kind].clearRect(0, 0, paper.width, paper.height);
    if (base?.glow) glowCtx[kind].drawImage(base.glow[kind], base.x, base.y);
  }
  for (const op of ops) {
    if (op.type === 'stroke') op.points.forEach((_, i) => drawSegment(op, i));
    else if (op.type === 'fill') applyFill(op);
    else if (op.type === 'paste') ctx.drawImage(op.image, op.x, op.y);
    else if (op.type === 'transform') {
      applyTransform(ctx, op);
      applyTransform(holes, op);
      applyTransform(glowCtx.glow, op);
      applyTransform(glowCtx.uv, op);
      applyTransform(behindCtx, op);
    }
  }
  showHoles();
  showBehind();
  showGlow();
  snapshotPaper();
  renderSelection();
  changed();
}

// --- extras --------------------------------------------------------------

function currentAttachments(): PlacedAttachment[] {
  const list = [...baseAttachments];
  for (const op of ops) {
    if (op.type === 'attach') list.push(op.attachment);
    else if (op.type === 'detach') list.splice(list.indexOf(op.target), 1);
    else if (op.type === 'transform') carryExtras(list, op);
  }
  if (selection.moved) carryExtras(list, selection.pendingOp());
  return list;
}

/** Extras on the selected part move, copy or disappear with it. */
function carryExtras(list: PlacedAttachment[], op: TransformOp) {
  op.carried ??= new Map();
  const size = Math.hypot(op.matrix.a, op.matrix.b);
  for (const a of [...list]) {
    if (!maskHas(op.mask, a.x, a.y)) continue;
    let moved = op.carried.get(a) as PlacedAttachment | undefined;
    if (!moved) {
      const p = op.matrix.transformPoint({ x: a.x, y: a.y });
      moved = { ...a, x: p.x, y: p.y, scale: Math.min(3, Math.max(0.25, a.scale * size)) };
      op.carried.set(a, moved);
    }
    if (!op.copy) list.splice(list.indexOf(a), 1);
    if (!op.remove) list.push(moved);
  }
}

function placeOrRemoveExtra(p: Point) {
  const list = currentAttachments();
  const hit = list.findLast((a) => Math.hypot(a.x - p.x, a.y - p.y) < 35 * a.scale);
  if (hit) {
    ops.push({ type: 'detach', target: hit });
  } else if (list.length >= MAX_ATTACHMENTS) {
    showToast(`That's a lot of extras! The limit is ${MAX_ATTACHMENTS}.`, true);
    return;
  } else {
    ops.push({
      type: 'attach',
      attachment: { kind: state.extra, x: p.x, y: p.y, scale: EXTRA_SCALES[state.sizeIndex], color: state.color === 'clear' ? '#ffffff' : state.color },
    });
  }
  renderMarkers();
  changed();
}

function renderMarkers() {
  const pxPerUnit = paper.getBoundingClientRect().width / paper.width;
  markers.replaceChildren(
    ...currentAttachments().map((a) => {
      const el = document.createElement('span');
      el.innerHTML = EXTRA_ICONS[a.kind];
      el.style.left = `${(a.x / paper.width) * 100}%`;
      el.style.top = `${(a.y / paper.height) * 100}%`;
      el.style.fontSize = `${Math.max(14, 70 * a.scale * pxPerUnit)}px`;
      return el;
    }),
  );
}
addEventListener('resize', renderMarkers);

/** The holes canvas only marks where; CSS masks a checkerboard with it so see-through spots show. */
let holesTimer = 0;
function showHoles() {
  clearTimeout(holesTimer);
  holesTimer = window.setTimeout(() => holesView.style.setProperty('--holes', `url(${holesCanvas.toDataURL()})`), 30);
}

// --- brush cursor: a circle the exact size the brush will paint ------------

const brushCursor = document.querySelector<HTMLDivElement>('#brush-cursor')!;

function cursorSize() {
  const size = SIZES[state.sizeIndex];
  if (state.tool === 'select') return selectBrushSize();
  if (state.tool === 'brush') return brushWidth(size, 0.5, false);
  if (state.tool === 'eraser') return brushWidth(size, 0.5, true);
  return 0;
}

function moveCursor(e: PointerEvent) {
  const p = toCanvas(e);
  const overSelection = state.tool === 'select' && selectMode === 'add' && selection.contains(p.x, p.y);
  const size = overSelection || e.pointerType === 'touch' ? 0 : cursorSize();
  brushCursor.hidden = size === 0;
  if (overSelection) paper.style.cursor = 'move';
  else if (state.tool === 'select') paper.style.cursor = 'none';
  if (brushCursor.hidden) return;
  const scale = paper.getBoundingClientRect().width / paper.width;
  brushCursor.style.width = brushCursor.style.height = `${size * scale}px`;
  brushCursor.style.left = `${(p.x / paper.width) * 100}%`;
  brushCursor.style.top = `${(p.y / paper.height) * 100}%`;
}
paper.addEventListener('pointermove', moveCursor);
paper.addEventListener('pointerdown', moveCursor);
paper.addEventListener('pointerleave', () => (brushCursor.hidden = true));

// --- selection ---------------------------------------------------------------

/** Remembers the paper before the selected part starts moving, so it can be shown anywhere. */
function startMove() {
  if (!selection.moved) snapshotPaper();
}

function snapshotPaper() {
  const s = snapshot.getContext('2d')!;
  s.clearRect(0, 0, snapshot.width, snapshot.height);
  s.drawImage(paper, 0, 0);
}

/** Shows the paper with the selected part where it's being moved to, and the selection on top. */
function renderSelection() {
  if (selection.moved) {
    ctx.save();
    ctx.globalCompositeOperation = 'copy';
    ctx.drawImage(snapshot, 0, 0);
    ctx.restore();
    applyTransform(ctx, selection.pendingOp());
  }
  selection.drawOverlay(overlay);
  renderMarkers();
}

const selectBrushSize = () => Math.max(30, SIZES[state.sizeIndex] * 3);

function paintSelection(p: Point) {
  const size = selectBrushSize();
  selection.paint(selectStroke ?? p, p, size, selectMode === 'remove');
  selectStroke = p;
  renderSelection();
}

/** Turns a pending move into an op in the history; the selection stays on the part. */
function commitSelection() {
  if (!selection.moved) return;
  const op = selection.pendingOp();
  ops.push(op);
  applyTransform(holes, op);
  applyTransform(glowCtx.glow, op);
  applyTransform(glowCtx.uv, op);
  showHoles();
  showGlow();
  selection.settle();
  snapshotPaper();
  renderSelection();
}

function finishSelection() {
  commitSelection();
  if (selection.empty) return;
  selection.clear();
  renderSelection();
  renderSelectBar();
}

function renderSelectBar() {
  selectBar.querySelectorAll<HTMLButtonElement>('[data-select]').forEach((b) => {
    b.disabled = b.dataset.select !== 'all' && selection.empty;
  });
  if (selection.empty || state.tool !== 'select') animatePanel.hidden = true;
}

selectBar.querySelectorAll<HTMLButtonElement>('[data-select-mode]').forEach((b) => {
  b.onclick = () => {
    selectMode = b.dataset.selectMode as typeof selectMode;
    press(selectBar.querySelectorAll('[data-select-mode]'), (x) => x === b);
  };
});

const SELECT_ACTIONS: Record<string, () => void> = {
  all() {
    commitSelection();
    selection.selectAll();
  },
  bigger: () => (selection.scale = Math.min(4, selection.scale * 1.15)),
  smaller: () => (selection.scale = Math.max(0.2, selection.scale / 1.15)),
  left: () => (selection.angle -= 15),
  right: () => (selection.angle += 15),
  flip: () => (selection.flip = !selection.flip),
  copy() {
    commitSelection();
    selection.copy = true;
    selection.dx = selection.dy = 40;
  },
  delete() {
    commitSelection();
    ops.push({ ...selection.pendingOp(), remove: true });
    selection.clear();
    redraw();
  },
  animate() {
    animatePanel.hidden = !animatePanel.hidden;
  },
  none: finishSelection,
  done: finishSelection,
};
selectBar.querySelectorAll<HTMLButtonElement>('[data-select]').forEach((b) => {
  b.onclick = () => {
    startMove();
    SELECT_ACTIONS[b.dataset.select!]();
    renderSelection();
    renderSelectBar();
    changed();
  };
});

// --- animated parts ------------------------------------------------------------

const animatePanel = document.querySelector<HTMLDivElement>('#animate-panel')!;
const partsList = document.querySelector<HTMLDivElement>('#parts-list')!;
const partsOverlay = document.querySelector<HTMLCanvasElement>('#parts-overlay')!.getContext('2d')!;

for (const motion of PART_MOTIONS) {
  const info = PART_INFO[motion];
  const b = document.createElement('button');
  b.textContent = `${info.icon} ${info.label}`;
  b.title = info.hint;
  b.onclick = () => makePart(motion);
  animatePanel.append(b);
}

/** Turns the selected area into an animated part. */
function makePart(motion: PartMotion) {
  if (selection.empty) return;
  if (currentParts().length >= MAX_PARTS) {
    showToast(`That's a lot of moving parts! The limit is ${MAX_PARTS}.`, true);
    return;
  }
  commitSelection();
  ops.push({ type: 'part', part: { mask: cloneCanvas(selection.mask), motion } });
  selection.clear();
  animatePanel.hidden = true;
  renderSelection();
  renderSelectBar();
  changed();
  const { icon, label } = PART_INFO[motion];
  showToast(
    isHinged(motion)
      ? `${icon} ${label} added! The orange dashed line is where it's joined on: tap 📍 on its chip to draw it yourself.`
      : `${icon} ${label} added! Open ▶ Preview to see it move.`,
  );
}

function currentParts(): EditorPart[] {
  const list = [...baseParts];
  for (const op of ops) {
    if (op.type === 'part') list.push(op.part);
    else if (op.type === 'unpart') {
      const i = list.indexOf(op.target);
      if (i >= 0) list.splice(i, 1);
    } else if (op.type === 'hinge') {
      const i = list.indexOf(op.target);
      if (i >= 0) list[i] = op.result ??= { ...op.target, hinge: op.hinge };
    } else if (op.type === 'tune') {
      const i = list.indexOf(op.target);
      if (i >= 0) list[i] = op.result ??= { ...op.target, speed: op.speed, amount: op.amount, flip: op.flip, lift: op.lift };
    } else if (op.type === 'behind') {
      const i = list.indexOf(op.target);
      if (i >= 0) list[i] = op.result;
    } else if (op.type === 'transform') carryParts(list, op);
  }
  if (selection.moved) carryParts(list, selection.pendingOp());
  return list;
}

/** Parts with their hinges worked out from the drawing as it is now (and the part each came from). */
function placedParts(): (PlacedPart & { source: EditorPart })[] {
  const parts = currentParts();
  if (!parts.length) return [];
  const ink = ctx.getImageData(0, 0, paper.width, paper.height);
  const headRight = !(hasFacing(state.motion) && state.facingLeft);
  return parts.flatMap((part) => {
    const hinge = findHinge(ink, part, headRight);
    return hinge ? [{ ...part, hinge, source: part }] : [];
  });
}

let partsTimer = 0;
function scheduleParts() {
  clearTimeout(partsTimer);
  partsTimer = window.setTimeout(renderParts, 150);
}

/** Rings around masks, worked out once per mask and width (they're redrawn whenever a part is pointed at). */
const outlines = new WeakMap<HTMLCanvasElement, Map<string, HTMLCanvasElement>>();

/** A ring around the mask, width px wide, so the part shows up whatever colour it is. */
function outline(mask: HTMLCanvasElement, width: number, color: string) {
  const key = `${width}:${color}`;
  let cached = outlines.get(mask);
  if (!cached) outlines.set(mask, (cached = new Map()));
  const known = cached.get(key);
  if (known) return known;
  const ring = Object.assign(document.createElement('canvas'), { width: mask.width, height: mask.height });
  const r = ring.getContext('2d')!;
  for (let a = 0; a < 16; a++) r.drawImage(mask, Math.cos((a / 16) * Math.PI * 2) * width, Math.sin((a / 16) * Math.PI * 2) * width);
  r.globalCompositeOperation = 'source-in';
  r.fillStyle = color;
  r.fillRect(0, 0, ring.width, ring.height);
  r.globalCompositeOperation = 'destination-out';
  r.drawImage(mask, 0, 0);
  cached.set(key, ring);
  return ring;
}

/** The parts as last shown on the paper. */
let shownParts: ReturnType<typeof placedParts> = [];

/** The part to pick out on the paper: the one being worked on, pointed at or tapped in the list. */
const focusedPart = () => behindFor ?? hingeFor ?? hoverPart ?? pickedPart;

/**
 * Shows each part tinted and outlined with its icon, plus the hinge it pops out or flaps from. A
 * picked-out part is shown brighter and the others faded.
 */
function drawPartsOverlay() {
  partsOverlay.clearRect(0, 0, paper.width, paper.height);
  const focus = focusedPart();
  for (const part of shownParts) {
    const picked = part.source === focus;
    // While painting behind a part, only its outline shows.
    if (behindFor && !picked) continue;
    partsOverlay.globalAlpha = focus && !picked ? 0.3 : 1;
    if (!behindFor) {
      const tint = document.createElement('canvas');
      tint.width = paper.width;
      tint.height = paper.height;
      const t = tint.getContext('2d')!;
      t.drawImage(part.mask, 0, 0);
      t.globalCompositeOperation = 'source-in';
      t.fillStyle = picked ? 'rgba(255, 214, 0, 0.5)' : 'rgba(255, 140, 26, 0.22)';
      t.fillRect(0, 0, paper.width, paper.height);
      partsOverlay.drawImage(tint, 0, 0);
    }
    // Dark outside, white inside: visible on orange, white and black parts alike.
    partsOverlay.drawImage(outline(part.mask, picked ? 8 : 5, 'rgba(20, 30, 60, 0.85)'), 0, 0);
    partsOverlay.drawImage(outline(part.mask, picked ? 4 : 2.5, picked ? 'rgba(255, 230, 0, 1)' : 'rgba(255, 255, 255, 0.95)'), 0, 0);
    const [x1, y1, x2, y2] = part.hinge;
    if (isHinged(part.motion) && part.source !== hingeFor) {
      partsOverlay.save();
      partsOverlay.lineWidth = 6;
      partsOverlay.lineCap = 'round';
      partsOverlay.setLineDash([12, 8]);
      partsOverlay.strokeStyle = 'rgba(230, 110, 0, 0.9)';
      partsOverlay.beginPath();
      partsOverlay.moveTo(x1, y1);
      partsOverlay.lineTo(x2, y2);
      partsOverlay.stroke();
      partsOverlay.restore();
    }
    const b = inkBounds(part.mask);
    if (b && !behindFor) {
      partsOverlay.font = '36px sans-serif';
      partsOverlay.textAlign = 'center';
      partsOverlay.textBaseline = 'middle';
      partsOverlay.fillText(PART_INFO[part.motion].icon, (b.left + b.right) / 2, (b.top + b.bottom) / 2);
    }
  }
  partsOverlay.globalAlpha = 1;
  if (hingeLine) {
    partsOverlay.save();
    partsOverlay.lineWidth = 8;
    partsOverlay.lineCap = 'round';
    partsOverlay.strokeStyle = 'rgba(230, 110, 0, 0.9)';
    partsOverlay.beginPath();
    partsOverlay.moveTo(hingeLine[0], hingeLine[1]);
    partsOverlay.lineTo(hingeLine[2], hingeLine[3]);
    partsOverlay.stroke();
    partsOverlay.restore();
  }
  for (const chip of partsList.querySelectorAll<HTMLElement>('.chip')) {
    chip.classList.toggle('picked', chipParts.get(chip) === focus);
  }
}

const chipParts = new WeakMap<HTMLElement, EditorPart>();

/** Shows the parts on the paper and lists them, each with buttons to change how it moves. */
function renderParts() {
  shownParts = placedParts();
  const parts = currentParts();
  if (pickedPart && !parts.includes(pickedPart)) pickedPart = null;
  if (hoverPart && !parts.includes(hoverPart)) hoverPart = null;
  partsList.hidden = parts.length === 0;
  const help = document.createElement('p');
  help.className = 'parts-help';
  help.textContent =
    'Tap a part to see which it is on the drawing. ' +
    (parts.some((p) => isHinged(p.motion)) ? "The orange dashed line is where it's joined on, and stays still while the rest moves: 📍 draws it again. " : '') +
    '🖼️ paints what shows where it was as it moves.';
  partsList.replaceChildren(
    document.createTextNode('Moving parts:'),
    ...parts.map((part) => {
      const chip = document.createElement('span');
      chip.className = 'chip';
      chipParts.set(chip, part);
      const label = document.createElement('span');
      label.className = 'label';
      label.textContent = `${PART_INFO[part.motion].icon} ${PART_INFO[part.motion].label}`;
      label.title = 'Tap to see which part this is';
      label.onclick = () => {
        pickedPart = pickedPart === part ? null : part;
        drawPartsOverlay();
      };
      chip.onpointerenter = () => {
        hoverPart = part;
        drawPartsOverlay();
      };
      chip.onpointerleave = () => {
        hoverPart = null;
        drawPartsOverlay();
      };
      chip.append(label);
      const remove = document.createElement('button');
      remove.textContent = '✕';
      remove.title = 'Stop this part moving';
      remove.onclick = () => {
        ops.push({ type: 'unpart', target: part });
        changed();
      };
      const tune = (key: 'speed' | 'amount', title: string, steps: [number, string][]) => {
        const i = Math.max(0, steps.findIndex(([v]) => v === (part[key] ?? 1)));
        const button = document.createElement('button');
        button.textContent = steps[i][1];
        button.title = title;
        button.onclick = () => {
          const tuned = { speed: part.speed ?? 1, amount: part.amount ?? 1, flip: part.flip, lift: part.lift, [key]: steps[(i + 1) % steps.length][0] };
          ops.push({ type: 'tune', target: part, ...tuned });
          changed();
        };
        chip.append(button);
      };
      tune('speed', 'Speed (tap to change): normal, fast or slow', [[1, '▶'], [1.8, '⏩'], [0.5, '🐢']]);
      tune('amount', 'How far it moves (tap to change): normal, big or small', [[1, '◐'], [1.6, '⬤'], [0.5, '·']]);
      if (part.motion === 'chomp') {
        // How it opens: swinging one way or the other (seen from the side), or lifting straight up (from the front).
        const ways = [
          { flip: false, lift: false, icon: '↪️' },
          { flip: true, lift: false, icon: '↩️' },
          { flip: false, lift: true, icon: '⏫' },
        ];
        const i = part.lift ? 2 : part.flip ? 1 : 0;
        const way = document.createElement('button');
        way.textContent = ways[i].icon;
        way.title = 'How it opens (tap to change): swings one way, swings the other way, or lifts straight up (for a clam seen from the front)';
        way.onclick = () => {
          const next = ways[(i + 1) % ways.length];
          ops.push({ type: 'tune', target: part, speed: part.speed ?? 1, amount: part.amount ?? 1, flip: next.flip, lift: next.lift });
          changed();
          showToast(next.lift ? '⏫ Lifts straight up' : next.flip ? '↩️ Swings open the other way' : '↪️ Swings open');
        };
        chip.append(way);
      }
      if (isHinged(part.motion)) {
        const pin = document.createElement('button');
        pin.textContent = '📍';
        pin.title = `Draw where it's joined on. ${PART_INFO[part.motion].attach}`;
        pin.onclick = () => {
          if (behindFor) finishBehind();
          hingeFor = part;
          renderHint();
          drawPartsOverlay();
        };
        chip.append(pin);
      }
      const behind = document.createElement('button');
      behind.textContent = '🖼️';
      behind.title = part.behind
        ? 'Paint more of what shows where it was, as it moves'
        : 'Paint what shows where it was, as it moves (otherwise a shadow of it is left there)';
      behind.setAttribute('aria-pressed', String(part === behindFor));
      behind.onclick = () => (part === behindFor ? finishBehind() : startBehind(part));
      chip.append(behind, remove);
      return chip;
    }),
    help,
  );
  drawPartsOverlay();
}

/** The drawing as it would be sent, with its parts. */
function exportCurrent() {
  return exportDrawing(paper, {
    mirror: hasFacing(state.motion) && state.facingLeft,
    paperFill: document.querySelector<HTMLInputElement>('#paper-fill')!.checked,
    holes: holesCanvas,
    glow: glowCanvases,
    attachments: currentAttachments(),
    parts: placedParts(),
    behind: behindWithin(currentParts().filter((p) => p.behind)),
  });
}

// --- photo of a paper drawing ----------------------------------------------

const photoInput = document.querySelector<HTMLInputElement>('#photo-input')!;
const photoPanel = document.querySelector<HTMLDivElement>('#photo-panel')!;
const photoStrength = document.querySelector<HTMLInputElement>('#photo-strength')!;
let photo: ImageBitmap | null = null;

document.querySelector<HTMLButtonElement>('#photo')!.onclick = () => {
  if ((ops.length || base) && !confirm('Start over with a photo? This replaces the current drawing.')) return;
  photoStrength.value = '5';
  photoInput.click();
};

photoInput.onchange = () => {
  const file = photoInput.files?.[0];
  photoInput.value = '';
  if (file) void usePhoto(file);
};

async function usePhoto(file: Blob) {
  try {
    photo = await readPhoto(file as File);
  } catch {
    showToast("Couldn't open that photo.", true);
    return;
  }
  ops.length = 0;
  baseAttachments = [];
  baseParts = [];
  selection.clear();
  photoPanel.hidden = false;
  applyPhoto();
  showToast('Picture added! Slide to clean up the paper (all the way left just clears a plain background), then touch it up with the tools.');
}

// Pasting a picture (say a screenshot from Windows + Shift + S): onto an empty page it's used like a photo;
// onto a drawing it lands on top, selected, ready to move and resize.
addEventListener('paste', async (e) => {
  if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
  const file = [...(e.clipboardData?.items ?? [])].find((i) => i.kind === 'file' && i.type.startsWith('image/'))?.getAsFile();
  if (!file) return;
  e.preventDefault();
  if (!ops.length && !base) {
    // Most pasted pictures are screenshots, not photos of paper.
    photoStrength.value = '0';
    void usePhoto(file);
    return;
  }
  let bitmap: ImageBitmap;
  try {
    bitmap = await readPhoto(file);
  } catch {
    showToast("Couldn't paste that picture.", true);
    return;
  }
  // Clear a plain background, so a pasted hat doesn't arrive in a white box.
  const image = removePaper(bitmap, paper.width * 0.6, paper.height * 0.6, 0);
  bitmap.close();
  const op: Op = {
    type: 'paste',
    image,
    x: Math.round((paper.width - image.width) / 2),
    y: Math.round((paper.height - image.height) / 2),
  };
  setTool('select');
  finishSelection();
  ops.push(op);
  redraw();
  selection.addImage(image, op.x, op.y);
  renderSelection();
  renderSelectBar();
  showToast('Pasted! Drag it where you want it, or resize and turn it.');
});

/** (Re)builds the base image from the photo at the current paper-removal strength. */
function applyPhoto() {
  if (!photo) return;
  // Leave a margin so the drawing doesn't touch the paper's edges.
  const image = removePaper(photo, paper.width * 0.9, paper.height * 0.9, Number(photoStrength.value));
  base = {
    image,
    x: Math.round((paper.width - image.width) / 2),
    y: Math.round((paper.height - image.height) / 2),
  };
  redraw();
}

let photoTimer = 0;
photoStrength.oninput = () => {
  clearTimeout(photoTimer);
  photoTimer = window.setTimeout(applyPhoto, 60);
};

function closePhotoPanel() {
  photoPanel.hidden = true;
  photo?.close();
  photo = null;
}
document.querySelector<HTMLButtonElement>('#photo-done')!.onclick = closePhotoPanel;

// --- live preview ----------------------------------------------------------

const previewEl = document.querySelector<HTMLDivElement>('#preview')!;
const previewToggle = document.querySelector<HTMLButtonElement>('#preview-toggle')!;
const workspace = document.querySelector<HTMLDivElement>('#workspace')!;
/** Tools, paper, options and (when it's out) the preview: beside the options on a wide screen, under the paper on a tall one. */
const desk = document.querySelector<HTMLDivElement>('.desk')!;
/** Loaded on first open, so the tank code (and Pixi) only downloads when someone wants a preview. */
let preview: Promise<import('../tank/mini.ts').Preview> | null = null;
let previewTimer = 0;

const previewBlacklight = document.querySelector<HTMLButtonElement>('#preview-blacklight')!;
previewBlacklight.onclick = async () => {
  const on = previewBlacklight.getAttribute('aria-pressed') !== 'true';
  previewBlacklight.setAttribute('aria-pressed', String(on));
  (await preview)?.setBlacklight(on);
};

previewToggle.onclick = () => {
  const open = Boolean(previewEl.hidden);
  previewEl.hidden = !open;
  workspace.classList.toggle('previewing', open);
  workspace.closest('.draw-step')?.classList.toggle('previewing', open);
  desk.classList.toggle('previewing', open);
  previewToggle.setAttribute('aria-pressed', String(open));
  previewToggle.textContent = open ? '⏹ Preview' : '▶ Preview';
  renderMarkers();
  if (open) {
    preview ??= import('../tank/mini.ts').then(async (m) => {
      const view = await m.createPreview(previewEl);
      view.setBlacklight(previewBlacklight.getAttribute('aria-pressed') === 'true');
      return view;
    });
    void refreshPreview();
  }
};

function schedulePreview() {
  if (previewEl.hidden) return;
  clearTimeout(previewTimer);
  previewTimer = window.setTimeout(refreshPreview, 500);
}

async function refreshPreview() {
  if (previewEl.hidden || !preview) return;
  const exported = exportCurrent();
  // Nothing on the paper (just sent, or cleared): nothing in the preview either.
  if (!exported) {
    (await preview).empty();
    return;
  }
  const load = async (src?: string) => {
    if (!src) return null;
    const image = new Image();
    image.src = src;
    await image.decode();
    return image;
  };
  const [{ Texture }, { splitParts, toCutout }, { glowTextures }, view, image, partsImage, glowImage, behindImage] = await Promise.all([
    import('pixi.js'),
    import('../tank/parts.ts'),
    import('../tank/glow.ts'),
    preview,
    load(exported.dataUrl),
    load(exported.partsImage),
    load(exported.glowImage),
    load(exported.behindImage),
  ]);
  const cutout = partsImage ? toCutout(splitParts(image!, partsImage, exported.parts, behindImage ?? undefined)) : null;
  const glow = glowImage ? glowTextures(image!, glowImage, partsImage ?? undefined) : null;
  // The preview shows where it'll live: its home, or the first place picked.
  const home = placeById(homeSelect.value || chosenPlaces[0] || '');
  view.setBiome(home?.biome ?? habitats[0] ?? 'lake', home?.look);
  view.show(
    {
      // This id seeds an easygoing creature near the front glass at a typical size.
      id: 'preview-13',
      type: 'swimmer',
      motion: state.motion,
      name: nameInput.value,
      artist: artistInput.value,
      createdAt: Date.now(),
      width: exported.width,
      height: exported.height,
      attachments: exported.attachments,
      nocturnal: nocturnalInput.checked,
      traits,
      parts: exported.parts,
      glow: Boolean(glow),
      size: speciesSize,
    },
    cutout?.body ?? Texture.from(image!),
    cutout,
    glow,
  );
}
document.querySelector<HTMLInputElement>('#paper-fill')!.addEventListener('change', schedulePreview);
nocturnalInput.addEventListener('change', schedulePreview);
// The draft keeps its name and night-time too.
nameInput.addEventListener('input', scheduleDraft);
nocturnalInput.addEventListener('change', scheduleDraft);
explorerInput.addEventListener('change', () => renderWhere());
homeSelect.addEventListener('change', schedulePreview);

// --- Ready ➜: naming it and choosing where it lives, while watching it move ----------------------------------

const drawStep = document.querySelector<HTMLElement>('#draw-step')!;
const readyStep = document.querySelector<HTMLElement>('#ready-step')!;
const readyLook = document.querySelector<HTMLDivElement>('#ready-look')!;
/** Whether the preview was open while drawing (it always is on the Ready step). */
let previewWasOpen = false;

function showReady(open: boolean) {
  if (open === drawStep.hidden) return;
  if (open) {
    finishSelection();
    if (!exportCurrent()) {
      showToast('Draw something first!', true);
      return;
    }
    openKinds(false);
  }
  drawStep.hidden = open;
  readyStep.hidden = !open;
  // The one preview moves between the steps.
  if (open) {
    previewWasOpen = !previewEl.hidden;
    refreshDenPicture();
    readyLook.prepend(previewEl);
    if (previewEl.hidden) previewToggle.click();
    else void refreshPreview();
  } else {
    desk.append(previewEl);
    if (!previewWasOpen && !previewEl.hidden) previewToggle.click();
  }
  dispatchEvent(new Event('resize'));
  scrollTo({ top: 0 });
  if (open && !nameInput.value) nameInput.focus();
}
document.querySelector<HTMLButtonElement>('#ready')!.onclick = () => showReady(true);
document.querySelector<HTMLButtonElement>('#back')!.onclick = () => showReady(false);

// --- submit --------------------------------------------------------------

let toastTimer = 0;
function showToast(message: string, error = false) {
  toast.textContent = message;
  toast.classList.toggle('error', error);
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => (toast.textContent = ''), 5000);
}

document.querySelector<HTMLFormElement>('#submit-form')!.onsubmit = async (e) => {
  e.preventDefault();
  finishSelection();
  const exported = exportCurrent();
  if (!exported) {
    showToast('Draw something first!', true);
    return;
  }
  const artist = artistInput.value.trim();
  const payload = {
    motion: state.motion,
    name: nameInput.value,
    artist,
    image: exported.dataUrl,
    attachments: exported.attachments,
    nocturnal: nocturnalInput.checked,
    explorer: explorerInput.checked || undefined,
    traits: Object.keys(traits).length ? traits : undefined,
    parts: exported.parts,
    partsImage: exported.partsImage,
    glowImage: exported.glowImage,
    behindImage: exported.behindImage,
    den: denPayload(),
    ...wherePayload(),
  };
  if (state.motion === 'decor' && denFor.length && !denDoorAt) {
    showToast('Tap the picture where they go into the den 🚪', true);
    return;
  }

  sendButton.disabled = true;
  try {
    if (editing) {
      const drawing = await updateDrawing(editing.id, payload);
      showToast(`Saved! ${drawing.name} is updated everywhere it lives.`);
      setTimeout(() => location.assign('/gallery/'), 1200);
      return;
    }
    try {
      localStorage.setItem('doodlearium.artist', artist);
    } catch {}
    const drawing = await submitDrawing(payload);
    const where = drawing.place ? placeById(drawing.place)?.name : undefined;
    showToast(
      `Splash! ${drawing.name} moved into ${where ?? 'the world'}.${drawing.nocturnal ? ' It comes out at night 🌙' : ''}${drawing.explorer ? ' It\u2019ll be off exploring before long 🧭' : ''}`,
    );
    // It's in the world now, so the draft is done with.
    clearTimeout(draftTimer);
    try {
      localStorage.removeItem(DRAFT_KEY);
    } catch {}
    ops.length = 0;
    base = null;
    baseAttachments = [];
    baseParts = [];
    nameInput.value = '';
    nocturnalInput.checked = false;
    explorerInput.checked = false;
    denFor = [];
    denDoorAt = null;
    setWhere(defaultHabitats(state.motion), defaultGroup(state.motion), '', undefined, {});
    closePhotoPanel();
    redraw();
    showReady(false);
  } catch (err) {
    showToast(err instanceof Error ? err.message : 'Upload failed', true);
  } finally {
    sendButton.disabled = false;
  }
};

// --- editing an existing drawing (/draw/?edit=<id>) ----------------------

/** Splits a saved glow image back into the glow and blacklight masks. */
async function loadGlowMasks(drawing: Drawing) {
  const image = new Image();
  image.src = glowUrl(drawing);
  await image.decode();
  const { width, height } = image;
  const read = Object.assign(document.createElement('canvas'), { width, height }).getContext('2d', { willReadFrequently: true })!;
  read.drawImage(image, 0, 0);
  const marks = read.getImageData(0, 0, width, height).data;
  const mask = (channel: number) => {
    const canvas = Object.assign(document.createElement('canvas'), { width, height });
    const c = canvas.getContext('2d')!;
    const out = c.createImageData(width, height);
    for (let i = 0; i < marks.length; i += 4) out.data[i + 3] = marks[i + channel];
    c.putImageData(out, 0, 0);
    return canvas;
  };
  return { glow: mask(0), uv: mask(1) };
}

async function loadBehind(drawing: Drawing) {
  const image = new Image();
  image.src = behindUrl(drawing);
  return image.decode().then(
    () => image,
    () => undefined,
  );
}

async function loadForEditing(id: string) {
  const drawing = (await fetchDrawings()).find((d) => d.id === id);
  if (!drawing) {
    showToast('That drawing no longer exists.', true);
    return;
  }
  const image = new Image();
  image.src = imageUrl(drawing);
  await image.decode();

  editing = drawing;
  // Stored images are at most 512px, so they fit the 1000x750 paper at their own size.
  base = {
    image,
    x: Math.round((paper.width - image.width) / 2),
    y: Math.round((paper.height - image.height) / 2),
    holes: enclosedHoles(image),
    glow: drawing.glow ? await loadGlowMasks(drawing) : undefined,
    behind: drawing.parts?.some((p) => p.behind) ? await loadBehind(drawing) : undefined,
  };
  baseAttachments = (drawing.attachments ?? []).map((a) => ({
    ...a,
    x: base!.x + a.x * image.width,
    y: base!.y + a.y * image.height,
  }));
  baseParts = [];
  if (drawing.parts?.length) {
    const partsImage = new Image();
    partsImage.src = partsUrl(drawing);
    await partsImage.decode();
    baseParts = partsFromImage(
      partsImage,
      drawing.parts,
      paper,
      base,
    );
  }
  setMotion(motionOf(drawing));
  traits = { ...drawing.traits };
  renderKind();
  nameInput.value = drawing.name;
  artistInput.value = drawing.artist;
  nocturnalInput.checked = drawing.nocturnal === true;
  explorerInput.checked = drawing.explorer === true;
  denFor = drawing.den?.for ?? [];
  denDoorAt = drawing.den?.door ?? null;
  // The worlds its drawing packs give it, so the chips show where it lives now.
  const packs = await fetchPacks().catch(() => []);
  packWorlds = [...new Set(packs.filter((p) => p.drawings.includes(drawing.id)).flatMap((p) => p.worlds ?? []))];
  setWhere(drawing.habitats?.length ? drawing.habitats : defaultHabitats(motionOf(drawing)), drawing.group ?? defaultGroup(motionOf(drawing)), drawing.home, drawing.size, {
    worlds: drawing.worlds,
    places: drawing.places,
  });
  sendButton.textContent = 'Save changes 💾';
  const banner = document.querySelector<HTMLParagraphElement>('#editing')!;
  banner.hidden = false;
  banner.textContent =
    hasFacing(motionOf(drawing))
      ? `Editing ${drawing.name}. ${LAND_MOTIONS.includes(motionOf(drawing)) ? 'Going' : 'Swimming'} backwards? Tap “Facing” so the arrow points the way its head does, then save.`
      : `Editing ${drawing.name}.`;
  redraw();
}

pickColor(state.color);
press(sizeButtons, (b) => b === sizeButtons[state.sizeIndex]);
press(materialButtons, (b) => b === materialButtons[0]);
press(extraButtons, (b) => b === extraButtons[0]);
setTool('brush');
renderGuide();
renderKind();
setWhere(defaultHabitats(state.motion), defaultGroup(state.motion));

const editId = new URLSearchParams(location.search).get('edit');
// 🏠 Draw its den (from a creature in the gallery): a decoration, already that creature's home.
const denOf = new URLSearchParams(location.search).get('den');
if (editId) {
  loadForEditing(editId)
    .then(() => {
      // From a creature's 🏠 Its den: straight to where who lives in it is chosen.
      if (new URLSearchParams(location.search).get('step') !== 'den') return;
      showReady(true);
      denBox.scrollIntoView({ block: 'center' });
    })
    .catch(() => showToast('Could not load that drawing.', true));
} else {
  void restoreDraft().then(() => {
    if (!denOf) return;
    setMotion('decor');
    renderKind();
    denFor = [denOf];
    setWhere(defaultHabitats('decor'), defaultGroup('decor'));
  });
}
