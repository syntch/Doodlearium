import type { Drawing } from '../types.ts';
import type { World } from './world.ts';

export type Kind = 'swimmer' | 'crawler' | 'plant' | 'decor' | 'egg' | 'walker' | 'flier';
export type Personality = 'curious' | 'shy' | 'easygoing' | 'hunter';

/**
 * Everything a screen needs to draw a creature at one moment: where it is (in tank units), how it's scaled
 * (sx is negative when it faces left) and turned, how deep it is, and the numbers that drive its body's own
 * animation.
 */
export interface Pose {
  x: number;
  y: number;
  sx: number;
  sy: number;
  rot: number;
  z: number;
  /** Swim animation phase (radians), and how hard it's swimming. */
  phase: number;
  effort: number;
  /** 0 awake .. 1 fast asleep. */
  drowsy: number;
  /** Puffers: how blown up (0..1). Land animals: how high off the ground (a hopper mid-hop), in tank units. */
  puff: number;
  /** Out and about (night creatures hide by day). */
  out: boolean;
  /** Documentary mode is filming it. */
  star: boolean;
  /** What its 🦾 arms are doing (see ACT), and how far through that it is (0..1). */
  act: number;
  actT: number;
}

/** What a creature with 🦾 arms can be doing with them; screens swing the arms to match. */
export const ACT = {
  none: 0,
  /** One arm up, waving hello. */
  wave: 1,
  /** Reaching out to stroke the one beside it. */
  pet: 2,
  /** Bending down to pick something up (or put it back). */
  reach: 3,
  /** Holding something up to look at it. */
  hold: 4,
  /** Both arms up: hooray! */
  cheer: 5,
  stretch: 6,
  /** Scratching its head. */
  scratch: 7,
  /** Arms out in front (on the shoulders of the one ahead, in a conga). */
  forward: 8,
} as const;

export const newPose = (): Pose => ({
  x: 0, y: 0, sx: 1, sy: 1, rot: 0, z: 0.5, phase: 0, effort: 1, drowsy: 0, puff: 0, out: true, star: false, act: 0, actT: 0,
});

/** One creature's brain: where it goes and what it does. Screens draw it from its pose. */
export interface SimCreature {
  /** Which one it is (the drawing's id for its named original, see shared/world/population.ts). */
  readonly id: string;
  readonly drawing: Drawing;
  readonly kind: Kind;
  readonly pose: Pose;
  readonly personality?: Personality;
  update(dt: number, world: World): void;
  /** Documentary mode starts (or stops) filming it. */
  star?(on: boolean): void;
}

/**
 * Who to make: one individual of a drawing's species. grownFrom is when a baby hatched, so it grows over its
 * first week; hatchAt (with nest, 0..1 across) makes it an egg until then.
 */
export interface Spec {
  id: string;
  drawing: Drawing;
  grownFrom?: number;
  hatchAt?: number;
  nest?: number;
  placement?: Placement;
}

/**
 * Where the family put a plant or decoration by hand (instead of where it grew by itself): x across the
 * place (0..1), z how near the front (0..1), and scale its size at the very back (nearer ones look bigger).
 */
export interface Placement {
  x: number;
  z: number;
  scale: number;
}

/** What's worth keeping across a server restart, so creatures carry on where they were. */
export interface Saved {
  x: number;
  y: number;
  z: number;
  facing?: number;
  personality?: Personality;
}
