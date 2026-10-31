import type { Texture } from 'pixi.js';
import { motionOf, type CreatureType, type Drawing } from '../../shared/types.ts';
import { Crawler } from './behaviors/crawler.ts';
import { Decor } from './behaviors/decor.ts';
import { Plant } from './behaviors/plant.ts';
import { Swimmer } from './behaviors/swimmer.ts';
import type { Cutout } from './parts.ts';
import type { Creature, World } from './world.ts';

/** How many of each kind the tank shows at once; older ones retire to the gallery. */
export const CAPS: Record<CreatureType, number> = { swimmer: 40, crawler: 10, plant: 24, decor: 14 };

/**
 * The drawing's motion style picks its behaviour; every open-water style shares the swimmer brain.
 * pieces are the drawing's animated parts, already cut out of texture (see parts.ts).
 */
export function createCreature(
  drawing: Drawing,
  texture: Texture,
  world: World,
  dropIn: boolean,
  pieces: Cutout['pieces'] = [],
): Creature {
  switch (motionOf(drawing)) {
    case 'crawler':
      return new Crawler(drawing, texture, world, dropIn, pieces);
    case 'plant':
      return new Plant(drawing, texture, world, pieces);
    case 'decor':
      return new Decor(drawing, texture, world, pieces);
    default:
      return new Swimmer(drawing, texture, world, dropIn, pieces);
  }
}
