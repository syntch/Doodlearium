import {
  MAX_ATTACHMENTS,
  MAX_PARTS,
  PART_MOTIONS,
  imageUrl,
  motionOf,
  partsUrl,
  type AttachmentKind,
  type Drawing,
  type Motion,
  type PartMotion,
} from '../../shared/types.ts';
import { fetchDrawings, setupFeedButton, submitDrawing, updateDrawing } from '../shared/api.ts';
import { enclosedHoles, exportDrawing, inkBounds, type PlacedAttachment, type PlacedPart } from './export.ts';
import { MATERIALS, MATERIAL_LABELS, floodFill, floodRegion, materialPreview, type Material } from './fill.ts';
import { readPhoto, removePaper } from './photo.ts';
import { Selection, applyTransform, maskHas, type TransformOp } from './selection.ts';
import { PART_INFO, carryParts, cloneCanvas, findHinge, partsFromImage, type EditorPart } from './parts.ts';

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

const EXTRAS: { kind: AttachmentKind; icon: string; label: string; hint: string }[] = [
  { kind: 'bubbles', icon: '🫧', label: 'Bubbles', hint: 'Bubbles float up from here' },
  { kind: 'sparkles', icon: '✨', label: 'Sparkles', hint: 'Twinkling sparkles in your colour' },
  { kind: 'glow', icon: '💡', label: 'Glow', hint: 'A soft light, best at night' },
  { kind: 'googly', icon: '👀', label: 'Googly eye', hint: 'A wobbly googly eye' },
  { kind: 'flag', icon: '🚩', label: 'Flag', hint: 'A flag waving in the current, in your colour' },
  { kind: 'propeller', icon: '🌀', label: 'Propeller', hint: 'A spinning propeller' },
];
const EXTRA_ICONS = Object.fromEntries(EXTRAS.map((e) => [e.kind, e.icon])) as Record<AttachmentKind, string>;

type Tool = 'brush' | 'eraser' | 'fill' | 'extras' | 'select';
type Mirror = 'off' | 'updown' | 'leftright';
type Point = { x: number; y: number; pressure: number };

/** Everything on the paper is a replayable list of operations, so undo works the same for every tool. */
type Op =
  | { type: 'stroke'; color: string; size: number; erase: boolean; mirror: Mirror; points: Point[] }
  | { type: 'fill'; x: number; y: number; color: string; material: Material; mirror: Mirror }
  | { type: 'attach'; attachment: PlacedAttachment }
  | { type: 'detach'; target: PlacedAttachment }
  | { type: 'part'; part: EditorPart }
  | { type: 'unpart'; target: EditorPart }
  /** A hand-drawn hinge; result is the part with it, made once so later ops can find it. */
  | { type: 'hinge'; target: EditorPart; hinge: [number, number, number, number]; result?: EditorPart }
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

const state = {
  motion: 'fish' as Motion,
  tool: 'brush' as Tool,
  color: COLORS[0][0],
  sizeIndex: 1,
  material: 'solid' as Material,
  extra: 'bubbles' as AttachmentKind,
  mirror: 'off' as Mirror,
  facingLeft: false,
};
const ops: Op[] = [];
let current: Extract<Op, { type: 'stroke' }> | null = null;
/** When editing an existing drawing: the drawing, its image under the new ops, and its saved extras. */
let editing: Drawing | null = null;
/** Under the new ops; holes are its see-through areas, when re-editing a saved drawing. */
let base: { image: HTMLImageElement | HTMLCanvasElement; x: number; y: number; holes?: HTMLCanvasElement } | null = null;
let baseAttachments: PlacedAttachment[] = [];
let baseParts: EditorPart[] = [];
const selection = new Selection(paper.width, paper.height);
/** Where the drawing has been made see-through on purpose, so "Fill inside white" leaves it be. */
const holesCanvas = Object.assign(document.createElement('canvas'), { width: paper.width, height: paper.height });
const holesView = document.querySelector<HTMLDivElement>('#holes')!;
const holes = holesCanvas.getContext('2d', { willReadFrequently: true })!;
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
  };
  materialsEl.append(b);
  return b;
});

