import { Container, Graphics } from 'pixi.js';
import { seasonOf, type Season } from '../../shared/sim/math.ts';
import { TAU, sandY, seededRandom, type World } from './world.ts';

interface Flake {
  x: number;
  y: number;
  r: number;
  speed: number;
  phase: number;
}

const BULBS = [0xff4d4d, 0xffd23f, 0x4dd17a, 0x4da6ff, 0xff7de9];

/**
 * Decorations that come and go with the calendar: snow drifting down in winter, glowing jack-o'-lanterns
 * and spooky light around Halloween, twinkling lights along the top in December, hearts for Valentine's.
 */
export class Seasons {
  /** Behind the creatures, on the sand. */
  readonly back = new Container();
  /** In front of everything, above the night tint, so lights glow in the dark. */
  readonly glow = new Container();
  private pumpkins = new Graphics();
  private faces = new Graphics();
  private snowGfx = new Graphics();
  private lightsGfx = new Graphics();
  private spooky = new Graphics();
  private flakes: Flake[] = [];
  private heartIn = 2;

  constructor(public season: Season = seasonOf()) {
    this.back.addChild(this.pumpkins);
    this.faces.blendMode = 'add';
    this.glow.addChild(this.spooky, this.snowGfx, this.faces, this.lightsGfx);
  }

  /** Swaps to another season's decorations (the simulation says which). */
  set(season: Season, world: World) {
    if (JSON.stringify(season) === JSON.stringify(this.season)) return;
    this.season = season;
    for (const g of [this.faces, this.snowGfx, this.lightsGfx, this.spooky]) g.clear();
    this.flakes = [];
    this.layout(world);
  }

  layout(world: World) {
    this.pumpkins.clear();
    if (!this.season.halloween) return;
    const rand = seededRandom('pumpkins');
    for (const nx of [0.08, 0.31, 0.72, 0.93]) {
      const z = rand(0.3, 0.8);
      const r = world.height * rand(0.035, 0.05) * (1 - z * 0.4);
      const x = nx * world.width;
      const y = sandY(world, z, x) - r * 0.8;
      for (const dx of [-0.45, 0.45, 0]) {
        this.pumpkins.ellipse(x + dx * r, y, r * (dx ? 0.62 : 0.7), r * 0.8).fill(dx ? 0xd96a14 : 0xf08a24).stroke({ width: 1.5, color: 0x9a4508 });
      }
      this.pumpkins.roundRect(x - r * 0.08, y - r * 1.05, r * 0.16, r * 0.3, r * 0.05).fill(0x4f6b1f);
    }
  }

  update(dt: number, world: World, darkness: number) {
    const { season } = this;
    const night = darkness / 0.5;

    if (season.halloween) {
      // Carved faces flicker like candles, brighter in the dark; the water turns a little eerie at night.
      const rand = seededRandom('pumpkins');
      const g = this.faces.clear();
      for (const nx of [0.08, 0.31, 0.72, 0.93]) {
        const z = rand(0.3, 0.8);
        const r = world.height * rand(0.035, 0.05) * (1 - z * 0.4);
        const x = nx * world.width;
        const y = sandY(world, z, x) - r * 0.8;
        const flicker = 0.55 + 0.25 * Math.sin(world.time * 9 + nx * 40) + 0.2 * Math.sin(world.time * 23 + nx * 7);
        const color = 0xffc23a;
        const alpha = (0.35 + 0.65 * night) * flicker;
        g.poly([x - r * 0.42, y - r * 0.1, x - r * 0.2, y - r * 0.45, x - r * 0.05, y - r * 0.1]).fill({ color, alpha });
        g.poly([x + r * 0.42, y - r * 0.1, x + r * 0.2, y - r * 0.45, x + r * 0.05, y - r * 0.1]).fill({ color, alpha });
        g.poly([x - r * 0.45, y + r * 0.15, x - r * 0.2, y + r * 0.3, x, y + r * 0.18, x + r * 0.2, y + r * 0.3, x + r * 0.45, y + r * 0.15, x, y + r * 0.5]).fill({ color, alpha });
        g.circle(x, y, r * 1.6).fill({ color: 0xff8a1a, alpha: 0.06 * flicker * (0.4 + night) });
      }
      // Well past the tank's edges, for screens that see more water and sand around it.
      this.spooky.clear().rect(-world.width, -world.height, world.width * 3, world.height * 3).fill({ color: 0x5a1f7a, alpha: 0.12 * night });
    }

    if (season.snow) {
      if (this.flakes.length < 90 && Math.random() < dt * 6) {
        this.flakes.push({ x: Math.random() * world.width, y: -5, r: 1.5 + Math.random() * 2.5, speed: 18 + Math.random() * 22, phase: Math.random() * TAU });
      }
      const g = this.snowGfx.clear();
      this.flakes = this.flakes.filter((f) => f.y < world.floorY + 10);
      for (const f of this.flakes) {
        f.y += f.speed * dt;
        f.phase += dt;
        f.x += (Math.sin(f.phase) * 12 + world.current * 0.6) * dt;
        g.circle(f.x, f.y, f.r).fill({ color: 0xffffff, alpha: 0.75 });
      }
    }

    if (season.lights) {
      // A drooping string of bulbs along the top, twinkling.
      const g = this.lightsGfx.clear();
      const spans = 4;
      const sag = world.height * 0.04;
      const wire = (t: number) => {
        const span = t * spans;
        const local = span - Math.floor(span);
        return { x: t * world.width, y: world.height * 0.015 + sag * 4 * local * (1 - local) };
      };
      const points: number[] = [];
      for (let i = 0; i <= 80; i++) {
        const p = wire(i / 80);
        points.push(p.x, p.y);
      }
      g.poly(points, false).stroke({ width: 2, color: 0x1d3b2a, alpha: 0.9 });
      const count = 28;
      const r = Math.max(4, world.height * 0.009);
      for (let i = 0; i < count; i++) {
        const p = wire((i + 0.5) / count);
        const color = BULBS[i % BULBS.length];
        const twinkle = 0.6 + 0.4 * Math.sin(world.time * 2.2 + i * 1.7);
        g.circle(p.x, p.y + r * 1.2, r * 3).fill({ color, alpha: (0.08 + 0.2 * night) * twinkle });
        g.ellipse(p.x, p.y + r * 1.2, r * 0.75, r * 1.1).fill({ color, alpha: 0.75 + 0.25 * twinkle });
      }
    }

    if (season.valentine) {
      this.heartIn -= dt;
      if (this.heartIn <= 0) {
        this.heartIn = 1.5 + Math.random() * 3;
        world.scene.heart(world.width * (0.1 + Math.random() * 0.8), world.floorY, world.height * 0.015);
      }
    }
  }
}
