import type { Graphics } from 'pixi.js';
import type { Look } from '../../shared/world/looks.ts';
import { TAU, seededRandom, type World } from './world.ts';

/**
 * The space kinds of place, drawn in code like Earth's and coloured by the place's look (shared/world/looks.ts):
 * 🌌 open space, 🏙️ a space station, 🌑 a moon and 🌺 an alien garden.
 */

/** How far the screen sees, in tank units (screens of another shape see past the tank's edges). */
export interface Span {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

const mix = (a: number, b: number, t: number) => {
  const ch = (shift: number) => Math.round(((a >> shift) & 255) + ((((b >> shift) & 255) - ((a >> shift) & 255)) * t));
  return (ch(16) << 16) | (ch(8) << 8) | ch(0);
};
const floorOf = (world: World) => (x: number) => world.floorAt(Math.min(world.width, Math.max(0, x)));

/** Where the sky stops: the far edge of the ground, or (out in open space) the asteroids. */
const skyBottom = (world: World, x: number) => floorOf(world)(x) - (world.land ? 10 : 30);

/** Behind everything, drawn once: stars and nebula, then a planet, the station's halls, or the garden's giants. */
export function drawSpaceBack(g: Graphics, world: World, span: Span, look: Look, biome: string) {
  const rand = seededRandom(`space:${biome}:${look.id}`);
  const { left, right, top } = span;
  const width = right - left;
  // A station has a roof over its sky, except for the gleaming city out in the open air.
  const bright = biome === 'garden' || look.id === 'gleaming' || (biome === 'moon' && look.id === 'icy');
  // Nebula clouds: soft overlapping blobs of the look's two accents.
  for (let i = 0; i < 7; i++) {
    const x = rand(left, right);
    const y = rand(top, world.height * 0.5);
    const r = rand(120, 260);
    const color = i % 2 ? look.accent : look.accent2;
    for (let k = 0; k < 4; k++) g.circle(x + rand(-r, r) * 0.5, y + rand(-r, r) * 0.3, r * rand(0.5, 1)).fill({ color, alpha: bright ? 0.04 : 0.07 });
  }
  // Stars (only a few show through a bright sky).
  for (let i = 0; i < (bright ? 40 : 220); i++) {
    const x = rand(left, right);
    const y = rand(top, skyBottom(world, x));
    const r = rand() < 0.08 ? rand(1.8, 2.8) : rand(0.6, 1.6);
    g.circle(x, y, r).fill({ color: rand() < 0.2 ? mix(0xffffff, look.accent2, 0.4) : 0xffffff, alpha: bright ? rand(0.2, 0.5) : rand(0.4, 1) });
  }
  if (biome === 'space') {
    // A far planet with a ring, and a small moon.
    const px = left + width * 0.78;
    const py = world.height * 0.26;
    g.circle(px, py, 95).fill(mix(look.ground[0], look.accent, 0.35));
    g.circle(px - 22, py - 18, 70).fill({ color: 0xffffff, alpha: 0.08 });
    for (const [dy, a] of [[-30, 0.15], [5, 0.12], [35, 0.1]] as const) g.ellipse(px, py + dy, 92, 10).fill({ color: 0x000000, alpha: a });
    g.ellipse(px, py + 8, 170, 26).stroke({ width: 9, color: look.accent2, alpha: 0.55 });
    g.circle(left + width * 0.2, world.height * 0.18, 22).fill(mix(look.ground[1], 0xffffff, 0.2));
  } else if (biome === 'moon') {
    // A huge planet hanging over the horizon.
    const px = left + width * 0.68;
    const py = world.height * 0.3;
    const r = 210;
    g.circle(px, py, r + 26).fill({ color: look.accent, alpha: 0.12 });
    g.circle(px, py, r).fill(mix(look.sky[1], look.accent, 0.55));
    for (let k = 0; k < 5; k++) g.ellipse(px, py - r * 0.6 + k * r * 0.3, r * Math.sqrt(1 - ((k * 0.3 - 0.6) ** 2)) * 0.98, r * 0.06).fill({ color: look.accent2, alpha: 0.12 });
    // The night side.
    g.circle(px + r * 0.35, py + r * 0.2, r * 0.92).fill({ color: look.sky[0], alpha: 0.35 });
    drawLandHills(g, world, span, rand, mix(look.ground[1], look.sky[1], 0.45), 70, 0.006);
    drawLandHills(g, world, span, rand, mix(look.ground[1], look.sky[1], 0.25), 34, 0.011);
  } else if (biome === 'garden') {
    // Two suns, then giant glowing plants along the far side.
    for (const [x, y, r, c] of [[0.2, 0.14, 46, 0xfff2b0], [0.33, 0.24, 26, look.accent2]] as const) {
      const sx = left + width * x;
      g.circle(sx, world.height * y, r * 2.2).fill({ color: c, alpha: 0.15 });
      g.circle(sx, world.height * y, r).fill(c);
    }
    drawLandHills(g, world, span, rand, mix(look.ground[0], look.sky[1], 0.5), 90, 0.005);
    for (let i = 0; i < 11; i++) {
      const x = rand(left, right);
      const base = floorOf(world)(x) + 6;
      const h = rand(160, 380);
      const lean = rand(-60, 60);
      const stem = mix(look.ground[1], look.sky[0], 0.3);
      g.moveTo(x, base).quadraticCurveTo(x + lean * 0.2, base - h * 0.5, x + lean, base - h).stroke({ width: rand(8, 16), color: stem, cap: 'round' });
      const color = i % 3 ? look.accent : look.accent2;
      const bx = x + lean;
      const by = base - h;
      if (i % 2) {
        // A bulb that glows.
        g.circle(bx, by, 46).fill({ color, alpha: 0.18 });
        g.ellipse(bx, by, 26, 32).fill(color);
        g.ellipse(bx - 8, by - 10, 8, 12).fill({ color: 0xffffff, alpha: 0.5 });
      } else {
        // A big curled frond.
        for (let k = -2; k <= 2; k++) {
          const a = -Math.PI / 2 + k * 0.55;
          g.moveTo(bx, by).quadraticCurveTo(bx + Math.cos(a) * 60, by + Math.sin(a) * 70, bx + Math.cos(a) * 110, by + Math.sin(a) * 40 + 30).stroke({ width: 10, color: mix(look.ground[0], color, 0.4), cap: 'round' });
        }
      }
    }
  } else if (biome === 'station') {
    drawStation(g, world, span, look, rand, bright);
  }
}

/** Two rows of soft far hills (or dunes), like Earth's. */
function drawLandHills(g: Graphics, world: World, span: Span, rand: () => number, color: number, lift: number, wave: number) {
  const left = span.left - 40;
  const right = span.right + 40;
  const floor = floorOf(world);
  const phase = rand() * 10;
  const pts: number[] = [left, floor(left) + 30];
  for (let x = left; x <= right; x += 20) pts.push(x, floor(x) - lift * (0.55 + 0.45 * Math.sin(x * wave + phase)));
  pts.push(right, floor(right) + 30);
  g.poly(pts).fill(color);
}

/** A space station's hall: big windows onto the stars, towers with lit windows, neon signs and market stalls. */
function drawStation(g: Graphics, world: World, span: Span, look: Look, rand: (lo?: number, hi?: number) => number, open: boolean) {
  const { left, right, top } = span;
  const floor = floorOf(world);
  const metal = mix(look.ground[1], 0x000000, 0.35);
  // Far towers, two rows, with rows of little lit windows.
  for (const [count, shade, tall] of [[14, 0.55, [180, 340]], [9, 0.3, [120, 240]]] as const) {
    for (let i = 0; i < count; i++) {
      const x = left + ((i + rand(0.1, 0.9)) * (right - left)) / count;
      const w = rand(40, 90);
      const h = rand(tall[0], tall[1]);
      const base = floor(x) + 4;
      const color = mix(look.ground[1], look.sky[0], shade);
      g.rect(x - w / 2, base - h, w, h).fill(color);
      if (rand() < 0.4) g.rect(x - 3, base - h - 40, 6, 40).fill(color);
      for (let wy = base - h + 14; wy < base - 16; wy += 22) {
        for (let wx = x - w / 2 + 8; wx < x + w / 2 - 8; wx += 14) {
          if (rand() < 0.55) g.rect(wx, wy, 6, 8).fill({ color: rand() < 0.7 ? look.accent2 : look.accent, alpha: 0.55 });
        }
      }
    }
  }
  if (!open) {
    // The roof: girders arching over, with round windows onto the stars between them.
    const roof = world.height * 0.1;
    g.rect(left, top, right - left, roof - top).fill(metal);
    for (let x = left; x <= right; x += 160) {
      g.moveTo(x, roof).quadraticCurveTo(x + 80, roof + 40, x + 160, roof).stroke({ width: 10, color: metal });
      g.rect(x - 6, top, 12, roof - top + 6).fill(mix(metal, 0xffffff, 0.1));
      g.circle(x + 80, roof + 6, 5).fill(look.accent2);
    }
  }
  // Neon signs: glowing rounded boards with a few bright bars, like lettering.
  for (let i = 0; i < 6; i++) {
    const x = rand(left + 60, right - 60);
    const y = rand(world.height * 0.18, floor(x) - 180);
    const w = rand(70, 140);
    const h = rand(28, 46);
    const color = i % 2 ? look.accent : look.accent2;
    g.roundRect(x - w / 2 - 8, y - h / 2 - 8, w + 16, h + 16, 14).fill({ color, alpha: 0.15 });
    g.roundRect(x - w / 2, y - h / 2, w, h, 10).fill(mix(look.sky[0], 0x000000, 0.3)).stroke({ width: 3, color });
    for (let k = 0; k < 4; k++) g.roundRect(x - w / 2 + 10 + (k * (w - 20)) / 4, y - 5, (w - 20) / 4 - 6, 10, 4).fill(color);
  }
  // Market stalls along the back of the floor: striped awnings over counters.
  for (let i = 0; i < 5; i++) {
    const x = left + ((i + rand(0.2, 0.8)) * (right - left)) / 5;
    const base = floor(x) + 12;
    const w = rand(110, 160);
    const stripe = i % 2 ? look.accent : look.accent2;
    g.rect(x - w / 2, base - 50, w, 50).fill(mix(look.ground[1], 0x000000, 0.2));
    for (let k = 0; k < 6; k++) g.poly([x - w / 2 + (k * w) / 6, base - 90, x - w / 2 + ((k + 1) * w) / 6, base - 90, x - w / 2 + ((k + 1) * w) / 6 + 6, base - 66, x - w / 2 + (k * w) / 6 + 6, base - 66]).fill(k % 2 ? stripe : 0xf4f1ea);
    g.rect(x - w / 2 + 4, base - 66, 5, 18).fill(metal).rect(x + w / 2 - 4, base - 66, 5, 18).fill(metal);
    for (let k = 0; k < 4; k++) g.circle(x - w / 2 + 20 + k * ((w - 40) / 3), base - 56, 7).fill(mix(stripe, 0xffffff, 0.3));
  }
}

/** On the ground: floor plates in a station, craters on a moon, glowing tufts in a garden, rocks out in space. */
export function drawSpaceGround(g: Graphics, world: World, span: Span, look: Look, biome: string) {
  const rand = seededRandom(`spaceground:${biome}:${look.id}`);
  const { left, right, bottom } = span;
  const floor = floorOf(world);
  const depth = (x: number) => bottom - floor(x);
  if (biome === 'station') {
    // Plates running back to front and side to side, closer together far away.
    for (let k = 1; k < 9; k++) {
      const f = (k / 9) ** 1.6;
      const pts: number[] = [];
      for (let x = left; x <= right + 20; x += 40) pts.push(x, floor(x) + f * depth(x));
      g.poly(pts, false).stroke({ width: 1 + f * 2, color: 0x000000, alpha: 0.18 });
    }
    const mid = (left + right) / 2;
    for (let x = left - 400; x <= right + 400; x += 120) {
      g.moveTo(mid + (x - mid) * 0.5, floor(x)).lineTo(x + (x - mid) * 0.6, bottom).stroke({ width: 2, color: 0x000000, alpha: 0.15 });
    }
    // Glowing strips along the floor.
    for (const f of [0.18, 0.62]) {
      const pts: number[] = [];
      for (let x = left; x <= right + 20; x += 40) pts.push(x, floor(x) + f * depth(x));
      g.poly(pts, false).stroke({ width: 3 + f * 4, color: look.accent2, alpha: 0.35 });
    }
    return;
  }
  if (biome === 'moon') {
    // Craters, bigger nearer the front, each a dark bowl with a lit rim.
    for (let i = 0; i < 22; i++) {
      const x = rand(left, right);
      const k = rand(0.05, 0.95);
      const y = floor(x) + k * depth(x);
      const r = rand(14, 40) * (0.5 + k);
      g.ellipse(x, y, r, r * 0.32).fill({ color: mix(look.ground[1], 0x000000, 0.35), alpha: 0.6 });
      g.ellipse(x, y - r * 0.06, r * 0.9, r * 0.22).fill({ color: mix(look.ground[1], 0x000000, 0.15), alpha: 0.8 });
      g.ellipse(x, y + r * 0.02, r, r * 0.32).stroke({ width: 2 + k * 2, color: mix(look.ground[0], 0xffffff, 0.35), alpha: 0.6 });
    }
    for (let i = 0; i < 30; i++) {
      const x = rand(left, right);
      const k = rand(0.1, 1);
      const s = rand(4, 10) * (0.5 + k);
      g.ellipse(x, floor(x) + k * depth(x), s * 1.3, s * 0.7).fill(mix(look.ground[1], 0x000000, 0.2));
    }
    // Teal ruins: broken pillars glowing faintly.
    if (look.id === 'teal') {
      for (let i = 0; i < 5; i++) {
        const x = rand(left, right);
        const base = floor(x) + rand(10, 60);
        const h = rand(50, 130);
        g.rect(x - 14, base - h, 28, h).fill(mix(look.ground[0], 0xffffff, 0.15));
        g.rect(x - 18, base - h - 8, 36, 10).fill(mix(look.ground[0], 0xffffff, 0.25));
        g.rect(x - 4, base - h + 10, 8, h - 20).fill({ color: look.accent, alpha: 0.45 });
      }
    }
    return;
  }
  if (biome === 'garden') {
    // Glowing flowers and curly tufts across the ground, bigger nearer the front.
    for (let i = 0; i < (right - left) / 7; i++) {
      const x = rand(left, right);
      const k = rand(0.03, 1);
      const y = floor(x) + k * depth(x);
      const s = 3 + k * 7;
      if (rand() < 0.3) {
        const color = rand() < 0.5 ? look.accent : look.accent2;
        g.circle(x, y - s, s * 1.6).fill({ color, alpha: 0.15 });
        g.circle(x, y - s, s * 0.7).fill(color);
      } else {
        g.moveTo(x - s, y).quadraticCurveTo(x - s, y - s * 2.4, x + s * 0.6, y - s * 1.8).stroke({ width: Math.max(1.5, s * 0.35), color: mix(look.ground[1], 0x000000, 0.2), cap: 'round' });
      }
    }
    return;
  }
  // Open space: craggy asteroids sitting along the band at the bottom.
  for (let i = 0; i < 14; i++) {
    const x = rand(left, right);
    const y = floor(x) + rand(10, 60);
    asteroid(g, x, y, rand(18, 50), look, rand);
  }
}

function asteroid(g: Graphics, x: number, y: number, r: number, look: Look, rand: (lo?: number, hi?: number) => number, alpha = 1) {
  const pts: number[] = [];
  for (let k = 0; k < 9; k++) {
    const a = (k / 9) * TAU;
    const d = r * rand(0.75, 1.1);
    pts.push(x + Math.cos(a) * d, y + Math.sin(a) * d * 0.8);
  }
  g.poly(pts).fill({ color: look.ground[1], alpha });
  g.circle(x - r * 0.3, y - r * 0.2, r * 0.45).fill({ color: mix(look.ground[0], 0xffffff, 0.15), alpha: alpha * 0.6 });
  g.circle(x + r * 0.25, y + r * 0.15, r * 0.18).fill({ color: 0x000000, alpha: alpha * 0.25 });
}

/** Asteroids drifting far back, for open space. */
const DRIFTERS = Array.from({ length: 6 }, (_, i) => {
  const rand = seededRandom(`drifter${i}`);
  return { x: rand(), y: rand(0.15, 0.7), r: rand(8, 22), speed: rand(0.004, 0.012), spin: rand(-0.3, 0.3) };
});

/** Moving every frame: twinkling stars, drifting asteroids, hover traffic, spores, now and then a shooting star. */
export function drawSpaceLive(g: Graphics, world: World, span: Span, look: Look, biome: string) {
  const t = world.time;
  const { left, right, top } = span;
  const width = right - left;
  const rand = seededRandom(`twinkle:${biome}`);
  for (let i = 0; i < 40; i++) {
    const x = rand(left, right);
    const y = rand(top, skyBottom(world, x));
    const a = Math.max(0, Math.sin(t * rand(0.8, 2.4) + i * 2.1));
    if (a < 0.4) continue;
    const r = 1.5 + a * 2;
    g.rect(x - r * 2, y - 0.6, r * 4, 1.2).fill({ color: 0xffffff, alpha: a * 0.7 });
    g.rect(x - 0.6, y - r * 2, 1.2, r * 4).fill({ color: 0xffffff, alpha: a * 0.7 });
  }
  // A shooting star every so often.
  const cycle = t / 9;
  const p = cycle % 1;
  if (p < 0.12 && biome !== 'station') {
    const r2 = seededRandom(`shoot${Math.floor(cycle)}`);
    const x0 = left + r2(0.1, 0.8) * width;
    const y0 = top + r2(0.02, 0.25) * world.height;
    const k = p / 0.12;
    const x = x0 + k * 260;
    const y = y0 + k * 110;
    g.moveTo(x - 90, y - 38).lineTo(x, y).stroke({ width: 3, color: 0xffffff, alpha: Math.sin(k * Math.PI) * 0.8, cap: 'round' });
  }
  if (biome === 'space') {
    for (const d of DRIFTERS) {
      const x = left - 60 + ((((d.x + t * d.speed) % 1) + 1) % 1) * (width + 120);
      const y = world.height * d.y + Math.sin(t * 0.2 + d.r) * 10;
      asteroid(g, x, y, d.r, look, seededRandom(`rock${d.r}`), 0.5);
    }
  } else if (biome === 'station') {
    // Little hover cars zipping along lanes far back, lights on.
    for (let i = 0; i < 7; i++) {
      const lane = world.height * (0.2 + (i % 3) * 0.08);
      const dir = i % 2 ? 1 : -1;
      const u = (((t * (0.03 + (i % 4) * 0.012) + i * 0.37) % 1) + 1) % 1;
      const x = dir > 0 ? left - 40 + u * (width + 80) : right + 40 - u * (width + 80);
      g.roundRect(x - 14, lane - 5, 28, 10, 5).fill(mix(look.ground[1], 0xffffff, 0.2));
      g.circle(x + dir * 14, lane, 3).fill(look.accent2);
      g.moveTo(x - dir * 14, lane).lineTo(x - dir * 40, lane).stroke({ width: 2, color: look.accent, alpha: 0.5 });
    }
  } else if (biome === 'garden') {
    // Glowing spores drifting up and sideways.
    const spores = seededRandom('spores');
    for (let i = 0; i < 36; i++) {
      const x0 = spores(left, right);
      const rise = spores(12, 30);
      const fall = world.height;
      const y = world.height - ((t * rise + spores(0, fall)) % fall);
      const x = x0 + Math.sin(t * 0.5 + i) * 30;
      const pulse = 0.6 + 0.4 * Math.sin(t * 2 + i);
      const color = i % 2 ? look.accent : look.accent2;
      g.circle(x, y, 7).fill({ color, alpha: 0.15 * pulse });
      g.circle(x, y, 2.2).fill({ color, alpha: 0.9 * pulse });
    }
  }
}

/** The haze far things fade toward in a space place: its sky, lightened. */
export const spaceHaze = (look: Look) => mix(look.sky[1], 0xffffff, 0.45);
