import { Container, Graphics, Sprite, Texture } from 'pixi.js';
import type { Effect } from '../../shared/sim/world.ts';
import type { Biome } from '../../shared/world/biomes.ts';
import { lookOf, type Look as SpaceLook } from '../../shared/world/looks.ts';
import { drawSpaceBack, drawSpaceGround, drawSpaceLive, type Span } from './spacescene.ts';
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

/** How a biome looks: its water from the surface down, its sky (if the water doesn't fill the screen) and its ground (on land, sand is the grass). */
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
  meadow: {
    water: ['#6fb7d6', '#3f8fb5', '#2a6d8f'],
    sky: ['#6fbcec', '#e6f6ff'],
    sand: [0x8cc54f, 0x6fa83c],
    specks: [0x5e9a34, 0xb6e07a],
    rays: 0,
    aerators: [],
    seeps: 0,
  },
  farm: {
    water: ['#6fb7d6', '#3f8fb5', '#2a6d8f'],
    sky: ['#7cc5ef', '#f6f1d8'],
    sand: [0x9ccb55, 0x7cae40],
    specks: [0x6a9a36, 0xc7e27f],
    rays: 0,
    aerators: [],
    seeps: 0,
  },
  hills: {
    water: ['#6fb7d6', '#3f8fb5', '#2a6d8f'],
    sky: ['#86c6e8', '#eaf4f2'],
    sand: [0x7fb85a, 0x5f9a44],
    specks: [0x4f8236, 0xa9d58a],
    rays: 0,
    aerators: [],
    seeps: 0,
  },
  forest: {
    water: ['#6fb7d6', '#3f8fb5', '#2a6d8f'],
    sky: ['#9cc7d9', '#e2eee4'],
    sand: [0x6a9a45, 0x4d7a32],
    specks: [0x3f6a2a, 0x93b86a],
    rays: 0,
    aerators: [],
    seeps: 0,
  },
};

const hex = (n: number) => `#${n.toString(16).padStart(6, '0')}`;
const sceneLooks = new Map<string, Look>();

/**
 * A place's look: Earth's kinds have their own; the space kinds are coloured by the place's chosen scheme
 * (open space is "water" everything floats in, from its top colour down).
 */
function sceneLook(biome: Biome, look?: string): Look {
  const l = lookOf(biome, look);
  if (!l) return LOOKS[biome] ?? LOOKS.lake!;
  const key = `${biome}:${l.id}`;
  let found = sceneLooks.get(key);
  if (!found) {
    found = {
      water: [hex(l.sky[1]), hex(mixColor(l.sky[0], l.sky[1], 0.5)), hex(l.sky[0])],
      sky: [hex(l.sky[0]), hex(l.sky[1])],
      sand: l.ground,
      specks: [mixColor(l.ground[1], 0x000000, 0.3), l.accent2],
      rays: 0,
      aerators: [],
      seeps: 0,
    };
    sceneLooks.set(key, found);
  }
  return found;
}

