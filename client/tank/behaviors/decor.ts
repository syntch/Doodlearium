import { Container, Sprite, type Texture } from 'pixi.js';
import type { Drawing } from '../../../shared/types.ts';
import { Attachments } from '../attachments.ts';
import { Parts, type Cutout } from '../parts.ts';
import { depthOrder, depthScale, depthTint, sandY, seededRandom, type Creature, type Hideout, type World } from '../world.ts';

/** Sits still on the sand. */
export class Decor implements Creature {
  readonly view = new Container();
  private sprite: Sprite;
  private z: number;
  private nx: number;
  private size: number;
  private attachments: Attachments;
  private parts: Parts;

  constructor(
    readonly drawing: Drawing,
    texture: Texture,
    world: World,
    pieces: Cutout['pieces'] = [],
  ) {
    const rand = seededRandom(drawing.id);
    this.z = rand();
    this.nx = rand(0.05, 0.95);
    this.size = rand(0.85, 1.2);
    this.sprite = new Sprite({ texture, anchor: { x: 0.5, y: 1 } });
    this.sprite.tint = depthTint(this.z);
    this.attachments = new Attachments(drawing.attachments, texture.width, texture.height, {
      x: texture.width / 2,
      y: texture.height,
    });
    this.parts = new Parts(pieces, texture.width, texture.height, { x: texture.width / 2, y: texture.height });
    this.view.addChild(this.sprite, this.parts.container, this.attachments.container);
    this.view.zIndex = depthOrder(this.z);
    this.layout(world);
  }

  get moving() {
    return this.parts;
  }

  get body() {
    return this.sprite;
  }

  layout(world: World) {
    const { width, height } = this.sprite.texture;
    const byHeight = (world.height * 0.2 * this.size * depthScale(this.z)) / height;
    const byWidth = (world.width * 0.25) / width;
    this.view.scale.set(Math.min(byHeight, byWidth));
    this.view.position.set(this.nx * world.width, sandY(world, this.z));
  }

  hideout(): Hideout {
    const { width, height } = this.sprite.texture;
    return {
      x: this.view.x,
      bottom: this.view.y,
      height: height * this.view.scale.y,
      halfWidth: (width * this.view.scale.x) / 2,
      z: this.z,
    };
  }

  labelAnchor() {
    return { x: this.view.x, y: this.view.y - this.sprite.texture.height * this.view.scale.y - 8 };
  }

  update(dt: number, world: World) {
    this.parts.update(dt);
    this.attachments.update(dt, world);
  }
}
