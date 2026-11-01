import { Container, MeshPlane, type Texture } from 'pixi.js';
import type { Drawing } from '../../../shared/types.ts';
import type { Pose } from '../../../shared/sim/creature.ts';
import { Attachments } from '../attachments.ts';
import { Parts, type Cutout } from '../parts.ts';
import { TAU, clamp, depthOrder, depthTint, seededRandom, type Creature, type World } from '../world.ts';

const ROWS = 12;

/** Rooted at the bottom centre where the simulation planted it; rows sway sideways, more the higher up they are. */
export class Plant implements Creature {
  readonly view = new Container();
  private mesh: MeshPlane;
  private positions: Float32Array;
  private rest: Float32Array;
  private texW: number;
  private texH: number;
  private seed: number;
  private swaySpeed: number;
  private attachments: Attachments;
  private parts: Parts;
  private z = -1;

  constructor(
    readonly drawing: Drawing,
    texture: Texture,
    pieces: Cutout['pieces'] = [],
  ) {
    const rand = seededRandom(`${drawing.id}:sway`);
    this.seed = rand(0, TAU);
    this.swaySpeed = rand(0.6, 1.1);

    this.mesh = new MeshPlane({ texture, verticesX: 3, verticesY: ROWS });
    this.texW = texture.width;
    this.texH = texture.height;
    this.mesh.pivot.set(this.texW / 2, this.texH);
    this.positions = this.mesh.geometry.getAttribute('aPosition').buffer.data as Float32Array;
    this.rest = this.positions.slice();
    this.attachments = new Attachments(drawing.attachments, this.texW, this.texH, { x: this.texW / 2, y: this.texH });
    this.parts = new Parts(pieces, this.texW, this.texH, { x: this.texW / 2, y: this.texH });
    this.view.addChild(this.mesh, this.parts.container, this.attachments.container);
  }

  get moving() {
    return this.parts;
  }

  get body() {
    return this.mesh;
  }

  labelAnchor() {
    return { x: this.view.x, y: this.view.y - this.texH * this.view.scale.y - 8 };
  }

  update(dt: number, world: World, pose: Pose) {
    if (pose.z !== this.z) {
      this.z = pose.z;
      this.mesh.tint = depthTint(this.z);
      this.view.zIndex = depthOrder(this.z);
    }
    this.view.position.set(pose.x, pose.y);
    this.view.scale.set(pose.sx, pose.sy);
    const t = world.time * this.swaySpeed;
    const p = this.positions;
    for (let i = 0; i < p.length; i += 2) {
      p[i] = this.rest[i] + this.swayAt(1 - this.rest[i + 1] / this.texH, t, world);
    }
    this.mesh.geometry.getAttribute('aPosition').buffer.update();
    const bend = (_u: number, y: number) => ({ dx: this.swayAt(clamp(1 - y, 0, 1), t, world), dy: 0 });
    this.parts.update(dt, 1, bend);
    this.attachments.update(dt, world, bend);
  }

  /** Sideways offset at height v (0 roots .. 1 tip). */
  private swayAt(v: number, t: number, world: World) {
    const bend = Math.pow(v, 1.6);
    // A current leans the plant over; it's divided by the plant's own scale to stay in texture pixels.
    const lean = (world.current / (world.height * 0.03 || 1)) * this.texH * 0.12 * bend;
    return lean + this.texH * 0.06 * bend * (Math.sin(t + this.seed + v * 1.8) + 0.3 * Math.sin(t * 2.3 + this.seed * 2));
  }
}
