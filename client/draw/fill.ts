export const MATERIALS = ['solid', 'brick', 'stone', 'bark', 'scales', 'stripes', 'dots', 'rainbow'] as const;
export type Material = (typeof MATERIALS)[number];

export const MATERIAL_LABELS: Record<Material, string> = {
  solid: 'Solid',
  brick: 'Brick',
  stone: 'Stone',
  bark: 'Bark',
  scales: 'Scales',
  stripes: 'Stripes',
  dots: 'Dots',
  rainbow: 'Rainbow',
};

type RGB = [number, number, number];

/** Every pattern is a seamless tile of this size, painted in canvas coordinates so neighbouring fills line up. */
const TILE = 96;
const TAU = Math.PI * 2;

const hexToRgb = (hex: string): RGB => {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const mix = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const WHITE: RGB = [255, 255, 255];
const BLACK: RGB = [0, 0, 0];
const lighten = (c: RGB, t: number) => mix(c, WHITE, t);
const darken = (c: RGB, t: number) => mix(c, BLACK, t);
/** Positive t lightens, negative darkens. */
const shade = (c: RGB, t: number) => (t >= 0 ? lighten(c, t) : darken(c, -t));

function hsl(h: number, s: number, l: number): RGB {
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1));
  return [f(0) * 255, f(8) * 255, f(4) * 255];
}

/** Stable pseudo-random number in [0, 1) for integer coordinates. */
function hash(x: number, y: number, salt = 0) {
  let h = Math.imul(x * 374761393 + y * 668265263 + salt * 2246822519, 3266489917);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

const wrapDist = (a: number, b: number) => {
  const d = Math.abs(a - b) % TILE;
  return Math.min(d, TILE - d);
};

/** Colour of one pixel of a material tile. `base` gives the paint colour at that spot (it varies for rainbow paint). */
const PAINTERS: Record<Material, (x: number, y: number, base: (x: number, y: number) => RGB) => RGB> = {
  solid: (x, y, base) => base(x, y),

  rainbow: (_x, y) => hsl((y / TILE) * 360, 0.85, 0.6),

  brick: (x, y, base) => {
    const row = Math.floor(y / 16);
    const offset = row % 2 ? 16 : 0;
    const bx = (x + offset) % TILE;
    const col = Math.floor(bx / 32);
    if (y % 16 < 2 || bx % 32 < 2) return lighten(base(x, y), 0.6);
    const brickShade = (hash(col, row, 1) - 0.5) * 0.3;
    return shade(base(x, y), brickShade + (hash(x, y, 2) - 0.5) * 0.08);
  },

  stone: (x, y, base) => {
    // Cellular stones: each pixel belongs to the nearest seed point, with dark mortar where two cells meet.
    let d1 = Infinity, d2 = Infinity, nearest = 0;
    for (let i = 0; i < 9; i++) {
      const sx = hash(i, 0, 3) * TILE;
      const sy = hash(i, 1, 3) * TILE;
      const d = Math.hypot(wrapDist(x, sx), wrapDist(y, sy));
      if (d < d1) {
        d2 = d1;
        d1 = d;
        nearest = i;
      } else if (d < d2) d2 = d;
    }
    if (d2 - d1 < 2.5) return darken(base(x, y), 0.45);
    const rounded = 0.18 * Math.max(0, 1 - d1 / 22);
    return shade(base(x, y), (hash(nearest, 7, 4) - 0.5) * 0.35 + rounded + (hash(x, y, 5) - 0.5) * 0.06);
  },

  bark: (x, y, base) => {
    const wave = Math.sin((x / TILE) * TAU * 5 + 1.6 * Math.sin((y / TILE) * TAU * 2));
    if (wave > 0.82) return darken(base(x, y), 0.45);
    const streak = Math.sin((x / TILE) * TAU * 13 + Math.sin((y / TILE) * TAU * 3)) * 0.08;
    return shade(base(x, y), wave * -0.12 + streak + (hash(x, y, 6) - 0.5) * 0.08);
  },

  scales: (x, y, base) => {
    // Overlapping rows of circles; lower rows sit on top, like fish scales.
    const r = 12;
    for (let row = Math.floor(y / 12) + 1; row >= Math.floor(y / 12) - 1; row--) {
      const cy = row * 12;
      const offset = ((row % 2) + 2) % 2 ? 12 : 0;
      const cx = Math.round((x - offset) / 24) * 24 + offset;
      const d = Math.hypot(wrapDist(x, cx), wrapDist(y, cy));
      if (d < r) {
        if (d > r - 2) return darken(base(x, y), 0.35);
        return lighten(base(x, y), 0.3 * (1 - d / r));
      }
    }
    return base(x, y);
  },

  stripes: (x, y, base) => ((x + y) % 24 < 12 ? base(x, y) : lighten(base(x, y), 0.55)),

  dots: (x, y, base) => {
    const row = Math.floor(y / 24);
    const ox = row % 2 ? 12 : 0;
    const d = Math.hypot(((x + ox) % 24) - 12, (y % 24) - 12);
    return d < 6.5 ? base(x, y) : lighten(base(x, y), 0.7);
  },
};

const tileCache = new Map<string, Uint8ClampedArray>();

/** RGBA pixels of a TILE×TILE material tile in the given colour ('#rrggbb' or 'rainbow'). */
export function materialTile(material: Material, color: string): Uint8ClampedArray {
  const key = `${material}:${color}`;
  let tile = tileCache.get(key);
  if (tile) return tile;
  const fixed = color === 'rainbow' ? null : hexToRgb(color);
  const base = (_x: number, y: number) => fixed ?? hsl((y / TILE) * 360, 0.85, 0.6);
  tile = new Uint8ClampedArray(TILE * TILE * 4);
  for (let y = 0; y < TILE; y++) {
    for (let x = 0; x < TILE; x++) {
      const [r, g, b] = PAINTERS[material](x, y, base);
      const i = (y * TILE + x) * 4;
      tile[i] = r;
      tile[i + 1] = g;
      tile[i + 2] = b;
      tile[i + 3] = 255;
    }
  }
  tileCache.set(key, tile);
  return tile;
}

/** A small swatch image of the material, for the picker buttons. */
export function materialPreview(material: Material, color: string) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = TILE;
  canvas.getContext('2d')!.putImageData(new ImageData(materialTile(material, color).slice(), TILE, TILE), 0, 0);
  return canvas.toDataURL();
}

