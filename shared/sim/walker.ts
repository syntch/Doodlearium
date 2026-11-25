import { motionOf, type Drawing } from '../types.ts';
import { ACT, newPose, type Saved, type SimCreature } from './creature.ts';
import { LANDED_SECONDS, type Flake } from './food.ts';
import { TAU, clamp, depthScale, growScale, seededRandom } from './math.ts';
import { sizeFactor } from './styles.ts';
import { denFor, heart, sandY, type DenSpot, type Trinket, type World } from './world.ts';

/** How a land animal gets about: trotting on legs, hopping, or sliding along the ground. */
export type Gait = 'walk' | 'hop' | 'slither';

export const gaitOf = (d: Drawing): Gait => {
  const motion = motionOf(d);
  return motion === 'hopper' ? 'hop' : motion === 'slitherer' ? 'slither' : 'walk';
};

/** Longest side, as a share of the place's height, before its own size and depth. */
const SIZES: Record<Gait, number> = { walk: 0.2, hop: 0.13, slither: 0.24 };

/**
 * Animals on land (dogs, sheep, bunnies, snakes...): they wander about the field, back and forth and nearer
 * and further, stop to graze or sit, nap at night, run over to seeds, and (if their kind lives in a herd)
 * follow a leader. Drawings are stored facing right; they turn by squashing through zero width.
 * The pose's puff is how high it is off the ground (hoppers mid-hop), so screens can keep its shadow down.
 */
export class SimWalker implements SimCreature {
  readonly kind = 'walker';
  readonly pose = newPose();
  readonly gait: Gait;
  x = 0;
  z: number;
  facing: number;
  /** Followed when its kind lives in a herd (set by the place, see Tank.updateHerds); rank is its place in line. */
  leader: SimWalker | null = null;
  rank = 0;
  private size: number;
  private pace: number;
  private scale = 1;
  private goal = { x: 0, z: 0.5 };
  private resting = 0;
  /** What it's doing while stopped: looking about, grazing (head down) or sitting. */
  private pause: 'look' | 'graze' | 'sit' = 'look';
  private hurry = 1;
  private step = Math.random() * TAU;
  stride = 0;
  /** Hoppers: how far through the current hop (0..1), and how far it carries. */
  private hop = -1;
  private hopFrom = { x: 0, z: 0 };
  private hopTo = { x: 0, z: 0 };
  private landed = 0;
  private meal: Flake | null = null;
  private starring = false;
  private trickIn = 0;
  private dozing = 0;
  /** Where it's sheltering from the rain (under a tree or beside a barn), while it pours. */
  private shelter: { x: number; z: number } | null = null;
  /** Marked with 🦾 arm parts: it can wave, pet the others and pick things up. */
  readonly arms: boolean;
  /** What its arms are doing (see ACT), for how long, and how far into it. */
  private act: number = ACT.none;
  private actFor = 0;
  private actT = 0;
  /** Off to do something with its arms: pick up a decoration for a look, or give someone a pat. */
  private errand: { kind: 'fetch'; trinket: Trinket; stage: number } | { kind: 'pet'; who: SimWalker } | null = null;
  /** The decoration it has in its hands just now. */
  holding: string | null = null;
  /** Being petted: a happy wiggle, for a few seconds. */
  private petted = 0;
  /** Off home to its den (or in it): why, and (for a rest) until when. */
  private home: { den: DenSpot; why: 'sleep' | 'rain' | 'rest'; inside: boolean; until: number } | null = null;

