import { Container, MeshPlane, type Texture } from 'pixi.js';
import { motionOf, type Drawing } from '../../../shared/types.ts';
import { Attachments } from '../attachments.ts';
import { BODY_STYLES, type BodyState, type BodyStyle } from '../bodies.ts';
import type { Flake } from '../food.ts';
import { TAU, clamp, depthOrder, depthScale, depthTint, seededRandom, type Creature, type World } from '../world.ts';

/** How close to the glass a curious fish comes (negative depth is in front of everything). */
const GLASS_Z = -0.7;
const FLAKES_UNTIL_FULL = 3;

type Personality = 'curious' | 'shy' | 'easygoing';

/**
 * Anything that swims in open water. The drawing is a mesh bent by its body style (a fish's tail wave,
 * an eel's S-wave, a jellyfish's pulse...), while the body steers toward a target.
 * Drawings are stored facing right, so x = 0 is the tail and x = width is the head.
 *
 * Every frame the swimmer picks what it is up to, in priority order: chasing food, following a school,
 * visiting the glass (curious ones), darting away from neighbours (shy ones), or just wandering.
 */
export class Swimmer implements Creature {
  readonly view = new Container();
  readonly style: BodyStyle;
  private body: BodyState;
  private mesh: MeshPlane;
  private positions: Float32Array;
  private rest: Float32Array;
  private texW: number;
  private texH: number;

  readonly personality: Personality;
  /** Where this fish likes to be (0 front .. 1 back), and where it is right now. */
  private zHome: number;
  z: number;
  private zGoal: number;
  private size: number;
  private cruise: number;
  private phase: number;
  x = 0;
  y = 0;
  vx = 0;
  vy = 0;
  facing = 1;
  private target = { x: 0, y: 0 };
  private legSpeed = 1;
  private retargetIn = 0;
  private bubbleIn: number;
  private dropTime = 0;
  private attachments: Attachments;
  private baseScale = 1;
  private scale = 1;

  private meal: Flake | null = null;
  private flakesEaten = 0;
  private fullUntil = 0;
  private visitIn: number;
  private visit: { until: number; hovering: boolean } | null = null;
  private dartCooldown = 0;

  constructor(
    readonly drawing: Drawing,
    texture: Texture,
    world: World,
    dropIn: boolean,
  ) {
    const rand = seededRandom(drawing.id);
    const roll = rand();
    this.personality = roll < 0.3 ? 'curious' : roll < 0.5 ? 'shy' : 'easygoing';
    this.zHome = this.personality === 'shy' ? rand(0.65, 1) : rand();
    this.z = this.zGoal = this.zHome;
    this.size = rand(0.75, 1.3);
    this.cruise = rand(0.7, 1.3);
    this.phase = rand(0, TAU);
    this.bubbleIn = rand(2, 10);
    this.visitIn = this.personality === 'curious' ? rand(15, 45) : rand(120, 300);

    this.style = BODY_STYLES[motionOf(drawing)] ?? BODY_STYLES.fish!;
    this.mesh = new MeshPlane({ texture, verticesX: this.style.columns, verticesY: this.style.rows });
    this.texW = texture.width;
    this.texH = texture.height;
    this.body = { phase: this.phase, effort: 1, texW: this.texW, texH: this.texH };
    this.mesh.pivot.set(this.texW / 2, this.texH / 2);
    this.positions = this.mesh.geometry.getAttribute('aPosition').buffer.data as Float32Array;
    this.rest = this.positions.slice();
    this.attachments = new Attachments(drawing.attachments, this.texW, this.texH, { x: this.texW / 2, y: this.texH / 2 });
    this.view.addChild(this.mesh, this.attachments.container);
    this.applyDepth();

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
    this.facing = this.style.flips && Math.random() < 0.5 ? -1 : 1;
    this.pickTarget(world);
  }

  layout(world: World) {
    this.baseScale =
      (world.height * this.style.size * this.size) / Math.max(this.texW, this.texH * this.style.heightWeight);
    this.scale = this.baseScale * depthScale(this.z);
    const b = this.bounds(world);
    this.x = clamp(this.x, b.left, b.right);
    if (this.dropTime <= 0) this.y = clamp(this.y, b.top, b.bottom);
    this.target.x = clamp(this.target.x, b.left, b.right);
    this.target.y = clamp(this.target.y, b.top, b.bottom);
  }

  labelAnchor() {
    return { x: this.view.x, y: this.view.y - (this.texH * this.scale) / 2 - 8 };
  }

  /** Half the fish's on-screen length. */
  get halfLength() {
    return (this.texW * this.scale) / 2;
  }

