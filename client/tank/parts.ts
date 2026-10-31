import { Container, Matrix, Sprite, Texture } from 'pixi.js';
import { partsUrl, type Drawing, type Part } from '../../shared/types.ts';
import type { Deform } from './attachments.ts';
import { TAU } from './world.ts';

/** One animated part cut out of a drawing, in the drawing's texture coordinates. */
export interface Piece {
  part: Part;
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
    pieces.push({ part, canvas, x: left, y: top });
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
      return {
        piece,
        holder,
        phase: Math.random() * TAU,
        timer: 1 + Math.random() * 4,
        h1,
        h2,
        mid: { x: (h1.x + h2.x) / 2, y: (h1.y + h2.y) / 2 },
        centre: { x: piece.x + piece.canvas.width / 2, y: piece.y + piece.canvas.height / 2 },
      };
    });
  }

  get empty() {
    return this.live.length === 0;
  }

  /** effort: how hard the creature is swimming (1 = normal), so fins work harder when it hurries. */
  update(dt: number, effort = 1, deform?: Deform) {
    for (const l of this.live) {
      const m = this.motion(l, dt, effort);
      // Pieces follow the body's bend at the point they're attached.
      const at = l.piece.part.motion === 'popout' || l.piece.part.motion === 'flap' ? l.mid : l.centre;
      const bend = deform?.(at.x / this.texW, at.y / this.texH) ?? { dx: 0, dy: 0 };
      m.prepend(new Matrix(1, 0, 0, 1, bend.dx - this.origin.x, bend.dy - this.origin.y));
      l.holder.setFromMatrix(m);
    }
  }

  /** The piece's own motion, as a matrix in texture pixels. */
  private motion(l: Live, dt: number, effort: number) {
    const m = new Matrix();
    switch (l.piece.part.motion) {
      case 'popout': {
        // Lifts up out of the paper around its hinge and settles back: seen from the front, the side
        // away from the hinge swings in toward it (the fin foreshortens), uncovering its shadow.
        l.phase += dt * (2 + effort * 1.2);
        const lift = (0.5 - 0.5 * Math.cos(l.phase)) * 1.25; // up to about 70°
        const angle = Math.atan2(l.h2.y - l.h1.y, l.h2.x - l.h1.x);
        // Lifting toward the viewer, it also looks a little bigger along the hinge.
        return aroundPoint(l.mid, m.rotate(-angle).scale(1 + Math.sin(lift) * 0.12, Math.cos(lift)).rotate(angle));
      }
      case 'flap':
        l.phase += dt * (3 + effort);
        return aroundPoint(l.mid, m.rotate(Math.sin(l.phase) * 0.45));
      case 'spin':
        l.phase += dt * 4;
        return aroundPoint(l.centre, m.rotate(l.phase));
      case 'pulse': {
        l.phase += dt * 3;
        const s = 1 + Math.sin(l.phase) * 0.14;
        return aroundPoint(l.centre, m.scale(s, s));
      }
      case 'blink': {
        l.timer -= dt;
        let squash = 1;
        if (l.timer < 0) {
          const t = -l.timer / 0.22;
          if (t >= 1) l.timer = 2 + Math.random() * 4;
          else squash = 1 - Math.sin(t * Math.PI) * 0.9;
        }
        return aroundPoint(l.centre, m.scale(1, squash));
      }
    }
  }
}

/** Applies m around point p instead of around the origin. */
function aroundPoint(p: { x: number; y: number }, m: Matrix) {
  // prepend(x) means "then do x".
  return new Matrix(1, 0, 0, 1, -p.x, -p.y).prepend(m).prepend(new Matrix(1, 0, 0, 1, p.x, p.y));
}
