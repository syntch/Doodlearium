import type { Drawing } from '../types.ts';
import type { World } from './world.ts';

export type Kind = 'swimmer' | 'crawler' | 'plant' | 'decor' | 'egg';
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
  /** Puffers: how blown up (0..1). */
  puff: number;
  /** Out and about (night creatures hide by day). */
  out: boolean;
  /** Documentary mode is filming it. */
  star: boolean;
}

export const newPose = (): Pose => ({ x: 0, y: 0, sx: 1, sy: 1, rot: 0, z: 0.5, phase: 0, effort: 1, drowsy: 0, puff: 0, out: true, star: false });

/** One creature's brain: where it goes and what it does. Screens draw it from its pose. */
export interface SimCreature {
  readonly drawing: Drawing;
  readonly kind: Kind;
  readonly pose: Pose;
  readonly personality?: Personality;
  update(dt: number, world: World): void;
  /** Documentary mode starts (or stops) filming it. */
  star?(on: boolean): void;
}

/** What's worth keeping across a server restart, so creatures carry on where they were. */
export interface Saved {
  x: number;
  y: number;
  z: number;
  facing?: number;
  personality?: Personality;
}
