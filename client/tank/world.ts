import type { Container } from 'pixi.js';
import type { Drawing } from '../../shared/types.ts';
import { shapeOf, type Biome, type Shape } from '../../shared/world/biomes.ts';
import { WORLD_H, WORLD_W } from '../../shared/sim/world.ts';
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
export interface World extends Shape {
  width: number;
  height: number;
  /** Top edge of the sand at its deepest. */
  floorY: number;
  biome: Biome;
  /** The place's colour scheme, for the space kinds (see shared/world/looks.ts). */
  look?: string;
  /** Seconds since the world began. */
  time: number;
  scene: Scene;
  /** The sideways current, which leans the plants. */
  current: number;
}

/** The lie of the land for a biome: where the water starts and where the bottom is (and its colours). */
export function shapeFor(biome: Biome, look?: string) {
  const shape = shapeOf(biome, WORLD_W, WORLD_H);
  return { biome, look, ...shape, floorY: shape.floorAt(WORLD_W) };
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
  /** A den's 🚪 In front parts, kept apart from its view so they're drawn in front of whoever's inside. */
  readonly front?: Container | null;
  /** Its moving parts, for their glowing paint to ride along. */
  readonly moving?: Parts;
  /** 🦾 Arms: a show has them wave or cheer for a moment (see ACT), and where the hand is, on the screen. */
  gesture?(act: number): void;
  hand?(): { x: number; y: number } | null;
}

/** Negative z means pressed up against the glass, in front of everything. */
export const depthOrder = (z: number) => Math.round((1 - z) * 1000);

const WATER = { r: 0x5f, g: 0x9f, b: 0xc4, amount: 0.3 };
const AIR = { r: 0xc4, g: 0xd8, b: 0xe6, amount: 0.25 };
let haze = WATER;
/** Under water, far things fade toward the water's blue; on land, toward a pale haze. Set when the place changes. */
export function setHaze(land: boolean, tint?: number) {
  haze = tint === undefined ? (land ? AIR : WATER) : { r: (tint >> 16) & 255, g: (tint >> 8) & 255, b: tint & 255, amount: 0.25 };
}
/** Far things are washed toward the water colour (or the haze on land). */
export function depthTint(z: number) {
  const t = Math.max(0, z) * haze.amount;
  const r = Math.round(lerp(255, haze.r, t));
  const g = Math.round(lerp(255, haze.g, t));
  const b = Math.round(lerp(255, haze.b, t));
  return (r << 16) | (g << 8) | b;
}