  update(dt: number, world: World) {
    this.dropTime -= dt;
    this.dartCooldown -= dt;
    this.decide(dt, world);

    // Glide toward the depth we want: forward to the glass, back home, or alongside the school.
    if (Math.abs(this.zGoal - this.z) > 0.001) {
      this.z += clamp(this.zGoal - this.z, -dt * 0.5, dt * 0.5);
      this.applyDepth();
    }
    this.scale = this.baseScale * depthScale(this.z);

    const style = this.style;
    const baseSpeed = world.height * 0.075 * this.cruise * style.cruise * depthScale(Math.max(0, this.z));
    const speed = baseSpeed * this.legSpeed * style.thrust(this.phase);
    const dx = this.target.x - this.x;
    const dy = this.target.y - this.y;
    const dist = Math.hypot(dx, dy);
    // Slow down on arrival so hovering looks calm rather than jittery (but stay brisk when food is near).
    const arrive = clamp(dist / (world.height * 0.08), this.meal ? 0.6 : 0.15, 1);
    const dirX = dx / (dist || 1);
    const dirY = dy / (dist || 1);

    // Ease velocity toward the target heading; drops steer gently so the plunge carries through.
    const steer = this.dropTime > 0 ? 0.6 : this.legSpeed > 1.5 ? 2.4 : 1.4;
    let k = Math.min(1, dt * steer);
    let wantX = dirX * speed * arrive;
    let wantY = dirY * speed * arrive * style.vertical;
    if (style.move === 'pulse' && this.dropTime <= 0) {
      // Jellyfish: each contraction shoots up and along; in between they sink. Over a whole beat the rise
      // and sink cancel out (a half-sine averages 1/π), so the drift toward the target sets where it goes.
      const contraction = Math.max(0, Math.sin(this.phase));
      wantX = dirX * speed * 0.5 * (0.2 + contraction);
      wantY = (1 - contraction * 3.1) * baseSpeed + dirY * speed * 0.6;
      k = Math.min(1, dt * 6);
    }
    this.vx += (wantX - this.vx) * k;
    this.vy += (wantY - this.vy) * k;
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    if (style.move === 'pulse') {
      const b = this.bounds(world);
      this.y = clamp(this.y, b.top, b.bottom + this.halfLength * 0.3);
    }

    // Turn around by squashing through zero width, which reads as the creature rotating to face the other way.
    if (style.flips && Math.abs(this.vx) > baseSpeed * 0.15) {
      this.facing += (Math.sign(this.vx) - this.facing) * Math.min(1, dt * 3.5);
    }
    const tilt = clamp(Math.atan2(this.vy, Math.abs(this.vx) + 1e-3), -0.45, 0.45) * style.tilt;
    const bob = Math.sin(world.time * 1.3 + this.phase * 0.1) * world.height * style.bob;
    this.view.position.set(this.x, this.y + bob);
    this.view.scale.set(this.facing * this.scale, this.scale);
    this.view.rotation = tilt * Math.sign(this.facing);

    const effort = clamp(Math.hypot(this.vx, this.vy) / baseSpeed, 0.2, 2.5);
    this.phase += dt * style.beat(effort);
    this.body.phase = this.phase;
    this.body.effort = effort;
    this.bend();
    // Extras ride the same body motion as the drawing underneath them.
    this.attachments.update(dt, world, (u, v) => style.deform(clamp(u, 0, 1), clamp(v, 0, 1), this.body));

    this.tryToEat(world);

    this.bubbleIn -= dt;
    if (this.bubbleIn <= 0) {
      this.bubbleIn = 4 + Math.random() * 10;
      world.scene.bubble(this.headX(), this.y, 2 + Math.random() * 2);
    }
  }

  // --- what the fish is up to ------------------------------------------------

  private decide(dt: number, world: World) {
    if (this.dropTime > 0) return;
    if (this.chaseFood(world)) return;
    if (this.followSchool(world)) return;
    if (this.visitGlass(dt, world)) return;
    if (this.personality === 'shy' && this.dartFromNeighbours(world)) return;
    this.zGoal = this.zHome;
    this.retargetIn -= dt;
    if (this.retargetIn <= 0 || Math.hypot(this.target.x - this.x, this.target.y - this.y) < 20) {
      this.pickTarget(world);
    }
  }

  private chaseFood(world: World) {
    if (world.time < this.fullUntil) return false;
    // Re-pick the nearest flake when ours is gone (eaten by someone else, or fading on the sand).
    if (!this.meal || this.meal.eaten || this.meal.landedFor > 5) {
      this.meal = world.food.nearest(this.x, this.y);
    }
    if (!this.meal) return false;
    this.visit = null;
    this.zGoal = Math.min(this.zHome, 0.3);
    // Aim so the head (not the middle of the body) reaches the flake.
    const side = this.meal.x >= this.x ? 1 : -1;
    this.target.x = this.meal.x - side * this.halfLength * 0.8;
    this.target.y = this.meal.y;
    // Jellyfish just drift toward food; everyone else races for it.
    this.legSpeed = this.style.move === 'pulse' ? 0.8 : this.personality === 'shy' ? 1.4 : 1.9;
    return true;
  }

