import { MAX_ATTACHMENTS, imageUrl, motionOf, type AttachmentKind, type Drawing, type Motion } from '../../shared/types.ts';
import { fetchDrawings, setupFeedButton, submitDrawing, updateDrawing } from '../shared/api.ts';
import { exportDrawing, inkBounds, type PlacedAttachment } from './export.ts';
import { MATERIALS, MATERIAL_LABELS, floodFill, materialPreview, type Material } from './fill.ts';
import { readPhoto, removePaper } from './photo.ts';
import { Selection, applyTransform, maskHas, type TransformOp } from './selection.ts';

const COLORS = [
  '#1b1b1b', '#ffffff', '#e63946', '#ff8c1a', '#ffd60a', '#52b788',
  '#2ec4b6', '#3a86ff', '#8338ec', '#ff70a6', '#8d5a3b', '#8d99ae',
  'rainbow',
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
  color: COLORS[0],
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
let base: { image: HTMLImageElement | HTMLCanvasElement; x: number; y: number } | null = null;
let baseAttachments: PlacedAttachment[] = [];
const selection = new Selection(paper.width, paper.height);
const overlay = document.querySelector<HTMLCanvasElement>('#selection-overlay')!.getContext('2d')!;
/** The paper as committed, under a selection that is being moved around. */
const snapshot = Object.assign(document.createElement('canvas'), { width: paper.width, height: paper.height });
let selectMode: 'add' | 'remove' = 'add';
/** A selection drag in progress: where it started and where the selection was then. */
let drag: { x: number; y: number; dx: number; dy: number } | null = null;
let selectStroke: Point | null = null;

try {
  artistInput.value = localStorage.getItem('doodlearium.artist') ?? '';
} catch {}
setupFeedButton(document.querySelector<HTMLButtonElement>('#feed')!);

// --- toolbar -------------------------------------------------------------

const press = (buttons: Iterable<Element>, isOn: (b: HTMLElement) => boolean) => {
  for (const b of buttons) b.setAttribute('aria-pressed', String(isOn(b as HTMLElement)));
};

const colorsEl = document.querySelector<HTMLDivElement>('#colors')!;
const colorButtons = COLORS.map((color) => {
  const b = document.createElement('button');
  b.dataset.color = color;
  if (color === 'rainbow') {
    b.className = 'rainbow';
    b.title = 'Rainbow';
  } else {
    b.style.background = color;
    b.title = color;
  }
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
  if (state.tool !== 'fill') return;
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
  paper.style.cursor = tool === 'fill' ? 'cell' : tool === 'extras' ? 'copy' : 'crosshair';
  renderSelectBar();
  renderMaterials();
  renderHint();
}

function renderHint() {
  const extra = EXTRAS.find((e) => e.kind === state.extra)!;
  hint.textContent =
    state.tool === 'fill'
      ? 'Tap inside a shape to fill it.'
      : state.tool === 'extras'
        ? `${extra.hint}. Tap the drawing to add one, tap it again to remove it. Extras come alive in the tank!`
        : state.tool === 'select'
          ? 'Paint over a part to select it, then drag it to move it, or use the buttons to resize, turn, flip, copy or delete it.'
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
}

document.querySelector<HTMLButtonElement>('#undo')!.onclick = undo;
document.querySelector<HTMLButtonElement>('#clear')!.onclick = () => {
  if ((ops.length || base) && !confirm('Clear the whole drawing?')) return;
  ops.length = 0;
  base = null;
  baseAttachments = [];
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
  if (drag) {
    const p = toCanvas(e);
    selection.dx = drag.dx + p.x - drag.x;
    selection.dy = drag.dy + p.y - drag.y;
    renderSelection();
    return;
  }
  if (selectStroke) {
    paintSelection(toCanvas(e));
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
  ctx.globalCompositeOperation = stroke.erase ? 'destination-out' : 'source-over';
  ctx.strokeStyle = stroke.color === 'rainbow' ? `hsl(${(i * 4) % 360} 85% 58%)` : stroke.color;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.lineWidth = stroke.size * (0.4 + p.pressure * 2) * (stroke.erase ? 1.5 : 1);
  const froms = withMirror(prev, stroke.mirror);
  const tos = withMirror(p, stroke.mirror);
  ctx.beginPath();
  froms.forEach((from, k) => {
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(tos[k].x + (i === 0 ? 0.01 : 0), tos[k].y);
  });
  ctx.stroke();
}

function applyFill(op: Extract<Op, { type: 'fill' }>) {
  ctx.globalCompositeOperation = 'source-over';
  const material = op.material === 'solid' && op.color === 'rainbow' ? 'rainbow' : op.material;
  floodFill(ctx, withMirror(op, op.mirror), material, op.color);
}

function redraw() {
  ctx.globalCompositeOperation = 'source-over';
  ctx.clearRect(0, 0, paper.width, paper.height);
  if (base) ctx.drawImage(base.image, base.x, base.y);
  for (const op of ops) {
    if (op.type === 'stroke') op.points.forEach((_, i) => drawSegment(op, i));
    else if (op.type === 'fill') applyFill(op);
    else if (op.type === 'transform') applyTransform(ctx, op);
  }
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
      attachment: { kind: state.extra, x: p.x, y: p.y, scale: EXTRA_SCALES[state.sizeIndex], color: state.color },
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

function paintSelection(p: Point) {
  const size = Math.max(30, SIZES[state.sizeIndex] * 3);
  selection.paint(selectStroke ?? p, p, size, selectMode === 'remove');
  selectStroke = p;
  renderSelection();
}

/** Turns a pending move into an op in the history; the selection stays on the part. */
function commitSelection() {
  if (!selection.moved) return;
  ops.push(selection.pendingOp());
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
  const exported = exportDrawing(paper, {
    mirror: hasFacing(state.motion) && state.facingLeft,
    paperFill: document.querySelector<HTMLInputElement>('#paper-fill')!.checked,
    attachments: currentAttachments(),
  });
  if (!exported) return;
  const image = new Image();
  image.src = exported.dataUrl;
  const [{ Texture }, view] = await Promise.all([import('pixi.js'), preview, image.decode()]);
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
    },
    Texture.from(image),
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
  const exported = exportDrawing(paper, {
    mirror: hasFacing(state.motion) && state.facingLeft,
    paperFill: document.querySelector<HTMLInputElement>('#paper-fill')!.checked,
    attachments: currentAttachments(),
  });
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
  };
  baseAttachments = (drawing.attachments ?? []).map((a) => ({
    ...a,
    x: base!.x + a.x * image.width,
    y: base!.y + a.y * image.height,
  }));
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
