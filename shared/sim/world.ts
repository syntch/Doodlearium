import { shapeOf, type Biome } from '../world/biomes.ts';
import type { SimFood } from './food.ts';
import type { SimSwimmer } from './swimmer.ts';

/**
 * The tank in its own units, the same on every screen: screens scale it to fit (and show a little more water
 * or sand around it when their shape differs).
 */
export const WORLD_W = 1600;
export const WORLD_H = 900;
export const FLOOR_Y = WORLD_H * 0.86;

/** Something worth seeing that the simulation can't draw itself: the screens play these. */
export type Effect =
  | { kind: 'bubble'; x: number; y: number; r: number }
  | { kind: 'heart'; x: number; y: number; size: number }
  /** A splash of bubbles, e.g. when a drawing drops in or an egg cracks. */
  | { kind: 'burst'; x: number; y: number; count: number };

/** Something that happened, for the history: the server decides which are worth writing down. */
export type Note =
  | { kind: 'chase'; hunter: string; prey: string; seconds: number; hid: boolean }
  | { kind: 'scare'; who: string; hunter: string }
  | { kind: 'ate'; who: string }
  | { kind: 'hatch'; who: string }
  | { kind: 'school'; leader: string; members: string[] }
  /** A school broke up: the leader and the first in line might lay an egg. */
  | { kind: 'school-end'; leader: string; first: string }
  /** A night creature came out. */
  | { kind: 'out'; who: string };

export interface World {
  width: number;
  height: number;
  /** Top edge of the sand where the water is deepest. */
  floorY: number;
  /** The place's shape: where the water starts and how the bottom runs (see shared/world/biomes.ts). */
  waterTop: number;
  waterLeft: number;
  floorAt(x: number): number;
  /** A land place (see shared/world/biomes.ts). */
  land?: boolean;
  groundDepth?: number;
  /** How hard things fall (1 when unset; less on a moon). */
  gravity?: number;
  /** Seconds since the world began. */
  time: number;
  food: SimFood;
  /** Every fish currently out and about, so fish can react to each other. */
  fish: SimSwimmer[];
  /** Groups of fish swimming together, following a leader: a passing school, and species that live in groups. */
  schools: School[];
  /** 0 by day, 1 deep in the night: day creatures get drowsy and doze off. */
  sleepiness: number;
  /** Plants and decorations, where fish sleep and hide. */
  hideouts: Hideout[];
  /** A gentle sideways current, in units per second (negative flows left). */
  current: number;
  /** How hard it's raining (0..1): land animals run for shelter when it pours. */
  rain: number;
  effects: Effect[];
  notes: Note[];
}

/** Something on the sand a fish can tuck in beside or behind. */
export interface Hideout {
  x: number;
  /** Its base on the sand, and how tall and wide it is. */
  bottom: number;
  height: number;
  halfWidth: number;
  z: number;
}

export interface School {
  leader: SimSwimmer;
  /** Followers in order; each one's place in line decides its spot in the formation. */
  members: SimSwimmer[];
  until: number;
  /** A species that lives in a group (it keeps going), rather than a school that formed for a while. */
  species?: string;
}

export function newWorld(food: SimFood, biome: Biome = 'lake'): World {
  const shape = shapeOf(biome, WORLD_W, WORLD_H);
  return {
    width: WORLD_W,
    height: WORLD_H,
    floorY: shape.floorAt(WORLD_W),
    ...shape,
    time: 0,
    food,
    fish: [],
    schools: [],
  sleepiness: 0,
  hideouts: [],
    current: 0,
    rain: 0,
    effects: [],
    notes: [],
  };
}

/** Halfway (f = 0.5) down through the water, or any other fraction of the way from the top to the bottom. */
export const waterY = (world: Pick<World, 'waterTop' | 'floorY'>, f: number) => world.waterTop + (world.floorY - world.waterTop) * f;

/** How far the ground runs from its back edge to the front (much further on land than on the sand). */
export const groundBand = (world: Pick<World, 'height' | 'groundDepth'>) => world.height * (world.groundDepth ?? 0.105);

/** Things resting on the sand (or the ground) at x: far ones sit at the back edge, near ones toward the front. */
export const sandY = (world: Pick<World, 'floorAt' | 'height' | 'groundDepth'>, z: number, x: number) =>
  world.floorAt(x) + (1 - z) * groundBand(world) + 4;

/** Too many effects at once (nobody is collecting them, say) just get dropped. */
const MAX_EFFECTS = 400;
const effect = (world: World, e: Effect) => {
  if (world.effects.length < MAX_EFFECTS) world.effects.push(e);
};
export const bubble = (world: World, x: number, y: number, r: number) => effect(world, { kind: 'bubble', x, y, r });
export const heart = (world: World, x: number, y: number, size: number) => effect(world, { kind: 'heart', x, y, size });
export const burst = (world: World, x: number, y: number, count = 28) => effect(world, { kind: 'burst', x, y, count });