  private tryToEat(world: World) {
    if (!this.meal || this.meal.eaten) return;
    if (Math.hypot(this.meal.x - this.headX(), this.meal.y - this.y) > Math.max(16, this.halfLength * 0.45)) return;
    this.meal.eaten = true;
    this.meal = null;
    world.scene.bubble(this.headX(), this.y - 4, 2);
    if (++this.flakesEaten >= FLAKES_UNTIL_FULL) {
      this.flakesEaten = 0;
      this.fullUntil = world.time + 25;
    }
  }

  private followSchool(world: World) {
    const school = world.school;
    if (!school) return false;
    // The leader just wanders as usual; the others keep up with it.
    const place = school.members.indexOf(this);
    if (place === -1) return false;
    const leader = school.leader;
    const dir = Math.sign(leader.facing) || 1;
    const row = Math.floor(place / 2) + 1;
    const side = place % 2 ? 1 : -1;
    this.target.x = leader.x - dir * row * leader.halfLength * 1.6;
    this.target.y = leader.y + side * row * leader.halfLength * 0.55;
    this.zGoal = clamp(leader.z + side * 0.08, 0, 1);
    const gap = Math.hypot(this.target.x - this.x, this.target.y - this.y);
    this.legSpeed = clamp(gap / leader.halfLength, 0.9, 3.2);
    return true;
  }

  private visitGlass(dt: number, world: World) {
    this.visitIn -= dt;
    if (!this.visit) {
      if (this.visitIn > 0) return false;
      this.visit = { until: world.time + 30, hovering: false };
    }
    const visit = this.visit;
    if (!visit.hovering) {
      // Swim toward the middle of the tank while coming forward.
      this.zGoal = GLASS_Z;
      this.target.x = world.width * (0.35 + (this.phase % 1) * 0.3);
      this.target.y = world.height * 0.45;
      this.legSpeed = 0.8;
      if (Math.hypot(this.target.x - this.x, this.target.y - this.y) < 40 && Math.abs(this.z - GLASS_Z) < 0.1) {
        visit.hovering = true;
        visit.until = world.time + 6;
      }
    } else {
      // Hover nose-to-the-glass, drifting in a little circle.
      this.target.x += Math.cos(world.time * 0.9) * 0.6;
      this.target.y += Math.sin(world.time * 1.3) * 0.4;
      this.legSpeed = 0.35;
    }
    if (world.time > visit.until) {
      this.visit = null;
      this.visitIn = this.personality === 'curious' ? 40 + Math.random() * 50 : 180 + Math.random() * 240;
      this.pickTarget(world);
      return false;
    }
    return true;
  }

  private dartFromNeighbours(world: World) {
    if (this.dartCooldown > 0) return false;
    for (const other of world.fish) {
      if (other === this || Math.abs(other.z - this.z) > 0.35) continue;
      const dx = this.x - other.x;
      const dy = this.y - other.y;
      if (Math.hypot(dx, dy) > (this.halfLength + other.halfLength) * 1.3) continue;
      // Startled: zip off away from the neighbour, toward the back.
      const b = this.bounds(world);
      this.target.x = clamp(this.x + Math.sign(dx || 1) * world.width * 0.35, b.left, b.right);
      this.target.y = clamp(this.y + Math.sign(dy || 1) * world.height * 0.15, b.top, b.bottom);
      this.zGoal = Math.min(1, this.zHome + 0.15);
      this.legSpeed = 2.6;
      this.retargetIn = 2.5;
      this.dartCooldown = 4;
      return true;
    }
    return false;
  }

  // --- helpers -------------------------------------------------------------

  private headX() {
    return this.x + this.halfLength * 0.9 * Math.sign(this.facing || 1);
  }

  private applyDepth() {
    this.mesh.tint = depthTint(this.z);
    this.mesh.alpha = 1 - Math.max(0, this.z) * 0.1;
    this.view.zIndex = depthOrder(this.z);
  }

  /** Bends every mesh vertex by the body style. */
  private bend() {
    const p = this.positions;
    for (let i = 0; i < p.length; i += 2) {
      const { dx, dy } = this.style.deform(this.rest[i] / this.texW, this.rest[i + 1] / this.texH, this.body);
      p[i] = this.rest[i] + dx;
      p[i + 1] = this.rest[i + 1] + dy;
    }
    this.mesh.geometry.getAttribute('aPosition').buffer.update();
  }

  private pickTarget(world: World) {
    const b = this.bounds(world);
    // Mostly lazy cruising, sometimes a quick dart.
    this.legSpeed = this.style.darts && Math.random() < 0.15 ? 2.2 : 0.6 + Math.random() * 0.6;
    // Prefer horizontal travel: pick a far-off x and a nearby y (hoverers roam up and down more).
    // Shy ones keep low, near the plants.
    this.target.x = b.left + Math.random() * (b.right - b.left);
    const y = this.y + (Math.random() - 0.5) * world.height * 0.35 * (this.style.vertical >= 1 ? 1.8 : 1);
    this.target.y = clamp(this.personality === 'shy' ? Math.max(y, world.height * 0.5) : y, b.top, b.bottom);
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
