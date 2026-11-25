import { fillEnclosed, inkBounds } from './export.ts';

type Bounds = { left: number; top: number; right: number; bottom: number };

/**
 * A replayable move/resize/turn/copy/delete of the selected part of the paper.
 * Ops live only in memory (for undo), so the mask is kept as a canvas.
 */
export interface TransformOp {
  type: 'transform';
  mask: HTMLCanvasElement;
  matrix: DOMMatrix;
  /** Leave the original where it was. */
  copy: boolean;
  /** Just delete the selected part. */
  remove: boolean;
  /** Extras carried along, worked out once so later taps on them still find the same objects. */
  carried?: Map<object, object>;
}

const newCanvas = (width: number, height: number) => Object.assign(document.createElement('canvas'), { width, height });

/** Moves the selected pixels of ctx's canvas as the op says. */
export function applyTransform(ctx: CanvasRenderingContext2D, op: TransformOp) {
  const { width, height } = ctx.canvas;
  const part = newCanvas(width, height);
  const pctx = part.getContext('2d')!;
  pctx.drawImage(ctx.canvas, 0, 0);
  pctx.globalCompositeOperation = 'destination-in';
  pctx.drawImage(op.mask, 0, 0);

  ctx.save();
  if (!op.copy) {
    ctx.globalCompositeOperation = 'destination-out';
    ctx.drawImage(op.mask, 0, 0);
  }
  if (!op.remove) {
    ctx.globalCompositeOperation = 'source-over';
    ctx.imageSmoothingQuality = 'high';
    ctx.setTransform(op.matrix);
    ctx.drawImage(part, 0, 0);
  }
  ctx.restore();
}

/** Whether the mask covers the point (used to carry extras along). */
export function maskHas(mask: HTMLCanvasElement, x: number, y: number) {
  if (x < 0 || y < 0 || x >= mask.width || y >= mask.height) return false;
  return mask.getContext('2d', { willReadFrequently: true })!.getImageData(Math.floor(x), Math.floor(y), 1, 1).data[3] > 0;
}

/**
 * The part of the paper being worked on: a mask painted over the drawing, plus a pending move/resize/turn
 * that is shown live and only becomes an op when committed (so repeated resizing doesn't get blurry).
 */
export class Selection {
  mask: HTMLCanvasElement;
  dx = 0;
  dy = 0;
  scale = 1;
  angle = 0;
  flip = false;
  copy = false;
  private cachedBounds: Bounds | null | undefined;
  private tinted: HTMLCanvasElement | null = null;

  constructor(
    readonly width: number,
    readonly height: number,
  ) {
    this.mask = newCanvas(width, height);
  }

  private get mctx() {
    return this.mask.getContext('2d', { willReadFrequently: true })!;
  }

  /** Paints (or with erase, unpaints) a round-ended line onto the mask. */
  paint(from: { x: number; y: number }, to: { x: number; y: number }, size: number, erase: boolean) {
    const m = this.mctx;
    m.globalCompositeOperation = erase ? 'destination-out' : 'source-over';
    m.strokeStyle = '#000';
    m.lineCap = 'round';
    m.lineJoin = 'round';
    m.lineWidth = size;
    m.beginPath();
    m.moveTo(from.x, from.y);
    m.lineTo(to.x + 0.01, to.y);
    m.stroke();
    this.changedMask();
  }

  /**
   * Adds a flood region (see floodRegion) to the selection, grown a few pixels so the shape's own
   * outline comes along with it.
   */
  addRegion(region: Uint8Array, grow: number) {
    const shape = newCanvas(this.width, this.height);
    const s = shape.getContext('2d')!;
    const image = s.createImageData(this.width, this.height);
    for (let i = 0; i < region.length; i++) if (region[i]) image.data[i * 4 + 3] = 255;
    s.putImageData(image, 0, 0);
    const m = this.mctx;
    m.globalCompositeOperation = 'source-over';
    for (let dx = -grow; dx <= grow; dx += grow) {
      for (let dy = -grow; dy <= grow; dy += grow) m.drawImage(shape, dx, dy);
    }
    m.drawImage(shape, 0, 0);
    this.changedMask();
  }