  constructor(
    readonly id: string,
    readonly drawing: Drawing,
    world: World,
    arriving: boolean,
    saved?: Saved,
    grownFrom?: number,
  ) {
    const rand = seededRandom(id);
    this.gait = gaitOf(drawing);
    this.arms = drawing.parts?.some((p) => p.motion === 'arm') ?? false;
    this.z = saved?.z ?? rand(0.05, 0.95);
    this.size = rand(0.85, 1.2) * sizeFactor(drawing) * growScale(grownFrom);
    this.pace = rand(0.8, 1.2);
    this.x = saved?.x ?? world.width * rand(0.1, 0.9);
    this.facing = saved?.facing ?? (rand() < 0.5 ? -1 : 1);
    if (arriving && !saved) {
      // Newcomers wander in from the side.
      this.facing = this.x < world.width / 2 ? 1 : -1;
      this.x = this.facing > 0 ? -this.halfWidth(world) - 20 : world.width + this.halfWidth(world) + 20;
      this.goal = { x: world.width * rand(0.2, 0.8), z: this.z };
    } else this.pickGoal(world);
    this.update(0, world);
  }

  save(): Saved {
    return { x: this.x, y: 0, z: this.z, facing: Math.sign(this.facing) || 1 };
  }

  /** A baby starts out right beside its parents (or where its egg was). */
  placeAt(p: { x: number; z: number }) {
    this.x = p.x;
    this.z = p.z;
    this.resting = 2;
  }

  star(on: boolean) {
    this.starring = on;
    this.trickIn = 1;
    if (on) this.goal.z = 0.05;
  }

  /** The decoration it's off to fetch (or has in its hands), so nobody else goes for it. */
  get fetching() {
    return this.errand?.kind === 'fetch' ? this.errand.trinket.id : null;
  }

  /** Someone's coming over to give it a pat: it stays put, and wiggles happily once they're there. */
  stayFor(seconds: number) {
    this.resting = Math.max(this.resting, seconds);
    if (this.pause === 'graze') this.pause = 'look';
  }

  pat(seconds: number) {
    this.petted = seconds;
    this.stayFor(seconds);
  }

  /** Free to be petted: standing about, not off somewhere. */
  private get idle() {
    return this.resting > 1.5 && this.hop < 0 && !this.meal && !this.errand && !this.starring && !this.home;
  }

  /** Heads home to its den, if its kind has one here. */
  private goHome(world: World, why: 'sleep' | 'rain' | 'rest') {
    const den = denFor(world, this.drawing.id, this.x);
    if (!den) return false;
    this.home = { den, why, inside: false, until: 0 };
    this.errand = null;
    this.act = ACT.none;
    this.holding = null;
    this.shelter = null;
    this.goal = { x: den.x, z: den.z };
    this.hurry = why === 'rest' ? 1 : 1.5;
    this.resting = 0;
    return true;
  }

  /** In its den: snug until it's time to come out (morning, the rain stops, or it's had its rest). */
  private stayHome(dt: number, world: World, asleep: boolean) {
    const home = this.home!;
    const done = home.why === 'sleep' ? !asleep : home.why === 'rain' ? world.rain < 0.3 : world.time > home.until;
    if (done || this.starring || (this.meal && home.why === 'rest')) {
      // Out it comes, and off somewhere.
      this.home = null;
      this.resting = 0;
      this.pickGoal(world);
      return false;
    }
    this.x = home.den.x;
    this.z = home.den.z;
    this.stride += (0 - this.stride) * Math.min(1, dt * 6);
    return true;
  }

  baseScale(world: World) {
    const longest = this.gait === 'slither' ? this.drawing.width : Math.max(this.drawing.width, this.drawing.height);
    return (world.height * SIZES[this.gait] * this.size) / longest;
  }

  halfWidth(world: World) {
    return (this.drawing.width * this.baseScale(world) * depthScale(this.z)) / 2;
  }

  private pickGoal(world: World) {
    const margin = Math.min(this.halfWidth(world), world.width * 0.2);
    if (this.leader) {
      // Herds trail along behind their leader, a little to one side or the other.
      const behind = this.leader.facing >= 0 ? -1 : 1;
      const gap = this.halfWidth(world) * 2.2 * (1 + Math.floor(this.rank / 2));
      this.goal = {
        x: clamp(this.leader.x + behind * gap + (Math.random() - 0.5) * 40, margin, world.width - margin),
        z: clamp(this.leader.z + (this.rank % 2 ? 0.12 : -0.12) + (Math.random() - 0.5) * 0.1, 0, 1),
      };
    } else {
      this.goal = {
        x: clamp(this.x + (Math.random() - 0.5) * world.width * 0.7, margin, world.width - margin),
        z: clamp(this.z + (Math.random() - 0.5) * 0.6, 0, 1),
      };
    }
    this.hurry = 1;
  }

