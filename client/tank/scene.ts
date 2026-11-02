import { Container, Graphics, Sprite, Texture } from 'pixi.js';
import type { Effect } from '../../shared/sim/world.ts';
import type { Biome } from '../../shared/world/biomes.ts';
import { TAU, seededRandom, type World } from './world.ts';

/** The part of the tank's units a screen shows: the tank itself plus extra water or sand around it. */
export interface Visible {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

interface Bubble {
  x: number;
  y: number;
  r: number;
  speed: number;
  wobble: number;
  phase: number;
}

interface Heart {
  x: number;
  y: number;
  size: number;
  age: number;
}

/** How a biome looks: its water from the surface down, its sky (if the water doesn't fill the screen) and its ground. */
interface Look {
  water: [string, string, string];
  sky: [string, string];
  sand: [number, number];
  specks: [number, number];
  rays: number;
  /** Where bubbles stream up from (fractions across), like the old tank's aerators. */
  aerators: number[];
  /** Now and then a bubble rises from somewhere on the bottom. */
  seeps: number;
}

const LOOKS: Partial<Record<Biome, Look>> = {
  lake: {
    water: ['#4fb8e0', '#1f78a8', '#0a3456'],
    sky: ['#9fd8f5', '#d8f1ff'],
    sand: [0xcbb07a, 0xb89a63],
    specks: [0x8f7448, 0xe2cf9f],
    rays: 1,
    aerators: [0.14, 0.86],
    seeps: 0,
  },
  pond: {
    water: ['#7cbf8e', '#3b7d63', '#17392e'],
    sky: ['#a9dcf2', '#e4f6e0'],
    sand: [0x7d6a4a, 0x66553a],
    specks: [0x4d4030, 0x9c8a62],
    rays: 0.7,
    aerators: [],
    seeps: 0.6,
  },
  ocean: {
    water: ['#3fa6db', '#135c94', '#03162d'],
    sky: ['#8fd0f2', '#d6efff'],
    sand: [0xd9c79c, 0xbfa977],
    specks: [0x9a8660, 0xf0e3c0],
    rays: 1.1,
    aerators: [],
    seeps: 1.5,
  },
  seashore: {
    water: ['#63d3d6', '#2c9fbd', '#156d92'],
    sky: ['#7cc8f0', '#e3f5ff'],
    sand: [0xead39a, 0xd6bb7d],
    specks: [0xb8995c, 0xfff1c9],
    rays: 1.3,
    aerators: [],
    seeps: 0,
  },
};

const RAY_COUNT = 6;

/** Everything that isn't a drawing: water, sky, light, the bottom, bubbles and the day/night tint. */
export class Scene {
  readonly back = new Container();
  readonly front = new Container();

  private background = new Sprite();
  private rays = new Graphics();
  /** Things that never move: reeds, rocks, coral. */
  private props = new Graphics();
  private sand = new Graphics();
  /** The water's surface, where the place has one: waves, foam and lily pads. */
  private surface = new Graphics();
  private bubbleGfx = new Graphics();
  private night = new Graphics();
  private bubbles: Bubble[] = [];
  private hearts: Heart[] = [];
  private look: Look = LOOKS.lake!;
  /** Lily pads on the pond: where across, how big, and their bob. */
  private pads: { x: number; r: number; phase: number; flower: boolean }[] = [];
  /** Called for every aerator bubble burst, e.g. to make a sound. */
  onBloop: (() => void) | null = null;
  private bloopIn = 3;
  private aeratorTimers: number[] = [];
  private seepIn = 1;
  private rayShape = Array.from({ length: RAY_COUNT }, (_, i) => ({
    x: (i + 0.5) / RAY_COUNT + (Math.random() - 0.5) * 0.08,
    width: 0.03 + Math.random() * 0.05,
    skew: 0.08 + Math.random() * 0.1,
    phase: Math.random() * TAU,
  }));

  constructor() {
    this.rays.blendMode = 'add';
    this.back.addChild(this.background, this.rays, this.props, this.sand, this.surface);
    this.front.addChild(this.bubbleGfx, this.night);
  }

  private visible: Visible = { left: 0, top: 0, right: 0, bottom: 0 };

