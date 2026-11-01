import type { Container } from 'pixi.js';
import type { Drawing } from '../../shared/types.ts';
import type { Swimmer } from './behaviors/swimmer.ts';
import type { Parts } from './parts.ts';
import type { Food } from './food.ts';
import type { Scene } from './scene.ts';

export interface World {
  width: number;
  height: number;
  /** Top edge of the sand. */
  floorY: number;
  /** Seconds since the tank started. */
  time: number;
  scene: Scene;
  food: Food;
  /** Every fish currently out and about, so fish can react to each other. */
  fish: Swimmer[];
  /** A group of fish swimming together for a while, following the leader. */
  school: School | null;
  /** 0 by day, 1 deep in the night: day creatures get drowsy and doze off. */
  sleepiness: number;
  /** Plants and decorations, where fish sleep and hide. */
  hideouts: Hideout[];
  /** A gentle sideways current, in pixels per second (negative flows left). */
  current: number;
}

/** Something on the sand a fish can tuck in beside or behind. */
export interface Hideout {
  x: number;
  /** Its base on the sand, and how tall and wide it is on screen. */
  bottom: number;
  height: number;
  halfWidth: number;
  z: number;
}

export const newWorld = (scene: Scene, food: Food): World => ({
  width: 0,
  height: 0,
  floorY: 0,
  time: 0,
  scene,
  food,
  fish: [],
  school: null,
  sleepiness: 0,
  hideouts: [],
  current: 0,
});

export interface School {
  leader: Swimmer;
  /** Followers in order; each one's place in line decides its spot in the formation. */
  members: Swimmer[];
  until: number;
}

export interface Creature {
  drawing: Drawing;
  view: Container;
  update(dt: number, world: World): void;
  /** Called on start and whenever the screen size changes. */
  layout(world: World): void;
  /** Where its name label floats, in screen coordinates. */
  labelAnchor(): { x: number; y: number };
  /** The drawing itself (a bent mesh or a sprite), for glowing paint to follow. */
  readonly body?: Container;
  /** Its moving parts, for their glowing paint to ride along. */
  readonly moving?: Parts;
  /** Documentary mode is filming it: time to show off. */
  star?(on: boolean): void;
}

export const TAU = Math.PI * 2;
export const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** Deterministic random numbers per drawing, so plants and decor keep their spot across reloads. */
export function seededRandom(seed: string) {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  let a = h >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return (min = 0, max = 1) => min + next() * (max - min);
}

/**
 * Depth z runs 0 (front glass) to 1 (back wall). Far things are smaller and washed toward the water colour.
 */
export const depthScale = (z: number) => 1 - 0.45 * z;
/** Negative z means pressed up against the glass, in front of everything. */
export const depthOrder = (z: number) => Math.round((1 - z) * 1000);

const WATER = { r: 0x5f, g: 0x9f, b: 0xc4 };
export function depthTint(z: number) {
  const t = Math.max(0, z) * 0.3;
  const r = Math.round(lerp(255, WATER.r, t));
  const g = Math.round(lerp(255, WATER.g, t));
  const b = Math.round(lerp(255, WATER.b, t));
  return (r << 16) | (g << 8) | b;
}

/** Things resting on the sand: far ones sit at the back edge, near ones toward the bottom of the screen. */
export const sandY = (world: World, z: number) => world.floorY + (1 - z) * (world.height - world.floorY) * 0.75 + 4;
