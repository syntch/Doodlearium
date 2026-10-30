import { MAX_ATTACHMENTS, imageUrl, type AttachmentKind, type CreatureType, type Drawing } from '../../shared/types.ts';
import { fetchDrawings, submitDrawing, updateDrawing } from '../shared/api.ts';
import { exportDrawing, type PlacedAttachment } from './export.ts';
import { MATERIALS, MATERIAL_LABELS, floodFill, materialPreview, type Material } from './fill.ts';

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

type Tool = 'brush' | 'eraser' | 'fill' | 'extras';
type Mirror = 'off' | 'updown' | 'leftright';
type Point = { x: number; y: number; pressure: number };

/** Everything on the paper is a replayable list of operations, so undo works the same for every tool. */
type Op =
  | { type: 'stroke'; color: string; size: number; erase: boolean; mirror: Mirror; points: Point[] }
  | { type: 'fill'; x: number; y: number; color: string; material: Material; mirror: Mirror }
  | { type: 'attach'; attachment: PlacedAttachment }
  | { type: 'detach'; target: PlacedAttachment };

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

const state = {
  kind: 'swimmer' as CreatureType,
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
let base: { image: HTMLImageElement; x: number; y: number } | null = null;
let baseAttachments: PlacedAttachment[] = [];

try {
  artistInput.value = localStorage.getItem('doodlearium.artist') ?? '';
} catch {}

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

const toolButtons = document.querySelectorAll<HTMLButtonElement>('[data-tool]');
toolButtons.forEach((b) => (b.onclick = () => setTool(b.dataset.tool as Tool)));

function setTool(tool: Tool) {
  state.tool = tool;
  press(toolButtons, (b) => b.dataset.tool === tool);
  sizesEl.hidden = tool === 'fill';
  materialsEl.hidden = tool !== 'fill';
  extrasEl.hidden = tool !== 'extras';
  paper.style.cursor = tool === 'fill' ? 'cell' : tool === 'extras' ? 'copy' : 'crosshair';
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
};

function setKind(kind: CreatureType) {
  state.kind = kind;
  press(document.querySelectorAll('[data-kind]'), (b) => b.dataset.kind === kind);
  renderGuide();
}
document.querySelectorAll<HTMLButtonElement>('[data-kind]').forEach((b) => {
  b.onclick = () => setKind(b.dataset.kind as CreatureType);
});

const PLACEHOLDERS: Record<CreatureType, string> = {
  swimmer: 'Name it (e.g. Bubbles)',
  plant: 'Name it (e.g. Swirly Weed)',
  decor: 'Name it (e.g. Castle)',
};

function renderGuide() {
  const fish = state.kind === 'swimmer';
  facingButton.hidden = !fish;
  facingButton.textContent = state.facingLeft ? '← Facing' : 'Facing →';
  nameInput.placeholder = PLACEHOLDERS[state.kind];
  const mirrorLine = state.mirror === 'off' ? '' : `<div class="mirror-line ${state.mirror}"></div>`;
  guide.innerHTML =
    mirrorLine +
    (fish
      ? `<div class="arrow">${state.facingLeft ? '⟵ head this way' : 'head this way ⟶'}</div>`
      : `<div class="ground">${state.kind === 'plant' ? 'grows up from the sand' : 'sits on the sand'}</div>`);
}

document.querySelector<HTMLButtonElement>('#undo')!.onclick = undo;
document.querySelector<HTMLButtonElement>('#clear')!.onclick = () => {
  if ((ops.length || base) && !confirm('Clear the whole drawing?')) return;
  ops.length = 0;
  base = null;
  baseAttachments = [];
  redraw();
};
addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
    e.preventDefault();
    undo();
  }
});

function undo() {
  ops.pop();
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
    return;
  }
  if (state.tool === 'extras') {
    placeOrRemoveExtra(p);
    return;
  }
  paper.setPointerCapture(e.pointerId);
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
  if (!current) return;
  const coalesced = e.getCoalescedEvents?.();
  for (const event of coalesced?.length ? coalesced : [e]) {
    current.points.push(toCanvas(event));
    drawSegment(current, current.points.length - 1);
  }
});
const endStroke = () => (current = null);
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
  }
  renderMarkers();
}

// --- extras --------------------------------------------------------------

function currentAttachments(): PlacedAttachment[] {
  const list = [...baseAttachments];
  for (const op of ops) {
    if (op.type === 'attach') list.push(op.attachment);
    else if (op.type === 'detach') list.splice(list.indexOf(op.target), 1);
  }
  return list;
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
  const exported = exportDrawing(paper, {
    mirror: state.kind === 'swimmer' && state.facingLeft,
    paperFill: document.querySelector<HTMLInputElement>('#paper-fill')!.checked,
    attachments: currentAttachments(),
  });
  if (!exported) {
    showToast('Draw something first!', true);
    return;
  }
  const artist = artistInput.value.trim();
  const payload = {
    type: state.kind,
    name: nameInput.value,
    artist,
    image: exported.dataUrl,
    attachments: exported.attachments,
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
    showToast(`Splash! ${drawing.name} is in the tank.`);
    ops.length = 0;
    nameInput.value = '';
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
  setKind(drawing.type);
  nameInput.value = drawing.name;
  artistInput.value = drawing.artist;
  sendButton.textContent = 'Save changes 💾';
  const banner = document.querySelector<HTMLParagraphElement>('#editing')!;
  banner.hidden = false;
  banner.textContent =
    drawing.type === 'swimmer'
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