  /** visible is how far the screen sees past the tank's own edges (screens of another shape see more). */
  layout(world: World, visible: Visible = { left: 0, top: 0, right: world.width, bottom: world.height }) {
    this.visible = visible;
    const look = LOOKS[world.biome] ?? LOOKS.lake!;
    if (look !== this.look) {
      this.look = look;
      this.bubbles = [];
      this.hearts = [];
    }
    this.aeratorTimers = look.aerators.map(() => 0);
    if (this.background.texture !== Texture.EMPTY) this.background.texture.destroy(true);
    const top = Math.min(0, visible.top);
    const height = Math.max(world.height, visible.bottom) - top;
    this.background.texture = backdrop(look, height, world.waterTop - top, world.floorY - top);
    this.background.position.set(visible.left, top);
    this.background.width = visible.right - visible.left;
    this.background.height = height;
    const rand = seededRandom(world.biome);
    this.pads = world.biome === 'pond'
      ? [0.12, 0.2, 0.47, 0.66, 0.74, 0.88].map((x) => ({ x: x + rand(-0.03, 0.03), r: rand(26, 44), phase: rand(0, TAU), flower: rand() < 0.35 }))
      : [];
    this.drawProps(world);
    this.drawSand(world);
  }

  /** Plays something the simulation asked for. */
  play(e: Effect) {
    if (e.kind === 'bubble') this.bubble(e.x, e.y, e.r);
    else if (e.kind === 'heart') this.heart(e.x, e.y, e.size);
    else this.burst(e.x, e.y, e.count);
  }

  update(dt: number, world: World) {
    this.drawRays(world);
    this.drawSurface(world);

    const { aerators, seeps } = this.look;
    this.aeratorTimers.forEach((timer, i) => {
      this.aeratorTimers[i] = timer - dt;
      if (this.aeratorTimers[i] <= 0) {
        this.aeratorTimers[i] = 0.08 + Math.random() * 0.35;
        const x = aerators[i] * world.width;
        this.bubble(x + (Math.random() - 0.5) * 10, world.floorAt(x) + 10, 2 + Math.random() * 5);
      }
    });
    if (aerators.length) {
      this.bloopIn -= dt;
      if (this.bloopIn <= 0) {
        this.bloopIn = 3 + Math.random() * 7;
        this.onBloop?.();
      }
    }
    if (seeps) {
      this.seepIn -= dt * seeps;
      if (this.seepIn <= 0) {
        this.seepIn = 0.6 + Math.random() * 2;
        const x = world.waterLeft + Math.random() * (world.width - world.waterLeft);
        for (let i = 0; i < 1 + Math.random() * 3; i++) this.bubble(x + (Math.random() - 0.5) * 6, world.floorAt(x) + 4 - i * 9, 1.5 + Math.random() * 3);
      }
    }

    const g = this.bubbleGfx.clear();
    // Bubbles pop at the surface (or, when the water fills the screen, once they're off the top).
    const popAt = world.waterTop > 0 ? world.waterTop + 2 : Math.min(0, this.visible.top) - 20;
    this.bubbles = this.bubbles.filter((b) => b.y > popAt);
    for (const b of this.bubbles) {
      b.y -= b.speed * dt;
      b.x += world.current * 1.3 * dt;
      b.phase += dt * 3;
      const x = b.x + Math.sin(b.phase) * b.wobble;
      g.circle(x, b.y, b.r).fill({ color: 0xffffff, alpha: 0.12 }).stroke({ width: 1.2, color: 0xe8f7ff, alpha: 0.55 });
      g.circle(x - b.r * 0.35, b.y - b.r * 0.35, b.r * 0.25).fill({ color: 0xffffff, alpha: 0.7 });
    }
    this.hearts = this.hearts.filter((h) => h.age < 2.4);
    for (const h of this.hearts) {
      h.age += dt;
      h.y -= dt * h.size * 2.5;
      const s = h.size * Math.min(1, h.age * 4);
      const x = h.x + Math.sin(h.age * 4) * h.size * 0.3;
      const alpha = Math.min(1, (2.4 - h.age) / 0.8);
      // Two bumps and a point.
      g.circle(x - s * 0.5, h.y - s * 0.2, s * 0.55).fill({ color: 0xff5c8a, alpha });
      g.circle(x + s * 0.5, h.y - s * 0.2, s * 0.55).fill({ color: 0xff5c8a, alpha });
      g.poly([x - s * 1.02, h.y, x + s * 1.02, h.y, x, h.y + s * 1.1]).fill({ color: 0xff5c8a, alpha });
    }

    // Under the blacklight the water goes a deep violet and almost everything dims, except blacklight paint.
    const b = this.blacklight;
    const color = mixColor(0x020d24, 0x14052e, b);
    const v = this.visible;
    this.night.clear().rect(v.left, Math.min(0, v.top), v.right - v.left, Math.max(world.height, v.bottom) - Math.min(0, v.top)).fill({ color, alpha: Math.max(this.darkness, 0.78 * b) });
  }

