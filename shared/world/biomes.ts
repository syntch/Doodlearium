import type { Drawing, Motion } from '../types.ts';
import { motionOf } from '../types.ts';

/** The kinds of place in the world. Land ones open up once land animals exist. */
export const BIOMES = ['lake', 'pond', 'ocean', 'seashore', 'meadow', 'hills', 'forest', 'farm'] as const;
export type Biome = (typeof BIOMES)[number];
export const WATER_BIOMES: Biome[] = ['lake', 'pond', 'ocean', 'seashore'];
export const LAND_BIOMES: Biome[] = ['meadow', 'farm', 'hills', 'forest'];
export const isLand = (biome: Biome) => LAND_BIOMES.includes(biome);

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
  walker: ['farm', 'meadow', 'hills'],
  hopper: ['meadow', 'hills', 'forest'],
  slitherer: ['forest', 'meadow'],
  flier: ['meadow', 'farm', 'hills', 'forest', 'pond', 'seashore'],
  waterfowl: ['pond', 'seashore', 'meadow', 'farm'],
  // Plants and decorations drawn before the land opened were made for the water; on land, tick the places.
  plant: [...WATER_BIOMES],
  decor: [...WATER_BIOMES],
};

export const defaultHabitats = (motion: Motion) => DEFAULT_HABITATS[motion];
/** Places with open sky above the water or the ground. The Lake and the Ocean are all underwater. */
export const hasSky = (biome: Biome) => isLand(biome) || biome === 'pond' || biome === 'seashore';
/** Whether a style can live in a kind of place: fliers (and waterfowl) need a sky to fly in. */
export const suits = (motion: Motion, biome: Biome) => (motion !== 'flier' && motion !== 'waterfowl') || hasSky(biome);
/** Where it lives: the places its artist ticked that suit its style (its style's usual if none do). */
export function habitatsOf(d: Drawing): Biome[] {
  const motion = motionOf(d);
  const picked = (d.habitats ?? []).filter((b) => suits(motion, b));
  return picked.length ? picked : DEFAULT_HABITATS[motion];
}
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
  /** A land place: no water at all (waterTop is the bottom of the tank), sky above the ground. */
  land?: boolean;
  /** How deep the ground runs from back to front, as a share of the height (the sand's is shallower). */
  groundDepth?: number;
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
    case 'meadow':
    case 'farm':
    case 'hills':
    case 'forest': {
      // The ground's back edge: the far side of the field. Things nearer the front stand lower down.
      const back = (u: number) => {
        if (biome === 'meadow') return 0.56 + Math.sin(u * 8.2 + 0.6) * 0.018 + Math.sin(u * 3.1) * 0.012;
        if (biome === 'hills') return 0.6 - 0.11 * Math.exp(-(((u - 0.55) / 0.22) ** 2)) + Math.sin(u * 5) * 0.01;
        if (biome === 'forest') return 0.57 + Math.sin(u * 4.4 + 1) * 0.012;
        return 0.57;
      };
      return { waterTop: height, floorAt: (x) => height * back(x / width), waterLeft: 0, land: true, groundDepth: 0.3 };
    }
    default:
      return flat(0.86);
  }
}
