import { imageUrl, type Drawing, type NewEgg } from '../../shared/types.ts';

/** Babies hatch a bit over half size and grow up over their first week. */
export function babyScale(drawing: Drawing, now = Date.now()) {
  if (!drawing.parents) return 1;
  const days = (now - (drawing.hatchAt ?? drawing.createdAt)) / 86_400_000;
  return 0.6 + 0.35 * Math.min(1, Math.max(0, days) / 7);
}

const loadImage = async (src: string) => {
  const image = new Image();
  image.src = src;
  await image.decode();
  return image;
};

/** Smooth 0 → 1 between edge0 and edge1. */
const smoothstep = (edge0: number, edge1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
};

/**
 * A baby that takes after both parents: the front half (with the head) from one, the tail end from the
 * other, their shapes and colours melting together in the middle. Both drawings face right, so lining
 * them up in the same box puts heads with heads and tails with tails.
 */
export async function blendParents(head: Drawing, tail: Drawing): Promise<HTMLCanvasElement> {
  const [a, b] = await Promise.all([loadImage(imageUrl(head)), loadImage(imageUrl(tail))]);
  const width = Math.round((a.width + b.width) / 2);
  const height = Math.round((a.height + b.height) / 2);
  const read = (image: HTMLImageElement) => {
    const c = Object.assign(document.createElement('canvas'), { width, height }).getContext('2d', { willReadFrequently: true })!;
    c.drawImage(image, 0, 0, width, height);
    return c.getImageData(0, 0, width, height).data;
  };
  const h = read(a);
  const t = read(b);
  const canvas = Object.assign(document.createElement('canvas'), { width, height });
  const ctx = canvas.getContext('2d')!;
  const out = ctx.createImageData(width, height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      // How much of this spot comes from the head parent: all of it at the front, none at the tail.
      const w = smoothstep(0.3, 0.7, x / width);
      const ah = (h[i + 3] / 255) * w;
      const at = (t[i + 3] / 255) * (1 - w);
      const alpha = ah + at;
      if (alpha <= 0) continue;
      for (let k = 0; k < 3; k++) out.data[i + k] = (h[i + k] * ah + t[i + k] * at) / alpha;
      // Keep edges crisp rather than ghostly where the two outlines don't quite agree.
      out.data[i + 3] = Math.round(Math.min(1, Math.max(0, (alpha - 0.3) / 0.35)) * 255);
    }
  }
  ctx.putImageData(out, 0, 0);
  return canvas;
}

/** "Bubbles" and "Nemo" have a "Bubbmo". */
export function blendName(head: string, tail: string) {
  const front = head.trim().slice(0, Math.ceil(head.trim().length / 2));
  const back = tail.trim().slice(Math.floor(tail.trim().length / 2)).toLowerCase();
  let name = (front + back).replace(/\s+/g, ' ').trim();
  name = name.charAt(0).toUpperCase() + name.slice(1);
  if (name.length < 3 || name === head || name === tail) name = `${head} Jr.`;
  return name.slice(0, 40);
}

/** Everything the server needs to lay an egg for these two parents. nest is where across the tank (0..1). */
export async function makeEgg(mum: Drawing, dad: Drawing, nest: number): Promise<NewEgg> {
  // Either parent may give the head.
  const [head, tail] = Math.random() < 0.5 ? [mum, dad] : [dad, mum];
  const canvas = await blendParents(head, tail);
  return {
    motion: 'fish',
    name: blendName(head.name, tail.name),
    artist: mum.artist === dad.artist ? mum.artist : `${mum.artist} & ${dad.artist}`,
    image: canvas.toDataURL('image/png'),
    nocturnal: mum.nocturnal === true && dad.nocturnal === true,
    parents: [mum.id, dad.id],
    nest,
  };
}
