import { Container, Sprite, type Texture } from 'pixi.js';
import type { Drawing } from '../../../shared/types.ts';
import type { Pose } from '../../../shared/sim/creature.ts';
import { Attachments } from '../attachments.ts';
import { Parts, type Cutout } from '../parts.ts';
import { depthOrder, depthTint, type Creature, type World } from '../world.ts';

/** Sits still on the sand, where the simulation put it. */
export class Decor implements Creature {
  readonly view = new Container();
  private sprite: Sprite;
  private attachments: Attachments;
  private parts: Parts;
  private z = -1;

  constructor(
    readonly drawing: Drawing,
    texture: Texture,
    pieces: Cutout['pieces'] = [],
  ) {
    this.sprite = new Sprite({ texture, anchor: { x: 0.5, y: 1 } });
    this.attachments = new Attachments(drawing.attachments, texture.width, texture.height, {
      x: texture.width / 2,
      y: texture.height,
    });
    this.parts = new Parts(pieces, texture.width, texture.height, { x: texture.width / 2, y: texture.height });
    this.view.addChild(this.sprite, this.parts.container, this.attachments.container);
  }

  get moving() {
    return this.parts;
  }

  get body() {
    return this.sprite;
  }

  labelAnchor() {
    return { x: this.view.x, y: this.view.y - this.sprite.texture.height * this.view.scale.y - 8 };
  }

  update(dt: number, world: World, pose: Pose) {
    if (pose.z !== this.z) {
      this.z = pose.z;
      this.sprite.tint = depthTint(this.z);
      this.view.zIndex = depthOrder(this.z);
    }
    this.view.position.set(pose.x, pose.y);
    this.view.scale.set(pose.sx, pose.sy);
    this.parts.update(dt);
    this.attachments.update(dt, world);
  }
}