/** Puffy clouds drifting over the land places. */
const CLOUDS = Array.from({ length: 6 }, (_, i) => ({
  x: (i / 6) * 1.2,
  y: 0.06 + ((i * 37) % 23) / 80,
  size: 0.7 + ((i * 53) % 7) / 10,
  speed: 0.004 + ((i * 29) % 5) / 1000,
}));

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
  /** On land: clouds in the sky, and long grass swaying in front of everyone. */
  private clouds = new Graphics();
  private foreground = new Graphics();
  /** On land at night: stars, the moon and fireflies, bright above the night's tint. */
  private nightLights = new Graphics();
  /** The weather: a greyer sky and a rainbow behind, puddles and snow on the ground, rain and snow falling in front. */
  private skyWeather = new Graphics();
  private groundWeather = new Graphics();
  private falling = new Graphics();
  /** How wet and how snowy the ground is: slow to come, slower to go. */
  private wet = 0;
  private snowCover = 0;
  private bubbles: Bubble[] = [];
  private hearts: Heart[] = [];
  private look: Look = LOOKS.lake!;
  /** The space kinds' colours (see spacescene.ts); undefined on Earth. */
  private spaceLook: SpaceLook | undefined;
  /** Out in space: twinkles, drifting rocks, traffic and spores. */
  private spaceSky = new Graphics();
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
    this.back.addChild(this.background, this.spaceSky, this.clouds, this.skyWeather, this.rays, this.props, this.sand, this.groundWeather, this.surface);
    this.front.addChild(this.bubbleGfx, this.foreground, this.falling, this.night, this.nightLights);
  }

  private visible: Visible = { left: 0, top: 0, right: 0, bottom: 0 };

  /** visible is how far the screen sees past the tank's own edges (screens of another shape see more). */
  layout(world: World, visible: Visible = { left: 0, top: 0, right: world.width, bottom: world.height }) {
    this.visible = visible;
    const look = sceneLook(world.biome, world.look);
    this.spaceLook = lookOf(world.biome, world.look);
    if (look !== this.look) {
      this.look = look;
      this.bubbles = [];
      this.hearts = [];
    }
    this.aeratorTimers = look.aerators.map(() => 0);
    if (this.background.texture !== Texture.EMPTY) this.background.texture.destroy(true);
    const top = Math.min(0, visible.top);
    const height = Math.max(world.height, visible.bottom) - top;
    // On land the sky runs all the way down (behind the ground).
    this.background.texture = backdrop(look, height, world.land ? height : world.waterTop - top, world.floorY - top);
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
    this.spaceSky.clear();
    if (this.spaceLook) drawSpaceLive(this.spaceSky, world, this.span(world), this.spaceLook, world.biome);
    this.drawSurface(world);
    this.drawSky(world);
    this.drawGrass(world);
    this.drawNightLights(world);
    this.drawWeather(dt, world);

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
  /** [rain, snow, rainbow], each 0..1 (set from the simulation). */
  weather: [number, number, number] = [0, 0, 0];
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
    if (!this.look.rays) return;
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

  /** All the screen sees, in tank units. */
  private span(world: World): Span {
    const v = this.visible;
    return { left: Math.min(0, v.left), right: Math.max(world.width, v.right), top: Math.min(0, v.top), bottom: Math.max(world.height, v.bottom) };
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

  /** Clouds drifting slowly across a land place's sky. */
  private drawSky(world: World) {
    const g = this.clouds.clear();
    if (!world.land || this.spaceLook) return;
    const left = Math.min(0, this.visible.left);
    const span = Math.max(world.width, this.visible.right) - left + 400;
    for (const c of CLOUDS) {
      const x = left - 200 + ((((c.x + world.time * c.speed) % 1.2) + 1.2) % 1.2) / 1.2 * span;
      const y = c.y * world.height;
      const s = 70 * c.size;
      for (const [dx, dy, r] of [[-0.9, 0.15, 0.55], [-0.35, -0.2, 0.75], [0.3, -0.1, 0.65], [0.85, 0.15, 0.5], [0, 0.2, 0.7]]) {
        g.circle(x + dx * s, y + dy * s, r * s).fill({ color: 0xffffff, alpha: 0.9 });
      }
    }
  }

  /** Rain and snow showers, and the rainbow after, wherever there's sky to see. */
  private drawWeather(dt: number, world: World) {
    const [rain, snow, rainbow] = this.weather;
    const sky = this.skyWeather.clear();
    const ground = this.groundWeather.clear();
    const g = this.falling.clear();
    this.wet = Math.max(0, Math.min(1, this.wet + (rain > 0.4 ? dt * 0.05 : -dt * 0.015)));
    this.snowCover = Math.max(0, Math.min(1, this.snowCover + (snow > 0.4 ? dt * 0.03 : -dt * 0.01)));
    const land = world.land === true;
    if (!land && world.waterTop <= 0) return;
    const left = Math.min(0, this.visible.left);
    const right = Math.max(world.width, this.visible.right);
    const top = Math.min(0, this.visible.top);
    const t = world.time;
    // Where things stop falling: the grass (somewhere front to back) on land, the water's surface elsewhere.
    const landing = (x: number, k: number) => (land ? world.floorAt(Math.min(world.width, Math.max(0, x))) + k * world.height * (world.groundDepth ?? 0) : world.waterTop);
    const span = right - left;

    // The sky clouds over.
    const grey = Math.max(rain, snow * 0.6);
    if (grey > 0.01) {
      const bottom = land ? Math.max(world.height, this.visible.bottom) : world.waterTop;
      sky.rect(left, top, span, bottom - top).fill({ color: 0x5d6b78, alpha: grey * 0.35 });
    }

    if (rainbow > 0.01) {
      // An arc over the far hills (or out over the water), the seven colours from the outside in.
      const cx = world.width * 0.38;
      const cy = land ? world.floorAt(cx) + 30 : world.waterTop;
      const r = land ? world.height * 0.48 : Math.max(80, (world.waterTop - top) * 0.92);
      const band = Math.max(5, r * 0.035);
      [0xff4b4b, 0xff9d3b, 0xffe53b, 0x5fd35a, 0x47a8ff, 0x5b5bd6, 0xa45bd6].forEach((color, i) => {
        sky.arc(cx, cy, r - i * band, Math.PI, TAU).stroke({ width: band + 0.5, color, alpha: rainbow * 0.45 });
      });
    }

    if (land && this.wet > 0.01) {
      // Puddles in the grass, shining with the sky.
      const rand = seededRandom(`puddles${world.biome}`);
      for (let i = 0; i < 7; i++) {
        const x = rand(0.05, 0.95) * world.width;
        const k = rand(0.15, 0.95);
        const y = world.floorAt(x) + k * world.height * (world.groundDepth ?? 0) + 6;
        const w = rand(40, 90) * (0.5 + k * 0.7) * Math.min(1, this.wet * 1.5);
        ground.ellipse(x, y, w, w * 0.18).fill({ color: 0x9cc1d6, alpha: 0.7 * Math.min(1, this.wet * 2) });
        ground.ellipse(x - w * 0.25, y - w * 0.04, w * 0.4, w * 0.05).fill({ color: 0xffffff, alpha: 0.4 * this.wet });
        if (rain > 0.2) {
          // Rain plinking into it.
          const p = (t * 1.3 + i * 0.37) % 1;
          ground.ellipse(x + Math.sin(i * 9.1 + Math.floor(t * 1.3 + i * 0.37)) * w * 0.5, y, 4 + p * 14, (4 + p * 14) * 0.3).stroke({ width: 1.5, color: 0xffffff, alpha: (1 - p) * rain * 0.7 });
        }
      }
    }
    if (land && this.snowCover > 0.01) {
      // A white dusting over the ground, thickest at the back where it's settled longest.
      const pts: number[] = [];
      for (let x = left; x <= right + 20; x += 20) pts.push(x, world.floorAt(Math.min(world.width, Math.max(0, x))) - 3 + Math.sin(x * 0.05) * 2);
      const bottom = Math.max(world.height, this.visible.bottom);
      ground.poly([...pts, right + 20, bottom, left, bottom]).fill({ color: 0xf4f8ff, alpha: this.snowCover * 0.55 });
      ground.poly(pts, false).stroke({ width: 6, color: 0xffffff, alpha: this.snowCover * 0.85 });
    }

    if (rain > 0.01) {
      // Slanting streaks, falling fast.
      const drops = Math.round(180 * rain);
      for (let i = 0; i < drops; i++) {
        const seed = ((i * 7919) % 1000) / 1000;
        const k = ((i * 104729) % 997) / 997;
        const speed = 1.4 + k * 0.6;
        const x0 = left + ((seed * span + i * 37) % span);
        const stop = landing(x0, k);
        const fall = stop - top + 40;
        const y = top - 40 + ((((t * speed * 600) / fall + seed) % 1) * fall);
        const x = x0 - (y - top) * 0.18;
        g.moveTo(x, y).lineTo(x - 5, y + 26).stroke({ width: 2, color: 0xe4f1ff, alpha: 0.75 * rain });
      }
      if (!land) {
        // Rings spreading where it lands on the water.
        const from = Math.max(left, this.shoreX(world));
        for (let i = 0; i < 14; i++) {
          const cycle = t * 0.9 + i / 14;
          const p = cycle % 1;
          const x = from + ((Math.sin(Math.floor(cycle) * 12.9898 + i * 78.233) * 43758.5453) % 1 + 1) % 1 * (right - from);
          g.ellipse(x, world.waterTop + 2, 3 + p * 20, (3 + p * 20) * 0.22).stroke({ width: 1.5, color: 0xffffff, alpha: (1 - p) * 0.7 * rain });
        }
      }
    }
    if (snow > 0.01) {
      // Big soft flakes drifting down and sideways.
      const flakes = Math.round(150 * snow);
      for (let i = 0; i < flakes; i++) {
        const seed = ((i * 7919) % 1000) / 1000;
        const k = ((i * 104729) % 997) / 997;
        const x0 = left + ((seed * span + i * 53) % span);
        const stop = landing(x0, k);
        const fall = stop - top + 20;
        const y = top - 20 + ((((t * (40 + k * 30)) / fall + seed) % 1) * fall);
        const x = x0 + Math.sin(t * 0.8 + i) * 18;
        g.circle(x, y, 2 + k * 3).fill({ color: 0xffffff, alpha: 0.85 * snow });
      }
    }
  }

  /** After dark on land: twinkling stars and the moon over the hills, and fireflies drifting over the grass. */
  private drawNightLights(world: World) {
    const g = this.nightLights.clear();
    const n = Math.min(1, Math.max(0, (this.darkness - 0.12) / 0.3));
    if (!world.land || n === 0) return;
    // Space places have their own stars (and the garden its spores).
    if (this.spaceLook) return;
    const left = Math.min(0, this.visible.left);
    const right = Math.max(world.width, this.visible.right);
    const top = Math.min(0, this.visible.top);
    const t = world.time;
    const rand = seededRandom('stars');
    // In the Woods the leaves hide the sky.
    for (let i = 0; i < (world.biome === 'forest' ? 0 : 90); i++) {
      const x = rand(left, right);
      const y = rand(top, world.floorAt(Math.min(world.width, Math.max(0, x))) - 140);
      const twinkle = 0.55 + 0.45 * Math.sin(t * rand(1, 3) + i);
      g.circle(x, y, rand(1, 2.6)).fill({ color: 0xfffbe6, alpha: n * twinkle * 0.9 });
    }
    const mx = world.width * 0.82;
    const my = world.height * (world.biome === 'forest' ? -1 : 0.12);
    g.circle(mx, my, 70).fill({ color: 0xfff6d5, alpha: n * 0.08 });
    g.circle(mx, my, 34).fill({ color: 0xfff6d5, alpha: n * 0.95 });
    g.circle(mx - 9, my - 6, 7).fill({ color: 0xe8dcb5, alpha: n * 0.8 });
    g.circle(mx + 10, my + 9, 5).fill({ color: 0xe8dcb5, alpha: n * 0.8 });
    if (world.biome !== 'meadow' && world.biome !== 'forest') return;
    const flies = seededRandom('fireflies');
    for (let i = 0; i < 28; i++) {
      const bx = flies(left, right);
      const by = flies(world.floorAt(world.width / 2) + 10, world.height - 20);
      const x = bx + Math.sin(t * flies(0.2, 0.5) + i) * 60;
      const y = by + Math.sin(t * flies(0.3, 0.7) + i * 2) * 30;
      const blink = Math.max(0, Math.sin(t * flies(0.8, 1.6) + i * 1.3));
      g.circle(x, y, 9).fill({ color: 0xd9ff6b, alpha: n * blink * 0.25 });
      g.circle(x, y, 2.5).fill({ color: 0xf4ffb0, alpha: n * blink });
    }
  }

  /** In the Woods: two big trunks right up close at the sides, framing the view. */
  private drawNearTrunks(world: World, g: Graphics) {
    if (world.biome !== 'forest') return;
    const top = Math.min(0, this.visible.top);
    const bottom = Math.max(world.height, this.visible.bottom) + 10;
    for (const [x, w] of [[Math.min(0, this.visible.left) + 20, 90], [Math.max(world.width, this.visible.right) - 30, 110]]) {
      g.poly([x - w / 2, top, x + w / 2, top, x + w * 0.65, bottom, x - w * 0.65, bottom]).fill(0x3e2f22);
      g.poly([x - w * 0.1, top, x + w * 0.15, top, x + w * 0.2, bottom, x - w * 0.1, bottom]).fill({ color: 0x5a4532, alpha: 0.8 });
    }
  }

  /** Tufts of long grass along the front edge of a land place, swaying in the breeze. */
  private drawGrass(world: World) {
    const g = this.foreground.clear();
    if (!world.land || world.biome === 'station' || world.biome === 'moon') return;
    this.drawNearTrunks(world, g);
    const left = Math.min(0, this.visible.left);
    const right = Math.max(world.width, this.visible.right);
    const bottom = Math.max(world.height, this.visible.bottom);
    const [light, dark] = this.look.sand;
    const t = world.time;
    let i = 0;
    for (let x = left; x <= right; x += 38) {
      i++;
      const base = bottom + 4;
      const tall = 36 + ((i * 47) % 30);
      const sway = Math.sin(t * 1.3 + i * 0.7) * 6 + world.current * 0.4;
      for (const k of [-1, 0, 1]) {
        const bx = x + k * 7 + ((i * 13) % 11);
        g.moveTo(bx - 3, base).quadraticCurveTo(bx + k * 4, base - tall * 0.6, bx + k * 10 + sway, base - tall + Math.abs(k) * 8).lineTo(bx + 3, base).fill(k ? dark : light);
      }
    }
  }

  private drawSurface(world: World) {
    const g = this.surface.clear();
    if (world.waterTop <= 0 || world.land) return;
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

  /** Reeds at the pond, rocks and coral in the ocean, the far hills and the barn on land: drawn once per layout. */
  private drawProps(world: World) {
    const g = this.props.clear();
    const rand = seededRandom(`props:${world.biome}`);
    if (this.spaceLook) drawSpaceBack(g, world, this.span(world), this.spaceLook, world.biome);
    else if (world.land) this.drawLandBack(world, g, rand);
    else if (world.biome === 'pond') {
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

  /** Behind the ground: far-off hills and trees, and the farm's barn, silo and fence. */
  private drawLandBack(world: World, g: Graphics, rand: (lo?: number, hi?: number) => number) {
    const left = Math.min(0, this.visible.left) - 40;
    const right = Math.max(world.width, this.visible.right) + 40;
    const top = Math.min(0, this.visible.top);
    const floor = (x: number) => world.floorAt(Math.min(world.width, Math.max(0, x)));
    if (world.biome === 'hills') {
      // Far mountains, misty blue, most with snow on top.
      for (let i = 0; i < 6; i++) {
        const cx = left + ((i + rand(0.1, 0.9)) * (right - left)) / 6;
        const base = floor(cx) + 20;
        const h = rand(220, 330);
        const w = rand(180, 280);
        g.poly([cx - w, base, cx, base - h, cx + w, base]).fill(i % 2 ? 0xa9bfd0 : 0x9db4c7);
        if (rand() < 0.75) {
          g.poly([cx - w * 0.28, base - h * 0.72, cx, base - h, cx + w * 0.28, base - h * 0.72, cx + w * 0.1, base - h * 0.66, cx - w * 0.06, base - h * 0.76, cx - w * 0.16, base - h * 0.68]).fill(0xf4f8fb);
        }
      }
      // Mist settling in front of them.
      const mist = floor(world.width / 2);
      for (let k = 1; k <= 8; k++) g.rect(left, mist - k * 22, right - left, k * 22).fill({ color: 0xeef4f6, alpha: 0.05 });
    }
    // Two rows of far hills, paler the further away they are.
    for (const [lift, color, wave] of [[110, 0xb4d6c0, 0.004], [55, 0x9cc98a, 0.007]] as const) {
      const pts: number[] = [left, world.floorAt(0) + 30];
      for (let x = left; x <= right; x += 20) {
        pts.push(x, world.floorAt(Math.min(world.width, Math.max(0, x))) - lift * (0.55 + 0.45 * Math.sin(x * wave + lift)));
      }
      pts.push(right, world.floorAt(world.width) + 30);
      g.poly(pts).fill(color);
    }
    if (world.biome === 'forest') {
      this.drawWoods(world, g, rand, left, right, top);
      return;
    }
    // A line of round trees along the far edge.
    const trees = world.biome === 'farm' ? 7 : world.biome === 'hills' ? 5 : 12;
    for (let i = 0; i < trees; i++) {
      const x = rand(left, right);
      if (world.biome === 'farm' && x > world.width * 0.68 && x < world.width * 0.95) continue; // the barn's there
      const base = world.floorAt(Math.min(world.width, Math.max(0, x))) + 4;
      const r = rand(16, 30);
      g.rect(x - 3, base - r * 1.2, 6, r * 1.2).fill(0x6b4f35);
      g.circle(x, base - r * 1.5, r).fill(rand() < 0.5 ? 0x5f9a44 : 0x4f8a3c);
      g.circle(x - r * 0.3, base - r * 1.75, r * 0.5).fill({ color: 0x8cc06a, alpha: 0.6 });
    }
    if (world.biome !== 'farm') return;
    // The barn, with a silo beside it.
    const bx = world.width * 0.8;
    const base = world.floorAt(bx) + 10;
    const w = 220;
    const h = 140;
    g.rect(bx + w / 2 + 6, base - h * 1.35, 56, h * 1.35).fill(0xb9c2c9);
    g.ellipse(bx + w / 2 + 34, base - h * 1.35, 28, 18).fill(0x8d98a1);
    g.rect(bx - w / 2, base - h, w, h).fill(0xc0392b);
    g.poly([bx - w / 2 - 14, base - h, bx, base - h - 80, bx + w / 2 + 14, base - h]).fill(0x7b241c);
    g.rect(bx - 40, base - 86, 80, 86).fill(0x922b21).stroke({ width: 5, color: 0xf4f1ea });
    g.moveTo(bx - 40, base - 86).lineTo(bx + 40, base).moveTo(bx + 40, base - 86).lineTo(bx - 40, base).stroke({ width: 5, color: 0xf4f1ea });
    g.rect(bx - 20, base - h - 40, 40, 30).fill(0xf4f1ea);
    // A fence along the back of the field.
    for (let x = left; x <= right; x += 56) {
      const y = world.floorAt(Math.min(world.width, Math.max(0, x))) + 26;
      g.rect(x - 4, y - 46, 8, 50).fill(0xe8dcc3);
    }
    for (const lift of [18, 36]) {
      const pts: number[] = [];
      for (let x = left; x <= right; x += 28) pts.push(x, world.floorAt(Math.min(world.width, Math.max(0, x))) + 26 - lift);
      g.poly(pts, false).stroke({ width: 6, color: 0xe8dcc3 });
    }
  }

  /**
   * The Woods: rows of tall trees, misty far back and darker nearer, their leaves meeting overhead, with
   * beams of sunlight slanting down through the gaps.
   */
  private drawWoods(world: World, g: Graphics, rand: (lo?: number, hi?: number) => number, left: number, right: number, top: number) {
    const floor = (x: number) => world.floorAt(Math.min(world.width, Math.max(0, x)));
    const rows = [
      { count: 18, trunk: 0x9aa79a, leaf: 0xa9c3ae, wide: [8, 14], lift: 0 },
      { count: 12, trunk: 0x7a6650, leaf: 0x6f9a62, wide: [16, 26], lift: 8 },
      { count: 8, trunk: 0x5e4a36, leaf: 0x4f7f45, wide: [28, 42], lift: 18 },
    ];
    for (const row of rows) {
      for (let i = 0; i < row.count; i++) {
        const x = left + ((i + rand(0.15, 0.85)) * (right - left)) / row.count;
        const base = floor(x) + row.lift;
        const w = rand(row.wide[0], row.wide[1]);
        g.poly([x - w / 2, top, x + w / 2, top, x + w * 0.6, base, x - w * 0.6, base]).fill(row.trunk);
        // A branch or two.
        if (rand() < 0.6) {
          const by = rand(world.height * 0.15, world.height * 0.35);
          const dir = rand() < 0.5 ? -1 : 1;
          g.moveTo(x, by + 20).lineTo(x + dir * w * 2.2, by - 10).stroke({ width: Math.max(3, w * 0.25), color: row.trunk, cap: 'round' });
        }
        // Leaves overhead.
        for (let k = 0; k < 4; k++) {
          g.circle(x + rand(-90, 90), rand(top - 20, world.height * 0.14), rand(60, 110)).fill(row.leaf);
        }
      }
    }
    // Sunbeams.
    for (let i = 0; i < 5; i++) {
      const x = rand(world.width * 0.1, world.width * 0.9);
      const w = rand(30, 70);
      const base = floor(x) + 120;
      g.poly([x, world.height * 0.08, x + w, world.height * 0.08, x + w + 140, base, x + 140 - w * 0.5, base]).fill({ color: 0xfff5c8, alpha: 0.12 });
    }
  }

  /** On land, the ground: grass that's lighter at the back, tufts and flowers, a pond's edge or a ploughed field. */
  private drawGround(world: World) {
    const { sand, specks } = this.look;
    const left = Math.floor(Math.min(0, this.visible.left) / 20) * 20;
    const right = Math.max(world.width, this.visible.right);
    const height = Math.max(world.height, this.visible.bottom);
    const g = this.sand;
    const rand = seededRandom(`ground:${world.biome}`);
    const floor = (x: number) => world.floorAt(Math.min(world.width, Math.max(0, x)));
    const band = (lift: number, color: number, alpha = 1) => {
      const pts: number[] = [left, height + 10];
      for (let x = left; x <= right + 20; x += 20) pts.push(x, floor(x) + lift);
      pts.push(right + 20, height + 10);
      g.poly(pts).fill({ color, alpha });
    };
    band(0, sand[0]);
    // Nearer is a richer green.
    for (const [lift, alpha] of [[60, 0.25], [140, 0.35], [230, 0.45]] as const) band(lift, sand[1], alpha);
    band(0, 0xffffff, 0.12);
    band(10, sand[0], 0.9);
    if (this.spaceLook) {
      drawSpaceGround(g, world, this.span(world), this.spaceLook, world.biome);
      return;
    }
    if (world.biome === 'meadow') {
      // The edge of a pond at the back, with reeds.
      const px = world.width * 0.14;
      const py = floor(px) + 34;
      g.ellipse(px, py, 190, 26).fill(0x4f9fc4).ellipse(px, py - 4, 176, 18).fill(0x7cc2e0);
      for (let i = 0; i < 14; i++) {
        const x = px + rand(-200, 200);
        const top = py - rand(30, 70);
        g.moveTo(x, py + rand(0, 12)).lineTo(x + rand(-6, 6), top).stroke({ width: 3, color: 0x4f7d2f });
        if (rand() < 0.4) g.roundRect(x - 4, top - 4, 8, 22, 4).fill(0x6b4426);
      }
    } else if (world.biome === 'hills') {
      // A path winding down the hillside toward us, and rocks dotted about.
      const x0 = world.width * 0.56;
      const y0 = floor(x0) + 6;
      const edgeL: number[] = [];
      const edgeR: number[] = [];
      for (let y = y0; y <= height + 20; y += 15) {
        const t = (y - y0) / (height - y0);
        const cx = x0 + Math.sin(t * 4.2) * 140 * t + t * 120;
        const w = 8 + t * 80;
        edgeL.push(cx - w, y);
        edgeR.unshift(cx + w, y);
      }
      g.poly([...edgeL, ...edgeR]).fill({ color: 0xd9c18e, alpha: 0.9 });
      for (const [x, k, s] of [[0.12, 0.2, 1], [0.3, 0.55, 1.4], [0.82, 0.35, 1.1], [0.9, 0.8, 1.8], [0.4, 0.15, 0.8], [0.7, 0.7, 1.3]] as const) {
        const cx = world.width * x;
        const cy = floor(cx) + 20 + k * (height - floor(cx) - 40);
        const r = 26 * s * (0.6 + k * 0.6);
        g.ellipse(cx, cy, r * 1.3, r * 0.75).fill(0x8d949a);
        g.ellipse(cx - r * 0.25, cy - r * 0.3, r * 0.8, r * 0.38).fill(0xaab1b6);
        g.ellipse(cx, cy + r * 0.6, r * 1.3, r * 0.18).fill({ color: 0x2f4a22, alpha: 0.25 });
      }
    } else if (world.biome === 'forest') {
      // Dappled light on the forest floor, ferns and toadstools.
      for (let i = 0; i < 12; i++) {
        const x = rand(left, right);
        const y = rand(floor(x) + 20, height);
        g.ellipse(x, y, rand(40, 110), rand(10, 24)).fill({ color: 0xfff1b0, alpha: 0.13 });
      }
      for (let i = 0; i < 16; i++) {
        const x = rand(left, right);
        const y = rand(floor(x) + 20, height);
        const s = 18 + ((y - floor(x)) / (height - floor(x))) * 40;
        for (let k = -3; k <= 3; k++) {
          const a = -Math.PI / 2 + k * 0.38;
          g.moveTo(x, y).quadraticCurveTo(x + Math.cos(a) * s * 0.7, y + Math.sin(a) * s * 1.1, x + Math.cos(a) * s * 1.2, y + Math.sin(a) * s * 0.7).stroke({ width: Math.max(2, s * 0.12), color: k % 2 ? 0x3f7a35 : 0x4f8f3f, cap: 'round' });
        }
      }
      for (let i = 0; i < 9; i++) {
        const x = rand(left, right);
        const y = rand(floor(x) + 20, height - 10);
        const s = 6 + ((y - floor(x)) / (height - floor(x))) * 14;
        g.rect(x - s * 0.25, y - s * 1.1, s * 0.5, s * 1.1).fill(0xf3ead6);
        g.ellipse(x, y - s * 1.1, s, s * 0.6).fill(0xd8382d);
        g.ellipse(x, y - s * 1.0, s * 0.85, s * 0.16).fill(0xf3ead6);
        for (const [dx, dy] of [[-0.4, -0.2], [0.35, -0.3], [0, -0.45]]) g.circle(x + dx * s, y - s * 1.1 + dy * s, s * 0.13).fill(0xffffff);
      }
    } else if (world.biome === 'farm') {
      // A ploughed field on the left, with rows of young crops, and a dirt track to the barn.
      const fx = world.width * 0.42;
      const pts: number[] = [left, floor(left) + 8];
      for (let x = left; x <= fx; x += 20) pts.push(x, floor(x) + 8);
      pts.push(fx + 60, floor(fx) + 150, left, floor(left) + 150);
      g.poly(pts).fill(0x9b7650);
      for (let r = 0; r < 7; r++) {
        const y0 = 18 + r * 19;
        const row: number[] = [];
        for (let x = left; x <= fx + (y0 / 150) * 60; x += 12) row.push(x, floor(x) + y0);
        g.poly(row, false).stroke({ width: 4, color: 0x5e8f32 });
      }
      const bx = world.width * 0.8;
      g.poly([bx - 30, floor(bx) + 8, bx + 30, floor(bx) + 8, bx + 150, height + 10, bx - 10, height + 10]).fill({ color: 0xc9a46c, alpha: 0.85 });
      // Hay bales.
      for (const [x, y, s] of [[0.56, 120, 1], [0.6, 150, 1.15], [0.95, 210, 1.3]] as const) {
        const cx = world.width * x;
        const cy = floor(cx) + y;
        g.roundRect(cx - 40 * s, cy - 50 * s, 80 * s, 50 * s, 8).fill(0xe0b84f);
        g.ellipse(cx - 40 * s, cy - 25 * s, 14 * s, 25 * s).fill(0xcfa13d);
        g.ellipse(cx - 40 * s, cy - 25 * s, 8 * s, 15 * s).stroke({ width: 2, color: 0xa87f2a });
      }
    }
    // Tufts of grass, and flowers in the meadow (bigger nearer the front).
    for (let i = 0; i < (right - left) / 5; i++) {
      const x = rand(left, right);
      const y = rand(floor(x) + 14, height);
      const near = (y - floor(x)) / (height - floor(x));
      const s = 3 + near * 6;
      if (world.biome === 'farm' && x < world.width * 0.42 + 60 && y < floor(x) + 150) continue;
      if (world.biome === 'meadow' && rand() < 0.35) {
        const color = [0xffe14d, 0xffe14d, 0xffffff, 0xf6a8c8][Math.floor(rand(0, 4))];
        for (let k = 0; k < 5; k++) g.circle(x + Math.cos(k * 1.26) * s * 0.6, y + Math.sin(k * 1.26) * s * 0.6, s * 0.5).fill(color);
        g.circle(x, y, s * 0.35).fill(color === 0xffe14d ? 0xf0a020 : 0xffd84d);
      } else {
        const color = rand() > 0.5 ? specks[0] : specks[1];
        g.moveTo(x - s, y).lineTo(x - s * 0.6, y - s * 1.6).lineTo(x, y).lineTo(x + s * 0.5, y - s * 1.9).lineTo(x + s, y).fill(color);
      }
    }
  }

  private drawSand(world: World) {
    this.sand.clear();
    if (world.land) {
      this.drawGround(world);
      return;
    }
    const { sand, specks } = this.look;
    const left = Math.floor(Math.min(0, this.visible.left) / 20) * 20;
    const right = Math.max(world.width, this.visible.right);
    const height = Math.max(world.height, this.visible.bottom);
    const rand = seededRandom('sand');
    const g = this.sand;
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
    if (this.spaceLook) drawSpaceGround(g, world, this.span(world), this.spaceLook, world.biome);
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
export function biomeBackdrop(biome: Biome, height: number, waterTop: number, floor: number, look?: string) {
  return backdrop(sceneLook(biome, look), height, waterTop, floor);
}

/** The colour of a biome's sand. */
export const sandColor = (biome: Biome, look?: string) => sceneLook(biome, look).sand[0];

/** The sky (above the water, if any), then the water: light at the surface, deep by the bottom. */
function backdrop(look: Look, height: number, waterTop: number, floor: number) {
  const canvas = document.createElement('canvas');
  canvas.width = 4;
  canvas.height = Math.max(64, Math.min(1024, Math.round(height)));
  const ctx = canvas.getContext('2d')!;
  const grad = ctx.createLinearGradient(0, 0, 0, canvas.height);
  const f = (y: number) => Math.min(1, Math.max(0, y / height));
  const surface = f(waterTop);
  if (surface >= 1) {
    // A land place: all sky, paling toward the far side of the field.
    grad.addColorStop(0, look.sky[0]);
    grad.addColorStop(Math.max(0.01, f(floor)), look.sky[1]);
    grad.addColorStop(1, look.sky[1]);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    return Texture.from(canvas);
  }
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
