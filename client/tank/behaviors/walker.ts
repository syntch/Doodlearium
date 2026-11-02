import { Container, Graphics, MeshPlane, type Texture } from 'pixi.js';
import { motionOf, type Drawing } from '../../../shared/types.ts';
import type { Pose } from '../../../shared/sim/creature.ts';
import { Attachments } from '../attachments.ts';
import { Parts, type Cutout } from '../parts.ts';
import { TAU, clamp, depthOrder, depthTint, type Creature, type World } from '../world.ts';

/**
 * Animals on land. The simulation (shared/sim/walker.ts) moves them about; here the drawing stands on its
 * bottom edge with a soft shadow under it (which stays on the ground while a hopper is in the air), legs
 * marked as 🦵 parts swing in step, and a slitherer's body ripples along its length.
 */
export class Walker implements Creature {
  readonly view = new Container();
  private mesh: MeshPlane;
  private positions: Float32Array;
  private rest: Float32Array;
  private texW: number;
  private texH: number;
  private shadow = new Graphics();
  private attachments: Attachments;
  private parts: Parts;
  private slither: boolean;
  private phase = 0;
  private stride = 0;
  private z = -1;
  private starring = false;

  constructor(
    readonly drawing: Drawing,
    texture: Texture,
    pieces: Cutout['pieces'] = [],
  ) {
    this.slither = motionOf(drawing) === 'slitherer';
    this.texW = texture.width;
    this.texH = texture.height;
    this.mesh = new MeshPlane({ texture, verticesX: this.slither ? 24 : 2, verticesY: 2 });
    this.mesh.pivot.set(this.texW / 2, this.texH);
    this.positions = this.mesh.geometry.getAttribute('aPosition').buffer.data as Float32Array;
    this.rest = this.positions.slice();
    const origin = { x: this.texW / 2, y: this.texH };
    this.attachments = new Attachments(drawing.attachments, this.texW, this.texH, origin);
    this.parts = new Parts(pieces, this.texW, this.texH, origin);
    this.shadow.ellipse(0, 0, this.texW * 0.42, Math.max(6, this.texH * 0.07)).fill({ color: 0x1d3310, alpha: 0.22 });
    this.view.addChild(this.shadow, this.mesh, this.parts.container, this.attachments.container);
  }

  labelAnchor() {
    return { x: this.view.x, y: this.view.y - this.texH * Math.abs(this.view.scale.y) - 8 };
  }

  get moving() {
    return this.parts;
  }

  get body() {
    return this.mesh;
  }

  update(dt: number, world: World, pose: Pose) {
    if (pose.z !== this.z || pose.star !== this.starring) {
      this.z = pose.z;
      this.starring = pose.star;
      this.mesh.tint = depthTint(this.z);
      this.view.zIndex = this.starring ? 3000 : depthOrder(this.z);
    }
    this.view.position.set(pose.x, pose.y);
    this.view.scale.set(pose.sx, pose.sy);
    this.view.rotation = pose.rot;
    // The shadow stays on the ground, shrinking and fading as it rises (and over water there isn't one).
    const up = pose.puff / Math.max(0.001, Math.abs(pose.sy));
    this.shadow.visible = pose.puff >= 0 && pose.puff < 400;
    this.shadow.position.set(0, up);
    this.shadow.scale.set(Math.max(0.4, 1 - pose.puff / 300));
    this.shadow.alpha = Math.max(0, 1 - pose.puff / 400);
    this.shadow.rotation = -pose.rot;
    this.phase = pose.phase;
    this.stride = clamp(pose.effort - 1, 0, 1);
    const bend = this.slither ? (u: number, v: number) => this.shape(clamp(u, 0, 1), clamp(v, 0, 1)) : undefined;
    if (this.slither) this.bend();
    this.parts.update(dt, pose.effort, bend, pose.drowsy, { phase: pose.phase, stride: this.stride });
    this.attachments.update(dt, world, bend);
  }

  /**
   * A slitherer's ripple: humps running back along the body, flatter at the head. The back rises and falls
   * more than the belly, which mostly stays on the ground.
   */
  private shape(u: number, v: number) {
    const amp = Math.min(this.texW * 0.035, this.texH * 0.5) * (0.3 + 0.7 * this.stride);
    const dy = amp * (0.35 + 0.65 * (1 - u)) * Math.sin(this.phase * 1.5 + u * TAU * 1.6);
    return { dx: 0, dy: dy * (1 - 0.6 * v) };
  }

  private bend() {
    const p = this.positions;
    for (let i = 0; i < p.length; i += 2) {
      const { dy } = this.shape(this.rest[i] / this.texW, this.rest[i + 1] / this.texH);
      p[i] = this.rest[i];
      p[i + 1] = this.rest[i + 1] + dy;
    }
    this.mesh.geometry.getAttribute('aPosition').buffer.update();
  }
}
