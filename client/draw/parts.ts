import type { Part, PartMotion } from '../../shared/types.ts';
import { inkBounds } from './export.ts';
import type { TransformOp } from './selection.ts';

/** An animated part while editing: which area of the paper it covers, and how it moves. */
export interface EditorPart {
  mask: HTMLCanvasElement;
  motion: PartMotion;
  /** A hinge drawn by hand, in paper pixels; otherwise it's found automatically. */
  hinge?: [number, number, number, number];
  /** 1 = normal; see Part. */
  speed?: number;
  amount?: number;
  flip?: boolean;
  lift?: boolean;
}

/** Moves a hand-drawn hinge along with its part. */
const moveHinge = (hinge: EditorPart['hinge'], matrix: DOMMatrix): EditorPart['hinge'] => {
  if (!hinge) return undefined;
  const a = matrix.transformPoint({ x: hinge[0], y: hinge[1] });
  const b = matrix.transformPoint({ x: hinge[2], y: hinge[3] });
  return [a.x, a.y, b.x, b.y];
};

export const PART_INFO: Record<PartMotion, { icon: string; label: string; hint: string }> = {
  popout: { icon: '🪽', label: 'Pop-out', hint: "Lifts up out of the paper where it's attached, like a cut-out fin" },
  flap: { icon: '🦋', label: 'Flap', hint: "Swings back and forth where it's attached (tails, flippers)" },
  chomp: { icon: '🦪', label: 'Open & close', hint: "Opens and shuts where it's attached (clams, mouths, lids). Its chip has a button for which way it opens" },
  spin: { icon: '🌀', label: 'Spin', hint: 'Spins around its middle (propellers, wheels)' },
  pulse: { icon: '💓', label: 'Pulse', hint: 'Grows and shrinks (hearts, lights)' },
  blink: { icon: '😉', label: 'Blink', hint: 'Blinks every few seconds (eyes)' },
  leg: { icon: '🦵', label: 'Leg', hint: 'Swings from where it joins the body as the animal walks (mark each leg on its own)' },
};

const newCanvas = (width: number, height: number) => Object.assign(document.createElement('canvas'), { width, height });

/** Part masks never change once made, so their bounds are worked out once. */
const boundsCache = new WeakMap<HTMLCanvasElement, ReturnType<typeof inkBounds>>();
export function maskBounds(mask: HTMLCanvasElement) {
  if (!boundsCache.has(mask)) boundsCache.set(mask, inkBounds(mask));
  return boundsCache.get(mask)!;
}

export function cloneCanvas(source: HTMLCanvasElement) {
  const c = newCanvas(source.width, source.height);
  c.getContext('2d')!.drawImage(source, 0, 0);
  return c;
}

/** Parts on the moved area move (or copy, or disappear) with it. Copies become parts of their own. */
export function carryParts(list: EditorPart[], op: TransformOp) {
  op.carried ??= new Map();
  const opBounds = inkBounds(op.mask);
  for (const part of [...list]) {
    let result = op.carried.get(part) as EditorPart[] | undefined;
    if (!result) {
      const b = maskBounds(part.mask);
      const touches =
        b && opBounds && b.left <= opBounds.right && opBounds.left <= b.right && b.top <= opBounds.bottom && opBounds.top <= b.bottom;
      if (!touches) {
        result = [part];
      } else {
        const { width, height } = part.mask;
        const inside = newCanvas(width, height);
        const ic = inside.getContext('2d')!;
        ic.drawImage(part.mask, 0, 0);
        ic.globalCompositeOperation = 'destination-in';
        ic.drawImage(op.mask, 0, 0);
        const moved = newCanvas(width, height);
        const mc = moved.getContext('2d')!;
        mc.setTransform(op.matrix);
        mc.drawImage(inside, 0, 0);
        // The hinge goes along when the whole part moves.
        const whole =
          !!b && !!opBounds && b.left >= opBounds.left && b.right <= opBounds.right && b.top >= opBounds.top && b.bottom <= opBounds.bottom;
        const hinge = whole ? moveHinge(part.hinge, op.matrix) : part.hinge;
        if (op.copy) {
          result = [part, { ...part, mask: moved, hinge: moveHinge(part.hinge, op.matrix) }];
        } else {
          const rest = cloneCanvas(part.mask);
          const rc = rest.getContext('2d')!;
          rc.globalCompositeOperation = 'destination-out';
          rc.drawImage(op.mask, 0, 0);
          rc.globalCompositeOperation = 'source-over';
          if (!op.remove) rc.drawImage(moved, 0, 0);
          result = maskBounds(rest) ? [{ ...part, mask: rest, hinge }] : [];
        }
      }
      op.carried.set(part, result);
    }
    list.splice(list.indexOf(part), 1, ...result);
  }
}

/**
 * Where a part is attached to the rest of the drawing, as a line in paper pixels. It's fitted through the
 * part's pixels that touch other ink; a part that touches nothing hinges on its side facing the rest.
 * A part drawn inside the body (touching it all the way round, like a side fin) hinges near its
 * head end, where fins usually join.
 */
