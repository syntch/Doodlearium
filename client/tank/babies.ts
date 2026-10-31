import { MAX_ATTACHMENTS, MAX_PARTS, glowUrl, imageUrl, partsUrl, type Attachment, type Drawing, type NewEgg, type Part } from '../../shared/types.ts';

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

/** A parent's picture, plus its moving-parts and glow images when it has them. */
const loadParent = async (d: Drawing) => {
  const [picture, parts, glow] = await Promise.all([
    loadImage(imageUrl(d)),
    d.parts?.length ? loadImage(partsUrl(d)) : null,
    d.glow ? loadImage(glowUrl(d)) : null,
  ]);
  return { picture, parts, glow };
};

const toCanvas = (out: ImageData) => {
  const canvas = Object.assign(document.createElement('canvas'), { width: out.width, height: out.height });
  canvas.getContext('2d')!.putImageData(out, 0, 0);
  return canvas;
};

/** Stored drawings face right, so the front (head) half is x ≥ 0.5. */
const midX = (p: Part) => (p.hinge[0] + p.hinge[2]) / 2;

export interface Blend {
  image: HTMLCanvasElement;
  /** The head parent's moving parts from the front half, the tail parent's from the back. */
  parts: Part[];
  partsImage?: HTMLCanvasElement;
  glowImage?: HTMLCanvasElement;
}

/**
 * A baby that takes after both parents: the front half (with the head) from one, the tail end from the
 * other, their shapes and colours melting together in the middle. Both drawings face right, so lining
 * them up in the same box puts heads with heads and tails with tails. Moving parts and glowing paint
 * come along from whichever half they were on.
 */
export async function blendParents(head: Drawing, tail: Drawing): Promise<Blend> {
  const [a, b] = await Promise.all([loadParent(head), loadParent(tail)]);
  const width = Math.round((a.picture.width + b.picture.width) / 2);
  const height = Math.round((a.picture.height + b.picture.height) / 2);
  const read = (image: HTMLImageElement | null) => {
    if (!image) return null;
    const c = Object.assign(document.createElement('canvas'), { width, height }).getContext('2d', { willReadFrequently: true })!;
    // Part marks must stay exact values, so no smoothing between them.
    c.imageSmoothingEnabled = image !== a.parts && image !== b.parts;
    c.drawImage(image, 0, 0, width, height);
    return c.getImageData(0, 0, width, height).data;
  };
  const h = read(a.picture)!;
  const t = read(b.picture)!;
  const hg = read(a.glow);
  const tg = read(b.glow);
  const hp = read(a.parts);
  const tp = read(b.parts);

  // Both parents' moving parts come along (a wagging tail moves whichever tail the baby got), the ones on
  // the half each parent gave first. Each gets a new number in the baby's part image.
  const listed = (d: Drawing, from: 'head' | 'tail') => (d.parts ?? []).map((p, i) => ({ p, i, from }));
  const own = (x: { p: Part; from: string }) => (midX(x.p) >= 0.5) === (x.from === 'head');
  const all = [...listed(head, 'head'), ...listed(tail, 'tail')];
  const kept = [...all.filter(own), ...all.filter((x) => !own(x))].slice(0, MAX_PARTS);
  const renumber = { head: new Map<number, number>(), tail: new Map<number, number>() };
  kept.forEach(({ i, from }, n) => renumber[from as 'head' | 'tail'].set((i + 1) * 30, (n + 1) * 30));
  const partValue = (marks: Uint8ClampedArray | null, map: Map<number, number>, i: number) => {
    if (!marks || marks[i + 3] < 128) return 0;
    return map.get(Math.round(marks[i] / 30) * 30) ?? 0;
  };

  const out = new ImageData(width, height);
  const glowOut = new ImageData(width, height);
  const partsOut = new ImageData(width, height);
  let glows = false;
  const used = new Set<number>();
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
      if (hg || tg) {
        for (const k of [0, 1]) {
          const v = ((hg ? hg[i + k] * (hg[i + 3] / 255) : 0) * ah + (tg ? tg[i + k] * (tg[i + 3] / 255) : 0) * at) / alpha;
          glowOut.data[i + k] = v;
          if (v > 8) glows = true;
        }
        glowOut.data[i + 3] = 255;
      }
      // Where both parents have a part, the one whose half this is wins.
      const fromHead = partValue(hp, renumber.head, i);
      const fromTail = partValue(tp, renumber.tail, i);
      const part = w >= 0.5 ? fromHead || fromTail : fromTail || fromHead;
      if (part) {
        partsOut.data[i] = part;
        partsOut.data[i + 3] = 255;
        used.add(part);
      }
    }
  }
  // Parts squeezed out entirely by the other parent's are dropped, and the rest numbered without gaps.
  const parts: Part[] = [];
  const final = new Map<number, number>();
  kept.forEach(({ p }, n) => {
    if (!used.has((n + 1) * 30)) return;
    parts.push(p);
    final.set((n + 1) * 30, parts.length * 30);
  });
  for (let i = 0; i < partsOut.data.length; i += 4) if (partsOut.data[i + 3]) partsOut.data[i] = final.get(partsOut.data[i]) ?? 0;
  return {
    image: toCanvas(out),
    parts,
    partsImage: parts.length ? toCanvas(partsOut) : undefined,
    glowImage: glows ? toCanvas(glowOut) : undefined,
  };
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
  const blend = await blendParents(head, tail);
  // Babies get both parents' extras (so nobody's born without their googly eyes). Where two of the same kind
  // would land on top of each other, the one from the parent that gave that half wins.
  const fromHead = head.attachments ?? [];
  const fromTail = tail.attachments ?? [];
  const candidates = [
    ...fromHead.filter((a) => a.x >= 0.5),
    ...fromTail.filter((a) => a.x < 0.5),
    ...fromHead.filter((a) => a.x < 0.5),
    ...fromTail.filter((a) => a.x >= 0.5),
  ];
  const attachments: Attachment[] = [];
  for (const a of candidates) {
    const clash = attachments.some((b) => b.kind === a.kind && Math.hypot(b.x - a.x, b.y - a.y) < 0.15);
    if (!clash && attachments.length < MAX_ATTACHMENTS) attachments.push(a);
  }
  return {
    motion: 'fish',
    name: blendName(head.name, tail.name),
    artist: mum.artist === dad.artist ? mum.artist : `${mum.artist} & ${dad.artist}`,
    image: blend.image.toDataURL('image/png'),
    attachments,
    parts: blend.parts,
    partsImage: blend.partsImage?.toDataURL('image/png'),
    glowImage: blend.glowImage?.toDataURL('image/png'),
    nocturnal: mum.nocturnal === true && dad.nocturnal === true,
    parents: [mum.id, dad.id],
    nest,
  };
}
