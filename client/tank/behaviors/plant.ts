import { Container, MeshPlane, type Texture } from 'pixi.js';
import type { Drawing } from '../../../shared/types.ts';
import { TAU, depthOrder, depthScale, depthTint, sandY, seededRandom, type Creature, type World } from '../world.ts';

const ROWS = 12;

/** Rooted at the bottom centre; rows sway sideways, more the higher up they are. */
export class Plant implements Creature {
  readonly view = new Container();
  private mesh: MeshPlane;
  private positions: Float32Array;
  private rest: Float32Array;
  private texW: number;
  private texH: number;
  private z: number;
  private nx: number;
  private size: number;
  private seed: number;
  private swaySpeed: number;
  private scale = 1;

  constructor(
    readonly drawing: Drawing,
    texture: Texture,
    world: World,
  ) {
    const rand = seededRandom(drawing.id);
    this.z = rand();
    this.nx = rand(0.04, 0.96);
    this.size = rand(0.8, 1.25);
    this.seed = rand(0, TAU);
    this.swaySpeed = rand(0.6, 1.1);

    this.mesh = new MeshPlane({ texture, verticesX: 3, verticesY: ROWS });
    this.texW = texture.width;
    this.texH = texture.height;
    this.mesh.pivot.set(this.texW / 2, this.texH);
    this.mesh.tint = depthTint(this.z);
    this.positions = this.mesh.geometry.getAttribute('aPosition').buffer.data as Float32Array;
    this.rest = this.positions.slice();
    this.view.addChild(this.mesh);
    this.view.zIndex = depthOrder(this.z);
    this.layout(world);
  }

  layout(world: World) {
    const byHeight = (world.height * 0.32 * this.size * depthScale(this.z)) / this.texH;
    const byWidth = (world.width * 0.22) / this.texW;
    this.scale = Math.min(byHeight, byWidth);
    this.view.position.set(this.nx * world.width, sandY(world, this.z));
    this.view.scale.set(this.scale);
  }

  labelAnchor() {
    return { x: this.view.x, y: this.view.y - this.texH * this.scale - 8 };
  }

  update(_dt: number, world: World) {
    const t = world.time * this.swaySpeed;
    const amp = this.texH * 0.06;
    const p = this.positions;
    for (let i = 0; i < p.length; i += 2) {
      const v = 1 - this.rest[i + 1] / this.texH; // 0 roots .. 1 tip
      const bend = Math.pow(v, 1.6);
      p[i] = this.rest[i] + amp * bend * (Math.sin(t + this.seed + v * 1.8) + 0.3 * Math.sin(t * 2.3 + this.seed * 2));
    }
    this.mesh.geometry.getAttribute('aPosition').buffer.update();
  }
}
