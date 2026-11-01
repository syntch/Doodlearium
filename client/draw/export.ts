import type { Attachment, Part, PartMotion } from '../../shared/types.ts';

const MAX_SIZE = 512;
const PADDING = 6;
const ALPHA_VISIBLE = 10;
/** Pixels below this alpha are "open water" the outside flood can pass through. */
const ALPHA_WALL = 128;

/** An extra placed on the paper, in paper pixel coordinates. */
export type PlacedAttachment = Omit<Attachment, 'x' | 'y'> & { x: number; y: number };

/** An animated part on the paper: its area, and its hinge line in paper pixels. */
export interface PlacedPart {
  mask: HTMLCanvasElement;
  motion: PartMotion;
  hinge: [number, number, number, number];
  speed?: number;
  amount?: number;
  flip?: boolean;
}

/**
 * Crops the drawing to its inked area, scales it down, optionally mirrors it so it faces right,
 * and optionally fills enclosed regions white so outline-only drawings look like paper cut-outs.
 * Extras and part hinges are converted to fractions of the exported image, and parts get an image of
 * their own marking which pixels belong to which part.
 */
export function exportDrawing(
  source: HTMLCanvasElement,
  {
    mirror,
    paperFill,
    attachments,
    holes,
    glow,
    parts = [],
  }: {
    mirror: boolean;
    paperFill: boolean;
    attachments: PlacedAttachment[];
    /** Areas painted invisible, which the white fill must leave see-through. */
    holes?: HTMLCanvasElement;
    parts?: PlacedPart[];
    /** Where glow paint and blacklight paint are. */
    glow?: { glow: HTMLCanvasElement; uv: HTMLCanvasElement };
  },
): {
  dataUrl: string;
  width: number;
  height: number;
  attachments: Attachment[];
  parts: Part[];
  partsImage?: string;
  glowImage?: string;
} | null {
  const bounds = inkBounds(source);
  if (!bounds) return null;

  const cropW = bounds.right - bounds.left + 1 + PADDING * 2;
  const cropH = bounds.bottom - bounds.top + 1 + PADDING * 2;
  const clampFraction = (v: number) => Math.min(1.5, Math.max(-0.5, v));
  const toFraction = (px: number, py: number) => {
    const x = clampFraction((px - (bounds.left - PADDING)) / cropW);
    return { x: mirror ? 1 - x : x, y: clampFraction((py - (bounds.top - PADDING)) / cropH) };
  };
  const exportedAttachments = attachments.map((a) => ({ ...a, ...toFraction(a.x, a.y) }));
  const exportedParts: Part[] = parts.map(({ motion, hinge: [x1, y1, x2, y2], speed = 1, amount = 1, flip }) => {
    const a = toFraction(x1, y1);
    const b = toFraction(x2, y2);
    return { motion, hinge: [a.x, a.y, b.x, b.y], speed, amount, ...(flip ? { flip } : {}) };
  });
  const scale = Math.min(1, MAX_SIZE / Math.max(cropW, cropH));
  const width = Math.max(1, Math.round(cropW * scale));
  const height = Math.max(1, Math.round(cropH * scale));

  const out = document.createElement('canvas');
  out.width = width;
  out.height = height;
  const ctx = out.getContext('2d', { willReadFrequently: true })!;
  /** Draws a paper-sized canvas into the exported image's crop, scale and mirror. */
  const place = (target: CanvasRenderingContext2D, canvas: HTMLCanvasElement) => {
    target.imageSmoothingQuality = 'high';
    if (mirror) {
      target.translate(width, 0);
      target.scale(-1, 1);
    }
    target.drawImage(canvas, bounds.left - PADDING, bounds.top - PADDING, cropW, cropH, 0, 0, width, height);
    target.setTransform(1, 0, 0, 1, 0, 0);
  };
  place(ctx, source);

  if (paperFill) {
    let keepClear: Uint8ClampedArray | undefined;
    if (holes) {
      const h = Object.assign(document.createElement('canvas'), { width, height }).getContext('2d', { willReadFrequently: true })!;
      place(h, holes);
      keepClear = h.getImageData(0, 0, width, height).data;
    }
    fillEnclosed(ctx, width, height, keepClear);
  }
  let partsImage: string | undefined;
  if (parts.length) {
    // Later parts win where they overlap.
    const marks = Object.assign(document.createElement('canvas'), { width, height });
    const mctx = marks.getContext('2d', { willReadFrequently: true })!;
    const result = mctx.createImageData(width, height);
    parts.forEach((part, index) => {
      mctx.clearRect(0, 0, width, height);
      place(mctx, part.mask);
      const area = mctx.getImageData(0, 0, width, height).data;
      for (let i = 0; i < area.length; i += 4) {
        if (area[i + 3] < 128) continue;
        result.data[i] = (index + 1) * 30;
        result.data[i + 3] = 255;
      }
    });
    mctx.putImageData(result, 0, 0);
    partsImage = marks.toDataURL('image/png');
  }
  let glowImage: string | undefined;
  if (glow) {
    // One image: red marks glow paint, green blacklight paint.
    const marks = Object.assign(document.createElement('canvas'), { width, height });
    const mctx = marks.getContext('2d', { willReadFrequently: true })!;
    const read = (canvas: HTMLCanvasElement) => {
      mctx.clearRect(0, 0, width, height);
      place(mctx, canvas);
      return mctx.getImageData(0, 0, width, height).data;
    };
    const g = read(glow.glow);
    const u = read(glow.uv);
    const result = mctx.createImageData(width, height);
    let any = false;
    for (let i = 0; i < g.length; i += 4) {
      if (g[i + 3] < 8 && u[i + 3] < 8) continue;
      result.data[i] = g[i + 3];
      result.data[i + 1] = u[i + 3];
      result.data[i + 3] = 255;
      any = true;
    }
    if (any) {
      mctx.putImageData(result, 0, 0);
      glowImage = marks.toDataURL('image/png');
    }
  }
  return {
    dataUrl: out.toDataURL('image/png'),
    width,
    height,
    attachments: exportedAttachments,
    parts: exportedParts,
    partsImage,
    glowImage,
  };
}

