import { Container, Graphics, MeshPlane, Sprite, type Texture } from 'pixi.js';
import { motionOf, type Drawing } from '../../../shared/types.ts';
import type { Pose } from '../../../shared/sim/creature.ts';
import { Attachments } from '../attachments.ts';
import { Parts, type Cutout } from '../parts.ts';
import { TAU, clamp, depthOrder, depthTint, type Creature, type World } from '../world.ts';

/**
 * Animals on land. The simulation (shared/sim/walker.ts) moves them about; here the drawing stands on its
 * bottom edge with a soft shadow under it (which stays on the ground while a hopper is in the air), legs
 * marked as 🦵 parts swing in step, and a slitherer's body ripples along its length. Fliers use it too; a
 * waterfowl afloat shows only faintly below the waterline, as if seen through the water.
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
  /** The drawing, its parts and extras, which the waterline cuts across when it's afloat. */
  private whole = new Container();
  /** Waterfowl: its faint underwater half, and where the waterline cuts. */
  private float?: { below: Sprite; aboveMask: Graphics; belowMask: Graphics; afloat: boolean };
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
    this.whole.addChild(this.mesh, this.parts.container, this.attachments.container);
    this.view.addChild(this.shadow, this.whole);
    if (motionOf(drawing) === 'waterfowl') {
      const below = new Sprite({ texture, anchor: { x: 0.5, y: 1 }, tint: 0x8fc4bb, alpha: 0.4, visible: false });
      this.float = { below, aboveMask: new Graphics(), belowMask: new Graphics(), afloat: false };
      below.mask = this.float.belowMask;
      this.view.addChildAt(below, 1);
      this.view.addChild(this.float.aboveMask, this.float.belowMask);
    }
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
    if (this.float) this.waterline(world, pose);
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

  /** Afloat, the waterline cuts across it: clear above, faint and watery below. */
  private waterline(world: World, pose: Pose) {
    const f = this.float!;
    const afloat = !world.land && pose.y > world.waterTop + 0.5;
    if (afloat !== f.afloat) {
      f.afloat = afloat;
      f.below.visible = afloat;
      this.whole.mask = afloat ? f.aboveMask : null;
      // No longer a mask, the shape would show as itself (a white box): wiped until it's afloat again.
      if (!afloat) {
        f.aboveMask.clear();
        f.belowMask.clear();
      }
    }
    if (!afloat) return;
    // The view is moved, scaled and turned, so the waterline is drawn in its own (local) terms.
    const cos = Math.cos(-pose.rot);
    const sin = Math.sin(-pose.rot);
    const local = (x: number, y: number) => {
      const dx = x - pose.x;
      const dy = y - pose.y;
      return [(dx * cos - dy * sin) / pose.sx, (dx * sin + dy * cos) / pose.sy];
    };
    const r = Math.max(this.texW * Math.abs(pose.sx), this.texH * Math.abs(pose.sy)) * 2;
    const line = world.waterTop;
    const box = (top: number, bottom: number) => [
      ...local(pose.x - r, top), ...local(pose.x + r, top), ...local(pose.x + r, bottom), ...local(pose.x - r, bottom),
    ];
    f.aboveMask.clear().poly(box(line - r, line)).fill(0xffffff);
    f.belowMask.clear().poly(box(line, line + r)).fill(0xffffff);
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
