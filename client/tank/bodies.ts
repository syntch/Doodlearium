import type { Motion } from '../../shared/types.ts';
import { TAU } from './world.ts';

/** What a body style needs to bend the drawing this frame. */
export interface BodyState {
  /** Animation phase in radians; advances at the style's beat rate. */
  phase: number;
  /** How hard the creature is swimming, roughly 0.2 (drifting) to 2.5 (darting). */
  effort: number;
  texW: number;
  texH: number;
}

/**
 * How one kind of swimmer looks and moves. The shared swimmer brain (feeding, schooling, glass visits,
 * shyness) drives every style; these settings shape the body and the way it travels.
 */
export interface BodyStyle {
  /** Mesh grid: more columns for bending along the length, more rows for bending across it. */
  columns: number;
  rows: number;
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
  /** 'pulse' moves in jellyfish-style bursts instead of steady swimming. */
  move: 'cruise' | 'pulse';
  /** Bob amplitude as a share of tank height. */
  bob: number;
  /** Radians of animation phase per second. */
  beat(effort: number): number;
  /** Extra push on top of steering, e.g. a flapper's power stroke. 1 = none. */
  thrust(phase: number): number;
  /** Offset in texture pixels for the point at (u, v): u 0 tail .. 1 head, v 0 top .. 1 bottom. */
  deform(u: number, v: number, s: BodyState): { dx: number; dy: number };
}

const none = { dx: 0, dy: 0 };
const fixed = () => 1;

const fish: BodyStyle = {
  columns: 16,
  rows: 2,
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
  // A wave travelling toward the tail, biggest at the tail.
  deform(u, _v, s) {
    const amp = s.texH * 0.08 * (0.6 + s.effort * 0.4);
    const tail = 1 - u;
    return { dx: 0, dy: amp * (0.15 + tail * tail) * Math.sin(s.phase - u * 3.2) };
  },
};

const eel: BodyStyle = {
  columns: 28,
  rows: 2,
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
  // An S-wave of about one and a half wavelengths along the whole body, a little calmer at the head.
  deform(u, _v, s) {
    const amp = Math.min(s.texW * 0.05, s.texH * 0.9);
    return { dx: 0, dy: amp * (0.45 + 0.55 * (1 - u)) * Math.sin(s.phase - u * TAU * 1.5) };
  },
};

const jelly: BodyStyle = {
  columns: 7,
  rows: 14,
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
  deform(u, v, s) {
    const contraction = Math.max(0, Math.sin(s.phase));
    const bell = 0.4;
    if (v < bell) {
      // The bell squeezes narrower and taller on each contraction.
      const k = 1 - (v / bell) * 0.3;
      return { dx: -(u - 0.5) * s.texW * 0.22 * contraction * k, dy: -(1 - v / bell) * s.texH * 0.04 * contraction };
    }
    // Tentacles trail behind, swaying with a lag that grows toward their tips.
    const t = (v - bell) / (1 - bell);
    return {
      dx: s.texW * 0.09 * Math.pow(t, 1.3) * Math.sin(s.phase * 0.7 - t * 4),
      dy: s.texH * 0.03 * t * contraction,
    };
  },
};

const seahorse: BodyStyle = {
  columns: 4,
  rows: 12,
  size: 0.24,
  heightWeight: 1,
  cruise: 0.45,
  vertical: 1,
  tilt: 0,
  flips: true,
  darts: false,
  schools: false,
  move: 'cruise',
  bob: 0.012,
  beat: () => 2.4,
  thrust: fixed,
  // Upright: the tail end curls back and forth, the head stays steady.
  deform(_u, v, s) {
    return { dx: s.texW * 0.08 * v * v * Math.sin(s.phase * 0.5), dy: 0 };
  },
};

const flapper: BodyStyle = {
  columns: 6,
  rows: 10,
  size: 0.24,
  heightWeight: 1.2,
  cruise: 0.6,
  vertical: 0.6,
  tilt: 0.5,
  flips: true,
  darts: false,
  schools: false,
  move: 'cruise',
  bob: 0.003,
  beat: (effort) => 2 + effort * 0.8,
  // A burst of speed on each power stroke, then a glide.
  thrust: (phase) => 0.6 + 0.9 * Math.max(0, Math.sin(phase)),
  // Top and bottom edges (flippers or wings) sweep out and back; the middle of the body stays rigid.
  deform(u, v, s) {
    const fromMiddle = (v - 0.5) * 2;
    const edge = Math.pow(Math.abs(fromMiddle), 1.5);
    return {
      dx: -s.texW * 0.04 * edge * Math.cos(s.phase),
      dy: Math.sign(fromMiddle) * s.texH * 0.14 * edge * Math.sin(s.phase - u * 0.8),
    };
  },
};

const vessel: BodyStyle = {
  columns: 2,
  rows: 2,
  size: 0.26,
  heightWeight: 1,
  cruise: 0.75,
  vertical: 0.45,
  tilt: 0.6,
  flips: true,
  darts: false,
  schools: false,
  move: 'cruise',
  bob: 0.006,
  beat: () => 0,
  thrust: fixed,
  // Rigid: submarines don't wiggle. (Their extras, like propellers, still animate.)
  deform: () => none,
};

export const BODY_STYLES: Partial<Record<Motion, BodyStyle>> = { fish, eel, jelly, seahorse, flapper, vessel };
