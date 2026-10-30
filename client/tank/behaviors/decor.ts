import { Container, Sprite, type Texture } from 'pixi.js';
import type { Drawing } from '../../../shared/types.ts';
import { depthOrder, depthScale, depthTint, sandY, seededRandom, type Creature, type World } from '../world.ts';

/** Sits still on the sand. */
export class Decor implements Creature {
  readonly view = new Container();
  private sprite: Sprite;
  private z: number;
  private nx: number;
  private size: number;

  constructor(
    readonly drawing: Drawing,
    texture: Texture,
    world: World,
  ) {
    const rand = seededRandom(drawing.id);
    this.z = rand();
    this.nx = rand(0.05, 0.95);
    this.size = rand(0.85, 1.2);
    this.sprite = new Sprite({ texture, anchor: { x: 0.5, y: 1 } });
    this.sprite.tint = depthTint(this.z);
    this.view.addChild(this.sprite);
    this.view.zIndex = depthOrder(this.z);
    this.layout(world);
  }

  layout(world: World) {
    const { width, height } = this.sprite.texture;
    const byHeight = (world.height * 0.2 * this.size * depthScale(this.z)) / height;
    const byWidth = (world.width * 0.25) / width;
    this.view.scale.set(Math.min(byHeight, byWidth));
    this.view.position.set(this.nx * world.width, sandY(world, this.z));
  }

  labelAnchor() {
    return { x: this.view.x, y: this.view.y - this.sprite.texture.height * this.view.scale.y - 8 };
  }

  update() {}
}
