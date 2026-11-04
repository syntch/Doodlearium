import { TRAITS, motionOf, type Drawing, type Motion, type SpeciesSize } from '../types.ts';

const SIZE_FACTORS: Record<SpeciesSize, number> = { small: 0.65, big: 1.5 };

/**
 * On land, plants range much further: small is a little wildflower in the grass, medium a tall flower or a
 * bush, and big a tree.
 */
const LAND_PLANT_FACTORS: Record<SpeciesSize, number> = { small: 0.5, big: 3 };

/** How much bigger (or smaller) than usual a species grows: the family's small, medium or big. */
export function sizeFactor(drawing: Pick<Drawing, 'size'>, landPlant = false) {
  return drawing.size ? (landPlant ? LAND_PLANT_FACTORS : SIZE_FACTORS)[drawing.size] : 1;
}

/**
 * How one kind of swimmer travels. The shared swimmer brain (feeding, schooling, glass visits, shyness)
 * drives every style; these settings shape the way it moves. How its body bends is the screen's business
 * (see client/tank/bodies.ts).
 */
export interface SwimStyle {
  /** Longest side as a share of the tank height, before random size and depth. */
  size: number;
  /** Multiplier on the drawing's height when measuring its longest side (fish are drawn short and tall). */
  heightWeight: number;
  cruise: number;
  /** How much of the speed goes into vertical travel. */
  vertical: number;
  /** How much the body tilts up and down with its direction (0 = never). */
  tilt: number;
  /** Whether it turns around to face where it's going. */
  flips: boolean;
  /** Whether it sometimes darts off quickly. */
  darts: boolean;
  /** Whether it joins schools with others of the same style. */
  schools: boolean;
  /** Puffer fish: now and then (and when a hunter comes) blows up into a spiky ball. */
  puffs?: boolean;
  /**
   * Submarines and boats: they patrol rather than wander, never shy away, and don't race for food. Instead
   * they tidy up flakes that have sunk to the sand, and puff exhaust bubbles out of the back.
   */
  machine?: boolean;
  /** 'pulse' moves in jellyfish-style bursts instead of steady swimming. */
  move: 'cruise' | 'pulse';
  /** Bob amplitude as a share of tank height. */
  bob: number;
  /** Radians of animation phase per second. */
  beat(effort: number): number;
  /** Extra push on top of steering, e.g. a flapper's power stroke. 1 = none. */
  thrust(phase: number): number;
}

const fixed = () => 1;

const fish: SwimStyle = {
  size: 0.24,
  heightWeight: 1.4,
  cruise: 1,
  vertical: 0.75,
  tilt: 0.7,
  flips: true,
  darts: true,
  schools: true,
  move: 'cruise',
  bob: 0.004,
  beat: (effort) => 4 + effort * 4,
  thrust: fixed,
};

const puffer: SwimStyle = {
  ...fish,
  size: 0.2,
  heightWeight: 1.2,
  cruise: 0.7,
  darts: false,
  schools: false,
  puffs: true,
  beat: (effort) => 3 + effort * 3,
};

const eel: SwimStyle = {
  size: 0.45,
  heightWeight: 1,
  cruise: 0.7,
  vertical: 0.4,
  tilt: 0.35,
  flips: true,
  darts: false,
  schools: false,
  move: 'cruise',
  bob: 0.003,
  beat: (effort) => 2.6 + effort * 1.6,
  thrust: fixed,
};

const jelly: SwimStyle = {
  size: 0.28,
  heightWeight: 1,
  cruise: 0.8,
  vertical: 1,
  tilt: 0,
  flips: false,
  darts: false,
  schools: false,
  move: 'pulse',
  bob: 0,
  beat: () => 2.2,
  thrust: fixed,
};

const seahorse: SwimStyle = {
  size: 0.24,
  heightWeight: 1,
  cruise: 0.45,
  vertical: 1,
  tilt: 0,
  flips: true,
  darts: false,
  schools: false,
  move: 'cruise',
  bob: 0.02,
  beat: () => 2.4,
  thrust: fixed,
};

/** The glider (stored as 'flapper'): sails along in long, smooth swoops. */
const flapper: SwimStyle = {
  size: 0.24,
  heightWeight: 1.2,
  cruise: 0.55,
  vertical: 0.5,
  tilt: 0.8,
  flips: true,
  darts: false,
  schools: false,
  move: 'cruise',
  bob: 0.012,
  beat: (effort) => 1.1 + effort * 0.5,
  // A slow surge and coast, never jerky.
  thrust: (phase) => 0.85 + 0.3 * Math.sin(phase),
};

const vessel: SwimStyle = {
  size: 0.26,
  heightWeight: 1,
  cruise: 0.75,
  vertical: 0.45,
  tilt: 0.6,
  flips: true,
  darts: false,
  schools: false,
  machine: true,
  move: 'cruise',
  bob: 0.006,
  beat: () => 0,
  thrust: fixed,
};

// Slitherers that also live in the water (water snakes) swim like eels there.
export const SWIM_STYLES: Partial<Record<Motion, SwimStyle>> = { fish, puffer, eel, jelly, seahorse, flapper, vessel, slitherer: eel };

/** Its body's usual style, with what the family ticked or unticked for it (see TRAITS). */
export function swimStyleOf(drawing: Pick<Drawing, 'motion' | 'type' | 'traits'>): SwimStyle {
  const style = SWIM_STYLES[motionOf(drawing)] ?? SWIM_STYLES.fish!;
  const changes = Object.fromEntries(TRAITS.filter((t) => typeof drawing.traits?.[t] === 'boolean').map((t) => [t, drawing.traits![t]]));
  return Object.keys(changes).length ? { ...style, ...changes } : style;
}
