import { BlurFilter, Container, Mesh, MeshPlane, Sprite, Texture, type RenderLayer } from 'pixi.js';
import { glowUrl, partsUrl, type Drawing } from '../../shared/types.ts';
import type { Parts } from './parts.ts';

/**
 * Glowing paint. The draw page stores which pixels glow in a separate image (`glowUrl`): red where the
 * paint always glows, green where it's blacklight paint, which only glows when the blacklight is on.
 * The colour comes from the drawing itself, so red glow paint glows red.
 */
export interface GlowTextures {
  glow?: Texture;
  uv?: Texture;
  /** Glowing paint on moving parts, cut out so it can move with them (positions in drawing pixels). */
  pieces: { index: number; x: number; y: number; glow?: Texture; uv?: Texture }[];
}

const loadImage = async (src: string) => {
  const image = new Image();
  image.src = src;
  await image.decode();
  return image;
};

/** Builds the glowing copies of a drawing from its picture and glow mask, with moving parts cut out separately. */
export function glowTextures(picture: CanvasImageSource, mask: CanvasImageSource, partsMask?: CanvasImageSource): GlowTextures {
  const width = (picture as HTMLImageElement).width;
  const height = (picture as HTMLImageElement).height;
  const read = (source: CanvasImageSource) => {
    const c = Object.assign(document.createElement('canvas'), { width, height }).getContext('2d', { willReadFrequently: true })!;
    c.drawImage(source, 0, 0, width, height);
    return c.getImageData(0, 0, width, height).data;
  };
  const px = read(picture);
  const marks = read(mask);
  // Moving parts swing away from where they were drawn, so their glow is cut out to move with them.
  const parts = partsMask ? read(partsMask) : null;
  const partAt = (i: number) => (parts && parts[i + 3] >= 128 ? Math.round(parts[i] / 30) - 1 : -1);
  /** The glow of one kind (channel) within a box, for part `only` (-1: everything that isn't a part). */
  const make = (channel: number, only: number, left = 0, top = 0, w = width, h = height) => {
    const out = new ImageData(w, h);
    let any = false;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = ((top + y) * width + left + x) * 4;
        if (partAt(i) !== only) continue;
        const amount = (marks[i + channel] / 255) * (marks[i + 3] / 255) * (px[i + 3] / 255);
        if (amount < 0.02) continue;
        // Brighten dark paint a little, so even dark colours have something to glow with.
        const o = (y * w + x) * 4;
        for (let k = 0; k < 3; k++) out.data[o + k] = 40 + px[i + k] * 0.85;
        out.data[o + 3] = Math.round(amount * 255);
        any = true;
      }
    }
    if (!any) return undefined;
    const canvas = Object.assign(document.createElement('canvas'), { width: w, height: h });
    canvas.getContext('2d')!.putImageData(out, 0, 0);
    return Texture.from(canvas);
  };
  // Each part's box, so its glow textures stay small.
  const boxes = new Map<number, { left: number; top: number; right: number; bottom: number }>();
  if (parts) {
    for (let i = 0; i < px.length; i += 4) {
      const index = partAt(i);
      if (index < 0) continue;
      const x = (i / 4) % width;
      const y = Math.floor(i / 4 / width);
      const b = boxes.get(index) ?? { left: x, top: y, right: x, bottom: y };
      boxes.set(index, { left: Math.min(b.left, x), top: Math.min(b.top, y), right: Math.max(b.right, x), bottom: Math.max(b.bottom, y) });
    }
  }
  const pieces = [...boxes].flatMap(([index, b]) => {
    const w = b.right - b.left + 1;
    const h = b.bottom - b.top + 1;
    const glow = make(0, index, b.left, b.top, w, h);
    const uv = make(1, index, b.left, b.top, w, h);
    return glow || uv ? [{ index, x: b.left, y: b.top, glow, uv }] : [];
  });
  return { glow: make(0, -1), uv: make(1, -1), pieces };
}

export async function loadGlow(drawing: Drawing): Promise<GlowTextures | null> {
  if (!drawing.glow) return null;
  const [picture, mask, parts] = await Promise.all([
    loadImage(`/drawings/${drawing.id}.png?v=${drawing.updatedAt ?? drawing.createdAt}`),
    loadImage(glowUrl(drawing)),
    drawing.parts?.length ? loadImage(partsUrl(drawing)) : Promise.resolve(undefined),
  ]);
  return glowTextures(picture, mask, parts);
}

/**
 * The glow on one creature: a sharp bright copy of the glowing paint plus a soft blurred halo, laid over
 * the body and bending with it. They're drawn in `layer`, above the night tint, so they shine in the dark.
 */
export class Glow {
  private nodes: { node: Container; kind: 'glow' | 'uv'; halo: boolean }[] = [];

