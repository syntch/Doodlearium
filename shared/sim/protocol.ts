import type { Kind, Personality, Pose } from './creature.ts';
import type { Flake } from './food.ts';
import type { Season } from './math.ts';
import type { Effect } from './world.ts';
import type { ShowKind } from './explorers.ts';

/** Who's in a place, sent whenever that changes (a new drawing, an egg hatching...). */
export interface RosterEntry {
  id: string;
  /** The drawing it's one of. */
  species: string;
  /** The species' named original (others are "a Clowny"). */
  named?: boolean;
  /** An egg: when it hatches. */
  hatchAt?: number;
  kind: Kind;
  personality?: Personality;
  /** Arrived just now, so screens can say hello. */
  fresh?: boolean;
  /** Plants and decorations stay put: where they are. */
  still?: PackedPose;
  /** Put there by hand (so it can be put back). */
  arranged?: boolean;
}

/** A visitor (a whale passing, a diver...) and when it started, so every screen shows it in the same place. */
export interface Visit {
  name: string;
  seed: number;
  /** World time it started. */
  startedAt: number;
}

/** An explorer's show where it has just arrived (see shared/sim/explorers.ts), timed like a visit. */
export interface Show {
  kind: ShowKind;
  /** The explorer (its drawing's id). */
  who: string;
  /** Where it came from, for its hello. */
  from: string;
  seed: number;
  /** World time it arrived. */
  startedAt: number;
}

/** Something coming up that's worth tuning in for. */
export interface Upcoming {
  /** When (ms since 1970). */
  at: number;
  icon: string;
  text: string;
  /** Where (unset: everywhere). */
  place?: string;
  /** What sort of happening, so a screen following the action can choose (see UPCOMING_KINDS). */
  kind: UpcomingKind;
  /** About how long it lasts once it starts (seconds). */
  seconds: number;
}

/** The sorts of happening on Coming up: an explorer arriving, a visitor, an egg hatching, or one planned in ⚙️. */
export const UPCOMING_KINDS = ['explorer', 'visitor', 'egg', 'planned'] as const;
export type UpcomingKind = (typeof UPCOMING_KINDS)[number];

/** A glance at every place, for the map: how many live there and a few of their species. */
export type MapSummary = Record<string, { count: number; species: string[] }>;

/** What the ⚙️ menu has set (null: back to normal). */
export interface Settings {
  hour: number | null;
  season: string | null;
  blacklight: boolean;
}

/**
 * A moment in the tank, sent about ten times a second. Poses are packed into arrays to keep it small:
 * [id, x, y, sx, sy, rot, z, phase, effort, drowsy, puff, flags, act, actT], where flags is 1 for out, 2 for
 * starring, 4 for in its den out of sight and 8 for in its den where it can be seen; act is what its arms are
 * doing (see ACT).
 */
export interface Frame {
  /** Which place this is. */
  place: string;
  t: number;
  darkness: number;
  blacklight: number;
  current: number;
  season: Season;
  settings: Settings;
  doc: { id: string; until: number } | null;
  visit: Visit | null;
  show?: Show | null;
  /** [rain, snow, rainbow], each 0..1. */
  weather?: [number, number, number];
  poses: PackedPose[];
  /** Decorations being held up to look at: [who's holding it, the decoration]. */
  holds?: [string, string][];
  /** [id, x, y, size, color, landedFor] */
  flakes: number[][];
  effects: Effect[];
}

export type PackedPose = [string, ...number[]];

const r1 = (v: number) => Math.round(v * 10) / 10;
const r3 = (v: number) => Math.round(v * 1000) / 1000;
const r5 = (v: number) => Math.round(v * 100000) / 100000;

export function packPose(id: string, p: Pose): PackedPose {
  return [
    id, r1(p.x), r1(p.y), r5(p.sx), r5(p.sy), r3(p.rot), r3(p.z), r3(p.phase), r3(p.effort), r3(p.drowsy), r3(p.puff),
    (p.out ? 1 : 0) | (p.star ? 2 : 0) | (p.den === 1 ? 4 : p.den === 2 ? 8 : 0), p.act, r3(p.actT),
  ];
}

export function unpackPose(a: PackedPose, into: Pose) {
  const [, x, y, sx, sy, rot, z, phase, effort, drowsy, puff, flags, act = 0, actT = 0] = a;
  Object.assign(into, { x, y, sx, sy, rot, z, phase, effort, drowsy, puff, out: (flags & 1) !== 0, star: (flags & 2) !== 0, act, actT, den: flags & 4 ? 1 : flags & 8 ? 2 : 0 });
  return into;
}

export const packFlake = (f: Flake) => [f.id, r1(f.x), r1(f.y), r1(f.size), f.color, r1(f.landedFor)];
