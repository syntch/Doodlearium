import { Graphics } from 'pixi.js';
import { FOOD_COLORS, LANDED_SECONDS } from '../../shared/sim/food.ts';

/** One flake as the simulation sent it: [id, x, y, size, color, landedFor] (see shared/sim/protocol.ts). */
export type FlakeState = number[];

/** Draws the fish food: flakes that tumble as they drift down, and fade once they've settled on the sand. */
export class Food {
  readonly view = new Graphics();

  draw(flakes: FlakeState[], time: number) {
    const g = this.view.clear();
    for (const [id, x, y, size, color, landedFor] of flakes) {
      const alpha = Math.min(1, (LANDED_SECONDS - landedFor) / 2);
      const tilt = Math.sin(time * 3 + id * 1.7) * 0.5;
      const w = size * 1.4;
      const h = size * (0.6 + 0.4 * Math.abs(Math.cos(tilt)));
      g.ellipse(x, y, w, h).fill({ color: FOOD_COLORS[color] ?? FOOD_COLORS[0], alpha });
    }
  }
}