  /** The nearest fresh seed lying on the ground. */
  private findMeal(world: World) {
    let best: Flake | null = null;
    let bestD = Infinity;
    for (const f of world.food.flakes) {
      if (f.eaten || f.landedFor <= 0 || f.landedFor > LANDED_SECONDS - 1) continue;
      const d = Math.hypot(f.x - this.x, ((f.z ?? this.z) - this.z) * world.height);
      if (d < bestD) {
        best = f;
        bestD = d;
      }
    }
    return best;
  }

  update(dt: number, world: World) {
    const base = this.baseScale(world);
    const asleep = (this.drawing.nocturnal ? world.sleepiness < 0.5 : world.sleepiness > 0.5) && !this.starring;
    this.dozing += ((asleep ? 1 : 0) - this.dozing) * Math.min(1, dt * 0.5);

    if (this.meal?.eaten || (this.meal && this.meal.landedFor > LANDED_SECONDS - 1)) this.meal = null;
    if (!asleep) this.meal ??= this.findMeal(world);
    if (this.meal) {
      this.goal = { x: this.meal.x, z: this.meal.z ?? this.z };
      this.hurry = 1.8;
      this.resting = 0;
    }

    // At bedtime, or when it pours, a creature with a den here heads home.
    if (this.home?.inside && this.stayHome(dt, world, asleep)) {
      this.pose.drowsy = this.dozing;
      this.setPose(world, base);
      return;
    }
    if (!this.home && !this.starring && !this.meal && (asleep || world.rain > 0.5)) this.goHome(world, asleep ? 'sleep' : 'rain');
    if (this.home && (this.starring || (this.meal && this.home.why !== 'sleep'))) this.home = null;
    if (this.home && !this.home.inside) {
      this.goal = { x: this.home.den.x, z: this.home.den.z };
      if (Math.abs(this.home.den.x - this.x) < 8 && Math.abs(this.home.den.z - this.z) < 0.03) {
        this.home.inside = true;
        this.home.until = world.time + 8 + Math.random() * 16;
        this.setPose(world, base);
        return;
      }
    }

    // When it pours, everyone heads for the nearest tree or decoration and waits it out there.
    if (world.rain > 0.5 && !this.starring && !this.meal && !this.home) {
      if (!this.shelter && world.hideouts.length) {
        const h = world.hideouts.reduce((a, b) => (Math.abs(b.x - this.x) < Math.abs(a.x - this.x) ? b : a));
        this.shelter = { x: clamp(h.x + (Math.random() - 0.5) * h.halfWidth, 20, world.width - 20), z: clamp(h.z + (Math.random() - 0.5) * 0.15, 0, 1) };
        this.goal = { ...this.shelter };
        this.hurry = 1.6;
        this.resting = 0;
      }
      if (this.shelter && this.resting > 0) this.resting = Math.max(this.resting, 1);
    } else if (this.shelter) {
      this.shelter = null;
      this.resting = 0.5;
    }

    // Something more pressing comes up: put down what it's holding and let the errand go.
    if ((asleep || this.meal || this.shelter || this.starring) && (this.errand || this.act)) this.dropEverything();
    this.petted = Math.max(0, this.petted - dt);
    if (this.act) {
      this.actT += dt;
      this.resting = Math.max(this.resting, 0.2);
      if (this.errand?.kind === 'pet' && Math.random() < dt * 1.1) {
        const who = this.errand.who;
        heart(world, who.x, sandY(world, who.z, who.x) - who.drawing.height * who.baseScale(world) * depthScale(who.z) * 1.05, 9);
      }
      if (this.actT >= this.actFor) this.nextAct(world);
    }

    if (this.starring) {
      // On camera: up near the front, trotting back and forth, with a hop now and then.
      this.trickIn -= dt;
      if (this.resting <= 0 && Math.abs(this.goal.x - this.x) < 6) {
        this.goal = { x: clamp(this.x + (this.x < world.width / 2 ? 1 : -1) * world.width * 0.3, 100, world.width - 100), z: 0.05 };
      }
    }

    const dx = this.goal.x - this.x;
    const dz = this.goal.z - this.z;
    if (this.meal && Math.abs(dx) < Math.max(10, this.halfWidth(world) * 0.5) && Math.abs(dz) < 0.08) {
      this.meal.eaten = true;
      this.meal = null;
      world.notes.push({ kind: 'ate', who: this.id });
      heart(world, this.x, sandY(world, this.z, this.x) - this.drawing.height * base * 1.1, 10);
      this.resting = 1;
      this.pause = 'graze';
    }

    let moving = false;
    if (asleep && !this.meal && !this.home) {
      this.resting = Math.max(this.resting, 1);
      this.pause = 'sit';
    }
    if (this.hop >= 0) moving = true;
    else if (this.resting > 0) {
      this.resting -= dt;
      if (this.resting <= 0 && !asleep) this.pickGoal(world);
    } else if (Math.abs(dx) < 5 && Math.abs(dz) < 0.02) {
      if (this.errand) this.arrive(world);
      else if (this.home) this.resting = 0;
      // Now and then it pops home for a rest.
      else if (Math.random() < 0.12 && this.goHome(world, 'rest')) this.resting = 0;
      else if (!this.arms || !this.busyHands(world)) {
      // Arrived: a look about, some grazing, or a good long sit.
      const roll = Math.random();
      this.pause = roll < 0.4 ? 'look' : roll < 0.75 ? 'graze' : 'sit';
      this.resting = this.leader ? 1 + Math.random() * 3 : this.pause === 'sit' ? 6 + Math.random() * 8 : 1.5 + Math.random() * 4;
      }
    } else moving = true;

    if (moving) {
      if (Math.abs(dx) > 8) this.facing += (Math.sign(dx) - this.facing) * Math.min(1, dt * 5);
      const speed = world.height * 0.06 * this.pace * this.hurry;
      if (this.gait === 'hop') this.hopAlong(dt, world, speed);
      else {
        const dist = Math.hypot(dx, dz * world.height);
        const go = Math.min(1, (speed * dt) / Math.max(1, dist));
        this.x += dx * go;
        this.z += dz * go;
        this.step += dt * (this.gait === 'slither' ? 5 : 8) * this.pace * this.hurry;
      }
    }
    if (this.leader && this.resting <= 0 && !this.meal && !this.errand && Math.abs(this.leader.x - this.x) > this.halfWidth(world) * 8) this.pickGoal(world);

    this.stride += ((moving ? 1 : 0) - this.stride) * Math.min(1, dt * 6);
    this.landed = Math.max(0, this.landed - dt);
    this.pose.drowsy = this.dozing;
    this.setPose(world, base);
  }