export function inkBounds(canvas: HTMLCanvasElement) {
  const { width, height } = canvas;
  const data = canvas.getContext('2d')!.getImageData(0, 0, width, height).data;
  let left = width, right = -1, top = height, bottom = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4 + 3] > ALPHA_VISIBLE) {
        if (x < left) left = x;
        if (x > right) right = x;
        if (y < top) top = y;
        if (y > bottom) bottom = y;
      }
    }
  }
  return right < 0 ? null : { left, right, top, bottom };
}

export function fillEnclosed(ctx: CanvasRenderingContext2D, width: number, height: number, keepClear?: Uint8ClampedArray) {
  const image = ctx.getImageData(0, 0, width, height);
  const data = image.data;
  const outside = outsideOf(data, width, height, keepClear);
  // Everything the outside couldn't reach is inside the drawing: composite it over white.
  for (let i = 0; i < width * height; i++) {
    if (outside[i]) continue;
    const p = i * 4;
    const a = data[p + 3] / 255;
    data[p] = data[p] * a + 255 * (1 - a);
    data[p + 1] = data[p + 1] * a + 255 * (1 - a);
    data[p + 2] = data[p + 2] * a + 255 * (1 - a);
    data[p + 3] = 255;
  }
  ctx.putImageData(image, 0, 0);
}

/**
 * The see-through pixels the white fill would have filled: enclosed by the drawing, yet still clear.
 * When re-editing a saved drawing, these must have been made invisible on purpose.
 */
export function enclosedHoles(image: CanvasImageSource & { width: number; height: number }) {
  const { width, height } = image;
  const canvas = Object.assign(document.createElement('canvas'), { width, height });
  const c = canvas.getContext('2d', { willReadFrequently: true })!;
  c.drawImage(image, 0, 0);
  const result = c.getImageData(0, 0, width, height);
  const outside = outsideOf(result.data, width, height);
  for (let i = 0; i < width * height; i++) {
    const clear = !outside[i] && result.data[i * 4 + 3] < ALPHA_WALL;
    result.data[i * 4 + 3] = clear ? 255 : 0;
  }
  c.putImageData(result, 0, 0);
  return canvas;
}

/** Floods in from the edges (and from any keep-clear pixels) through see-through pixels. */
function outsideOf(data: Uint8ClampedArray, width: number, height: number, keepClear?: Uint8ClampedArray) {
  const outside = new Uint8Array(width * height);
  const stack = new Int32Array(width * height);
  let size = 0;
  const push = (i: number) => {
    if (!outside[i] && data[i * 4 + 3] < ALPHA_WALL) {
      outside[i] = 1;
      stack[size++] = i;
    }
  };
  for (let x = 0; x < width; x++) {
    push(x);
    push((height - 1) * width + x);
  }
  for (let y = 0; y < height; y++) {
    push(y * width);
    push(y * width + width - 1);
  }
  if (keepClear) for (let i = 0; i < width * height; i++) if (keepClear[i * 4 + 3] > 0) push(i);
  while (size > 0) {
    const i = stack[--size];
    const x = i % width;
    if (x > 0) push(i - 1);
    if (x < width - 1) push(i + 1);
    if (i >= width) push(i - width);
    if (i < width * (height - 1)) push(i + width);
  }
  return outside;
}
