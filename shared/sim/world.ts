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
  /** Top edge of the sand. */
  floorY: number;
  /** Seconds since the world began. */
  time: number;
  food: SimFood;
  /** Every fish currently out and about, so fish can react to each other. */
  fish: SimSwimmer[];
  /** A group of fish swimming together for a while, following the leader. */
  school: School | null;
  /** 0 by day, 1 deep in the night: day creatures get drowsy and doze off. */
  sleepiness: number;
  /** Plants and decorations, where fish sleep and hide. */
  hideouts: Hideout[];
  /** A gentle sideways current, in units per second (negative flows left). */
  current: number;
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
}

export const newWorld = (food: SimFood): World => ({
  width: WORLD_W,
  height: WORLD_H,
  floorY: FLOOR_Y,
  time: 0,
  food,
  fish: [],
  school: null,
  sleepiness: 0,
  hideouts: [],
  current: 0,
  effects: [],
  notes: [],
});

/** Things resting on the sand: far ones sit at the back edge, near ones toward the bottom of the tank. */
export const sandY = (world: Pick<World, 'floorY' | 'height'>, z: number) =>
  world.floorY + (1 - z) * (world.height - world.floorY) * 0.75 + 4;

/** Too many effects at once (nobody is collecting them, say) just get dropped. */
const MAX_EFFECTS = 400;
const effect = (world: World, e: Effect) => {
  if (world.effects.length < MAX_EFFECTS) world.effects.push(e);
};
export const bubble = (world: World, x: number, y: number, r: number) => effect(world, { kind: 'bubble', x, y, r });
export const heart = (world: World, x: number, y: number, size: number) => effect(world, { kind: 'heart', x, y, size });
export const burst = (world: World, x: number, y: number, count = 28) => effect(world, { kind: 'burst', x, y, count });
