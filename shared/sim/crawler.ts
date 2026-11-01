import type { Drawing } from '../types.ts';
import { newPose, type Saved, type SimCreature } from './creature.ts';
import type { Flake } from './food.ts';
import { TAU, clamp, depthScale, seededRandom } from './math.ts';
import { burst, sandY, type World } from './world.ts';

/**
 * Walks along the sand (crabs, snails, starfish...) with a bouncy step, stopping now and then to look
 * around, and scuttles over to food that has settled on the sand.
 * Drawings are stored facing right; it turns around by squashing through zero width.
 */
export class SimCrawler implements SimCreature {
  readonly kind = 'crawler';
  readonly pose = newPose();
  private z: number;
  private size: number;
  private pace: number;
  x = 0;
  /** Height above the sand while dropping in; 0 once landed. */
  private air = 0;
  private fallSpeed = 0;
  private facing: number;
  private goal = 0;
  private resting = 0;
  private hurry = 1;
  private step = Math.random() * TAU;
  private stride = 0;
  private meal: Flake | null = null;
  private scale = 1;
  /** Documentary mode is filming it: it hops about for the camera. */
  private starring = false;
  private hopIn = 0;

  constructor(
    readonly drawing: Drawing,
    world: World,
    dropIn: boolean,
    saved?: Saved,
  ) {
    const rand = seededRandom(drawing.id);
    this.z = rand(0.2, 0.9);
    this.size = rand(0.85, 1.15);
    this.pace = rand(0.8, 1.2);
    this.scale =
      Math.min((world.height * 0.13 * this.size) / drawing.height, (world.height * 0.3) / drawing.width) * depthScale(this.z);
    this.x = saved?.x ?? world.width * (0.1 + Math.random() * 0.8);
    this.facing = saved?.facing ?? (Math.random() < 0.5 ? -1 : 1);
    if (dropIn) this.air = world.height;
    this.pickGoal(world);
    this.update(0, world);
  }

  save(): Saved {
    return { x: this.x, y: 0, z: this.z, facing: Math.sign(this.facing) || 1 };
  }

  star(on: boolean) {
    this.starring = on;
    this.hopIn = 1.5;
  }

  private get halfWidth() {
    return (this.drawing.width * this.scale) / 2;
  }

  private pickGoal(world: World) {
    const margin = Math.min(this.halfWidth, world.width * 0.2);
    this.goal = clamp(this.x + (Math.random() - 0.5) * world.width * 0.6, margin, world.width - margin);
    this.hurry = 1;
  }

  /** The nearest fresh flake that has settled on the sand. */
  private findMeal(world: World) {
    let best: Flake | null = null;
    for (const f of world.food.flakes) {
      if (f.eaten || f.landedFor <= 0 || f.landedFor > 6) continue;
      if (!best || Math.abs(f.x - this.x) < Math.abs(best.x - this.x)) best = f;
    }
    return best;
  }

  update(dt: number, world: World) {
    const ground = sandY(world, this.z);
    if (this.starring && this.air === 0) {
      this.hopIn -= dt;
      if (this.hopIn <= 0) {
        // A happy little hop for the camera.
        this.hopIn = 2 + Math.random() * 2;
        this.air = 0.01;
        this.fallSpeed = -world.height * 0.32;
      }
    }

    if (this.air > 0) {
      // Dropping in: sink like a pebble, then a little bounce on landing.
      this.fallSpeed += world.height * 0.6 * dt;
      this.air = Math.max(0, this.air - this.fallSpeed * dt);
      if (this.air === 0) {
        burst(world, this.x, ground, 6);
        this.resting = 0.8;
      }
    } else {
      if (this.meal?.eaten || (this.meal && this.meal.landedFor > 6)) this.meal = null;
      this.meal ??= this.findMeal(world);
      if (this.meal) {
        this.goal = this.meal.x;
        this.hurry = 1.8;
        this.resting = 0;
      }

      const dx = this.goal - this.x;
      if (this.meal && Math.abs(dx) < Math.max(10, this.halfWidth * 0.4)) {
        this.meal.eaten = true;
        this.meal = null;
        world.notes.push({ kind: 'ate', who: this.drawing.id });
        this.resting = 0.6;
      }

      // Day crawlers stay put at night (unless there's food).
      const asleep = !this.drawing.nocturnal && world.sleepiness > 0.5 && !this.meal;
      if (asleep) this.resting = Math.max(this.resting, 0.5);
      if (this.resting > 0) {
        this.resting -= dt;
        if (this.resting <= 0) this.pickGoal(world);
      } else if (Math.abs(dx) < 4) {
        // Arrived: stop for a look around, sometimes a long one.
        this.resting = Math.random() < 0.3 ? 4 + Math.random() * 5 : 0.8 + Math.random() * 2;
      } else {
        const speed = world.height * 0.04 * this.pace * this.hurry * depthScale(this.z);
        // Steps come in pushes, so the walk speeds up and slows within each step.
        const push = 0.4 + 0.9 * Math.abs(Math.sin(this.step));
        this.x += Math.sign(dx) * Math.min(Math.abs(dx), speed * push * dt);
        this.step += dt * 7 * this.pace * this.hurry;
        if (Math.abs(dx) > 8) this.facing += (Math.sign(dx) - this.facing) * Math.min(1, dt * 5);
      }
    }

    // Stride eases in and out so starting and stopping don't snap.
    const walking = this.air === 0 && this.resting <= 0 && Math.abs(this.goal - this.x) >= 4;
    this.stride += ((walking ? 1 : 0) - this.stride) * Math.min(1, dt * 6);
    const bounce = Math.abs(Math.sin(this.step)) * this.stride;
    const h = this.drawing.height * this.scale;
    // Idle breathing so a resting crawler still looks alive.
    const breathe = Math.sin(world.time * 2 + this.pace * 10) * 0.015 * (1 - this.stride);

    const p = this.pose;
    p.x = this.x;
    p.y = ground - this.air - bounce * h * 0.06;
    p.sx = this.facing * this.scale * (1 + bounce * 0.04);
    p.sy = this.scale * (1 - bounce * 0.05 + breathe);
    p.rot = Math.sin(this.step * 2) * 0.04 * this.stride * Math.sign(this.facing);
    p.z = this.z;
    p.phase = this.step;
    p.effort = 1 + this.stride;
    p.drowsy = this.drawing.nocturnal ? 0 : world.sleepiness;
    p.star = this.starring;
  }
}