  /** Starts doing something with its arms, standing still while it does. */
  private doAct(act: number, seconds: number) {
    this.act = act;
    this.actFor = seconds;
    this.actT = 0;
    this.resting = Math.max(this.resting, seconds);
  }

  private dropEverything() {
    this.errand = null;
    this.holding = null;
    this.act = ACT.none;
  }

  /**
   * Instead of just standing about when it gets somewhere, a creature with arms might find something to do
   * with them: go and pick up a little decoration for a look, go over and pet someone, wave at a passer-by,
   * have a stretch or scratch its head. True if it found something.
   */
  private busyHands(world: World) {
    const roll = Math.random();
    const reach = world.width * 0.4;
    if (roll < 0.22) {
      // Something small enough to pick up (much smaller than itself), not too far.
      const h = this.drawing.height * this.baseScale(world) * depthScale(this.z);
      const w = this.halfWidth(world);
      // (Measured against its height or length, whichever is bigger, so a tall thin person counts as big.)
      const size = Math.max(h, w * 2);
      const near = (world.trinkets ?? []).filter((t) => !t.taken && t.height < size * 0.5 && t.halfWidth < size * 0.4 && Math.abs(t.x - this.x) < reach);
      const trinket = near[Math.floor(Math.random() * near.length)];
      if (trinket) {
        const side = Math.sign(trinket.x - this.x) || 1;
        trinket.taken = true;
        this.errand = { kind: 'fetch', trinket, stage: 0 };
        this.goal = { x: clamp(trinket.x - side * (trinket.halfWidth + w * 0.55), 20, world.width - 20), z: trinket.z };
        this.hurry = 1;
        return true;
      }
    } else if (roll < 0.44) {
      const near = (world.walkers ?? []).filter((o) => o !== this && o.idle && o.pose.out && Math.abs(o.x - this.x) < reach);
      const who = near[Math.floor(Math.random() * near.length)];
      if (who) {
        const side = Math.sign(who.x - this.x) || 1;
        this.errand = { kind: 'pet', who };
        this.goal = { x: clamp(who.x - side * (who.halfWidth(world) + this.halfWidth(world)) * 0.7, 20, world.width - 20), z: who.z };
        this.hurry = 1;
        who.stayFor(8);
        return true;
      }
    } else if (roll < 0.7) {
      // Someone on the move nearby gets a wave; otherwise a stretch, or a scratch of the head.
      const passing = (world.walkers ?? []).find((o) => o !== this && o.pose.out && o.stride > 0.5 && Math.abs(o.x - this.x) < world.width * 0.3);
      if (passing && Math.random() < 0.55) {
        this.facing = Math.sign(passing.x - this.x) || this.facing;
        this.doAct(ACT.wave, 2 + Math.random());
      } else if (Math.random() < 0.5) this.doAct(ACT.stretch, 2.5);
      else this.doAct(ACT.scratch, 1.6 + Math.random());
      this.pause = 'look';
      this.resting += 0.5 + Math.random() * 1.5;
      return true;
    }
    return false;
  }

