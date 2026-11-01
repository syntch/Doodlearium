import type { Container } from 'pixi.js';
import type { Drawing } from '../../shared/types.ts';
import type { Pose } from '../../shared/sim/creature.ts';
import { lerp } from '../../shared/sim/math.ts';
import type { Parts } from './parts.ts';
import type { Scene } from './scene.ts';

export { TAU, clamp, lerp, seededRandom, depthScale } from '../../shared/sim/math.ts';
export { sandY } from '../../shared/sim/world.ts';

/**
 * What a screen needs to draw the tank: its size in tank units (the same on every screen, see
 * shared/sim/world.ts), the shared clock, and the scene that plays bubbles and hearts. Where everything is
 * comes from the server (or, for the draw page's preview, a little simulation of its own).
 */
export interface World {
  width: number;
  height: number;
  /** Top edge of the sand. */
  floorY: number;
  /** Seconds since the world began. */
  time: number;
  scene: Scene;
  /** The sideways current, which leans the plants. */
  current: number;
}

/** A drawing on screen: it draws itself at the pose the simulation gives it. */
export interface Creature {
  drawing: Drawing;
  view: Container;
  update(dt: number, world: World, pose: Pose): void;
  /** Where its name label floats, in tank units. */
  labelAnchor(): { x: number; y: number };
  /** The drawing itself (a bent mesh or a sprite), for glowing paint to follow. */
  readonly body?: Container;
  /** Its moving parts, for their glowing paint to ride along. */
  readonly moving?: Parts;
}

/** Negative z means pressed up against the glass, in front of everything. */
export const depthOrder = (z: number) => Math.round((1 - z) * 1000);

const WATER = { r: 0x5f, g: 0x9f, b: 0xc4 };
/** Far things are washed toward the water colour. */
export function depthTint(z: number) {
  const t = Math.max(0, z) * 0.3;
  const r = Math.round(lerp(255, WATER.r, t));
  const g = Math.round(lerp(255, WATER.g, t));
  const b = Math.round(lerp(255, WATER.b, t));
  return (r << 16) | (g << 8) | b;
}