/**
 * Bucket fill from one or more seed points. Each seed floods the area of similar colour around it
 * (transparent areas count as one colour), then the area grows by one pixel so it tucks under
 * anti-aliased line edges, which are drawn back on top.
 */
export function floodFill(ctx: CanvasRenderingContext2D, seeds: { x: number; y: number }[], material: Material, color: string) {
  const { width, height } = ctx.canvas;
  const image = ctx.getImageData(0, 0, width, height);
  const d = image.data;
  const mask = new Uint8Array(width * height); // 1 = filled area, 2 = edge ring
  const stack = new Int32Array(width * height);

  for (const seed of seeds) {
    const sx = Math.floor(seed.x);
    const sy = Math.floor(seed.y);
    if (sx < 0 || sy < 0 || sx >= width || sy >= height || mask[sy * width + sx]) continue;
    const s = (sy * width + sx) * 4;
    const [r0, g0, b0, a0] = [d[s], d[s + 1], d[s + 2], d[s + 3]];
    const matches =
      a0 < 128
        ? (p: number) => d[p + 3] < 128
        : (p: number) =>
            d[p + 3] >= 128 && Math.abs(d[p] - r0) + Math.abs(d[p + 1] - g0) + Math.abs(d[p + 2] - b0) <= 90;

    let size = 0;
    const push = (i: number) => {
      if (!mask[i] && matches(i * 4)) {
        mask[i] = 1;
        stack[size++] = i;
      }
    };
    push(sy * width + sx);
    while (size > 0) {
      const i = stack[--size];
      const x = i % width;
      if (x > 0) push(i - 1);
      if (x < width - 1) push(i + 1);
      if (i >= width) push(i - width);
      if (i < width * (height - 1)) push(i + width);
    }
  }

  for (let i = 0; i < mask.length; i++) {
    if (mask[i] !== 1) continue;
    const x = i % width;
    if (x > 0 && !mask[i - 1]) mask[i - 1] = 2;
    if (x < width - 1 && !mask[i + 1]) mask[i + 1] = 2;
    if (i >= width && !mask[i - width]) mask[i - width] = 2;
    if (i < width * (height - 1) && !mask[i + width]) mask[i + width] = 2;
  }

  const tile = materialTile(material, color);
  for (let i = 0; i < mask.length; i++) {
    if (!mask[i]) continue;
    const x = i % width;
    const y = (i - x) / width;
    const t = ((y % TILE) * TILE + (x % TILE)) * 4;
    const p = i * 4;
    // The filled area takes the paint; the edge ring keeps its pixel drawn over the paint.
    const a = mask[i] === 1 ? 0 : d[p + 3] / 255;
    d[p] = d[p] * a + tile[t] * (1 - a);
    d[p + 1] = d[p + 1] * a + tile[t + 1] * (1 - a);
    d[p + 2] = d[p + 2] * a + tile[t + 2] * (1 - a);
    d[p + 3] = 255;
  }
  ctx.putImageData(image, 0, 0);
}
