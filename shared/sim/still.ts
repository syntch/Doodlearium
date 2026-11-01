import type { Drawing } from '../types.ts';
import { newPose, type SimCreature } from './creature.ts';
import { depthScale, seededRandom } from './math.ts';
import { sandY, type Hideout, type World } from './world.ts';

/**
 * Plants and decorations: they stay where they grew (a spot picked from the drawing's id, so it never
 * changes), and fish sleep and hide beside them. Plants sway on the screen; that's just for looks.
 */
export class SimStill implements SimCreature {
  readonly pose = newPose();

  constructor(
    readonly id: string,
    readonly drawing: Drawing,
    readonly kind: 'plant' | 'decor',
    world: World,
  ) {
    const rand = seededRandom(id);
    const z = rand();
    const nx = kind === 'plant' ? rand(0.04, 0.96) : rand(0.05, 0.95);
    const size = kind === 'plant' ? rand(0.8, 1.25) : rand(0.85, 1.2);
    const [tall, wide] = kind === 'plant' ? [0.32, 0.22] : [0.2, 0.25];
    const scale = Math.min((world.height * tall * size * depthScale(z)) / drawing.height, (world.width * wide) / drawing.width);
    Object.assign(this.pose, { x: nx * world.width, y: sandY(world, z, nx * world.width), sx: scale, sy: scale, z });
  }

  hideout(): Hideout {
    const p = this.pose;
    return { x: p.x, bottom: p.y, height: this.drawing.height * p.sy, halfWidth: (this.drawing.width * p.sx) / 2, z: p.z };
  }

  update() {}
}
