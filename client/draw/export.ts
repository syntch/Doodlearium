import type { Attachment } from '../../shared/types.ts';

const MAX_SIZE = 512;
const PADDING = 6;
const ALPHA_VISIBLE = 10;
/** Pixels below this alpha are "open water" the outside flood can pass through. */
const ALPHA_WALL = 128;

/** An extra placed on the paper, in paper pixel coordinates. */
export type PlacedAttachment = Omit<Attachment, 'x' | 'y'> & { x: number; y: number };

/**
 * Crops the drawing to its inked area, scales it down, optionally mirrors it so it faces right,
 * and optionally fills enclosed regions white so outline-only drawings look like paper cut-outs.
 * Extras are converted to fractions of the exported image.
 */
export function exportDrawing(
  source: HTMLCanvasElement,
  { mirror, paperFill, attachments }: { mirror: boolean; paperFill: boolean; attachments: PlacedAttachment[] },
): { dataUrl: string; width: number; height: number; attachments: Attachment[] } | null {
  const bounds = inkBounds(source);
  if (!bounds) return null;

  const cropW = bounds.right - bounds.left + 1 + PADDING * 2;
  const cropH = bounds.bottom - bounds.top + 1 + PADDING * 2;
  const clampFraction = (v: number) => Math.min(1.5, Math.max(-0.5, v));
  const exportedAttachments = attachments.map((a) => {
    const x = clampFraction((a.x - (bounds.left - PADDING)) / cropW);
    return { ...a, x: mirror ? 1 - x : x, y: clampFraction((a.y - (bounds.top - PADDING)) / cropH) };
  });
  const scale = Math.min(1, MAX_SIZE / Math.max(cropW, cropH));
  const width = Math.max(1, Math.round(cropW * scale));
  const height = Math.max(1, Math.round(cropH * scale));

  const out = document.createElement('canvas');
  out.width = width;
  out.height = height;
  const ctx = out.getContext('2d', { willReadFrequently: true })!;
  ctx.imageSmoothingQuality = 'high';
  if (mirror) {
    ctx.translate(width, 0);
    ctx.scale(-1, 1);
  }
  ctx.drawImage(source, bounds.left - PADDING, bounds.top - PADDING, cropW, cropH, 0, 0, width, height);
  ctx.setTransform(1, 0, 0, 1, 0, 0);

  if (paperFill) fillEnclosed(ctx, width, height);
  return { dataUrl: out.toDataURL('image/png'), width, height, attachments: exportedAttachments };
}

function inkBounds(canvas: HTMLCanvasElement) {
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

function fillEnclosed(ctx: CanvasRenderingContext2D, width: number, height: number) {
  const image = ctx.getImageData(0, 0, width, height);
  const data = image.data;
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
  while (size > 0) {
    const i = stack[--size];
    const x = i % width;
    if (x > 0) push(i - 1);
    if (x < width - 1) push(i + 1);
    if (i >= width) push(i - width);
    if (i < width * (height - 1)) push(i + width);
  }
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