  /** 0 in daylight, 0.5 at full night (set from the simulation). */
  darkness = 0;
  /** How far the blacklight has faded in (0..1). */
  blacklight = 0;

  /** Night creatures come out once it's getting properly dark. */
  get isNight() {
    return this.darkness >= 0.25;
  }

  bubble(x: number, y: number, r: number) {
    if (this.bubbles.length > 300) return;
    this.bubbles.push({ x, y, r, speed: 40 + r * 14 + Math.random() * 20, wobble: 2 + Math.random() * 4, phase: Math.random() * TAU });
  }

  /** A little heart that floats up and fades, e.g. from a fish that's had a good meal. */
  heart(x: number, y: number, size: number) {
    if (this.hearts.length < 40) this.hearts.push({ x, y, size, age: 0 });
  }

  /** A splash of bubbles, used when a new drawing drops into the tank. */
  burst(x: number, y: number, count = 28) {
    for (let i = 0; i < count; i++) {
      this.bubble(x + (Math.random() - 0.5) * 90, y + Math.random() * 120, 2 + Math.random() * 7);
    }
  }

  private drawRays(world: World) {
    const g = this.rays.clear();
    const top = world.waterTop;
    for (const ray of this.rayShape) {
      const alpha = (0.035 + 0.03 * Math.sin(world.time * 0.4 + ray.phase)) * this.look.rays;
      const x0 = ray.x * world.width;
      if (x0 < world.waterLeft) continue;
      const w = ray.width * world.width;
      const bottom = w * 2.6;
      const shift = ray.skew * world.width;
      const floor = world.floorAt(x0 + shift);
      g.poly([x0, top, x0 + w, top, x0 + shift + bottom, floor, x0 + shift, floor]).fill({ color: 0xbfe9ff, alpha });
    }
  }

  /** The top of the sand at x, with its gentle ripples. */
  private sandTop(world: World, x: number) {
    return world.floorAt(Math.min(world.width, Math.max(0, x))) + Math.sin(x * 0.006) * 10 + Math.sin(x * 0.019 + 1) * 4;
  }

  /** Where the water meets the beach (or the left edge, if it doesn't). */
  private shoreX(world: World) {
    let x = 0;
    while (x < world.width && this.sandTop(world, x) <= world.waterTop) x += 2;
    return x;
  }