  /** Got to where its errand was: turn to face it and get on with it. */
  private arrive(world: World) {
    const e = this.errand!;
    const at = e.kind === 'fetch' ? e.trinket.x : e.who.x;
    this.facing = Math.sign(at - this.x) || this.facing;
    this.pause = 'look';
    if (e.kind === 'fetch') this.doAct(ACT.reach, 0.8);
    else if (e.who.pose.out && Math.abs(e.who.x - this.x) < (e.who.halfWidth(world) + this.halfWidth(world)) * 1.5) {
      this.doAct(ACT.pet, 3 + Math.random() * 1.5);
      e.who.pat(this.actFor + 0.5);
    } else this.errand = null;
  }

  /** One thing done with its arms: on to the next part of its errand, or back to its day. */
  private nextAct(world: World) {
    const e = this.errand;
    this.act = ACT.none;
    if (e?.kind === 'fetch') {
      e.stage++;
      // Bent down: up it comes for a good look, then down again, and back it goes just where it was.
      if (e.stage === 1) {
        this.holding = e.trinket.id;
        this.doAct(ACT.hold, 3 + Math.random() * 3);
        return;
      }
      if (e.stage === 2) {
        this.doAct(ACT.reach, 0.8);
        return;
      }
      this.holding = null;
    }
    this.errand = null;
    this.resting = 0.8 + Math.random();
  }

