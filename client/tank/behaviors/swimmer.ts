import { Container, MeshPlane, type Texture } from 'pixi.js';
import type { Drawing } from '../../../shared/types.ts';
import { Attachments } from '../attachments.ts';
import { TAU, clamp, depthOrder, depthScale, depthTint, seededRandom, type Creature, type World } from '../world.ts';

const COLUMNS = 16;

/**
 * A fish: the drawing is a mesh whose columns are bent by a sine wave travelling from head to tail
 * (amplitude grows toward the tail), while the body wanders between random targets with smooth steering.
 * Drawings are stored facing right, so x = 0 is the tail and x = width is the head.
 */
export class Swimmer implements Creature {
  readonly view = new Container();
  private mesh: MeshPlane;
  private positions: Float32Array;
  private rest: Float32Array;
  private texW: number;
  private texH: number;

  private z: number;
  private size: number;
  private cruise: number;
  private phase: number;
  private x = 0;
  private y = 0;
  private vx = 0;
  private vy = 0;
  private target = { x: 0, y: 0 };
  private legSpeed = 1;
  private retargetIn = 0;
  private bubbleIn: number;
  private facing = 1;
  private dropTime = 0;
  private amp = 0;
  private attachments: Attachments;
  private scale = 1;

  constructor(
    readonly drawing: Drawing,
    texture: Texture,
    world: World,
    dropIn: boolean,
  ) {
    const rand = seededRandom(drawing.id);
    this.z = rand();
    this.size = rand(0.75, 1.3);
    this.cruise = rand(0.7, 1.3);
    this.phase = rand(0, TAU);
    this.bubbleIn = rand(2, 10);

    this.mesh = new MeshPlane({ texture, verticesX: COLUMNS, verticesY: 2 });
    this.texW = texture.width;
    this.texH = texture.height;
    this.mesh.pivot.set(this.texW / 2, this.texH / 2);
    this.mesh.tint = depthTint(this.z);
    this.mesh.alpha = 1 - this.z * 0.1;
    this.positions = this.mesh.geometry.getAttribute('aPosition').buffer.data as Float32Array;
    this.rest = this.positions.slice();
    this.attachments = new Attachments(drawing.attachments, this.texW, this.texH, { x: this.texW / 2, y: this.texH / 2 });
    this.view.addChild(this.mesh, this.attachments.container);
    this.view.zIndex = depthOrder(this.z);

    this.layout(world);
    const bounds = this.bounds(world);
    if (dropIn) {
      // Plunge in from above the water line, then settle into wandering.
      this.x = bounds.left + Math.random() * (bounds.right - bounds.left);
      this.y = -this.texH * this.scale;
      this.vy = world.height * 0.45;
      this.dropTime = 1.6;
    } else {
      this.x = bounds.left + Math.random() * (bounds.right - bounds.left);
      this.y = bounds.top + Math.random() * (bounds.bottom - bounds.top);
    }
    this.facing = Math.random() < 0.5 ? -1 : 1;
    this.pickTarget(world);
  }

  layout(world: World) {
    this.scale = (world.height * 0.24 * this.size * depthScale(this.z)) / Math.max(this.texW, this.texH * 1.4);
    const b = this.bounds(world);
    this.x = clamp(this.x, b.left, b.right);
    if (this.dropTime <= 0) this.y = clamp(this.y, b.top, b.bottom);
    this.target.x = clamp(this.target.x, b.left, b.right);
    this.target.y = clamp(this.target.y, b.top, b.bottom);
  }

  labelAnchor() {
    return { x: this.view.x, y: this.view.y - (this.texH * this.scale) / 2 - 8 };
  }

  update(dt: number, world: World) {
    const baseSpeed = world.height * 0.075 * this.cruise * depthScale(this.z);
    const speed = baseSpeed * this.legSpeed;

    this.retargetIn -= dt;
    const dx = this.target.x - this.x;
    const dy = this.target.y - this.y;
    const dist = Math.hypot(dx, dy);
    if (dist < 20 || this.retargetIn <= 0) this.pickTarget(world);

    // Ease velocity toward the target heading; drops steer gently so the plunge carries through.
    this.dropTime -= dt;
    const steer = this.dropTime > 0 ? 0.6 : 1.4;
    const k = Math.min(1, dt * steer);
    this.vx += ((dx / (dist || 1)) * speed - this.vx) * k;
    this.vy += ((dy / (dist || 1)) * speed * 0.6 - this.vy) * k;
    this.x += this.vx * dt;
    this.y += this.vy * dt;

    // Turn around by squashing through zero width, which reads as the fish rotating to face the other way.
    if (Math.abs(this.vx) > baseSpeed * 0.2) {
      this.facing += (Math.sign(this.vx) - this.facing) * Math.min(1, dt * 3.5);
    }
    const tilt = clamp(Math.atan2(this.vy, Math.abs(this.vx) + 1e-3), -0.45, 0.45) * 0.7;
    const bob = Math.sin(world.time * 1.3 + this.phase) * world.height * 0.004;
    this.view.position.set(this.x, this.y + bob);
    this.view.scale.set(this.facing * this.scale, this.scale);
    this.view.rotation = tilt * Math.sign(this.facing);

    const effort = clamp(Math.hypot(this.vx, this.vy) / baseSpeed, 0.2, 2.5);
    this.phase += dt * (4 + effort * 4);
    this.wiggle(effort);
    // Extras ride the same body wave as the drawing underneath them.
    this.attachments.update(dt, world, (u) => ({ dx: 0, dy: this.waveAt(clamp(u, 0, 1)) }));

    this.bubbleIn -= dt;
    if (this.bubbleIn <= 0) {
      this.bubbleIn = 4 + Math.random() * 10;
      const head = (this.texW / 2) * this.scale * Math.sign(this.facing);
      world.scene.bubble(this.x + head, this.y, 2 + Math.random() * 2);
    }
  }

  private wiggle(effort: number) {
    this.amp = this.texH * 0.08 * (0.6 + effort * 0.4);
    const p = this.positions;
    for (let i = 0; i < p.length; i += 2) {
      p[i + 1] = this.rest[i + 1] + this.waveAt(this.rest[i] / this.texW);
    }
    this.mesh.geometry.getAttribute('aPosition').buffer.update();
  }

  /** Vertical body offset at u (0 tail .. 1 head): a wave travelling toward the tail, biggest at the tail. */
  private waveAt(u: number) {
    const tail = 1 - u;
    return this.amp * (0.15 + tail * tail) * Math.sin(this.phase - u * 3.2);
  }

  private pickTarget(world: World) {
    const b = this.bounds(world);
    // Mostly lazy cruising, sometimes a quick dart.
    this.legSpeed = Math.random() < 0.15 ? 2.2 : 0.6 + Math.random() * 0.6;
    // Prefer horizontal travel: pick a far-off x and a nearby y.
    this.target.x = b.left + Math.random() * (b.right - b.left);
    this.target.y = clamp(this.y + (Math.random() - 0.5) * world.height * 0.35, b.top, b.bottom);
    this.retargetIn = 6 + Math.random() * 8;
  }

  private bounds(world: World) {
    const halfW = (this.texW * this.scale) / 2;
    const halfH = (this.texH * this.scale) / 2;
    return {
      left: halfW + 10,
      right: Math.max(halfW + 11, world.width - halfW - 10),
      top: world.height * 0.06 + halfH,
      bottom: Math.max(world.height * 0.06 + halfH + 1, world.floorY - halfH * 0.6),
    };
  }
}
