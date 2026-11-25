import type { Texture } from 'pixi.js';
import type { Drawing } from '../../shared/types.ts';
import type { Kind } from '../../shared/sim/creature.ts';
import { Crawler } from './behaviors/crawler.ts';
import { Decor } from './behaviors/decor.ts';
import { Egg } from './behaviors/egg.ts';
import { Plant } from './behaviors/plant.ts';
import { Swimmer } from './behaviors/swimmer.ts';
import { Walker } from './behaviors/walker.ts';
import type { Cutout } from './parts.ts';
import type { Creature } from './world.ts';

/**
 * How a drawing looks on screen, by what the simulation says it is (every open-water style is a swimmer).
 * pieces are the drawing's animated parts, already cut out of texture (see parts.ts).
 */
export function createCreature(drawing: Drawing, kind: Kind, texture: Texture, pieces: Cutout['pieces'] = []): Creature {
  switch (kind) {
    case 'egg':
      return new Egg(drawing, texture);
    case 'crawler':
      return new Crawler(drawing, texture, pieces);
    case 'plant':
      return new Plant(drawing, texture, pieces);
    case 'decor':
      return new Decor(drawing, texture, pieces);
    case 'walker':
    case 'flier':
      return new Walker(drawing, texture, pieces);
    default:
      return new Swimmer(drawing, texture, pieces);
  }
}
