import { Container, Graphics, MeshPlane, type Texture } from 'pixi.js';
import { motionOf, type Drawing } from '../../../shared/types.ts';
import { Attachments } from '../attachments.ts';
import { Parts, type Cutout } from '../parts.ts';
import { babyScale } from '../babies.ts';
import { BODY_STYLES, type BodyState, type BodyStyle } from '../bodies.ts';
import type { Flake } from '../food.ts';
import { TAU, clamp, depthOrder, depthScale, depthTint, seededRandom, type Creature, type World } from '../world.ts';

/** How close to the glass a curious fish comes (negative depth is in front of everything). */
const GLASS_Z = -0.7;
const FLAKES_UNTIL_FULL = 3;

type Personality = 'curious' | 'shy' | 'easygoing' | 'hunter';

type Spot = { x: number; y: number; z: number };

/** Show-off moves for the camera. */
type Trick = 'loop' | 'dash' | 'waggle' | 'bubbles' | 'puff';
const TRICK_SECONDS: Record<Trick, number> = { loop: 1.6, dash: 1.4, waggle: 1.6, bubbles: 1.8, puff: 4 };

/**
 * Anything that swims in open water. The drawing is a mesh bent by its body style (a fish's tail wave,
 * an eel's S-wave, a jellyfish's pulse...), while the body steers toward a target.
 * Drawings are stored facing right, so x = 0 is the tail and x = width is the head.
 *
 * Every frame the swimmer picks what it is up to, in priority order: hiding from a hunter, chasing food,
 * sleeping (day fish at night), following a school, prowling (hunters), visiting the glass (curious ones),
 * darting away from neighbours (shy ones), or just wandering.
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
  private parts: Parts;
  private baseScale = 1;
  private scale = 1;

  private meal: Flake | null = null;
  private flakesEaten = 0;
  private fullUntil = 0;
  /** A well-fed fish looks a little bigger for a while. */
  private plump = 0;
  private visitIn: number;
  private visit: { until: number; hovering: boolean } | null = null;
  private dartCooldown = 0;
  /** Day fish doze off at night near a plant or on the bottom. */
  private bed: Spot | null = null;
  private sleeping = false;
  /** 0 awake .. 1 fast asleep; eases in and out. */
  private drowsy = 0;
  /** A hunter's current target, and when it gives up. */
  private stalk: { prey: Swimmer; until: number } | null = null;
  private prowlIn: number;
  /** Where a frightened fish is hiding, and until when. */
  private hide: (Spot & { until: number }) | null = null;
  /** Puffers: how blown up (0..1), how long until the next puff or until it lets go, and its silly tumble. */
  private puff = 0;
  private puffing = false;
  private puffTimer = 0;
  private spin = 0;
  private spikes: Graphics | null = null;
  private spikeColor = 0;
  /** Documentary mode is filming it: it comes right up front and does tricks. */
  private starring = false;
  private trickIn = 0;
  private trick: { kind: Trick; t: number; length: number } | null = null;
  private lastTrick: Trick | null = null;
  private spinBase = 0;
  private trailIn = 0;

  constructor(
    readonly drawing: Drawing,
    texture: Texture,
    world: World,
    dropIn: boolean,
    pieces: Cutout['pieces'] = [],
  ) {
    const rand = seededRandom(drawing.id);
    const roll = rand();
    this.personality = roll < 0.3 ? 'curious' : roll < 0.5 ? 'shy' : 'easygoing';
    this.zHome = this.personality === 'shy' ? rand(0.65, 1) : rand();
    this.z = this.zGoal = this.zHome;
    this.size = rand(0.75, 1.3) * babyScale(drawing);
    this.cruise = rand(0.7, 1.3);
    this.prowlIn = rand(10, 40);
    this.phase = rand(0, TAU);
    this.bubbleIn = rand(2, 10);
    this.visitIn = this.personality === 'curious' ? rand(15, 45) : rand(120, 300);

    this.style = BODY_STYLES[motionOf(drawing)] ?? BODY_STYLES.fish!;
    // Some of the bigger easygoing fish (and eels) are hunters: they prowl after smaller fish, which hide.
    const hunts = motionOf(drawing) === 'fish' || motionOf(drawing) === 'eel';
    if (hunts && roll >= 0.5 && roll < 0.64 && this.size > 1) this.personality = 'hunter';
    this.mesh = new MeshPlane({ texture, verticesX: this.style.columns, verticesY: this.style.rows });
    this.texW = texture.width;
    this.texH = texture.height;
    this.bodyState = { phase: this.phase, effort: 1, texW: this.texW, texH: this.texH };
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
      this.puffTimer = rand(15, 40);
    }
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

  /** Puts it somewhere, e.g. where its egg was. */
  placeAt(p: { x: number; y: number; z: number }) {
    this.x = p.x;
    this.y = p.y;
    this.z = p.z;
    this.vy = -this.halfLength;
    this.applyDepth();
  }

  get body() {
    return this.mesh;
  }

  /** Documentary mode starts (or stops) filming this fish. */
  star(on: boolean) {
    this.starring = on;
    this.trickIn = 2;
    if (!on && this.trick) this.endTrick();
    this.applyDepth();
  }

  /** Puffers blow up into a ball (from the console: doodlearium.creature().puffUp()). */
  puffUp() {
    if (!this.style.puffs || this.puffing) return;
    this.puffing = true;
    this.puffTimer = 6 + Math.random() * 4;
  }

  /** Blown up enough that hunters lose interest. */
  get puffed() {
    return this.puff > 0.5;
  }

  /** The fish a hunter is after right now. */
  get stalking(): Swimmer | null {
    return this.stalk?.prey ?? null;
  }

  /** Half the fish's on-screen length. */
  get halfLength() {
    return (this.texW * this.scale) / 2;
  }

  update(dt: number, world: World) {
    this.dropTime -= dt;
    this.dartCooldown -= dt;
    this.decide(dt, world);
    if (this.trick) this.doTrick(dt, world);

    // Glide toward the depth we want: forward to the glass, back home, or alongside the school.
    if (Math.abs(this.zGoal - this.z) > 0.001) {
      this.z += clamp(this.zGoal - this.z, -dt * 0.5, dt * 0.5);
      this.applyDepth();
    }
    this.plump = Math.max(0, this.plump - dt * 0.00005);
    this.scale = this.baseScale * depthScale(this.z) * (1 + this.plump);

    const style = this.style;
    const baseSpeed = world.height * 0.075 * this.cruise * style.cruise * depthScale(Math.max(0, this.z));
    if (style.puffs) this.updatePuff(dt, world);
    // A puffed-up ball can barely swim; it just drifts.
    const speed = baseSpeed * this.legSpeed * style.thrust(this.phase) * (1 - 0.85 * this.puff);
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
      wantY = (1.25 - contraction * 3.9) * baseSpeed + dirY * speed * 0.6;
      k = Math.min(1, dt * 6);
    }
    this.vx += (wantX - this.vx) * k;
    this.vy += (wantY - this.vy) * k;
    // A current carries everyone along a little; deeper sleepers drift more.
    this.x += (this.vx + world.current * (0.35 + this.drowsy * 0.3)) * dt;
    this.y += this.vy * dt;
    if (style.move === 'pulse') {
      const b = this.bounds(world);
      this.y = clamp(this.y, b.top, b.bottom + this.halfLength * 0.3);
    }

    // Turn around by squashing through zero width, which reads as the creature rotating to face the other way.
    if (style.flips && this.puff < 0.3 && Math.abs(this.vx) > baseSpeed * 0.15) {
      this.facing += (Math.sign(this.vx) - this.facing) * Math.min(1, dt * 3.5);
    }
    const tilt = clamp(Math.atan2(this.vy, Math.abs(this.vx) + 1e-3), -0.45, 0.45) * style.tilt;
    this.drowsy += ((this.sleeping ? world.sleepiness : 0) - this.drowsy) * Math.min(1, dt * 0.4);
    const bob = Math.sin(world.time * 1.3 + this.phase * 0.1) * world.height * style.bob * (1 - this.drowsy * 0.6);
    this.view.position.set(this.x, this.y + bob);
    this.view.scale.set(this.facing * this.scale, this.scale);
    this.view.rotation = (tilt * (1 - this.puff) + this.spin) * Math.sign(this.facing);

    const effort = clamp(Math.hypot(this.vx, this.vy) / baseSpeed, 0.2, 2.5);
    this.phase += dt * style.beat(effort) * (1 - this.drowsy * 0.65);
    this.bodyState.phase = this.phase;
    this.bodyState.effort = effort;
    this.bend();
    // Extras ride the same body motion as the drawing underneath them.
    const bend = (u: number, v: number) => this.shape(clamp(u, 0, 1), clamp(v, 0, 1));
    this.parts.update(dt, effort, bend, this.drowsy);
    this.attachments.update(dt, world, bend);

    this.tryToEat(world);

    this.bubbleIn -= dt;
    if (this.bubbleIn <= 0) {
      this.bubbleIn = (4 + Math.random() * 10) * (1 + this.drowsy * 2);
      world.scene.bubble(this.headX(), this.y, 2 + Math.random() * 2);
    }
  }

  // --- what the fish is up to ------------------------------------------------

  private decide(dt: number, world: World) {
    this.sleeping = false;
    if (this.dropTime > 0) return;
    if (this.starring) {
      if (!this.chaseFood(world)) this.perform(dt, world);
      return;
    }
    if (this.flee(world)) return;
    if (this.chaseFood(world)) return;
    if (this.sleep(world)) return;
    if (this.followSchool(world)) return;
    if (this.personality === 'hunter' && this.prowl(dt, world)) return;
    if (this.visitGlass(dt, world)) return;
    if (this.personality === 'shy' && this.dartFromNeighbours(world)) return;
    this.zGoal = this.zHome;
    this.retargetIn -= dt;
    if (this.retargetIn <= 0 || Math.hypot(this.target.x - this.x, this.target.y - this.y) < 20) {
      this.pickTarget(world);
    }
  }