/** Material swatches are shown in the current colour, so brick in blue looks like blue brick. */
function renderMaterials() {
  // See-through has no pattern, so there's nothing to pick.
  materialsEl.hidden = state.tool !== 'fill' || state.color === 'clear';
  if (materialsEl.hidden) return;
  MATERIALS.forEach((material, i) => {
    const color = state.color === 'rainbow' || material === 'rainbow' ? 'rainbow' : state.color;
    materialButtons[i].innerHTML = `<img alt="" src="${materialPreview(material, color)}" />${MATERIAL_LABELS[material]}`;
  });
}

const extrasEl = document.querySelector<HTMLDivElement>('#extras')!;
const extraButtons = EXTRAS.map((extra) => {
  const b = document.createElement('button');
  b.textContent = `${extra.icon} ${extra.label}`;
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
  if (tool !== 'select') finishSelection();
  state.tool = tool;
  press(toolButtons, (b) => b.dataset.tool === tool);
  sizesEl.hidden = tool === 'fill';
  materialsEl.hidden = tool !== 'fill';
  extrasEl.hidden = tool !== 'extras';
  selectBar.hidden = tool !== 'select';
  colorsEl.hidden = tool === 'select';
  paper.style.cursor = tool === 'fill' ? 'cell' : tool === 'extras' ? 'copy' : tool === 'select' ? 'crosshair' : 'none';
  renderSelectBar();
  renderMaterials();
  renderHint();
}

function renderHint() {
  if (hingeFor) {
    hint.textContent = '📍 Draw a line on the drawing where this part is attached.';
    return;
  }
  const extra = EXTRAS.find((e) => e.kind === state.extra)!;
  hint.textContent =
    state.tool === 'fill'
      ? 'Tap inside a shape to fill it.'
      : state.tool === 'extras'
        ? `${extra.hint}. Tap the drawing to add one, tap it again to remove it. Extras come alive in the tank!`
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
  eel: '🐍 Eel',
  jelly: '🪼 Jellyfish',
  seahorse: '🦄 Seahorse',
  flapper: '🐢 Flapper',
  vessel: '🚢 Vessel',
  crawler: '🦀 Crawler',
  plant: '🌿 Plant',
  decor: '🏰 Decoration',
};

const PLACEHOLDERS: Record<Motion, string> = {
  fish: 'Name it (e.g. Bubbles)',
  eel: 'Name it (e.g. Noodle)',
  jelly: 'Name it (e.g. Wobbles)',
  seahorse: 'Name it (e.g. Sir Prance)',
  flapper: 'Name it (e.g. Shelly)',
  vessel: 'Name it (e.g. Yellow Sub)',
  crawler: 'Name it (e.g. Pinchy)',
  plant: 'Name it (e.g. Swirly Weed)',
  decor: 'Name it (e.g. Castle)',
};

/** Styles that have a head, so the Facing button matters. */
const hasFacing = (motion: Motion) => motion !== 'jelly' && motion !== 'plant' && motion !== 'decor';

function setMotion(motion: Motion) {
  state.motion = motion;
  press(document.querySelectorAll('.kinds [data-motion]'), (b) => b.dataset.motion === motion);
  suggestEl.hidden = true;
  renderGuide();
  changed();
}
document.querySelectorAll<HTMLButtonElement>('.kinds [data-motion]').forEach((b) => {
  b.onclick = () => setMotion(b.dataset.motion as Motion);
});

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
    eel: top(way('head this way')),
    flapper: top(way('head this way')),
    vessel: top(way('front this way')),
    seahorse: top(way('head at the top, facing')),
    jelly: top('bell on top, tentacles hanging down'),
    crawler: top(way('walks this way')) + ground('walks on the sand'),
    plant: ground('grows up from the sand'),
    decor: ground('sits on the sand'),
  };
  guide.innerHTML = mirrorLine + guides[m];
}

// --- motion suggestions ------------------------------------------------------

