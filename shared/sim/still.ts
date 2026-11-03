import type { Drawing } from '../types.ts';
import { newPose, type Placement, type SimCreature } from './creature.ts';
import { depthScale, seededRandom } from './math.ts';
import { sizeFactor } from './styles.ts';
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
    placement?: Placement,
  ) {
    const rand = seededRandom(id);
    const z = rand();
    // Plants grow under water (on the beach, that's past the shore); decorations can go anywhere.
    const nx = kind === 'plant' ? rand(Math.max(0.04, world.waterLeft / world.width + 0.02), 0.96) : rand(0.05, 0.95);
    const landPlant = kind === 'plant' && world.land;
    const grow = sizeFactor(drawing, landPlant);
    const size = (kind === 'plant' ? rand(0.8, 1.25) : rand(0.85, 1.2)) * grow;
    // Weeds grow tall under water; on land, a medium plant is about as tall as a horse.
    const [tall, wide] = landPlant ? [0.11, 0.22] : kind === 'plant' ? [0.32, 0.22] : [0.2, 0.25];
    // Plants are measured by height; decorations by their overall size, so a flat clam and a tall
    // castle come out about as big as each other.
    const measure = kind === 'plant' ? drawing.height : Math.sqrt(drawing.width * drawing.height);
    const scale = Math.min((world.height * tall * size * depthScale(z)) / measure, (world.width * wide * grow) / drawing.width);
    this.place(world, placement ?? { x: nx, z, scale: scale / depthScale(z) });
  }

  private place(world: World, { x, z, scale }: Placement) {
    const s = scale * depthScale(z);
    Object.assign(this.pose, { x: x * world.width, y: sandY(world, z, x * world.width), sx: s, sy: s, z });
  }

  hideout(): Hideout {
    const p = this.pose;
    return { x: p.x, bottom: p.y, height: this.drawing.height * p.sy, halfWidth: (this.drawing.width * p.sx) / 2, z: p.z };
  }

  update() {}
}