  private drawSurface(world: World) {
    const g = this.surface.clear();
    if (world.waterTop <= 0) return;
    const t = world.time;
    const y0 = world.waterTop;
    const from = Math.max(Math.min(0, this.visible.left), this.shoreX(world));
    const right = Math.max(world.width, this.visible.right);
    // A gently moving surface line, lit from above.
    const pts: number[] = [];
    for (let x = from; x <= right + 20; x += 20) pts.push(x, y0 + Math.sin(x * 0.018 + t * 1.6) * 3 + Math.sin(x * 0.041 - t * 2.3) * 1.5);
    g.poly([...pts, right + 20, y0 + 10, from, y0 + 10], false).fill({ color: 0xffffff, alpha: 0.12 });
    g.poly(pts, false).stroke({ width: 3, color: 0xeafaff, alpha: 0.7 });

    if (world.biome === 'seashore') {
      const shore = this.shoreX(world);
      // Swells roll in from the sea, curling white as they near the beach.
      for (let i = 0; i < 4; i++) {
        const k = (t * 0.07 + i / 4) % 1;
        const x = shore + 40 + (1 - k) * 900;
        const w = 40 + k * 70;
        const h = 6 + k * 14;
        const alpha = Math.min(1, Math.sin(k * Math.PI) * 1.6);
        // The swell's hump of water, then the white curl along its front.
        g.moveTo(x - w * 1.6, y0 + 3).quadraticCurveTo(x - w * 0.4, y0 - h, x, y0 - h * 0.8).quadraticCurveTo(x + w * 0.25, y0 - h * 0.5, x + w * 0.35, y0 + 3).closePath().fill({ color: 0x8fdde6, alpha: alpha * 0.8 });
        g.moveTo(x - w * 0.6, y0 - h * 0.85).quadraticCurveTo(x - w * 0.05, y0 - h * 1.05, x + w * 0.3, y0 - h * 0.1).stroke({ width: 4 + k * 5, color: 0xffffff, alpha: alpha * 0.9, cap: 'round' });
      }
      // Each wave washes up the sand as a thin sheet of water with foam along its edge, then slides back.
      const lap = Math.sin(t * 0.9) * 0.5 + 0.5;
      const edge = shore - 30 - lap * 170;
      const end = shore + 60;
      const top: number[] = [];
      const under: number[] = [];
      for (let x = edge; x <= end; x += 5) {
        const y = this.sandTop(world, x);
        // Thickest just up the beach, thinning to nothing at the leading edge and out over the open water.
        const deep = Math.min(1, (x - edge) / 80, (end - x) / 60);
        top.push(x, Math.min(y, y0) - 2 - deep * 9);
        under.unshift(x, Math.min(y, y0) + 4);
      }
      // A wet, darker band of sand left behind as the water slides back.
      const wet: number[] = [];
      for (let x = shore - 210; x <= shore; x += 10) wet.push(x, this.sandTop(world, x) - 1);
      g.poly(wet, false).stroke({ width: 10, color: 0xb59a66, alpha: 0.45, cap: 'round' });
      g.poly([...top, ...under]).fill({ color: 0x9fe6e6, alpha: 0.85 });
      g.poly(top.slice(0, 30), false).stroke({ width: 7, color: 0xffffff, cap: 'round', join: 'round' });
      for (let i = 0; i < 8; i++) {
        const x = edge + 6 + i * 9 + Math.sin(t * 3 + i) * 3;
        g.circle(x, this.sandTop(world, x) - 6 - (i % 2) * 4, 3 + (i % 3)).fill({ color: 0xffffff, alpha: 0.9 });
      }
    }
    for (const pad of this.pads) {
      // Lily pads float on top: a circle with a notch, and now and then a pink flower.
      const x = pad.x * world.width + Math.sin(t * 0.3 + pad.phase) * 6;
      const y = y0 + Math.sin(t * 1.1 + pad.phase) * 1.5;
      const r = pad.r;
      g.ellipse(x, y + 3, r, r * 0.28).fill({ color: 0x0f3324, alpha: 0.35 });
      g.ellipse(x, y, r, r * 0.26).fill(0x4f9a3f);
      g.poly([x, y, x + r * 0.95, y - r * 0.12, x + r * 0.95, y + r * 0.12]).fill(0x7cbf8e);
      g.ellipse(x - r * 0.2, y - r * 0.06, r * 0.5, r * 0.1).fill({ color: 0x8ccf6f, alpha: 0.6 });
      if (pad.flower) {
        for (let k = -2; k <= 2; k++) g.ellipse(x - r * 0.35 + k * 5, y - 8 + Math.abs(k) * 2, 5, 11).fill(0xf6a8c8);
        g.circle(x - r * 0.35, y - 9, 4).fill(0xffe36b);
      }
    }
  }

  /** Reeds at the pond, rocks and coral in the ocean: drawn once per layout. */
  private drawProps(world: World) {
    const g = this.props.clear();
    const rand = seededRandom(`props:${world.biome}`);
    if (world.biome === 'pond') {
      for (const cx of [0.02, 0.07, 0.31, 0.92, 0.97]) {
        for (let i = 0; i < 6; i++) {
          const x = (cx + rand(-0.025, 0.025)) * world.width;
          const base = world.floorAt(x) + 14;
          const top = world.waterTop - rand(30, 120);
          const lean = rand(-30, 30);
          const color = rand() < 0.5 ? 0x3f6b2f : 0x557d36;
          g.moveTo(x, base).quadraticCurveTo(x + lean * 0.3, (base + top) / 2, x + lean, top).stroke({ width: rand(4, 7), color, alpha: 0.85 });
          if (rand() < 0.45) g.roundRect(x + lean - 6, top - 6, 12, 40, 6).fill(0x6b4426);
        }
      }
    } else if (world.biome === 'ocean') {
      // Faint, far-off coral and rocks, so the deep feels big.
      for (let i = 0; i < 9; i++) {
        const x = rand(0, world.width);
        const base = world.floorAt(x) + 8;
        const color = [0xe57a7a, 0xf0a35c, 0xc97ad9][Math.floor(rand(0, 3))];
        const branch = (bx: number, by: number, angle: number, len: number, depth: number) => {
          const ex = bx + Math.cos(angle) * len;
          const ey = by + Math.sin(angle) * len;
          g.moveTo(bx, by).lineTo(ex, ey).stroke({ width: Math.max(2, depth * 3), color, alpha: 0.35, cap: 'round' });
          if (depth > 0) for (const turn of [-0.45, 0.4]) branch(ex, ey, angle + turn + rand(-0.15, 0.15), len * 0.72, depth - 1);
        };
        branch(x, base, -Math.PI / 2 + rand(-0.2, 0.2), rand(30, 55), 3);
      }
      for (let i = 0; i < 7; i++) {
        const x = rand(0, world.width);
        const r = rand(24, 70);
        const y = world.floorAt(x) + 10;
        g.ellipse(x, y, r, r * 0.6).fill({ color: 0x3d4a5a, alpha: 0.75 });
        g.ellipse(x - r * 0.25, y - r * 0.25, r * 0.5, r * 0.25).fill({ color: 0x5d6b7b, alpha: 0.5 });
      }
    }
  }