const suggestEl = document.querySelector<HTMLParagraphElement>('#suggest')!;
const suggestText = document.querySelector<HTMLSpanElement>('#suggest-text')!;
const suggestOptions = document.querySelector<HTMLSpanElement>('#suggest-options')!;
/** Once dismissed, no more suggestions until the drawing is sent. */
let suggestDismissed = false;
document.querySelector<HTMLButtonElement>('#suggest-dismiss')!.onclick = () => {
  suggestDismissed = true;
  suggestEl.hidden = true;
};

/** Suggests (never switches to) a style that suits the drawing's shape. */
function suggestMotion() {
  const b = suggestDismissed || state.motion === 'plant' || state.motion === 'decor' ? null : inkBounds(paper);
  const w = b ? b.right - b.left + 1 : 0;
  const h = b ? b.bottom - b.top + 1 : 0;
  let text = '';
  let options: Motion[] = [];
  if (b && Math.max(w, h) > 80) {
    if (w >= h * 3.2) {
      text = 'Looks long and skinny! Try';
      options = ['eel'];
    } else if (h >= w * 1.4) {
      text = 'Tall and thin! Try';
      options = ['seahorse', 'jelly'];
    }
  }
  // Already one of the suggestions: nothing to say.
  if (options.includes(state.motion)) options = [];
  suggestEl.hidden = options.length === 0;
  if (suggestEl.hidden) return;
  suggestText.textContent = text;
  suggestOptions.replaceChildren(
    ...options.map((m) => {
      const button = document.createElement('button');
      button.textContent = `${MOTION_LABELS[m]}?`;
      button.onclick = () => setMotion(m);
      return button;
    }),
  );
}

let suggestTimer = 0;
/** Called whenever the drawing, its style or its extras change. */
function changed() {
  clearTimeout(suggestTimer);
  suggestTimer = window.setTimeout(suggestMotion, 800);
  schedulePreview();
  scheduleParts();
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
  redraw();
};
addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
    e.preventDefault();
    undo();
  }
});

function undo() {
  // While selecting, undo first takes back the pending move, then the selection itself.
  if (selection.moved) selection.resetPlacement();
  else if (!selection.empty) selection.clear();
  else ops.pop();
  redraw();
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
    const op: Op = { type: 'fill', x: p.x, y: p.y, color: state.color, material: state.material, mirror: state.mirror };
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
  ctx.globalCompositeOperation = stroke.erase || invisible ? 'destination-out' : 'source-over';
  ctx.strokeStyle = stroke.color === 'rainbow' ? `hsl(${(i * 4) % 360} 85% 58%)` : invisible ? '#000' : stroke.color;
  line(ctx);
  // Invisible paint marks a see-through spot; real paint over one covers it up again.
  if (invisible || !stroke.erase) {
    holes.globalCompositeOperation = invisible ? 'source-over' : 'destination-out';
    holes.strokeStyle = '#000';
    line(holes);
    showHoles();
  }
}

/** On-paper width of a brush stroke; pen pressure scales it from 0.4x to 2.4x. */
function brushWidth(size: number, pressure: number, erase: boolean) {
  return size * (0.4 + pressure * 2) * (erase ? 1.5 : 1);
}

function applyFill(op: Extract<Op, { type: 'fill' }>) {
  ctx.globalCompositeOperation = 'source-over';
  const material = op.material === 'solid' && op.color === 'rainbow' ? 'rainbow' : op.material;
  const area = floodFill(ctx, withMirror(op, op.mirror), material, op.color);
  const image = holes.getImageData(0, 0, holesCanvas.width, holesCanvas.height);
  const alpha = op.color === 'clear' ? 255 : 0;
  for (let i = 0; i < area.length; i++) if (area[i] === 1) image.data[i * 4 + 3] = alpha;
  holes.putImageData(image, 0, 0);
  showHoles();
}

