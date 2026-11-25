import { motionOf, type Drawing, type Motion } from '../../shared/types.ts';
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
 * How one kind of swimmer's body bends as it swims. How it moves around (speed, tilting, turning...) is
 * the simulation's business: see SWIM_STYLES in shared/sim/styles.ts.
 */
export interface BodyStyle {
  /** Mesh grid: more columns for bending along the length, more rows for bending across it. */
  columns: number;
  rows: number;
  /** Puffer fish: blows up into a spiky ball now and then. */
  puffs?: boolean;
  /** Offset in texture pixels for the point at (u, v): u 0 tail .. 1 head, v 0 top .. 1 bottom. */
  deform(u: number, v: number, s: BodyState): { dx: number; dy: number };
}

const none = { dx: 0, dy: 0 };

const fish: BodyStyle = {
  columns: 16,
  rows: 2,
  // A wave travelling toward the tail, biggest at the tail.
  deform(u, _v, s) {
    const amp = s.texH * 0.08 * (0.6 + s.effort * 0.4);
    const tail = 1 - u;
    return { dx: 0, dy: amp * (0.15 + tail * tail) * Math.sin(s.phase + u * 3.2) };
  },
};

const puffer: BodyStyle = {
  ...fish,
  // Enough grid to round the body out into a ball.
  columns: 12,
  rows: 10,
  puffs: true,
};

const eel: BodyStyle = {
  columns: 28,
  rows: 2,
  // An S-wave of about one and a half wavelengths travelling from head to tail, a little calmer at the head.
  deform(u, _v, s) {
    const amp = Math.min(s.texW * 0.05, s.texH * 0.9);
    return { dx: 0, dy: amp * (0.45 + 0.55 * (1 - u)) * Math.sin(s.phase + u * TAU * 1.5) };
  },
};

const jelly: BodyStyle = {
  columns: 7,
  rows: 14,
  deform(u, v, s) {
    // Squeezes hard on each contraction and relaxes a little wider than rest in between.
    const wave = Math.sin(s.phase);
    const squeeze = wave > 0 ? wave : wave * 0.35;
    const bell = 0.4;
    const pinch = -(u - 0.5) * s.texW * 0.34 * squeeze;
    if (v < bell) {
      // The bell narrows and domes up, most at its rim.
      const rim = 0.55 + 0.45 * (v / bell);
      return { dx: pinch * rim, dy: -(1 - v / bell) * s.texH * 0.08 * squeeze };
    }
    // Tentacles start where the rim is and trail behind, swaying with a lag that grows toward their tips,
    // and stretch out as the bell pushes up.
    const t = (v - bell) / (1 - bell);
    return {
      dx: pinch * (1 - t) + s.texW * 0.14 * Math.pow(t, 1.2) * Math.sin(s.phase * 0.8 - t * 4),
      dy: s.texH * 0.07 * t * Math.max(0, wave),
    };
  },
};

const seahorse: BodyStyle = {
  columns: 4,
  rows: 12,
  // Upright: the tail end curls back and forth, the body leans and rocks, and the snout nods.
  deform(_u, v, s) {
    const curl = s.texW * 0.16 * v * v * Math.sin(s.phase * 0.5);
    const lean = s.texW * 0.05 * (v - 0.4) * Math.sin(s.phase * 0.5 + 1.2);
    const nod = v < 0.25 ? -s.texH * 0.025 * (1 - v / 0.25) * Math.sin(s.phase) : 0;
    return { dx: curl + lean, dy: nod };
  },
};

/**
 * The glider (stored as 'flapper'): sails along in long, smooth swoops, its edges rippling gently like a
 * ray's. Flippers and wings flap best as moving parts (✨ Animate → Flap) on top of this.
 */
const flapper: BodyStyle = {
  columns: 10,
  rows: 8,
  // The top and bottom edges ripple from front to back; the middle barely moves.
  deform(u, v, s) {
    const fromMiddle = (v - 0.5) * 2;
    const edge = fromMiddle * fromMiddle;
    return { dx: 0, dy: Math.sign(fromMiddle) * s.texH * 0.05 * edge * Math.sin(s.phase + u * 2.4) };
  },
};

const vessel: BodyStyle = {
  columns: 2,
  rows: 2,
  // Rigid: submarines don't wiggle. (Their extras, like propellers, still animate.)
  deform: () => none,
};

export const BODY_STYLES: Partial<Record<Motion, BodyStyle>> = { fish, puffer, eel, jelly, seahorse, flapper, vessel, slitherer: eel };

/** Its body's style; one ticked to puff up gets enough grid to round out into a ball. */
export function bodyStyleOf(drawing: Pick<Drawing, 'motion' | 'type' | 'traits'>): BodyStyle {
  const style = BODY_STYLES[motionOf(drawing)] ?? BODY_STYLES.fish!;
  const puffs = drawing.traits?.puffs ?? Boolean(style.puffs);
  if (puffs === Boolean(style.puffs)) return style;
  return puffs ? { ...style, puffs, columns: Math.max(style.columns, 12), rows: Math.max(style.rows, 10) } : { ...style, puffs };
}
