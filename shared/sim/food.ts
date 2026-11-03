import { TAU } from './math.ts';
import { burst, sandY, type World } from './world.ts';

export interface Flake {
  id: number;
  x: number;
  y: number;
  size: number;
  /** Which of the food colours (see FOOD_COLORS). */
  color: number;
  phase: number;
  drift: number;
  age: number;
  /** Seconds since it reached the sand; flakes there fade away. */
  landedFor: number;
  eaten: boolean;
  /** A submarine is on its way to collect it (and its neighbours), so it lingers on the sand longer. */
  claimed?: boolean;
  /** On land: how far back it lands (seeds are scattered over the field, not dropped through water). */
  z?: number;
}

export const FOOD_COLORS = [0xe0882f, 0xc8552d, 0x9cc25a, 0xe8c25a];
export const LANDED_SECONDS = 8;

/** Fish food: flakes that drift down, get eaten, or settle on the sand and fade. */
export class SimFood {
  readonly flakes: Flake[] = [];
  private nextId = 1;

  drop(world: World, xFraction: number) {
    const cx = xFraction * world.width;
    if (world.land) {
      // Seeds and grain, scattered over the grass in a little arc.
      for (let i = 0; i < 22; i++) {
        const z = Math.random();
        const x = cx + (Math.random() - 0.5) * world.width * 0.22;
        this.flakes.push({
          id: this.nextId++,
          x,
          y: sandY(world, z, x) - world.height * (0.12 + Math.random() * 0.1),
          size: world.height * (0.004 + Math.random() * 0.003),
          color: Math.floor(Math.random() * FOOD_COLORS.length),
          phase: Math.random() * TAU,
          drift: 0,
          age: 0,
          landedFor: 0,
          eaten: false,
          z,
        });
      }
      return;
    }
    for (let i = 0; i < 18; i++) {
      this.flakes.push({
        id: this.nextId++,
        x: cx + (Math.random() - 0.5) * world.width * 0.14,
        y: world.waterTop - Math.random() * world.height * 0.1,
        size: world.height * (0.004 + Math.random() * 0.004),
        color: Math.floor(Math.random() * FOOD_COLORS.length),
        phase: Math.random() * TAU,
        drift: 10 + Math.random() * 25,
        age: 0,
        landedFor: 0,
        eaten: false,
      });
    }
    burst(world, cx, 0, 12);
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
    for (let i = this.flakes.length - 1; i >= 0; i--) {
      const f = this.flakes[i];
      f.age += dt;
      const restY = f.z === undefined ? world.floorAt(f.x) + f.size * 2 : sandY(world, f.z, f.x);
      if (f.y < restY) {
        // Seeds fall quickly through the air (speeding up); flakes drift down through the water.
        f.y = Math.min(restY, f.y + world.height * (f.z === undefined ? 0.045 : (0.15 + f.age * 0.6) * (world.gravity ?? 1)) * dt);
        f.x += (Math.sin(f.age * 2 + f.phase) * f.drift + world.current) * dt;
      } else {
        f.landedFor += dt * (f.claimed ? 0.25 : 1);
      }
      if (f.eaten || f.landedFor > LANDED_SECONDS) this.flakes.splice(i, 1);
    }
  }
}
