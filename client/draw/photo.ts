/**
 * Turns a photo of a drawing on paper into a transparent-background drawing.
 *
 * Phone photos have uneven light (shadows, a lamp on one side), so a single "paper colour" doesn't work.
 * Instead the paper colour is estimated per small block from its brightest pixels, spread across
 * neighbouring blocks (so a block that is all ink still finds paper nearby), and smoothly interpolated.
 * Each pixel is then compared with the paper behind it: dark or colourful compared to the paper means ink.
 */

const BLOCK = 24;

export async function readPhoto(file: File): Promise<ImageBitmap> {
  // 'from-image' honours the phone's rotation metadata so portrait photos aren't sideways.
  return createImageBitmap(file, { imageOrientation: 'from-image' });
}

/**
 * @param strength 1 (gentle: keeps faint pencil lines) .. 10 (strong: removes shadows and smudges).
 */
export function removePaper(photo: ImageBitmap, maxW: number, maxH: number, strength: number): HTMLCanvasElement {
  const scale = Math.min(1, maxW / photo.width, maxH / photo.height);
  const width = Math.max(1, Math.round(photo.width * scale));
  const height = Math.max(1, Math.round(photo.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(photo, 0, 0, width, height);
  const image = ctx.getImageData(0, 0, width, height);
  const d = image.data;

  const paper = paperMap(d, width, height);
  const t0 = 0.06 + strength * 0.022;
  const t1 = t0 + 0.1;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const p = (y * width + x) * 4;
      const [pr, pg, pb] = paper(x, y);
      const r = Math.min(1.2, d[p] / pr);
      const g = Math.min(1.2, d[p + 1] / pg);
      const b = Math.min(1.2, d[p + 2] / pb);
      const darkness = 1 - (0.3 * r + 0.59 * g + 0.11 * b);
      const colourfulness = Math.max(r, g, b) - Math.min(r, g, b);
      const ink = Math.max(darkness, colourfulness * 1.1);
      const alpha = smoothstep(t0, t1, ink);
      // White-balanced against the paper, and deepened a little: photos make marker colours look washed out.
      d[p] = 255 * Math.pow(Math.min(1, r), 1.4);
      d[p + 1] = 255 * Math.pow(Math.min(1, g), 1.4);
      d[p + 2] = 255 * Math.pow(Math.min(1, b), 1.4);
      d[p + 3] = 255 * alpha;
    }
  }
  ctx.putImageData(image, 0, 0);
  return canvas;
}

const smoothstep = (a: number, b: number, v: number) => {
  const t = Math.min(1, Math.max(0, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** Paper colour estimate at any pixel, interpolated between block centres. */
function paperMap(d: Uint8ClampedArray, width: number, height: number) {
  const cols = Math.ceil(width / BLOCK);
  const rows = Math.ceil(height / BLOCK);
  const blocks: [number, number, number][] = [];

  // Per block: average colour of its brightest 20% of pixels.
  for (let by = 0; by < rows; by++) {
    for (let bx = 0; bx < cols; bx++) {
      const pixels: number[] = [];
      for (let y = by * BLOCK; y < Math.min(height, (by + 1) * BLOCK); y++) {
        for (let x = bx * BLOCK; x < Math.min(width, (bx + 1) * BLOCK); x++) pixels.push((y * width + x) * 4);
      }
      const lum = (p: number) => 0.3 * d[p] + 0.59 * d[p + 1] + 0.11 * d[p + 2];
      pixels.sort((a, b) => lum(b) - lum(a));
      const top = pixels.slice(0, Math.max(1, Math.floor(pixels.length * 0.2)));
      const sum = top.reduce((s, p) => [s[0] + d[p], s[1] + d[p + 1], s[2] + d[p + 2]], [0, 0, 0]);
      blocks.push(sum.map((v) => Math.max(1, v / top.length)) as [number, number, number]);
    }
  }

  // A block covered in ink has no paper of its own: take the brightest block within two blocks of it.
  const spread = blocks.map((_, i) => {
    const bx = i % cols;
    const by = Math.floor(i / cols);
    let best = blocks[i];
    for (let y = Math.max(0, by - 2); y <= Math.min(rows - 1, by + 2); y++) {
      for (let x = Math.max(0, bx - 2); x <= Math.min(cols - 1, bx + 2); x++) {
        const c = blocks[y * cols + x];
        if (c[0] + c[1] + c[2] > best[0] + best[1] + best[2]) best = c;
      }
    }
    return best;
  });

  return (x: number, y: number): [number, number, number] => {
    const gx = Math.min(cols - 1, Math.max(0, x / BLOCK - 0.5));
    const gy = Math.min(rows - 1, Math.max(0, y / BLOCK - 0.5));
    const x0 = Math.floor(gx), y0 = Math.floor(gy);
    const x1 = Math.min(cols - 1, x0 + 1), y1 = Math.min(rows - 1, y0 + 1);
    const fx = gx - x0, fy = gy - y0;
    const a = spread[y0 * cols + x0], b = spread[y0 * cols + x1];
    const c = spread[y1 * cols + x0], e = spread[y1 * cols + x1];
    return [0, 1, 2].map(
      (k) => (a[k] * (1 - fx) + b[k] * fx) * (1 - fy) + (c[k] * (1 - fx) + e[k] * fx) * fy,
    ) as [number, number, number];
  };
}
