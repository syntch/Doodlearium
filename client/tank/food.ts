import { Graphics } from 'pixi.js';
import { TAU, type World } from './world.ts';

export interface Flake {
  x: number;
  y: number;
  size: number;
  color: number;
  phase: number;
  drift: number;
  age: number;
  /** Seconds since it reached the sand; flakes there fade away. */
  landedFor: number;
  eaten: boolean;
  /** A submarine is on its way to collect it (and its neighbours), so it lingers on the sand longer. */
  claimed?: boolean;
}

const COLORS = [0xe0882f, 0xc8552d, 0x9cc25a, 0xe8c25a];
const LANDED_SECONDS = 8;

/** Fish food: flakes that drift down, get eaten, or settle on the sand and fade. */
export class Food {
  readonly view = new Graphics();
  readonly flakes: Flake[] = [];

  drop(world: World, xFraction: number) {
    const cx = xFraction * world.width;
    for (let i = 0; i < 18; i++) {
      this.flakes.push({
        x: cx + (Math.random() - 0.5) * world.width * 0.14,
        y: -Math.random() * world.height * 0.1,
        size: world.height * (0.004 + Math.random() * 0.004),
        color: COLORS[Math.floor(Math.random() * COLORS.length)],
        phase: Math.random() * TAU,
        drift: 10 + Math.random() * 25,
        age: 0,
        landedFor: 0,
        eaten: false,
      });
    }
    world.scene.burst(cx, 0, 12);
  }

  /** The closest uneaten flake, drifting or (while still fresh) on the sand; or only ones that have sunk below `below`. */
  nearest(x: number, y: number, below = -Infinity): Flake | null {
    let best: Flake | null = null;
    let bestDist = Infinity;
    for (const f of this.flakes) {
      if (f.eaten || f.landedFor > LANDED_SECONDS - 2 || (f.landedFor <= 0 && f.y < below)) continue;
      const d = Math.hypot(f.x - x, f.y - y);
      if (d < bestDist) {
        best = f;
        bestDist = d;
      }
    }
    return best;
  }

  update(dt: number, world: World) {
    const g = this.view.clear();
    for (let i = this.flakes.length - 1; i >= 0; i--) {
      const f = this.flakes[i];
      f.age += dt;
      const restY = world.floorY + f.size * 2;
      if (f.y < restY) {
        f.y = Math.min(restY, f.y + world.height * 0.045 * dt);
        f.x += (Math.sin(f.age * 2 + f.phase) * f.drift + world.current) * dt;
      } else {
        f.landedFor += dt * (f.claimed ? 0.25 : 1);
      }
      if (f.eaten || f.landedFor > LANDED_SECONDS) {
        this.flakes.splice(i, 1);
        continue;
      }
      const alpha = Math.min(1, (LANDED_SECONDS - f.landedFor) / 2);
      const tilt = Math.sin(f.age * 3 + f.phase) * 0.5;
      const w = f.size * 1.4;
      const h = f.size * (0.6 + 0.4 * Math.abs(Math.cos(tilt)));
      g.ellipse(f.x, f.y, w, h).fill({ color: f.color, alpha });
    }
  }
}
