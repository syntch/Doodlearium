import { imageUrl, type CreatureType, type Drawing } from '../../shared/types.ts';
import { fetchDrawings, submitDrawing, updateDrawing } from '../shared/api.ts';
import { exportDrawing } from './export.ts';

const COLORS = [
  '#1b1b1b', '#ffffff', '#e63946', '#ff8c1a', '#ffd60a', '#52b788',
  '#2ec4b6', '#3a86ff', '#8338ec', '#ff70a6', '#8d5a3b', '#8d99ae',
];
const SIZES = [4, 10, 22, 40];

interface Stroke {
  color: string;
  size: number;
  erase: boolean;
  points: { x: number; y: number; pressure: number }[];
}

const paper = document.querySelector<HTMLCanvasElement>('#paper')!;
const ctx = paper.getContext('2d', { willReadFrequently: true })!;
const guide = document.querySelector<HTMLDivElement>('#guide')!;
const facingButton = document.querySelector<HTMLButtonElement>('#facing')!;
const eraserButton = document.querySelector<HTMLButtonElement>('#eraser')!;
const toast = document.querySelector<HTMLParagraphElement>('#toast')!;
const nameInput = document.querySelector<HTMLInputElement>('#name')!;
const artistInput = document.querySelector<HTMLInputElement>('#artist')!;
const sendButton = document.querySelector<HTMLButtonElement>('#send')!;

const state = {
  kind: 'swimmer' as CreatureType,
  color: COLORS[0],
  size: SIZES[1],
  erase: false,
  facingLeft: false,
};
const strokes: Stroke[] = [];
let current: Stroke | null = null;
/** When editing an existing drawing: the drawing, and its image drawn underneath the new strokes. */
let editing: Drawing | null = null;
let base: { image: HTMLImageElement; x: number; y: number } | null = null;

try {
  artistInput.value = localStorage.getItem('doodlearium.artist') ?? '';
} catch {}

// --- toolbar -------------------------------------------------------------

const colorsEl = document.querySelector<HTMLDivElement>('#colors')!;
const colorButtons = COLORS.map((color) => {
  const b = document.createElement('button');
  b.style.background = color;
  b.title = color;
  b.setAttribute('aria-pressed', String(color === state.color));
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
  setEraser(false);
  colorButtons.forEach((b, i) => b.setAttribute('aria-pressed', String(COLORS[i] === color)));
}

const sizesEl = document.querySelector<HTMLDivElement>('#sizes')!;
const sizeButtons = SIZES.map((size) => {
  const b = document.createElement('button');
  b.title = `Brush ${size}`;
  const dot = document.createElement('span');
  const px = Math.max(4, Math.min(26, size * 0.65));
  dot.style.width = dot.style.height = `${px}px`;
  b.append(dot);
  b.setAttribute('aria-pressed', String(size === state.size));
  b.onclick = () => {
    state.size = size;
    sizeButtons.forEach((s, i) => s.setAttribute('aria-pressed', String(SIZES[i] === size)));
  };
  sizesEl.append(b);
  return b;
});

function setEraser(on: boolean) {
  state.erase = on;
  eraserButton.setAttribute('aria-pressed', String(on));
}
eraserButton.onclick = () => setEraser(!state.erase);

facingButton.onclick = () => {
  state.facingLeft = !state.facingLeft;
  renderGuide();
};

function setKind(kind: CreatureType) {
  state.kind = kind;
  document
    .querySelectorAll<HTMLButtonElement>('[data-kind]')
    .forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.kind === kind)));
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
  guide.innerHTML = fish
    ? `<div class="arrow">${state.facingLeft ? '⟵ head this way' : 'head this way ⟶'}</div>`
    : `<div class="ground">${state.kind === 'plant' ? 'grows up from the sand' : 'sits on the sand'}</div>`;
}
renderGuide();

document.querySelector<HTMLButtonElement>('#undo')!.onclick = undo;
document.querySelector<HTMLButtonElement>('#clear')!.onclick = () => {
  if ((strokes.length || base) && !confirm('Clear the whole drawing?')) return;
  strokes.length = 0;
  base = null;
  redraw();
};
addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
    e.preventDefault();
    undo();
  }
});

function undo() {
  strokes.pop();
  redraw();
}

// --- drawing -------------------------------------------------------------

function toCanvas(e: PointerEvent) {
  const rect = paper.getBoundingClientRect();
  return {
    x: ((e.clientX - rect.left) / rect.width) * paper.width,
    y: ((e.clientY - rect.top) / rect.height) * paper.height,
    pressure: e.pointerType === 'pen' ? e.pressure || 0.5 : 0.5,
  };
}

paper.addEventListener('pointerdown', (e) => {
  if (e.button !== 0) return;
  paper.setPointerCapture(e.pointerId);
  current = { color: state.color, size: state.size, erase: state.erase, points: [toCanvas(e)] };
  strokes.push(current);
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
function drawSegment(stroke: Stroke, i: number) {
  const p = stroke.points[i];
  const prev = stroke.points[Math.max(0, i - 1)];
  ctx.globalCompositeOperation = stroke.erase ? 'destination-out' : 'source-over';
  ctx.strokeStyle = stroke.color;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.lineWidth = stroke.size * (0.4 + p.pressure * 2) * (stroke.erase ? 1.5 : 1);
  ctx.beginPath();
  ctx.moveTo(prev.x, prev.y);
  ctx.lineTo(p.x + (i === 0 ? 0.01 : 0), p.y);
  ctx.stroke();
}

function redraw() {
  ctx.globalCompositeOperation = 'source-over';
  ctx.clearRect(0, 0, paper.width, paper.height);
  if (base) ctx.drawImage(base.image, base.x, base.y);
  for (const stroke of strokes) stroke.points.forEach((_, i) => drawSegment(stroke, i));
}

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
  });
  if (!exported) {
    showToast('Draw something first!', true);
    return;
  }
  const artist = artistInput.value.trim();
  const payload = { type: state.kind, name: nameInput.value, artist, image: exported.dataUrl };

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
    strokes.length = 0;
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

const editId = new URLSearchParams(location.search).get('edit');
if (editId) {
  loadForEditing(editId).catch(() => showToast('Could not load that drawing.', true));
}