export function findHinge(ink: ImageData, part: EditorPart, headRight: boolean): [number, number, number, number] | null {
  if (part.hinge) return part.hinge;
  const b = maskBounds(part.mask);
  if (!b) return null;
  const { width, height, data } = ink;
  const m = part.mask.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, width, height).data;
  const inPart = (i: number) => m[i * 4 + 3] >= 128 && data[i * 4 + 3] >= 128;
  const isOther = (i: number) => m[i * 4 + 3] < 128 && data[i * 4 + 3] >= 128;

  const contacts: { x: number; y: number }[] = [];
  const all: { x: number; y: number }[] = [];
  let edge = 0;
  for (let y = Math.max(1, b.top); y <= Math.min(height - 2, b.bottom); y++) {
    for (let x = Math.max(1, b.left); x <= Math.min(width - 2, b.right); x++) {
      const i = y * width + x;
      if (!inPart(i)) continue;
      all.push({ x, y });
      const out = (j: number) => !inPart(j);
      if (out(i - 1) || out(i + 1) || out(i - width) || out(i + width)) edge++;
      if (isOther(i - 1) || isOther(i + 1) || isOther(i - width) || isOther(i + width)) contacts.push({ x, y });
    }
  }
  if (!all.length) return null;
  if (contacts.length >= 3 && contacts.length < edge * 0.6) return lineThrough(contacts);
  if (contacts.length >= 3) {
    // Surrounded: a line across the part a quarter of the way in from its head end.
    const span = b.right - b.left;
    const x = headRight ? b.right - span * 0.25 : b.left + span * 0.25;
    const ys = all.filter((p) => Math.abs(p.x - x) < 2).map((p) => p.y);
    if (ys.length) return [x, Math.min(...ys), x, Math.max(...ys)];
  }

  // Not touching anything: hinge on the side facing the rest of the drawing (or the bottom).
  const centre = mean(all);
  let rest = { x: centre.x, y: centre.y + 1 };
  let sx = 0, sy = 0, n = 0;
  for (let i = 0; i < width * height; i += 7) {
    if (!isOther(i)) continue;
    sx += i % width;
    sy += Math.floor(i / width);
    n++;
  }
  if (n) rest = { x: sx / n, y: sy / n };
  const toward = normalize({ x: rest.x - centre.x, y: rest.y - centre.y });
  const along = { x: -toward.y, y: toward.x };
  let far = -Infinity, lo = Infinity, hi = -Infinity;
  for (const p of all) {
    far = Math.max(far, (p.x - centre.x) * toward.x + (p.y - centre.y) * toward.y);
    const s = (p.x - centre.x) * along.x + (p.y - centre.y) * along.y;
    lo = Math.min(lo, s);
    hi = Math.max(hi, s);
  }
  const base = { x: centre.x + toward.x * far, y: centre.y + toward.y * far };
  return [base.x + along.x * lo, base.y + along.y * lo, base.x + along.x * hi, base.y + along.y * hi];
}

const mean = (points: { x: number; y: number }[]) => ({
  x: points.reduce((s, p) => s + p.x, 0) / points.length,
  y: points.reduce((s, p) => s + p.y, 0) / points.length,
});

const normalize = (v: { x: number; y: number }) => {
  const len = Math.hypot(v.x, v.y) || 1;
  return { x: v.x / len, y: v.y / len };
};

/** The best-fit line through the points (their main direction), spanning all of them. */
function lineThrough(points: { x: number; y: number }[]): [number, number, number, number] {
  const c = mean(points);
  let xx = 0, xy = 0, yy = 0;
  for (const p of points) {
    xx += (p.x - c.x) ** 2;
    xy += (p.x - c.x) * (p.y - c.y);
    yy += (p.y - c.y) ** 2;
  }
  const angle = 0.5 * Math.atan2(2 * xy, xx - yy);
  const d = { x: Math.cos(angle), y: Math.sin(angle) };
  let lo = Infinity, hi = -Infinity;
  for (const p of points) {
    const s = (p.x - c.x) * d.x + (p.y - c.y) * d.y;
    lo = Math.min(lo, s);
    hi = Math.max(hi, s);
  }
  return [c.x + d.x * lo, c.y + d.y * lo, c.x + d.x * hi, c.y + d.y * hi];
}

/** Rebuilds part masks from a saved drawing's part image, placed where the drawing sits on the paper. */
export function partsFromImage(
  partsImage: HTMLImageElement,
  saved: Part[],
  paper: { width: number; height: number },
  at: { x: number; y: number },
): EditorPart[] {
  const placed = newCanvas(paper.width, paper.height).getContext('2d', { willReadFrequently: true })!;
  placed.drawImage(partsImage, at.x, at.y);
  const marks = placed.getImageData(0, 0, paper.width, paper.height);
  return saved.map(({ motion, speed, amount, flip, lift }, index) => {
    const mask = newCanvas(paper.width, paper.height);
    const c = mask.getContext('2d')!;
    const out = c.createImageData(paper.width, paper.height);
    const value = (index + 1) * 30;
    for (let i = 0; i < out.data.length; i += 4) {
      if (marks.data[i + 3] >= 128 && Math.abs(marks.data[i] - value) <= 10) out.data[i + 3] = 255;
    }
    c.putImageData(out, 0, 0);
    return { mask, motion, speed, amount, flip, lift };
  });
}
