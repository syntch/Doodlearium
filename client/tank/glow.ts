import { BlurFilter, Container, Mesh, MeshPlane, Sprite, Texture, type RenderLayer } from 'pixi.js';
import { glowUrl, partsUrl, type Drawing } from '../../shared/types.ts';

/**
 * Glowing paint. The draw page stores which pixels glow in a separate image (`glowUrl`): red where the
 * paint always glows, green where it's blacklight paint, which only glows when the blacklight is on.
 * The colour comes from the drawing itself, so red glow paint glows red.
 */
export interface GlowTextures {
  glow?: Texture;
  uv?: Texture;
}

const loadImage = async (src: string) => {
  const image = new Image();
  image.src = src;
  await image.decode();
  return image;
};

/** Builds the glowing copies of a drawing from its picture and glow mask (and leaves moving parts out). */
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
  // Moving parts swing away from where they were drawn, so their glow would be left behind.
  const parts = partsMask ? read(partsMask) : null;
  const make = (channel: number) => {
    const out = new ImageData(width, height);
    let any = false;
    for (let i = 0; i < px.length; i += 4) {
      if (parts && parts[i + 3] >= 128) continue;
      const amount = (marks[i + channel] / 255) * (marks[i + 3] / 255) * (px[i + 3] / 255);
      if (amount < 0.02) continue;
      // Brighten dark paint a little, so even dark colours have something to glow with.
      for (let k = 0; k < 3; k++) out.data[i + k] = 40 + px[i + k] * 0.85;
      out.data[i + 3] = Math.round(amount * 255);
      any = true;
    }
    if (!any) return undefined;
    const canvas = Object.assign(document.createElement('canvas'), { width, height });
    canvas.getContext('2d')!.putImageData(out, 0, 0);
    return Texture.from(canvas);
  };
  return { glow: make(0), uv: make(1) };
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
  ) {
    const parent = body.parent!;
    let at = parent.getChildIndex(body) + 1;
    for (const kind of ['glow', 'uv'] as const) {
      const texture = textures[kind];
      if (!texture) continue;
      for (const halo of [true, false]) {
        const node = copyOf(body, texture);
        node.blendMode = 'add';
        if (halo) node.filters = [new BlurFilter({ strength: Math.max(6, texture.width * 0.03), quality: 3 })];
        parent.addChildAt(node, at++);
        layer.attach(node);
        this.nodes.push({ node, kind, halo });
      }
    }
  }

  /** How brightly each kind glows right now (0 = not at all). */
  update(glow: number, uv: number) {
    for (const { node, kind, halo } of this.nodes) {
      const level = kind === 'glow' ? glow : uv;
      node.visible = level > 0.01;
      node.alpha = Math.min(1, level * (halo ? 1 : 0.55));
    }
  }

  destroy() {
    for (const { node } of this.nodes) {
      if (node.destroyed) continue;
      this.layer.detach(node);
      node.destroy();
    }
    this.textures.glow?.destroy(true);
    this.textures.uv?.destroy(true);
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