  /** Hoppers go in hops: a crouch, an arc through the air, a squash on landing, and a short pause. */
  private hopAlong(dt: number, world: World, speed: number) {
    if (this.hop < 0) {
      if (this.landed > 0) return;
      const reach = world.height * 0.12 * this.pace * (this.hurry > 1 ? 1.4 : 1);
      const dx = this.goal.x - this.x;
      const dz = this.goal.z - this.z;
      const dist = Math.hypot(dx, dz * world.height);
      const f = Math.min(1, reach / Math.max(1, dist));
      this.hopFrom = { x: this.x, z: this.z };
      this.hopTo = { x: this.x + dx * f, z: this.z + dz * f };
      this.hop = 0;
    }
    // Under a weaker pull a hop takes longer (and goes higher: see setPose).
    this.hop += ((dt * speed) / (world.height * 0.09)) * Math.sqrt(world.gravity ?? 1);
    const t = Math.min(1, this.hop);
    this.x = this.hopFrom.x + (this.hopTo.x - this.hopFrom.x) * t;
    this.z = this.hopFrom.z + (this.hopTo.z - this.hopFrom.z) * t;
    if (this.hop >= 1) {
      this.hop = -1;
      this.landed = this.hurry > 1 ? 0.12 : 0.25 + Math.random() * 0.5;
    }
  }

  private setPose(world: World, base: number) {
    const p = this.pose;
    const ground = sandY(world, this.z, this.x);
    const scale = base * depthScale(this.z);
    const h = this.drawing.height * scale;
    const breathe = Math.sin(world.time * (2 - this.dozing) + this.pace * 10) * (0.015 + this.dozing * 0.015);
    let lift = 0;
    let sx = 1;
    let sy = 1 + breathe * (1 - this.stride);
    let rot = 0;
    if (this.gait === 'hop') {
      if (this.hop >= 0) {
        const t = this.hop;
        lift = (Math.sin(t * Math.PI) * h * (this.starring ? 1.1 : 0.55)) / Math.sqrt(world.gravity ?? 1);
        sy *= 1 + Math.sin(t * Math.PI) * 0.12;
        sx *= 1 - Math.sin(t * Math.PI) * 0.06;
        rot = (0.5 - t) * -0.35;
      } else if (this.landed > 0) {
        sy *= 0.86;
        sx *= 1.08;
      }
    } else if (this.gait === 'walk') {
      const bob = Math.abs(Math.sin(this.step)) * this.stride;
      lift = bob * h * 0.05;
      rot = Math.sin(this.step * 2) * 0.03 * this.stride;
    }
    // Bending down to pick something up; stretching tall; wiggling happily while being petted.
    if (this.act === ACT.reach) rot += 0.22 * Math.sin(Math.min(1, this.actT / this.actFor) * Math.PI);
    if (this.act === ACT.stretch) sy *= 1 + 0.05 * Math.sin(Math.min(1, this.actT / this.actFor) * Math.PI);
    if (this.petted > 0) {
      const k = Math.min(1, this.petted);
      rot += Math.sin(world.time * 13) * 0.05 * k;
      sy *= 1 + Math.abs(Math.sin(world.time * 6.5)) * 0.03 * k;
    }
    if (this.resting > 0 && this.stride < 0.5) {
      // Grazing tips the head down; sitting settles lower; asleep it's lower still.
      if (this.pause === 'graze' && this.gait === 'walk') rot += 0.1 * Math.min(1, this.resting);
      if (this.pause === 'sit') sy *= 0.93 - this.dozing * 0.05;
    }
    p.x = this.x;
    p.y = ground - lift;
    p.sx = this.facing * scale * sx;
    p.sy = scale * sy;
    p.rot = rot * Math.sign(this.facing || 1);
    p.z = this.z;
    p.phase = this.step;
    p.effort = 1 + this.stride * this.hurry;
    p.puff = lift;
    p.star = this.starring;
    p.act = this.act;
    p.actT = this.act ? Math.min(1, this.actT / this.actFor) : 0;
    p.den = 0;
    if (this.home?.inside) {
      // Just in front of the den's back wall and behind its front, at the door, small enough to fit.
      const den = this.home.den;
      const fit = Math.min(1, (den.height * 0.75) / Math.max(1, this.drawing.height * scale));
      p.x = den.x;
      p.y = den.y;
      p.z = den.z - 0.005;
      p.sx *= fit;
      p.sy *= fit;
      p.rot = 0;
      p.puff = 0;
      p.den = den.open ? 2 : 1;
    }
  }
}