  private drawSand(world: World) {
    const { sand, specks } = this.look;
    const left = Math.floor(Math.min(0, this.visible.left) / 20) * 20;
    const right = Math.max(world.width, this.visible.right);
    const height = Math.max(world.height, this.visible.bottom);
    const rand = seededRandom('sand');
    const g = this.sand.clear();
    const floor = (x: number) => world.floorAt(Math.min(world.width, Math.max(0, x)));
    const points: number[] = [left, height];
    for (let x = left; x <= right + 20; x += 20) points.push(x, this.sandTop(world, x));
    points.push(right + 20, height);
    g.poly(points).fill(sand[0]);
    g.poly(points.map((v, i) => (i % 2 === 1 && v !== height ? v + 14 : v))).fill(sand[1]);
    for (let i = 0; i < (right - left) / 6; i++) {
      const x = rand(left, right);
      const y = rand(floor(x) + 18, height);
      g.circle(x, y, rand(1, 3.5)).fill({ color: rand() > 0.5 ? specks[0] : specks[1], alpha: 0.7 });
    }
    if (world.biome === 'seashore') {
      // The beach above the water is dry and pale; where the waves reach, it's dark and wet.
      const shore = this.shoreX(world);
      // A band along the top of the sand, thinning away to nothing at the water's edge.
      const dry: number[] = [];
      const below: number[] = [];
      for (let x = left; x <= shore + 10; x += 10) {
        const y = this.sandTop(world, x);
        dry.push(x, y);
        below.unshift(x, y + 30 * Math.max(0, Math.min(1, (shore - x) / 120)));
      }
      g.poly([...dry, ...below], true).fill({ color: 0xf6e3b4, alpha: 0.6 });
      // Shells and pebbles dotted along the beach and the shallows.
      const r = seededRandom('shells');
      for (let i = 0; i < 12; i++) {
        const x = r(20, shore + 300);
        const y = this.sandTop(world, x) + r(6, 22);
        const s = r(6, 10);
        if (r() < 0.5) g.ellipse(x, y, s, s * 0.6).fill(0xa69a88);
        else g.moveTo(x - s, y).arc(x, y, s, Math.PI, 0).closePath().fill(0xf7d9d0).stroke({ width: 1.5, color: 0xd9a89a });
      }
    }
  }
}

/** A picture of a biome's sky and water, height tall (for the map's portholes). */
export function biomeBackdrop(biome: Biome, height: number, waterTop: number, floor: number) {
  return backdrop(LOOKS[biome] ?? LOOKS.lake!, height, waterTop, floor);
}

/** The colour of a biome's sand. */
export const sandColor = (biome: Biome) => (LOOKS[biome] ?? LOOKS.lake!).sand[0];

/** The sky (above the water, if any), then the water: light at the surface, deep by the bottom. */
function backdrop(look: Look, height: number, waterTop: number, floor: number) {
  const canvas = document.createElement('canvas');
  canvas.width = 4;
  canvas.height = Math.max(64, Math.min(1024, Math.round(height)));
  const ctx = canvas.getContext('2d')!;
  const grad = ctx.createLinearGradient(0, 0, 0, canvas.height);
  const f = (y: number) => Math.min(1, Math.max(0, y / height));
  const surface = f(waterTop);
  if (surface > 0) {
    grad.addColorStop(0, look.sky[0]);
    grad.addColorStop(Math.max(0, surface - 0.001), look.sky[1]);
  }
  const end = f(floor);
  grad.addColorStop(surface, look.water[0]);
  grad.addColorStop(surface + (end - surface) * 0.45, look.water[1]);
  grad.addColorStop(end, look.water[2]);
  grad.addColorStop(1, look.water[2]);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  return Texture.from(canvas);
}

const mixColor = (a: number, b: number, t: number) => {
  const ch = (shift: number) => Math.round(((a >> shift) & 255) + ((((b >> shift) & 255) - ((a >> shift) & 255)) * t));
  return (ch(16) << 16) | (ch(8) << 8) | ch(0);
};
