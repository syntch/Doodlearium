import { Container, Graphics, Sprite, Texture } from 'pixi.js';
import { TAU, seededRandom, type World } from './world.ts';

interface Bubble {
  x: number;
  y: number;
  r: number;
  speed: number;
  wobble: number;
  phase: number;
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

  layout(world: World) {
    if (this.background.texture !== Texture.EMPTY) this.background.texture.destroy(true);
    this.background.texture = waterGradient(world.height);
    this.background.width = world.width;
    this.background.height = world.height;
    this.drawSand(world);
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

    const g = this.bubbleGfx.clear();
    this.bubbles = this.bubbles.filter((b) => b.y > -20);
    for (const b of this.bubbles) {
      b.y -= b.speed * dt;
      b.phase += dt * 3;
      const x = b.x + Math.sin(b.phase) * b.wobble;
      g.circle(x, b.y, b.r).fill({ color: 0xffffff, alpha: 0.12 }).stroke({ width: 1.2, color: 0xe8f7ff, alpha: 0.55 });
      g.circle(x - b.r * 0.35, b.y - b.r * 0.35, b.r * 0.25).fill({ color: 0xffffff, alpha: 0.7 });
    }

    this.darkness = nightDarkness();
    this.night.clear().rect(0, 0, world.width, world.height).fill({ color: 0x020d24, alpha: this.darkness });
  }

  /** 0 in daylight, 0.5 at full night. */
  darkness = 0;

  /** Night creatures come out once it's getting properly dark. */
  get isNight() {
    return this.darkness >= 0.25;
  }

  bubble(x: number, y: number, r: number) {
    if (this.bubbles.length > 300) return;
    this.bubbles.push({ x, y, r, speed: 40 + r * 14 + Math.random() * 20, wobble: 2 + Math.random() * 4, phase: Math.random() * TAU });
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
    const { width, height, floorY } = world;
    const rand = seededRandom('sand');
    const g = this.sand.clear();
    const points: number[] = [0, height];
    for (let x = 0; x <= width; x += 20) {
      points.push(x, floorY + Math.sin(x * 0.006) * 10 + Math.sin(x * 0.019 + 1) * 4);
    }
    points.push(width, height);
    g.poly(points).fill(0xcbb07a);
    g.poly(points.map((v, i) => (i % 2 === 1 && v !== height ? v + 14 : v))).fill(0xb89a63);
    for (let i = 0; i < width / 6; i++) {
      const x = rand(0, width);
      const y = rand(floorY + 18, height);
      g.circle(x, y, rand(1, 3.5)).fill({ color: rand() > 0.5 ? 0x8f7448 : 0xe2cf9f, alpha: 0.7 });
    }
  }
}

function waterGradient(height: number) {
  const canvas = document.createElement('canvas');
  canvas.width = 4;
  canvas.height = Math.max(64, Math.min(1024, Math.round(height)));
  const ctx = canvas.getContext('2d')!;
  const grad = ctx.createLinearGradient(0, 0, 0, canvas.height);
  grad.addColorStop(0, '#4fb8e0');
  grad.addColorStop(0.45, '#1f78a8');
  grad.addColorStop(1, '#0a3456');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  return Texture.from(canvas);
}

/** `/tank/?hour=22` pretends it's that hour, to preview night (or day) any time. */
const HOUR_OVERRIDE = Number.parseFloat(new URLSearchParams(location.search).get('hour') ?? '');

/** 0 during the day, up to 0.5 at night, easing through dawn (5–8h) and dusk (18–21h). */
function nightDarkness() {
  const now = new Date();
  const hour = Number.isFinite(HOUR_OVERRIDE) ? HOUR_OVERRIDE % 24 : now.getHours() + now.getMinutes() / 60;
  const max = 0.5;
  if (hour >= 8 && hour < 18) return 0;
  if (hour >= 21 || hour < 5) return max;
  if (hour < 8) return max * (1 - (hour - 5) / 3);
  return (max * (hour - 18)) / 3;
}