/** On camera: swims a slow figure-eight right at the front of the tank, with a trick every few seconds. */
  private perform(dt: number, world: World) {
    this.visit = null;
    this.stalk = null;
    this.hide = null;
    this.bed = null;
    this.zGoal = 0.02;
    const b = this.bounds(world);
    if (this.trick?.kind !== 'dash') {
      const t = world.time * 0.22 + this.phase;
      this.target.x = clamp(world.width * (0.5 + 0.18 * Math.sin(t)), b.left, b.right);
      this.target.y = clamp(world.height * (0.42 + 0.09 * Math.sin(t * 2)), b.top, b.bottom);
      this.legSpeed = 0.9;
    }
    this.trickIn -= dt;
    if (!this.trick && this.trickIn <= 0) {
      const kinds: Trick[] = this.style.puffs ? ['puff', 'puff', 'loop', 'bubbles'] : ['loop', 'dash', 'waggle', 'bubbles'];
      const options = kinds.filter((k) => k !== this.lastTrick);
      const kind = options[Math.floor(Math.random() * options.length)];
      this.trick = { kind, t: 0, length: TRICK_SECONDS[kind] };
      this.lastTrick = kind;
      this.spinBase = this.spin;
      if (kind === 'puff') this.puffUp();
      if (kind === 'dash') {
        // Zoom off across the middle, trailing bubbles.
        const dir = this.x < world.width / 2 ? 1 : -1;
        this.target.x = clamp(this.x + dir * world.width * 0.35, b.left, b.right);
        this.target.y = clamp(this.y - world.height * 0.05, b.top, b.bottom);
        this.legSpeed = 3;
      }
    }
  }

  private doTrick(dt: number, world: World) {
    const trick = this.trick!;
    trick.t += dt;
    const k = clamp(trick.t / trick.length, 0, 1);
    switch (trick.kind) {
      case 'loop':
        // A full loop-the-loop, easing in and out.
        this.spin = this.spinBase + TAU * k * k * (3 - 2 * k);
        break;
      case 'waggle':
        // A happy, extra-wiggly swim.
        this.phase += dt * 10 * Math.sin(k * Math.PI);
        break;
      case 'bubbles':
        // Stops to blow a stream of bubbles, then a heart.
        this.legSpeed = 0.15;
        this.trailIn -= dt;
        if (this.trailIn <= 0 && k < 0.8) {
          this.trailIn = 0.07;
          world.scene.bubble(this.headX(), this.y - this.halfLength * 0.1, 2 + Math.random() * 4);
        }
        break;
      case 'dash':
        this.trailIn -= dt;
        if (this.trailIn <= 0) {
          this.trailIn = 0.06;
          world.scene.bubble(this.x - this.halfLength * Math.sign(this.facing || 1), this.y, 2 + Math.random() * 3);
        }
        break;
    }
    if (k >= 1) {
      if (trick.kind === 'bubbles') world.scene.heart(this.headX(), this.y - this.halfLength * 0.4, Math.max(6, this.halfLength * 0.15));
      this.endTrick();
    }
  }

  private endTrick() {
    if (this.trick?.kind === 'loop') this.spin = this.spinBase;
    this.trick = null;
    this.trickIn = 2.5 + Math.random() * 2;
  }

  /** Day fish swim down beside a plant (or to the bottom) and doze. Food still wakes them. */
  private sleep(world: World) {
    if (this.drawing.nocturnal || world.sleepiness < 0.5) {
      this.bed = null;
      return false;
    }
    this.bed ??= this.findBed(world);
    this.sleeping = true;
    this.visit = null;
    this.stalk = null;
    const far = Math.hypot(this.bed.x - this.x, this.bed.y - this.y) > this.halfLength * 2;
    this.target.x = this.bed.x + Math.sin(world.time * 0.15 + this.phase) * this.halfLength * 0.4;
    this.target.y = this.bed.y;
    this.zGoal = this.bed.z;
    this.legSpeed = far ? 0.7 : 0.12;
    return true;
  }

  private findBed(world: World): Spot {
    const b = this.bounds(world);
    const spots = world.hideouts;
    if (spots.length && Math.random() < 0.8) {
      const h = spots[Math.floor(Math.random() * spots.length)];
      return {
        x: clamp(h.x + (Math.random() - 0.5) * h.halfWidth * 2.4, b.left, b.right),
        y: clamp(h.bottom - h.height * (0.15 + Math.random() * 0.4), b.top, b.bottom),
        z: clamp(h.z - 0.04, 0, 1),
      };
    }
    return { x: b.left + Math.random() * (b.right - b.left), y: b.bottom - Math.random() * world.height * 0.08, z: this.zHome };
  }

  /** Hunters pick out a smaller fish now and then and follow it for a while. They never catch anything. */
  private prowl(dt: number, world: World) {
    if (!this.stalk) {
      this.prowlIn -= dt;
      if (this.prowlIn > 0) return false;
      let prey: Swimmer | null = null;
      for (const f of world.fish) {
        if (f === this || f.personality === 'hunter' || !(f.style.darts || f.style.puffs) || f.halfLength > this.halfLength * 0.9) continue;
        if (!prey || Math.hypot(f.x - this.x, f.y - this.y) < Math.hypot(prey.x - this.x, prey.y - this.y)) prey = f;
      }
      if (!prey) {
        this.prowlIn = 20;
        return false;
      }
      this.stalk = { prey, until: world.time + 6 + Math.random() * 4 };
    }
    const prey = this.stalk.prey;
    if (world.time > this.stalk.until || !world.fish.includes(prey) || prey.hide || prey.puffed) {
      this.stalk = null;
      this.prowlIn = 25 + Math.random() * 35;
      this.pickTarget(world);
      return false;
    }
    this.target.x = prey.x;
    this.target.y = prey.y;
    this.zGoal = prey.z;
    this.legSpeed = 1.5;
    return true;
  }

  /** Small fish scatter from a prowling hunter and hide behind the nearest plant or decoration. */
  private flee(world: World) {
    if (this.personality === 'hunter' || !(this.style.darts || this.style.puffs)) return false;
    if (!this.hide) {
      const reach = this.personality === 'shy' ? 6 : 4;
      const hunter = world.fish.find(
        (h) =>
          h.stalking &&
          (h.stalking === this ||
            (this.halfLength < h.halfLength && Math.hypot(h.x - this.x, h.y - this.y) < h.halfLength * reach)),
      );
      if (!hunter) return false;
      // Puffers don't hide: they blow up into a spiky ball instead.
      if (this.style.puffs) {
        this.puffUp();
        return false;
      }
      this.hide = { ...this.hidingPlace(world, hunter), until: world.time + 6 + Math.random() * 6 };
      this.visit = null;
      this.meal = null;
    }
    if (world.time > this.hide.until) {
      this.hide = null;
      this.pickTarget(world);
      return false;
    }
    const far = Math.hypot(this.hide.x - this.x, this.hide.y - this.y) > this.halfLength;
    this.target.x = this.hide.x;
    this.target.y = this.hide.y;
    this.zGoal = this.hide.z;
    this.legSpeed = far ? 2.8 : 0.25;
    return true;
  }

  private hidingPlace(world: World, hunter: Swimmer): Spot {
    const b = this.bounds(world);
    let best = null;
    let bestScore = Infinity;
    for (const h of world.hideouts) {
      // Close by, and not past the hunter.
      const score = Math.abs(h.x - this.x) + (Math.sign(h.x - this.x) === Math.sign(hunter.x - this.x) ? world.width * 0.3 : 0);
      if (score < bestScore) {
        best = h;
        bestScore = score;
      }
    }
    if (best) {
      return {
        x: clamp(best.x, b.left, b.right),
        y: clamp(best.bottom - best.height * 0.45, b.top, b.bottom),
        z: Math.min(1, best.z + 0.08),
      };
    }
    // Nowhere to hide: flee to the far back.
    return { x: clamp(this.x + Math.sign(this.x - hunter.x || 1) * world.width * 0.4, b.left, b.right), y: this.y, z: 1 };
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
    this.plump = Math.min(0.12, this.plump + 0.012);
    if (++this.flakesEaten >= FLAKES_UNTIL_FULL) {
      this.flakesEaten = 0;
      world.scene.heart(this.headX(), this.y - this.halfLength * 0.4, Math.max(5, this.halfLength * 0.12));
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
    if (this.spikes) this.spikes.tint = depthTint(this.z);
    this.mesh.alpha = 1 - Math.max(0, this.z) * 0.1;
    // The star of the show swims in front of everyone.
    this.view.zIndex = this.starring ? 3000 : depthOrder(this.z);
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

  private updatePuff(dt: number, world: World) {
    this.puffTimer -= dt;
    if (this.puffTimer <= 0) {
      if (this.puffing) {
        this.puffing = false;
        this.puffTimer = 40 + Math.random() * 60;
      } else if (this.dropTime <= 0 && !this.sleeping) {
        this.puffUp();
      }
    }
    // Blows up fast, lets the air out slowly.
    const want = this.puffing ? 1 : 0;
    this.puff = clamp(this.puff + (want - this.puff) * Math.min(1, dt * (this.puffing ? 3 : 0.9)), 0, 1);
    if (this.puff < 0.002) this.puff = 0;
    if (this.puffing && this.puff > 0.3) {
      // A slow, lopsided tumble: speeds up, nearly stops, sometimes rocks back.
      this.spin += dt * (0.45 + 0.75 * Math.sin(world.time * 1.1 + this.phase) + 0.3 * Math.sin(world.time * 2.9));
      this.vy -= world.height * 0.01 * dt;
    } else if (this.trick?.kind !== 'loop') {
      // Settle back the right way up by the shortest way round.
      const upright = Math.round(this.spin / TAU) * TAU;
      this.spin += (upright - this.spin) * Math.min(1, dt * 1.5);
    }
    this.drawSpikes();
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