  constructor(
    body: Container,
    private textures: GlowTextures,
    private layer: RenderLayer,
    moving?: Parts,
  ) {
    const parent = body.parent!;
    let at = parent.getChildIndex(body) + 1;
    // The halo's blur is sized by the whole drawing, so parts glow just as softly as the body.
    const width = (body as Container & { texture?: Texture }).texture?.width ?? 200;
    const add = (node: Container, kind: 'glow' | 'uv', halo: boolean) => {
      node.blendMode = 'add';
      if (halo) node.filters = [new BlurFilter({ strength: Math.max(6, width * 0.03), quality: 3 })];
      layer.attach(node);
      this.nodes.push({ node, kind, halo });
    };
    for (const kind of ['glow', 'uv'] as const) {
      const texture = textures[kind];
      if (!texture) continue;
      for (const halo of [true, false]) {
        const node = copyOf(body, texture);
        parent.addChildAt(node, at++);
        add(node, kind, halo);
      }
    }
    // Glowing paint on a moving part rides in the part's own holder, so it moves with it.
    for (const piece of textures.pieces) {
      const holder = moving?.holderFor(piece.index);
      if (!holder) continue;
      for (const kind of ['glow', 'uv'] as const) {
        const texture = piece[kind];
        if (!texture) continue;
        for (const halo of [true, false]) {
          const node = new Sprite({ texture, position: { x: piece.x, y: piece.y } });
          holder.addChild(node);
          add(node, kind, halo);
        }
      }
    }
  }

  /** Where it sits among the glows and covers in the glow layer (see Cover). */
  order(z: number) {
    for (const { node } of this.nodes) node.zIndex = z;
  }

  /** How brightly each kind glows right now (0 = not at all). */
  update(glow: number, uv: number) {
    for (const { node, kind, halo } of this.nodes) {
      const level = kind === 'glow' ? glow : uv;
      node.visible = level > 0.01;
      node.alpha = Math.min(1, level * (halo ? 1 : 0.55));
    }
  }

  /** keepTextures: they're shared (the tank shares a species' pictures between all of it). */
  destroy(keepTextures = false) {
    for (const { node } of this.nodes) {
      if (node.destroyed) continue;
      this.layer.detach(node);
      node.destroy();
    }
    if (keepTextures) return;
    for (const t of [this.textures, ...this.textures.pieces]) {
      t.glow?.destroy(true);
      t.uv?.destroy(true);
    }
  }
}

/**
 * Glows are drawn above the night tint, so without this they'd shine through creatures passing in front.
 * A Cover is a copy of a creature's body, dimmed as the night tint dims it, drawn in the glow layer at the
 * creature's depth: a creature in front covers the glow of one behind, just as it covers its body. What's
 * drawn on top of the body (moving parts, eyes and other extras) moves into the glow layer too while the
 * cover's on, just above the copy, or the copy would hide it (a shell's lid under the patch it lifts off).
 */
export class Cover {
  private node: Container & { tint: number };
  /** The things on top of the body, while they're lifted into the glow layer. */
  private lifted: Container[] = [];

  constructor(
    private body: Container & { tint: number; texture: Texture },
    private layer: RenderLayer,
  ) {
    this.node = copyOf(body, body.texture) as Container & { tint: number };
    body.parent!.addChildAt(this.node, body.parent!.getChildIndex(body));
    layer.attach(this.node);
  }

  /** dim: how much the night tint darkens it (0 = not at all). */
  update(on: boolean, z: number, dim: number) {
    this.node.visible = on;
    if (!on) {
      this.drop();
      return;
    }
    if (!this.lifted.length) this.lift();
    const k = 1 - dim;
    const dimmed = (t: number) => {
      const ch = (shift: number) => Math.round(((t >> shift) & 255) * k) << shift;
      return ch(16) | ch(8) | ch(0);
    };
    this.node.zIndex = z;
    this.node.tint = dimmed(this.body.tint);
    for (const extra of this.lifted) {
      extra.zIndex = z;
      extra.tint = dimmed(0xffffff);
    }
  }

  /** Everything after the body in its parent that isn't already in a layer (the glow's copies are). */
  private lift() {
    const parent = this.body.parent;
    if (!parent) return;
    this.lifted = parent.children.slice(parent.getChildIndex(this.body) + 1).filter((c) => !c.parentRenderLayer);
    // Attached after the copy, so at the same depth they're drawn over it.
    for (const extra of this.lifted) this.layer.attach(extra);
  }

  private drop() {
    for (const extra of this.lifted) {
      if (extra.destroyed) continue;
      this.layer.detach(extra);
      extra.tint = 0xffffff;
    }
    this.lifted = [];
  }

  destroy() {
    this.drop();
    if (this.node.destroyed) return;
    this.layer.detach(this.node);
    this.node.destroy();
  }
}

/** A copy of the body (a bent mesh or a sprite) showing another texture, moving exactly with it. */
function copyOf(body: Container, texture: Texture): Container {
  if (body instanceof MeshPlane || body instanceof Mesh) {
    // Sharing the geometry means every bend of the body bends the glow too.
    const mesh = new Mesh({ geometry: body.geometry, texture });
    mesh.pivot.copyFrom(body.pivot);
    mesh.position.copyFrom(body.position);
    return mesh;
  }
  const sprite = body as Sprite;
  const copy = new Sprite({ texture, anchor: sprite.anchor });
  copy.position.copyFrom(sprite.position);
  return copy;
}
