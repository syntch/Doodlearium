import type { Drawing } from '../types.ts';
import { newPose, type SimCreature } from './creature.ts';
import { depthScale } from './math.ts';
import { burst, sandY, waterY, type World } from './world.ts';

export const EGG_Z = 0.15;

/** An egg sinking to the sand and resting there until its baby hatches (see Tank). */
export class SimEgg implements SimCreature {
  readonly kind = 'egg';
  readonly pose = newPose();
  private fall = 0;
  private r: number;

  constructor(
    readonly id: string,
    readonly drawing: Drawing,
    world: World,
    /** Laid just now: it sinks down from midwater instead of already lying on the sand. */
    sinking: boolean,
    readonly hatchAt: number,
    nest: number,
  ) {
    this.r = world.height * 0.03 * depthScale(EGG_Z);
    // Laid in the water, never up on a dry beach (on land, anywhere in the field).
    const x = world.land ? nest * world.width : Math.max(nest * world.width, world.waterLeft + this.r * 4);
    Object.assign(this.pose, {
      x,
      y: sinking ? waterY(world, 0.52) : 0,
      sx: this.r,
      sy: this.r,
      z: EGG_Z,
    });
    // On land, eggs are laid straight into the grass.
    if (!sinking || world.land) this.pose.y = this.rest(world);
  }

  private rest(world: World) {
    return sandY(world, EGG_Z, this.pose.x) - this.r * 1.3;
  }

  /** True once it's time to hatch. */
  get ready() {
    return Date.now() >= this.hatchAt;
  }

  update(dt: number, world: World) {
    const p = this.pose;
    const rest = this.rest(world);
    if (p.y < rest) {
      this.fall = Math.min(this.fall + world.height * 0.08 * dt, world.height * 0.12);
      p.y = Math.min(rest, p.y + this.fall * dt);
      if (p.y === rest) burst(world, p.x, rest + this.r, 5);
    }
    // How close to hatching it is (0..1 over the last minute), so the screens can wobble it.
    const left = (this.hatchAt - Date.now()) / 1000;
    p.effort = left < 60 ? 1 - Math.max(0, left) / 60 : 0;
  }
}
