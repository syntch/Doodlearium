import { Container, Matrix, Sprite, Texture } from 'pixi.js';
import { isHinged, partsUrl, type Drawing, type Part } from '../../shared/types.ts';
import type { Deform } from './attachments.ts';
import { TAU } from './world.ts';

/** One animated part cut out of a drawing, in the drawing's texture coordinates. */
export interface Piece {
  part: Part;
  /** Its place in the drawing's list of parts. */
  index: number;
  /** The middle of the rest of the drawing (everything that isn't this part), so it can open away from it. */
  rest: { x: number; y: number };
  canvas: HTMLCanvasElement;
  /** Top-left of the piece within the drawing. */
  x: number;
  y: number;
}

/** A drawing split for the tank: the body (with shadows where parts lift off) and its pieces. */
export interface Split {
  body: HTMLCanvasElement;
  pieces: Piece[];
}

const loadImage = async (src: string) => {
  const image = new Image();
  image.src = src;
  await image.decode();
  return image;
};

/** A split drawing turned into textures, ready for a creature. */
export interface Cutout {
  body: Texture;
  pieces: (Piece & { texture: Texture })[];
  destroy(): void;
}

export function toCutout(split: Split): Cutout {
  const body = Texture.from(split.body);
  const pieces = split.pieces.map((p) => ({ ...p, texture: Texture.from(p.canvas) }));
  return {
    body,
    pieces,
    destroy() {
      body.destroy(true);
      for (const p of pieces) p.texture.destroy(true);
    },
  };
}

export async function loadCutout(drawing: Drawing, image: string): Promise<Cutout> {
  const [picture, parts] = await Promise.all([loadImage(image), loadImage(partsUrl(drawing))]);
  return toCutout(splitParts(picture, parts, drawing.parts ?? []));
}

/**
 * Cuts each part out of the picture. Where a part was, the body keeps a darker copy of it,
 * like the hole and shadow left when something is cut out of paper and lifted.
 */
export function splitParts(picture: CanvasImageSource, partsImage: CanvasImageSource, parts: Part[]): Split {
  const width = (picture as HTMLImageElement).width;
  const height = (picture as HTMLImageElement).height;
  const read = (source: CanvasImageSource) => {
    const c = Object.assign(document.createElement('canvas'), { width, height }).getContext('2d', { willReadFrequently: true })!;
    c.drawImage(source, 0, 0, width, height);
    return c.getImageData(0, 0, width, height);
  };
  const body = read(picture);
  const marks = read(partsImage).data;
  const px = body.data;

  const pieces: Piece[] = [];
  parts.forEach((part, index) => {
    const value = (index + 1) * 30;
    let left = width, top = height, right = -1, bottom = -1;
    for (let i = 0; i < width * height; i++) {
      if (marks[i * 4 + 3] < 128 || Math.abs(marks[i * 4] - value) > 10 || px[i * 4 + 3] === 0) continue;
      const x = i % width;
      const y = (i - x) / width;
      if (x < left) left = x;
      if (x > right) right = x;
      if (y < top) top = y;
      if (y > bottom) bottom = y;
    }
    if (right < 0) return;
    const w = right - left + 1;
    const h = bottom - top + 1;
    const canvas = Object.assign(document.createElement('canvas'), { width: w, height: h });
    const c = canvas.getContext('2d')!;
    const out = c.createImageData(w, h);
    for (let y = top; y <= bottom; y++) {
      for (let x = left; x <= right; x++) {
        const i = y * width + x;
        if (marks[i * 4 + 3] < 128 || Math.abs(marks[i * 4] - value) > 10) continue;
        const o = ((y - top) * w + (x - left)) * 4;
        for (let k = 0; k < 4; k++) out.data[o + k] = px[i * 4 + k];
        // Under the part: the same shape, in shadow.
        for (let k = 0; k < 3; k++) px[i * 4 + k] *= 0.4;
      }
    }
    c.putImageData(out, 0, 0);
    // Where the rest of the drawing is, sampled sparsely.
    let sx = 0, sy = 0, n = 0;
    for (let i = 0; i < width * height; i += 7) {
      if (px[i * 4 + 3] < 128 || (marks[i * 4 + 3] >= 128 && Math.abs(marks[i * 4] - value) <= 10)) continue;
      sx += i % width;
      sy += Math.floor(i / width);
      n++;
    }
    const rest = n ? { x: sx / n, y: sy / n } : { x: width / 2, y: height / 2 };
    pieces.push({ part, index, rest, canvas, x: left, y: top });
  });

  const bodyCanvas = Object.assign(document.createElement('canvas'), { width, height });
  bodyCanvas.getContext('2d')!.putImageData(body, 0, 0);
  return { body: bodyCanvas, pieces };
}

