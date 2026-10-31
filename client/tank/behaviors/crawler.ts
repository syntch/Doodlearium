import { Container, Sprite, type Texture } from 'pixi.js';
import type { Drawing } from '../../../shared/types.ts';
import { Attachments } from '../attachments.ts';
import { Parts, type Cutout } from '../parts.ts';
import type { Flake } from '../food.ts';
import { clamp, depthOrder, seededRandom, depthScale, depthTint, sandY, TAU, type Creature, type World } from '../world.ts';

/**
 * Walks along the sand (crabs, snails, starfish...) with a bouncy step, stopping now and then to look
 * around, and scuttles over to food that has settled on the sand.
 * Drawings are stored facing right; it turns around by squashing through zero width.
 */
export class Crawler implements Creature {
  readonly view = new Container();
  private sprite: Sprite;
  private attachments: Attachments;
  private parts: Parts;
  private z: number;
  private size: number;
  private pace: number;
  private x = 0;
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

  constructor(
    readonly drawing: Drawing,
    texture: Texture,
    world: World,
    dropIn: boolean,
    pieces: Cutout['pieces'] = [],
  ) {
    const rand = seededRandom(drawing.id);
    this.z = rand(0.2, 0.9);
    this.size = rand(0.85, 1.15);
    this.pace = rand(0.8, 1.2);
    this.sprite = new Sprite({ texture, anchor: { x: 0.5, y: 1 } });
    this.sprite.tint = depthTint(this.z);
    this.attachments = new Attachments(drawing.attachments, texture.width, texture.height, {
      x: texture.width / 2,
      y: texture.height,
    });
    this.parts = new Parts(pieces, texture.width, texture.height, { x: texture.width / 2, y: texture.height });
    this.view.addChild(this.sprite, this.parts.container, this.attachments.container);
    this.view.zIndex = depthOrder(this.z);
    this.x = world.width * (0.1 + Math.random() * 0.8);
    this.facing = Math.random() < 0.5 ? -1 : 1;
    if (dropIn) this.air = world.height;
    this.layout(world);
    this.pickGoal(world);
  }

  layout(world: World) {
    const { width, height } = this.sprite.texture;
    this.scale =
      Math.min((world.height * 0.13 * this.size) / height, (world.height * 0.3) / width) * depthScale(this.z);
    this.x = clamp(this.x, 0, world.width);
  }

  labelAnchor() {
    return { x: this.view.x, y: this.view.y - this.sprite.texture.height * this.scale - 8 };
  }

  private get halfWidth() {
    return (this.sprite.texture.width * this.scale) / 2;
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

    if (this.air > 0) {
      // Dropping in: sink like a pebble, then a little bounce on landing.
      this.fallSpeed += world.height * 0.6 * dt;
      this.air = Math.max(0, this.air - this.fallSpeed * dt);
      if (this.air === 0) {
        world.scene.burst(this.x, ground, 6);
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
    const h = this.sprite.texture.height * this.scale;
    // Idle breathing so a resting crawler still looks alive.
    const breathe = Math.sin(world.time * 2 + this.pace * 10) * 0.015 * (1 - this.stride);

    this.view.position.set(this.x, ground - this.air - bounce * h * 0.06);
    this.view.scale.set(this.facing * this.scale * (1 + bounce * 0.04), this.scale * (1 - bounce * 0.05 + breathe));
    this.view.rotation = Math.sin(this.step * 2) * 0.04 * this.stride * Math.sign(this.facing);
    this.parts.update(dt, 1 + this.stride, undefined, this.drawing.nocturnal ? 0 : world.sleepiness);
    this.attachments.update(dt, world);
  }
}
