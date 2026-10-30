import type { Texture } from 'pixi.js';
import type { CreatureType, Drawing } from '../../shared/types.ts';
import { Decor } from './behaviors/decor.ts';
import { Plant } from './behaviors/plant.ts';
import { Swimmer } from './behaviors/swimmer.ts';
import type { Creature, World } from './world.ts';

/** How many of each kind the tank shows at once; older ones retire to the gallery. */
export const CAPS: Record<CreatureType, number> = { swimmer: 40, plant: 24, decor: 14 };

/** The drawing's type picks its behaviour. New kinds (crawlers, floaters…) plug in here. */
export function createCreature(drawing: Drawing, texture: Texture, world: World, dropIn: boolean): Creature {
  switch (drawing.type) {
    case 'swimmer':
      return new Swimmer(drawing, texture, world, dropIn);
    case 'plant':
      return new Plant(drawing, texture, world);
    case 'decor':
      return new Decor(drawing, texture, world);
  }
}
