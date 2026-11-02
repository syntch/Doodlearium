export const MATERIALS = [
  'solid', 'brick', 'stone', 'wood', 'bark', 'scales', 'feathers', 'fur', 'hair', 'wool', 'patches', 'stripes', 'dots', 'rainbow',
] as const;
export type Material = (typeof MATERIALS)[number];

export const MATERIAL_LABELS: Record<Material, string> = {
  solid: 'Solid',
  brick: 'Brick',
  stone: 'Stone',
  wood: 'Wood',
  bark: 'Bark',
  scales: 'Scales',
  feathers: 'Feathers',
  fur: 'Fur',
  hair: 'Hair',
  wool: 'Wool',
  patches: 'Patches',
  stripes: 'Stripes',
  dots: 'Dots',
  rainbow: 'Rainbow',
};

/**
 * Which ways a material can be turned: quarter turns clockwise, with an arrow for the button. Scales
 * and feathers point the way their rounded edges do, fur the way it lies; the others run along (↔) or
 * up and down (↕).
 */
export const MATERIAL_TURNS: Partial<Record<Material, { turn: number; label: string; title: string }[]>> = {
  scales: [
    { turn: 0, label: '⬇', title: 'Scales point down' },
    { turn: 1, label: '⬅', title: 'Scales point left' },
    { turn: 2, label: '⬆', title: 'Scales point up' },
    { turn: 3, label: '➡', title: 'Scales point right' },
  ],
  feathers: [
    { turn: 0, label: '⬇', title: 'Feathers point down' },
    { turn: 1, label: '⬅', title: 'Feathers point left' },
    { turn: 2, label: '⬆', title: 'Feathers point up' },
    { turn: 3, label: '➡', title: 'Feathers point right' },
  ],
  fur: [
    { turn: 0, label: '⬇', title: 'Fur lies down' },
    { turn: 1, label: '⬅', title: 'Fur lies to the left' },
    { turn: 2, label: '⬆', title: 'Fur sticks up' },
    { turn: 3, label: '➡', title: 'Fur lies to the right' },
  ],
  hair: [
    { turn: 0, label: '↕', title: 'Hair hangs down' },
    { turn: 1, label: '↔', title: 'Hair flows across' },
  ],
  wood: [
    { turn: 0, label: '↔', title: 'Planks run across' },
    { turn: 1, label: '↕', title: 'Planks run up and down' },
  ],
  bark: [
    { turn: 0, label: '↕', title: 'Grain runs up and down' },
    { turn: 1, label: '↔', title: 'Grain runs across' },
  ],
  brick: [
    { turn: 0, label: '↔', title: 'Rows run across' },
    { turn: 1, label: '↕', title: 'Rows run up and down' },
  ],
  stripes: [
    { turn: 0, label: '⟋', title: 'Stripes lean right' },
    { turn: 1, label: '⟍', title: 'Stripes lean left' },
  ],
  rainbow: [
    { turn: 0, label: '↔', title: 'Bands run across' },
    { turn: 1, label: '↕', title: 'Bands run up and down' },
  ],
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
/** a - b the short way round the tile, from -TILE/2 to TILE/2. */
const wrapDiff = (a: number, b: number) => {
  const d = (a - b) % TILE;
  return d > TILE / 2 ? d - TILE : d < -TILE / 2 ? d + TILE : d;
};
/** A grid cell's index wrapped to the tile, so cells near the edges match the far side. */
const cell = (i: number, size: number) => ((i % (TILE / size)) + TILE / size) % (TILE / size);

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

  wood: (x, y, base) => {
    // Horizontal planks, 24px tall, each with one staggered end joint per tile and its own shade.
    const board = Math.floor(y / 24);
    const inBoard = y % 24;
    const joint = Math.floor(hash(board, 0, 8) * TILE);
    if (inBoard < 2 || wrapDist(x, joint) < 1.2) return darken(base(x, y), 0.5);
    // A knot on one board per tile, with grain rings around it.
    const kx = hash(0, 1, 9) * TILE;
    const ky = Math.floor(hash(0, 2, 9) * 4) * 24 + 12;
    const knotDist = Math.hypot(wrapDist(x, kx) * 0.55, wrapDist(y, ky));
    if (Math.floor(y / 24) === Math.floor(ky / 24) && knotDist < 7) {
      return darken(base(x, y), knotDist < 2.5 ? 0.45 : 0.18 + 0.12 * Math.sin(knotDist * 2.2));
    }
    const grain = Math.sin((inBoard + board * 7) * 0.9 + 1.4 * Math.sin((x / TILE) * TAU * 2 + board));
    const boardShade = (hash(board, 3, 10) - 0.5) * 0.18;
    return shade(base(x, y), boardShade + (grain > 0.75 ? -0.16 : grain * 0.04) + (hash(x, y, 11) - 0.5) * 0.05);
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

  feathers: (x, y, base) => {
    // Rows of feathers, tips pointing down, each row's tips lying over the row below (like roof tiles).
    for (let row = Math.ceil(y / 12); row <= Math.floor((y + 30) / 12); row++) {
      const dy = row * 12 - y; // 0 at the tip, 30 at the base
      if (dy < 0 || dy > 30) continue;
      const offset = ((row % 2) + 2) % 2 ? 12 : 0;
      const dx = Math.abs(x - (Math.round((x - offset) / 24) * 24 + offset));
      // A rounded point at the tip, full width further up.
      const half = 12.5 * Math.sin(Math.min(1, dy / 14) * (Math.PI / 2));
      if (dx > half) continue;
      const c = base(x, y);
      if (dx > half - 1.5) return darken(c, 0.4);
      // The shaft down the middle, and barbs slanting out from it.
      if (dx < 0.8 && dy > 3) return lighten(c, 0.3);
      const barb = (dy - dx * 0.7 + 40) % 3 < 0.9 ? -0.12 : 0;
      // Lighter toward the tip, darker where the next row up tucks under.
      return shade(c, 0.3 - (dy / 30) * 0.5 - (dx / 12) * 0.08 + barb);
    }
    return darken(base(x, y), 0.25);
  },

  fur: (x, y, base) => {
    // Short strands: each square of an 8px grid sprouts one that hangs down, a little to one side.
    let strand = 0;
    const cx = Math.floor(x / 8);
    const cy = Math.floor(y / 8);
    for (let j = -2; j <= 0; j++) {
      for (let i = -1; i <= 1; i++) {
        const hi = cell(cx + i, 8);
        const hj = cell(cy + j, 8);
        const angle = Math.PI / 2 + (hash(hi, hj, 22) - 0.5) * 0.8;
        const len = 10 + hash(hi, hj, 23) * 6;
        const dx = x - ((cx + i) * 8 + hash(hi, hj, 20) * 8);
        const dy = y - ((cy + j) * 8 + hash(hi, hj, 21) * 8);
        const along = dx * Math.cos(angle) + dy * Math.sin(angle);
        if (along < 0 || along > len) continue;
        // Thinning toward the tip.
        if (Math.abs(dy * Math.cos(angle) - dx * Math.sin(angle)) < 1.3 * (1 - (along / len) * 0.6)) {
          strand = hash(hi, hj, 24) < 0.5 ? -0.28 : 0.22;
        }
      }
    }
    return shade(base(x, y), strand || -0.06 + (hash(x, y, 25) - 0.5) * 0.08);
  },

  hair: (x, y, base) => {
    // Long locks flowing down in gentle waves, strand by strand, with a shine across them.
    const u = (((x + 4 * Math.sin((y / TILE) * TAU * 2 + Math.sin((x / TILE) * TAU) * 1.5)) % TILE) + TILE) % TILE;
    const strand = Math.floor(u / 4);
    const edge = u % 4 < 0.9 ? -0.2 : 0;
    const shine = Math.sin((y / TILE) * TAU + strand * 0.4) > 0.8 ? 0.16 : 0;
    return shade(base(x, y), (hash(strand, 0, 30) - 0.5) * 0.3 + edge + shine + (hash(x, y, 31) - 0.5) * 0.05);
  },

  wool: (x, y, base) => {
    // Little curls packed together: round bumps, each with a curl line winding into it.
    let d1 = Infinity, d2 = Infinity, near = { x: 0, y: 0, k: 0 };
    const cx = Math.floor(x / 12);
    const cy = Math.floor(y / 12);
    for (let j = -1; j <= 1; j++) {
      for (let i = -1; i <= 1; i++) {
        const hi = cell(cx + i, 12);
        const hj = cell(cy + j, 12);
        const sx = (cx + i) * 12 + 2 + hash(hi, hj, 40) * 8;
        const sy = (cy + j) * 12 + 2 + hash(hi, hj, 41) * 8;
        const d = Math.hypot(x - sx, y - sy);
        if (d < d1) {
          d2 = d1;
          d1 = d;
          near = { x: sx, y: sy, k: hi * 8 + hj };
        } else if (d < d2) d2 = d;
      }
    }
    const c = base(x, y);
    if (d2 - d1 < 1.2) return darken(c, 0.22);
    const turn = (Math.atan2(y - near.y, x - near.x) / TAU + hash(near.k, 0, 42) + 1) % 1;
    const curl = d1 < 6.5 && (d1 - turn * 3.2 + 6.4) % 3.2 < 0.8 ? -0.2 : 0;
    return shade(c, 0.25 * (1 - d1 / 9) - 0.05 + curl);
  },

  patches: (x, y, base) => {
    // Big blotches with wobbly edges, like a cow's or a giraffe's.
    let inside = false;
    for (let i = 0; i < 5 && !inside; i++) {
      const dx = wrapDiff(x, hash(i, 0, 50) * TILE);
      const dy = wrapDiff(y, hash(i, 1, 50) * TILE);
      const a = Math.atan2(dy, dx);
      const r = (11 + hash(i, 2, 50) * 8) * (1 + 0.22 * Math.sin(a * 3 + i) + 0.12 * Math.sin(a * 5 + i * 2));
      inside = Math.hypot(dx, dy) < r;
    }
    const c = base(x, y);
    return inside ? darken(c, 0.62) : shade(c, (hash(x, y, 51) - 0.5) * 0.05);
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
export function materialTile(material: Material, color: string, turn = 0): Uint8ClampedArray {
  const key = `${material}:${color}:${turn}`;
  let tile = tileCache.get(key);
  if (tile) return tile;
  const fixed = color === 'rainbow' ? null : hexToRgb(color);
  const base = (_x: number, y: number) => fixed ?? hsl((y / TILE) * 360, 0.85, 0.6);
  tile = new Uint8ClampedArray(TILE * TILE * 4);
  for (let y = 0; y < TILE; y++) {
    for (let x = 0; x < TILE; x++) {
      // A turned tile reads each pixel from where it was before turning (tiles are square, so it stays seamless).
      const [sx, sy] = [[x, y], [y, TILE - 1 - x], [TILE - 1 - x, TILE - 1 - y], [TILE - 1 - y, x]][turn & 3];
      const [r, g, b] = PAINTERS[material](sx, sy, base);
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
export function materialPreview(material: Material, color: string, turn = 0) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = TILE;
  canvas.getContext('2d')!.putImageData(new ImageData(materialTile(material, color, turn).slice(), TILE, TILE), 0, 0);
  return canvas.toDataURL();
}

/**
 * The area of similar colour around each seed (transparent areas count as one colour), plus a one-pixel
 * ring around it so fills tuck under anti-aliased line edges. In the result, 1 = area and 2 = ring.
 */
export function floodRegion(image: ImageData, seeds: { x: number; y: number }[]) {
  const { width, height } = image;
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
  return mask;
}

/**
 * Bucket fill from one or more seed points: the flood region takes the paint, and its edge ring keeps
 * its line drawn over the paint. Colour 'clear' makes the area see-through instead.
 * Returns the region (see floodRegion) so the caller can track see-through parts.
 */
export function floodFill(
  ctx: CanvasRenderingContext2D,
  seeds: { x: number; y: number }[],
  material: Material,
  color: string,
  turn = 0,
) {
  const { width, height } = ctx.canvas;
  const image = ctx.getImageData(0, 0, width, height);
  const d = image.data;
  const mask = floodRegion(image, seeds);

  if (color === 'clear') {
    for (let i = 0; i < mask.length; i++) if (mask[i] === 1) d[i * 4 + 3] = 0;
    ctx.putImageData(image, 0, 0);
    return mask;
  }

  const tile = materialTile(material, color, turn);
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
  return mask;
}
