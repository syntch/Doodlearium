import { motionOf, type Drawing } from '../types.ts';
import { newPose, type Saved, type SimCreature } from './creature.ts';
import { LANDED_SECONDS, type Flake } from './food.ts';
import { TAU, clamp, depthScale, growScale, seededRandom } from './math.ts';
import { sizeFactor } from './styles.ts';
import { heart, sandY, type World } from './world.ts';

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
  private stride = 0;
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

  private baseScale(world: World) {
    const longest = this.gait === 'slither' ? this.drawing.width : Math.max(this.drawing.width, this.drawing.height);
    return (world.height * SIZES[this.gait] * this.size) / longest;
  }

  private halfWidth(world: World) {
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

    // When it pours, everyone heads for the nearest tree or decoration and waits it out there.
    if (world.rain > 0.5 && !this.starring && !this.meal) {
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
    if (asleep && !this.meal) {
      this.resting = Math.max(this.resting, 1);
      this.pause = 'sit';
    }
    if (this.hop >= 0) moving = true;
    else if (this.resting > 0) {
      this.resting -= dt;
      if (this.resting <= 0 && !asleep) this.pickGoal(world);
    } else if (Math.abs(dx) < 5 && Math.abs(dz) < 0.02) {
      // Arrived: a look about, some grazing, or a good long sit.
      const roll = Math.random();
      this.pause = roll < 0.4 ? 'look' : roll < 0.75 ? 'graze' : 'sit';
      this.resting = this.leader ? 1 + Math.random() * 3 : this.pause === 'sit' ? 6 + Math.random() * 8 : 1.5 + Math.random() * 4;
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
    if (this.leader && this.resting <= 0 && !this.meal && Math.abs(this.leader.x - this.x) > this.halfWidth(world) * 8) this.pickGoal(world);

    this.stride += ((moving ? 1 : 0) - this.stride) * Math.min(1, dt * 6);
    this.landed = Math.max(0, this.landed - dt);
    this.pose.drowsy = this.dozing;
    this.setPose(world, base);
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
    this.hop += (dt * speed) / (world.height * 0.09);
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
        lift = Math.sin(t * Math.PI) * h * (this.starring ? 1.1 : 0.55);
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
  }
}
