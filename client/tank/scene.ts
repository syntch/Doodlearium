import { Container, Graphics, Sprite, Texture } from 'pixi.js';
import type { Effect } from '../../shared/sim/world.ts';
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

const AERATORS = [0.14, 0.86];
const RAY_COUNT = 6;

/** Everything that isn't a drawing: water, light, sand, bubbles and the day/night tint. */
export class Scene {
  readonly back = new Container();
  readonly front = new Container();

  private background = new Sprite();
  private rays = new Graphics();
  private sand = new Graphics();
  private bubbleGfx = new Graphics();
  private night = new Graphics();
  private bubbles: Bubble[] = [];
  private hearts: Heart[] = [];
  /** Called for every aerator bubble burst, e.g. to make a sound. */
  onBloop: (() => void) | null = null;
  private bloopIn = 3;
  private aeratorTimers = AERATORS.map(() => 0);
  private rayShape = Array.from({ length: RAY_COUNT }, (_, i) => ({
    x: (i + 0.5) / RAY_COUNT + (Math.random() - 0.5) * 0.08,
    width: 0.03 + Math.random() * 0.05,
    skew: 0.08 + Math.random() * 0.1,
    phase: Math.random() * TAU,
  }));

  constructor() {
    this.rays.blendMode = 'add';
    this.back.addChild(this.background, this.rays, this.sand);
    this.front.addChild(this.bubbleGfx, this.night);
  }

  private visible: Visible = { left: 0, top: 0, right: 0, bottom: 0 };

  /** visible is how far the screen sees past the tank's own edges (screens of another shape see more). */
  layout(world: World, visible: Visible = { left: 0, top: 0, right: world.width, bottom: world.height }) {
    this.visible = visible;
    if (this.background.texture !== Texture.EMPTY) this.background.texture.destroy(true);
    // The water darkens with depth down to the sand, and stays that colour below.
    const top = Math.min(0, visible.top);
    this.background.texture = waterGradient(world.height - top, world.floorY - top);
    this.background.position.set(visible.left, top);
    this.background.width = visible.right - visible.left;
    this.background.height = Math.max(world.height, visible.bottom) - top;
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

    this.aeratorTimers.forEach((timer, i) => {
      this.aeratorTimers[i] = timer - dt;
      if (this.aeratorTimers[i] <= 0) {
        this.aeratorTimers[i] = 0.08 + Math.random() * 0.35;
        this.bubble(AERATORS[i] * world.width + (Math.random() - 0.5) * 10, world.floorY + 10, 2 + Math.random() * 5);
      }
    });
    this.bloopIn -= dt;
    if (this.bloopIn <= 0) {
      this.bloopIn = 3 + Math.random() * 7;
      this.onBloop?.();
    }

    const g = this.bubbleGfx.clear();
    this.bubbles = this.bubbles.filter((b) => b.y > Math.min(0, this.visible.top) - 20);
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
    for (const ray of this.rayShape) {
      const alpha = 0.035 + 0.03 * Math.sin(world.time * 0.4 + ray.phase);
      const x0 = ray.x * world.width;
      const top = ray.width * world.width;
      const bottom = top * 2.6;
      const shift = ray.skew * world.width;
      g.poly([x0, 0, x0 + top, 0, x0 + shift + bottom, world.floorY, x0 + shift, world.floorY]).fill({ color: 0xbfe9ff, alpha });
    }
  }

  private drawSand(world: World) {
    const { floorY } = world;
    const left = Math.floor(Math.min(0, this.visible.left) / 20) * 20;
    const right = Math.max(world.width, this.visible.right);
    const height = Math.max(world.height, this.visible.bottom);
    const rand = seededRandom('sand');
    const g = this.sand.clear();
    const points: number[] = [left, height];
    for (let x = left; x <= right + 20; x += 20) {
      points.push(x, floorY + Math.sin(x * 0.006) * 10 + Math.sin(x * 0.019 + 1) * 4);
    }
    points.push(right + 20, height);
    g.poly(points).fill(0xcbb07a);
    g.poly(points.map((v, i) => (i % 2 === 1 && v !== height ? v + 14 : v))).fill(0xb89a63);
    for (let i = 0; i < (right - left) / 6; i++) {
      const x = rand(left, right);
      const y = rand(floorY + 18, height);
      g.circle(x, y, rand(1, 3.5)).fill({ color: rand() > 0.5 ? 0x8f7448 : 0xe2cf9f, alpha: 0.7 });
    }
  }
}

/** Light at the top, deep blue by the sand (floor, in the same units as height). */
function waterGradient(height: number, floor = height) {
  const canvas = document.createElement('canvas');
  canvas.width = 4;
  canvas.height = Math.max(64, Math.min(1024, Math.round(height)));
  const ctx = canvas.getContext('2d')!;
  const grad = ctx.createLinearGradient(0, 0, 0, canvas.height);
  const end = Math.min(1, floor / height);
  grad.addColorStop(0, '#4fb8e0');
  grad.addColorStop(0.45 * end, '#1f78a8');
  grad.addColorStop(end, '#0a3456');
  grad.addColorStop(1, '#0a3456');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  return Texture.from(canvas);
}

const mixColor = (a: number, b: number, t: number) => {
  const ch = (shift: number) => Math.round(((a >> shift) & 255) + ((((b >> shift) & 255) - ((a >> shift) & 255)) * t));
  return (ch(16) << 16) | (ch(8) << 8) | ch(0);
};