interface Live {
  piece: Piece;
  holder: Container;
  phase: number;
  /** Blink: seconds until the next one, or (negative) how far into the current one. */
  timer: number;
  /** Hinge ends and middle, and the piece's middle, in texture pixels. */
  h1: { x: number; y: number };
  h2: { x: number; y: number };
  mid: { x: number; y: number };
  centre: { x: number; y: number };
  /** Open & close: which way round it swings open (1 or -1). */
  opens: number;
  /** Open & close, lifting: the way straight off the rest of the drawing, and how far that is across the part. */
  away: { x: number; y: number };
  depth: number;
}

/** Animates a drawing's pieces in place, riding the body's own bend like extras do. */
export class Parts {
  readonly container = new Container();
  private live: Live[];

  constructor(
    pieces: (Piece & { texture: Texture })[],
    private texW: number,
    private texH: number,
    /** Texture point that sits at the view's origin (the mesh pivot or sprite anchor). */
    private origin: { x: number; y: number },
  ) {
    this.live = pieces.map((piece) => {
      const holder = new Container();
      holder.addChild(new Sprite({ texture: piece.texture, position: { x: piece.x, y: piece.y } }));
      this.container.addChild(holder);
      const [x1, y1, x2, y2] = piece.part.hinge;
      const h1 = { x: x1 * texW, y: y1 * texH };
      const h2 = { x: x2 * texW, y: y2 * texH };
      const centre = { x: piece.x + piece.canvas.width / 2, y: piece.y + piece.canvas.height / 2 };
      return {
        piece,
        holder,
        phase: Math.random() * TAU,
        timer: 1 + Math.random() * 4,
        h1,
        h2,
        mid: { x: (h1.x + h2.x) / 2, y: (h1.y + h2.y) / 2 },
        centre,
        opens: opensAway(piece.part, { x: (h1.x + h2.x) / 2, y: (h1.y + h2.y) / 2 }, centre, piece.rest),
        ...liftAway(h1, h2, centre, piece),
      };
    });
  }

  /** The container that moves a part, by its place in the drawing's list (to hang its glow on). */
  holderFor(index: number) {
    return this.live.find((l) => l.piece.index === index)?.holder;
  }

  get empty() {
    return this.live.length === 0;
  }

  /** effort: how hard the creature is swimming (1 = normal), so fins work harder when it hurries. */
  /** sleepy (0..1) slowly closes blinking eyes. walk keeps 🦵 legs in step with a land animal's stride. */
  update(dt: number, effort = 1, deform?: Deform, sleepy = 0, walk?: { phase: number; stride: number }) {
    for (const l of this.live) {
      const m = this.motion(l, dt * (l.piece.part.speed ?? 1), effort, sleepy, walk);
      // Pieces follow the body's bend at the point they're attached.
      const at = isHinged(l.piece.part.motion) ? l.mid : l.centre;
      const bend = deform?.(at.x / this.texW, at.y / this.texH) ?? { dx: 0, dy: 0 };
      m.prepend(new Matrix(1, 0, 0, 1, bend.dx - this.origin.x, bend.dy - this.origin.y));
      l.holder.setFromMatrix(m);
    }
  }

