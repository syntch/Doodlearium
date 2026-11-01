import { newPose, type Pose } from '../../shared/sim/creature.ts';
import { unpackPose, type Frame, type PackedPose } from '../../shared/sim/protocol.ts';
import type { Effect } from '../../shared/sim/world.ts';
import { lerp } from './world.ts';

/** How far behind the server the screen draws, so there's always a next frame to blend toward. */
const DELAY = 0.2;
const KEEP = 30;

interface Stored {
  frame: Frame;
  poses: Map<string, PackedPose>;
  flakes: Map<number, number[]>;
  played: boolean;
}

/**
 * The server's moments, about ten a second, smoothed into motion: the screen draws a fifth of a second in
 * the past and blends between the two moments either side of that time. Bubbles and hearts play as the
 * drawing time passes the moment they happened.
 */
export class Timeline {
  private frames: Stored[] = [];
  /** World time being drawn (seconds since the world began). */
  time = 0;
  private a = newPose();
  private b = newPose();

  get latest(): Frame | null {
    return this.frames.at(-1)?.frame ?? null;
  }

  /** Forgets everything (the screen moved to another place). */
  clear() {
    this.frames = [];
  }

  push(frame: Frame) {
    const last = this.latest;
    // A restarted server starts its clock again: start over.
    if (last && frame.t < last.t) this.frames = [];
    this.frames.push({
      frame,
      poses: new Map(frame.poses.map((p) => [p[0], p])),
      flakes: new Map(frame.flakes.map((f) => [f[0], f])),
      played: false,
    });
    if (this.frames.length > KEEP) this.frames.shift();
    if (this.frames.length === 1 || Math.abs(this.time - (frame.t - DELAY)) > 1.5) this.time = frame.t - DELAY;
  }

  /** Moves the drawing time on, playing the effects of the moments it passes. */
  advance(dt: number, play: (e: Effect) => void) {
    const last = this.latest;
    if (!last) return;
    this.time += dt;
    // Keep a steady distance behind the newest moment, catching up (or easing off) gently.
    this.time += (last.t - DELAY - this.time) * Math.min(1, dt * 0.8);
    this.time = Math.min(this.time, last.t);
    for (const s of this.frames) {
      if (s.played || s.frame.t > this.time) continue;
      s.played = true;
      for (const e of s.frame.effects) play(e);
    }
    // Forget moments well behind the two being blended.
    while (this.frames.length > 2 && this.frames[1].frame.t < this.time) this.frames.shift();
  }

  /** The two moments either side of the drawing time, and how far between them it is. */
  private span() {
    const f = this.frames;
    let i = 0;
    while (i < f.length - 1 && f[i + 1].frame.t <= this.time) i++;
    const from = f[i];
    const to = f[Math.min(i + 1, f.length - 1)];
    const t = to === from ? 0 : Math.min(1, Math.max(0, (this.time - from.frame.t) / (to.frame.t - from.frame.t)));
    return { from, to, t };
  }

  /** Where a creature is at the drawing time, or null if the server isn't showing it. */
  pose(id: string, into: Pose): Pose | null {
    if (!this.frames.length) return null;
    const { from, to, t } = this.span();
    const pa = from.poses.get(id);
    const pb = to.poses.get(id);
    if (!pa && !pb) return null;
    if (!pa || !pb) return unpackPose((pa ?? pb)!, into);
    const a = unpackPose(pa, this.a);
    const b = unpackPose(pb, this.b);
    into.x = lerp(a.x, b.x, t);
    into.y = lerp(a.y, b.y, t);
    into.sx = lerp(a.sx, b.sx, t);
    into.sy = lerp(a.sy, b.sy, t);
    into.rot = lerp(a.rot, b.rot, t);
    into.z = lerp(a.z, b.z, t);
    into.phase = lerp(a.phase, b.phase, t);
    into.effort = lerp(a.effort, b.effort, t);
    into.drowsy = lerp(a.drowsy, b.drowsy, t);
    into.puff = lerp(a.puff, b.puff, t);
    into.out = (t < 0.5 ? a : b).out;
    into.star = (t < 0.5 ? a : b).star;
    return into;
  }

  /** The food at the drawing time: [id, x, y, size, color, landedFor]. */
  flakes(): number[][] {
    if (!this.frames.length) return [];
    const { from, to, t } = this.span();
    const out: number[][] = [];
    for (const [id, a] of from.flakes) {
      const b = to.flakes.get(id);
      if (!b) {
        // Eaten (or faded) by the next moment: keep it until halfway.
        if (t < 0.5) out.push(a);
        continue;
      }
      out.push([id, lerp(a[1], b[1], t), lerp(a[2], b[2], t), b[3], b[4], lerp(a[5], b[5], t)]);
    }
    return out;
  }
}
