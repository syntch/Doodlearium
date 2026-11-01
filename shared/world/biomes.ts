import type { Drawing, Motion } from '../types.ts';
import { motionOf } from '../types.ts';

/** The kinds of place in the world. Land ones open up once land animals exist. */
export const BIOMES = ['lake', 'pond', 'ocean', 'seashore', 'meadow', 'hills', 'forest', 'farm'] as const;
export type Biome = (typeof BIOMES)[number];
export const WATER_BIOMES: Biome[] = ['lake', 'pond', 'ocean', 'seashore'];

export const BIOME_NAMES: Record<Biome, string> = {
  lake: '🏞️ Lake',
  pond: '🪷 Pond',
  ocean: '🌊 Ocean',
  seashore: '🏖️ Seashore',
  meadow: '🌼 Meadow',
  hills: '⛰️ Hills',
  forest: '🌲 Forest',
  farm: '🚜 Farm',
};

/** Where a style lives unless its artist says otherwise. */
const DEFAULT_HABITATS: Record<Motion, Biome[]> = {
  fish: ['lake', 'pond', 'ocean', 'seashore'],
  puffer: ['ocean', 'seashore'],
  seahorse: ['ocean', 'seashore'],
  jelly: ['ocean'],
  eel: ['lake', 'ocean'],
  flapper: ['lake', 'ocean'],
  vessel: ['lake', 'ocean'],
  crawler: ['seashore', 'pond', 'lake', 'ocean'],
  plant: [...WATER_BIOMES],
  decor: [...BIOMES],
};

export const defaultHabitats = (motion: Motion) => DEFAULT_HABITATS[motion];
export const habitatsOf = (d: Drawing): Biome[] => (d.habitats?.length ? d.habitats : DEFAULT_HABITATS[motionOf(d)]);
/** Fish come in schools unless their artist says otherwise. */
export const defaultGroup = (motion: Motion) => motion === 'fish';
export const isGroup = (d: Drawing) => d.group ?? defaultGroup(motionOf(d));

/**
 * The shape of a place's side view, in tank units (see shared/sim/world.ts): where the water starts, and
 * how high the bottom is across the tank. Most places have a flat bottom; the seashore's rises to a beach.
 */
export interface Shape {
  /** Top of the water (0 when the water fills the tank). */
  waterTop: number;
  /** The bottom's height at x (top edge of the sand). */
  floorAt(x: number): number;
  /** Swimmers stay right of this, where the water is deep enough. */
  waterLeft: number;
}

export function shapeOf(biome: Biome, width: number, height: number): Shape {
  const flat = (floor: number, waterTop = 0): Shape => ({ waterTop, floorAt: () => floor * height, waterLeft: 0 });
  switch (biome) {
    case 'pond':
      return flat(0.84, height * 0.1);
    case 'ocean':
      return flat(0.9);
    case 'seashore': {
      // Dry beach on the left, sloping down under the waves to a sandy bottom.
      const beach = 0.18;
      const deep = 0.5;
      return {
        waterTop: height * 0.3,
        floorAt: (x) => {
          const u = x / width;
          if (u <= beach) return height * 0.27;
          if (u >= deep) return height * 0.88;
          const t = (u - beach) / (deep - beach);
          return height * (0.27 + 0.61 * t * t * (3 - 2 * t));
        },
        waterLeft: width * 0.34,
      };
    }
    default:
      return flat(0.86);
  }
}