  /** The piece's own motion, as a matrix in texture pixels. */
  private motion(l: Live, dt: number, effort: number, sleepy: number, walk?: { phase: number; stride: number }) {
    const m = new Matrix();
    const amount = l.piece.part.amount ?? 1;
    switch (l.piece.part.motion) {
      case 'popout': {
        // Lifts up out of the paper around its hinge and settles back: seen from the front, the side
        // away from the hinge swings in toward it (the fin foreshortens), uncovering its shadow.
        l.phase += dt * (2 + effort * 1.2);
        const lift = (0.5 - 0.5 * Math.cos(l.phase)) * Math.min(1.45, 1.25 * amount); // up to about 70°
        const angle = Math.atan2(l.h2.y - l.h1.y, l.h2.x - l.h1.x);
        // Lifting toward the viewer, it also looks a little bigger along the hinge.
        return aroundPoint(l.mid, m.rotate(-angle).scale(1 + Math.sin(lift) * 0.12, Math.cos(lift)).rotate(angle));
      }
      case 'flap':
        // On a land animal or a flier, it beats in time with its stride or wingbeat, and rests when it does.
        if (walk) return aroundPoint(l.mid, m.rotate(Math.sin(walk.phase) * 0.55 * amount * (0.1 + 0.9 * walk.stride)));
        l.phase += dt * (3 + effort);
        return aroundPoint(l.mid, m.rotate(Math.sin(l.phase) * 0.45 * amount));
      case 'leg': {
        // Swings from the hip in step with the walk, every other leg the opposite way; still when standing.
        // (Off land, it just paddles gently.)
        const opposite = l.piece.index % 2 ? Math.PI : 0;
        if (!walk) l.phase += dt * (2 + effort);
        const swing = walk ? Math.sin(walk.phase + opposite) * 0.5 * walk.stride : Math.sin(l.phase + opposite) * 0.25;
        return aroundPoint(l.mid, m.rotate(swing * amount));
      }
      case 'chomp': {
        // Opens away from the rest of the body, holds, snaps shut, and rests a moment before the next.
        l.phase += dt * (1.6 + effort * 0.6);
        const c = (l.phase / TAU) % 1;
        const ease = (t: number) => t * t * (3 - 2 * t);
        const open = c < 0.3 ? ease(c / 0.3) : c < 0.45 ? 1 : c < 0.6 ? 1 - ease((c - 0.45) / 0.15) : 0;
        if (l.piece.part.lift) {
          // Seen from the front, a shell opening on a hinge at the back lifts straight up, tipping back a
          // little (so it looks a bit shorter), and uncovers the dark inside where it was.
          const angle = Math.atan2(l.away.y, l.away.x);
          const rise = open * l.depth * Math.min(0.9, 0.35 * amount);
          m.rotate(-angle).scale(1 - open * 0.12, 1).rotate(angle).translate(l.away.x * rise, l.away.y * rise);
          return aroundPoint(l.mid, m);
        }
        return aroundPoint(l.mid, m.rotate(open * Math.min(1.1, 0.5 * amount) * l.opens));
      }
      case 'spin':
        l.phase += dt * 4 * amount;
        return aroundPoint(l.centre, m.rotate(l.phase));
      case 'pulse': {
        l.phase += dt * 3;
        const s = 1 + Math.sin(l.phase) * 0.14 * amount;
        return aroundPoint(l.centre, m.scale(s, s));
      }
      case 'blink': {
        l.timer -= dt;
        let squash = 1;
        if (l.timer < 0) {
          const t = -l.timer / 0.22;
          if (t >= 1) l.timer = 2 + Math.random() * 4;
          else squash = 1 - Math.sin(t * Math.PI) * Math.min(0.95, 0.9 * amount);
        }
        // Sleepy eyes droop shut.
        squash = Math.min(squash, 1 - sleepy * 0.9);
        return aroundPoint(l.centre, m.scale(1, squash));
      }
    }
  }
}

/** Which way to turn a part around its hinge so it swings away from the rest of the drawing (a clam's lid opens upward). */
function opensAway(part: Part, hinge: { x: number; y: number }, centre: { x: number; y: number }, middle: { x: number; y: number }) {
  // Turning by a small angle moves the part's middle along (-ry, rx), where r runs from the hinge to it.
  const rx = centre.x - hinge.x;
  const ry = centre.y - hinge.y;
  const away = -ry * (centre.x - middle.x) + rx * (centre.y - middle.y);
  const sign = away < 0 ? -1 : 1;
  return part.flip ? -sign : sign;
}

/** Straight off the hinge line, on the part's side, and the part's size that way. */
function liftAway(h1: { x: number; y: number }, h2: { x: number; y: number }, centre: { x: number; y: number }, piece: Piece) {
  const out = { x: centre.x - piece.rest.x, y: centre.y - piece.rest.y };
  let away = { x: -(h2.y - h1.y), y: h2.x - h1.x };
  if (Math.hypot(away.x, away.y) < 1) away = out;
  const length = Math.hypot(away.x, away.y) || 1;
  const sign = away.x * out.x + away.y * out.y < 0 ? -1 : 1;
  away = { x: (away.x / length) * sign, y: (away.y / length) * sign };
  return { away, depth: Math.abs(away.x) * piece.canvas.width + Math.abs(away.y) * piece.canvas.height };
}

/** Applies m around point p instead of around the origin. */
function aroundPoint(p: { x: number; y: number }, m: Matrix) {
  // prepend(x) means "then do x".
  return new Matrix(1, 0, 0, 1, -p.x, -p.y).prepend(m).prepend(new Matrix(1, 0, 0, 1, p.x, p.y));
}