  /** Painting a loop around a part selects everything inside it too. */
  fillHoles() {
    fillEnclosed(this.mctx, this.width, this.height);
    this.changedMask();
  }

  /** Selects wherever the image has something, drawn at (x, y). */
  addImage(image: CanvasImageSource, x: number, y: number) {
    const m = this.mctx;
    m.globalCompositeOperation = 'source-over';
    m.drawImage(image, x, y);
    this.changedMask();
  }

  selectAll() {
    const m = this.mctx;
    m.globalCompositeOperation = 'source-over';
    m.fillRect(0, 0, this.width, this.height);
    this.changedMask();
  }

  clear() {
    this.mask = newCanvas(this.width, this.height);
    this.resetPlacement();
    this.changedMask();
  }

  private changedMask() {
    this.cachedBounds = undefined;
    this.tinted = null;
  }

  bounds() {
    if (this.cachedBounds === undefined) this.cachedBounds = inkBounds(this.mask);
    return this.cachedBounds;
  }

  get empty() {
    return !this.bounds();
  }

  /** Whether there is a pending change to commit. */
  get moved() {
    return this.copy || this.dx !== 0 || this.dy !== 0 || this.scale !== 1 || this.angle !== 0 || this.flip;
  }

  resetPlacement() {
    this.dx = this.dy = this.angle = 0;
    this.scale = 1;
    this.flip = this.copy = false;
  }

  /** Resizes and turns around the middle of the selection, then moves. */
  matrix() {
    const b = this.bounds();
    const cx = b ? (b.left + b.right) / 2 : 0;
    const cy = b ? (b.top + b.bottom) / 2 : 0;
    return new DOMMatrix()
      .translate(cx + this.dx, cy + this.dy)
      .rotate(this.angle)
      .scale(this.scale * (this.flip ? -1 : 1), this.scale)
      .translate(-cx, -cy);
  }

  /** Whether a paper point is on the (moved) selection's box, so dragging there moves it. */
  contains(x: number, y: number) {
    const b = this.bounds();
    if (!b) return false;
    const p = this.matrix().inverse().transformPoint({ x, y });
    const pad = 12 / this.scale;
    return p.x >= b.left - pad && p.x <= b.right + pad && p.y >= b.top - pad && p.y <= b.bottom + pad;
  }

  /** The pending change as an op (not yet in the history). */
  pendingOp(): TransformOp {
    return { type: 'transform', mask: this.mask, matrix: this.matrix(), copy: this.copy, remove: false };
  }

  /** After committing, the selection follows the part to where it now is. */
  settle() {
    const moved = newCanvas(this.width, this.height);
    const m = moved.getContext('2d')!;
    m.setTransform(this.matrix());
    m.drawImage(this.mask, 0, 0);
    this.mask = moved;
    this.resetPlacement();
    this.changedMask();
  }

  /** Draws the selection as a blue tint with a dashed box. */
  drawOverlay(octx: CanvasRenderingContext2D) {
    octx.clearRect(0, 0, this.width, this.height);
    const b = this.bounds();
    if (!b) return;
    if (!this.tinted) {
      this.tinted = newCanvas(this.width, this.height);
      const t = this.tinted.getContext('2d')!;
      t.drawImage(this.mask, 0, 0);
      t.globalCompositeOperation = 'source-in';
      t.fillStyle = 'rgba(58, 134, 255, 0.28)';
      t.fillRect(0, 0, this.width, this.height);
    }
    octx.save();
    octx.setTransform(this.matrix());
    octx.drawImage(this.tinted, 0, 0);
    octx.setLineDash([10, 8]);
    octx.lineWidth = 3 / this.scale;
    octx.strokeStyle = 'rgba(58, 134, 255, 0.9)';
    octx.strokeRect(b.left - 6, b.top - 6, b.right - b.left + 12, b.bottom - b.top + 12);
    octx.restore();
  }
}
