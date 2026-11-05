import { Container, Sprite, type Texture } from 'pixi.js';
import { isOpenDen, type Drawing } from '../../../shared/types.ts';
import type { Pose } from '../../../shared/sim/creature.ts';
import { Attachments } from '../attachments.ts';
import { Parts, type Cutout } from '../parts.ts';
import { depthOrder, depthTint, type Creature, type World } from '../world.ts';

/**
 * Sits still on the sand, where the simulation put it. A den with 🚪 In front parts draws those in front of
 * whoever's inside it: they're kept apart from the rest (in the same layer, just in front), so a creature
 * at the den's door shows between its back and its front.
 */
export class Decor implements Creature {
  readonly view = new Container();
  front: Container | null = null;
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
    if (drawing.den && isOpenDen(drawing)) {
      this.front = new Container();
      this.front.addChild(this.parts.container);
      this.view.on('destroyed', () => this.front?.destroy({ children: true }));
    }
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
    if (this.front) {
      if (this.front.parent !== this.view.parent && this.view.parent) this.view.parent.addChild(this.front);
      this.front.position.copyFrom(this.view.position);
      this.front.scale.copyFrom(this.view.scale);
      this.front.rotation = this.view.rotation;
      this.front.alpha = this.view.alpha;
      this.front.visible = this.view.visible;
      // In front of whoever's at its door (see the simulation's dens: they stand just in front of its back).
      this.front.zIndex = this.view.zIndex + 10;
    }
    this.parts.update(dt);
    this.attachments.update(dt, world);
  }
}