function redraw() {
  ctx.globalCompositeOperation = 'source-over';
  ctx.clearRect(0, 0, paper.width, paper.height);
  holes.globalCompositeOperation = 'source-over';
  holes.clearRect(0, 0, holesCanvas.width, holesCanvas.height);
  if (base) ctx.drawImage(base.image, base.x, base.y);
  if (base?.holes) holes.drawImage(base.holes, base.x, base.y);
  for (const op of ops) {
    if (op.type === 'stroke') op.points.forEach((_, i) => drawSegment(op, i));
    else if (op.type === 'fill') applyFill(op);
    else if (op.type === 'transform') {
      applyTransform(ctx, op);
      applyTransform(holes, op);
    }
  }
  showHoles();
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
      el.textContent = EXTRA_ICONS[a.kind];
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
  showHoles();
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
  showToast(`${PART_INFO[motion].icon} ${PART_INFO[motion].label} added! Open ▶ Preview to see it move.`);
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
    } else if (op.type === 'transform') carryParts(list, op);
  }
  if (selection.moved) carryParts(list, selection.pendingOp());
  return list;
}

/** Parts with their hinges worked out from the drawing as it is now. */
function placedParts(): PlacedPart[] {
  const parts = currentParts();
  if (!parts.length) return [];
  const ink = ctx.getImageData(0, 0, paper.width, paper.height);
  const headRight = !(hasFacing(state.motion) && state.facingLeft);
  return parts.flatMap((part) => {
    const hinge = findHinge(ink, part, headRight);
    return hinge ? [{ ...part, hinge }] : [];
  });
}

let partsTimer = 0;
function scheduleParts() {
  clearTimeout(partsTimer);
  partsTimer = window.setTimeout(renderParts, 150);
}

