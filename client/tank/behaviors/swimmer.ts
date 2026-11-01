import { Container, Graphics, MeshPlane, type Texture } from 'pixi.js';
import { motionOf, type Drawing } from '../../../shared/types.ts';
import type { Pose } from '../../../shared/sim/creature.ts';
import { Attachments } from '../attachments.ts';
import { Parts, type Cutout } from '../parts.ts';
import { BODY_STYLES, type BodyState, type BodyStyle } from '../bodies.ts';
import { TAU, clamp, depthOrder, depthTint, type Creature, type World } from '../world.ts';

/**
 * Anything that swims in open water. Where it goes is decided by the simulation (shared/sim/swimmer.ts);
 * here the drawing is a mesh bent by its body style (a fish's tail wave, an eel's S-wave, a jellyfish's
 * pulse...) in time with the pose's swim phase, and a puffer rounds out into a spiky ball.
 * Drawings are stored facing right, so x = 0 is the tail and x = width is the head.
 */
export class Swimmer implements Creature {
  readonly view = new Container();
  readonly style: BodyStyle;
  private bodyState: BodyState;
  private mesh: MeshPlane;
  private positions: Float32Array;
  private rest: Float32Array;
  private texW: number;
  private texH: number;
  private attachments: Attachments;
  private parts: Parts;
  private puff = 0;
  private spikes: Graphics | null = null;
  private spikeColor = 0;
  private z = -1;
  private starring = false;

  constructor(
    readonly drawing: Drawing,
    texture: Texture,
    pieces: Cutout['pieces'] = [],
  ) {
    this.style = BODY_STYLES[motionOf(drawing)] ?? BODY_STYLES.fish!;
    this.mesh = new MeshPlane({ texture, verticesX: this.style.columns, verticesY: this.style.rows });
    this.texW = texture.width;
    this.texH = texture.height;
    this.bodyState = { phase: 0, effort: 1, texW: this.texW, texH: this.texH };
    this.mesh.pivot.set(this.texW / 2, this.texH / 2);
    this.positions = this.mesh.geometry.getAttribute('aPosition').buffer.data as Float32Array;
    this.rest = this.positions.slice();
    this.attachments = new Attachments(drawing.attachments, this.texW, this.texH, { x: this.texW / 2, y: this.texH / 2 });
    this.parts = new Parts(pieces, this.texW, this.texH, { x: this.texW / 2, y: this.texH / 2 });
    this.view.addChild(this.mesh, this.parts.container, this.attachments.container);
    if (this.style.puffs) {
      // Spikes sit behind the body, so only their points show past the round edge.
      this.spikes = new Graphics();
      this.view.addChildAt(this.spikes, 0);
      this.spikeColor = averageColor(texture);
    }
  }

  labelAnchor() {
    return { x: this.view.x, y: this.view.y - (this.texH * Math.abs(this.view.scale.y)) / 2 - 8 };
  }

  get moving() {
    return this.parts;
  }

  get body() {
    return this.mesh;
  }

  update(dt: number, world: World, pose: Pose) {
    this.view.position.set(pose.x, pose.y);
    this.view.scale.set(pose.sx, pose.sy);
    this.view.rotation = pose.rot;
    if (pose.z !== this.z || pose.star !== this.starring) {
      this.z = pose.z;
      this.starring = pose.star;
      this.mesh.tint = depthTint(this.z);
      if (this.spikes) this.spikes.tint = depthTint(this.z);
      this.mesh.alpha = 1 - Math.max(0, this.z) * 0.1;
      // The star of the show swims in front of everyone.
      this.view.zIndex = this.starring ? 3000 : depthOrder(this.z);
    }
    if (this.spikes && (pose.puff > 0 || this.puff > 0)) {
      this.puff = pose.puff;
      this.drawSpikes();
    }

    this.bodyState.phase = pose.phase;
    this.bodyState.effort = pose.effort;
    this.bend();
    // Extras ride the same body motion as the drawing underneath them.
    const bend = (u: number, v: number) => this.shape(clamp(u, 0, 1), clamp(v, 0, 1));
    this.parts.update(dt, pose.effort, bend, pose.drowsy);
    this.attachments.update(dt, world, bend);
  }

  /** How far the body style (and puffing up) moves the point at (u, v), in texture pixels. */
  private shape(u: number, v: number) {
    const d = this.style.deform(u, v, this.bodyState);
    if (this.puff <= 0) return d;
    // Squares map onto a disc, so the whole drawing rounds out into a ball.
    const a = u * 2 - 1;
    const b = v * 2 - 1;
    const r = Math.max(this.texW, this.texH) * 0.42;
    const bx = a * Math.sqrt(1 - (b * b) / 2) * r + this.texW / 2 - u * this.texW;
    const by = b * Math.sqrt(1 - (a * a) / 2) * r + this.texH / 2 - v * this.texH;
    return { dx: d.dx + (bx - d.dx) * this.puff, dy: d.dy + (by - d.dy) * this.puff };
  }

  private drawSpikes() {
    const g = this.spikes!;
    g.clear();
    if (this.puff < 0.05) return;
    const r = Math.max(this.texW, this.texH) * 0.42;
    const length = r * 0.35 * this.puff ** 2;
    const count = 18;
    for (let i = 0; i < count; i++) {
      const a = (i / count) * TAU;
      const w = 0.11;
      g.poly([
        Math.cos(a - w) * r * 0.95, Math.sin(a - w) * r * 0.95,
        Math.cos(a) * (r + length), Math.sin(a) * (r + length),
        Math.cos(a + w) * r * 0.95, Math.sin(a + w) * r * 0.95,
      ]).fill(this.spikeColor).stroke({ width: Math.max(2, r * 0.025), color: 0x222222, alpha: 0.6, join: 'round' });
    }
  }

  /** Bends every mesh vertex by the body style. */
  private bend() {
    const p = this.positions;
    for (let i = 0; i < p.length; i += 2) {
      const { dx, dy } = this.shape(this.rest[i] / this.texW, this.rest[i + 1] / this.texH);
      p[i] = this.rest[i] + dx;
      p[i + 1] = this.rest[i + 1] + dy;
    }
    this.mesh.geometry.getAttribute('aPosition').buffer.update();
  }
}

/** The drawing's main colour (ignoring see-through pixels), a little darker, for puffer spikes. */
function averageColor(texture: Texture) {
  let r = 120, g = 120, b = 120;
  try {
    const c = Object.assign(document.createElement('canvas'), { width: 24, height: 24 }).getContext('2d', { willReadFrequently: true })!;
    c.drawImage(texture.source.resource as CanvasImageSource, 0, 0, 24, 24);
    const px = c.getImageData(0, 0, 24, 24).data;
    let n = 0, sr = 0, sg = 0, sb = 0;
    for (let i = 0; i < px.length; i += 4) {
      if (px[i + 3] < 128) continue;
      sr += px[i];
      sg += px[i + 1];
      sb += px[i + 2];
      n++;
    }
    if (n) [r, g, b] = [sr / n, sg / n, sb / n];
  } catch {}
  const dark = (v: number) => Math.round(v * 0.85);
  return (dark(r) << 16) | (dark(g) << 8) | dark(b);
}