/** Shows each part tinted orange with its icon, plus the hinge it pops out or flaps from. */
function renderParts() {
  const parts = placedParts();
  partsOverlay.clearRect(0, 0, paper.width, paper.height);
  for (const part of parts) {
    const tint = document.createElement('canvas');
    tint.width = paper.width;
    tint.height = paper.height;
    const t = tint.getContext('2d')!;
    t.drawImage(part.mask, 0, 0);
    t.globalCompositeOperation = 'source-in';
    t.fillStyle = 'rgba(255, 140, 26, 0.22)';
    t.fillRect(0, 0, paper.width, paper.height);
    partsOverlay.drawImage(tint, 0, 0);
    const [x1, y1, x2, y2] = part.hinge;
    if (part.motion === 'popout' || part.motion === 'flap') {
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
    if (b) {
      partsOverlay.font = '36px sans-serif';
      partsOverlay.textAlign = 'center';
      partsOverlay.textBaseline = 'middle';
      partsOverlay.fillText(PART_INFO[part.motion].icon, (b.left + b.right) / 2, (b.top + b.bottom) / 2);
    }
  }
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
  partsList.hidden = parts.length === 0;
  partsList.replaceChildren(
    document.createTextNode('Moving parts:'),
    ...currentParts().map((part) => {
      const chip = document.createElement('span');
      chip.className = 'chip';
      chip.textContent = `${PART_INFO[part.motion].icon} ${PART_INFO[part.motion].label}`;
      const remove = document.createElement('button');
      remove.textContent = '✕';
      remove.title = 'Stop this part moving';
      remove.onclick = () => {
        ops.push({ type: 'unpart', target: part });
        changed();
      };
      if (part.motion === 'popout' || part.motion === 'flap') {
        const pin = document.createElement('button');
        pin.textContent = '📍';
        pin.title = 'Draw where it is attached';
        pin.onclick = () => {
          hingeFor = part;
          renderHint();
        };
        chip.append(pin);
      }
      chip.append(remove);
      return chip;
    }),
  );
}

/** The drawing as it would be sent, with its parts. */
function exportCurrent() {
  return exportDrawing(paper, {
    mirror: hasFacing(state.motion) && state.facingLeft,
    paperFill: document.querySelector<HTMLInputElement>('#paper-fill')!.checked,
    holes: holesCanvas,
    attachments: currentAttachments(),
    parts: placedParts(),
  });
}

// --- photo of a paper drawing ----------------------------------------------

const photoInput = document.querySelector<HTMLInputElement>('#photo-input')!;
const photoPanel = document.querySelector<HTMLDivElement>('#photo-panel')!;
const photoStrength = document.querySelector<HTMLInputElement>('#photo-strength')!;
let photo: ImageBitmap | null = null;

document.querySelector<HTMLButtonElement>('#photo')!.onclick = () => {
  if ((ops.length || base) && !confirm('Start over with a photo? This replaces the current drawing.')) return;
  photoInput.click();
};

photoInput.onchange = async () => {
  const file = photoInput.files?.[0];
  photoInput.value = '';
  if (!file) return;
  try {
    photo = await readPhoto(file);
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
  showToast('Photo added! Slide to clean up the paper, then touch it up with the tools.');
};

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
/** Loaded on first open, so the tank code (and Pixi) only downloads when someone wants a preview. */
let preview: Promise<import('../tank/mini.ts').Preview> | null = null;
let previewTimer = 0;

previewToggle.onclick = () => {
  const open = Boolean(previewEl.hidden);
  previewEl.hidden = !open;
  workspace.classList.toggle('previewing', open);
  previewToggle.setAttribute('aria-pressed', String(open));
  previewToggle.textContent = open ? '⏹ Preview' : '▶ Preview';
  renderMarkers();
  if (open) {
    preview ??= import('../tank/mini.ts').then((m) => m.createPreview(previewEl));
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
  if (!exported) return;
  const load = async (src?: string) => {
    if (!src) return null;
    const image = new Image();
    image.src = src;
    await image.decode();
    return image;
  };
  const [{ Texture }, { splitParts, toCutout }, view, image, partsImage] = await Promise.all([
    import('pixi.js'),
    import('../tank/parts.ts'),
    preview,
    load(exported.dataUrl),
    load(exported.partsImage),
  ]);
  const cutout = partsImage ? toCutout(splitParts(image!, partsImage, exported.parts)) : null;
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
      parts: exported.parts,
    },
    cutout?.body ?? Texture.from(image!),
    cutout,
  );
}
document.querySelector<HTMLInputElement>('#paper-fill')!.addEventListener('change', schedulePreview);
nocturnalInput.addEventListener('change', schedulePreview);

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
    parts: exported.parts,
    partsImage: exported.partsImage,
  };

  sendButton.disabled = true;
  try {
    if (editing) {
      const drawing = await updateDrawing(editing.id, payload);
      showToast(`Saved! ${drawing.name} is updated in the tank.`);
      setTimeout(() => location.assign('/gallery/'), 1200);
      return;
    }
    try {
      localStorage.setItem('doodlearium.artist', artist);
    } catch {}
    const drawing = await submitDrawing(payload);
    showToast(`Splash! ${drawing.name} is in the tank.${drawing.nocturnal ? ' It comes out at night 🌙' : ''}`);
    ops.length = 0;
    base = null;
    baseAttachments = [];
    baseParts = [];
    nameInput.value = '';
    nocturnalInput.checked = false;
    suggestDismissed = false;
    closePhotoPanel();
    redraw();
  } catch (err) {
    showToast(err instanceof Error ? err.message : 'Upload failed', true);
  } finally {
    sendButton.disabled = false;
  }
};

// --- editing an existing drawing (/draw/?edit=<id>) ----------------------

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
      drawing.parts.map((p) => p.motion),
      paper,
      base,
    );
  }
  setMotion(motionOf(drawing));
  nameInput.value = drawing.name;
  artistInput.value = drawing.artist;
  nocturnalInput.checked = drawing.nocturnal === true;
  sendButton.textContent = 'Save changes 💾';
  const banner = document.querySelector<HTMLParagraphElement>('#editing')!;
  banner.hidden = false;
  banner.textContent =
    hasFacing(motionOf(drawing))
      ? `Editing ${drawing.name}. Swimming backwards? Tap “Facing” so the arrow points the way its head does, then save.`
      : `Editing ${drawing.name}.`;
  redraw();
}

pickColor(state.color);
press(sizeButtons, (b) => b === sizeButtons[state.sizeIndex]);
press(materialButtons, (b) => b === materialButtons[0]);
press(extraButtons, (b) => b === extraButtons[0]);
setTool('brush');
renderGuide();

const editId = new URLSearchParams(location.search).get('edit');
if (editId) {
  loadForEditing(editId).catch(() => showToast('Could not load that drawing.', true));
}
