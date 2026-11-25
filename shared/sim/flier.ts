import { motionOf, type Drawing } from '../types.ts';
import { newPose, type Saved, type SimCreature } from './creature.ts';
import { LANDED_SECONDS, type Flake } from './food.ts';
import { TAU, clamp, depthScale, growScale, seededRandom } from './math.ts';
import { sizeFactor } from './styles.ts';
import { burst, denFor, heart, sandY, type DenSpot, type World } from './world.ts';

/** A place to land: the ground (at a depth) or the top of a plant or decoration. */
interface Perch {
  x: number;
  y: number;
  z: number;
  /** On the water's surface (waterfowl), where it paddles about. */
  water?: boolean;
  /** Its den's door: it goes in there (to roost for the night, keep dry, or rest). */
  den?: DenSpot;
}

/**
 * Birds, butterflies, bees: they flap about the sky in loops and swoops, glide now and then, and land to
 * rest on the ground or on top of a tree, fence or flower. Over water (the Pond, Shell Beach) they stay in
 * the sky above it and only land on dry ground. They swoop down for seeds, roost at night, and (if their
 * kind comes in a flock) follow a leader. The pose's puff is how high it is above the ground under it
 * (-1 over water, where there's no shadow to cast).
 *
 * Waterfowl (ducks, geese, swans) do all that too, but at a water place they come down on the water instead:
 * they paddle about, bob, now and then dabble head-down under the surface, and paddle over to food floating
 * near the top.
 */
export class SimFlier implements SimCreature {
  readonly kind = 'flier';
  readonly pose = newPose();
  x = 0;
  y = 0;
  z: number;
  facing: number;
  leader: SimFlier | null = null;
  rank = 0;
  private size: number;
  private pace: number;
  private vx = 0;
  private vy = 0;
  private goal = { x: 0, y: 0 };
  private perch: Perch | null = null;
  /** Seconds left sitting on its perch (0 while flying). */
  private sitting = 0;
  private flyFor = 0;
  private gliding = 0;
  private flap = Math.random() * TAU;
  private effort = 1;
  private meal: Flake | null = null;
  private starring = false;
  private dozing = 0;
  /** Waterfowl: lands on the water to paddle about. */
  private swims: boolean;
  private paddleTo = 0;
  /** Seconds left of a dabble (tipped head-down under the water), and how long it is. */
  private dabble = 0;
  private dabbleFor = 1;

  constructor(
    readonly id: string,
    readonly drawing: Drawing,
    world: World,
    arriving: boolean,
    saved?: Saved,
    grownFrom?: number,
  ) {
    const rand = seededRandom(id);
    this.swims = motionOf(drawing) === 'waterfowl';
    this.z = saved?.z ?? rand(0.1, 0.9);
    this.size = rand(0.8, 1.2) * sizeFactor(drawing) * growScale(grownFrom);
    this.pace = rand(0.8, 1.25);
    this.facing = saved?.facing ?? (rand() < 0.5 ? -1 : 1);
    const sky = this.sky(world);
    this.x = saved?.x ?? world.width * rand(0.1, 0.9);
    this.y = saved?.y ?? rand(sky.top, sky.bottom);
    if (arriving && !saved) {
      // Newcomers fly in from the side.
      this.x = this.facing > 0 ? -60 : world.width + 60;
      this.y = rand(sky.top, (sky.top + sky.bottom) / 2);
    }
    this.flyFor = rand(8, 20);
    // Back on the water where it was paddling before a restart.
    if (this.swims && saved && saved.y >= world.waterTop - 1 && this.onWater(world, this.x)) {
      this.y = world.waterTop;
      this.perch = { x: this.x, y: this.y, z: this.z, water: true };
      this.sitting = rand(5, 25);
      this.paddleTo = this.x;
    }
    this.pickGoal(world);
    this.update(0, world);
  }

  save(): Saved {
    return { x: this.x, y: this.y, z: this.z, facing: Math.sign(this.facing) || 1 };
  }

  /** A chick starts out where its egg was, sitting for a moment before its first flight. */
  placeAt(p: { x: number; y: number; z: number }) {
    this.x = p.x;
    this.z = p.z;
    this.perch = { x: p.x, y: p.y, z: p.z };
    this.y = p.y;
    this.sitting = 4;
  }

  star(on: boolean) {
    this.starring = on;
    if (on) {
      this.perch = null;
      this.sitting = 0;
      this.z = 0.1;
    }
  }

  /** Where it can fly: above the ground on land, above the water elsewhere. */
  private sky(world: World) {
    const top = world.height * 0.05;
    const bottom = world.land ? world.floorAt(world.width / 2) - world.height * 0.04 : world.waterTop - world.height * 0.03;
    return { top, bottom: Math.max(top + 20, bottom) };
  }

  private scale(world: World) {
    // A little smaller over the water, where the sky is narrow.
    const room = world.land ? 1 : Math.min(1, Math.max(0.7, world.waterTop / (world.height * 0.3)));
    return ((world.height * 0.11 * this.size * room) / Math.max(this.drawing.width, this.drawing.height)) * depthScale(this.z);
  }

  private pickGoal(world: World) {
    const sky = this.sky(world);
    if (this.leader) {
      const behind = this.leader.facing >= 0 ? -1 : 1;
      const gap = 50 * (1 + Math.floor(this.rank / 2));
      this.goal = {
        x: this.leader.x + behind * gap,
        y: clamp(this.leader.y + (this.rank % 2 ? 30 : -30) * (1 + Math.floor(this.rank / 2) * 0.5), sky.top, sky.bottom),
      };
      return;
    }
    this.goal = {
      x: clamp(this.x + (Math.random() - 0.5) * world.width * 0.9, 40, world.width - 40),
      y: Math.random() * (sky.bottom - sky.top) + sky.top,
    };
  }

  /** Somewhere to land: home in its den (if its kind has one here), on dry ground, or on top of a tree, fence or flower. */
  private findPerch(world: World, asleep = false): Perch | null {
    const den = denFor(world, this.drawing.id, this.x);
    // Home for the night or out of the rain, and often just for a rest (bees are always popping in and out).
    if (den && (asleep || world.rain > 0.5 || Math.random() < 0.4)) return { x: den.x, y: den.y, z: den.z, den };
    // Waterfowl mostly come down on the water.
    if (this.swims && !world.land && Math.random() < 0.85) {
      const water = Array.from({ length: 6 }, () => Math.random() * world.width).filter((x) => this.onWater(world, x));
      water.sort((a, b) => Math.abs(a - this.x) - Math.abs(b - this.x));
      const x = water[Math.floor(Math.random() * Math.min(3, water.length))];
      if (x !== undefined) return { x, y: world.waterTop, z: 0.1 + Math.random() * 0.8, water: true };
    }
    const options: Perch[] = [];
    for (const h of world.hideouts) {
      const top = h.bottom - h.height;
      // Anywhere on its upper part, not only the very top: plants of a height would otherwise line
      // everyone up in one neat row across the screen.
      const down = Math.random() < 0.35 ? 4 : 4 + Math.random() * h.height * 0.45;
      if (world.land || top + down < world.waterTop - 10) options.push({ x: h.x + (Math.random() - 0.5) * h.halfWidth * 1.1, y: top + down, z: h.z });
    }
    const ground = (x: number) => (world.land || world.floorAt(x) < world.waterTop - 8 ? x : null);
    for (let i = 0; i < 4; i++) {
      const x = ground(Math.random() * world.width);
      if (x === null) continue;
      const z = Math.random();
      options.push({ x, y: sandY(world, z, x), z });
    }
    if (!options.length) return null;
    // Closer is likelier.
    options.sort((a, b) => Math.abs(a.x - this.x) - Math.abs(b.x - this.x));
    return options[Math.floor(Math.random() * Math.min(3, options.length))];
  }

  /** Open water to sit on, away from the shore and the edges. */
  private onWater(world: World, x: number) {
    return !world.land && x > 30 && x < world.width - 30 && x >= world.waterLeft && world.floorAt(x) > world.waterTop + world.height * 0.08;
  }

  /** How far down a floating bird can reach for food. */
  private reach(world: World) {
    return world.waterTop + world.height * 0.12;
  }

  private findMeal(world: World) {
    let best: Flake | null = null;
    if (!world.land) {
      // Waterfowl paddle over to food floating near the top.
      if (!this.swims) return null;
      for (const f of world.food.flakes) {
        if (f.eaten || f.y > this.reach(world) || !this.onWater(world, f.x)) continue;
        if (!best || Math.abs(f.x - this.x) < Math.abs(best.x - this.x)) best = f;
      }
      return best;
    }
    for (const f of world.food.flakes) {
      if (f.eaten || f.landedFor <= 0 || f.landedFor > LANDED_SECONDS - 1) continue;
      if (!best || Math.abs(f.x - this.x) < Math.abs(best.x - this.x)) best = f;
    }
    return best;
  }

  update(dt: number, world: World) {
    const asleep = (this.drawing.nocturnal ? world.sleepiness < 0.5 : world.sleepiness > 0.5) && !this.starring;
    this.dozing += ((asleep && this.sitting > 0 ? 1 : 0) - this.dozing) * Math.min(1, dt * 0.5);

    if (this.meal?.eaten || (this.meal && this.meal.landedFor > LANDED_SECONDS - 1)) this.meal = null;
    // Food in the water sinks out of reach.
    if (this.meal && !world.land && this.meal.y > this.reach(world)) this.meal = null;
    if (!asleep && !this.meal && Math.random() < dt * 0.5) {
      this.meal = this.findMeal(world);
      if (this.meal && world.land) {
        const z = this.meal.z ?? 0.5;
        this.perch = { x: this.meal.x, y: sandY(world, z, this.meal.x), z };
        this.sitting = 0;
      } else if (this.meal && !(this.perch?.water && this.sitting > 0)) {
        // Down onto the water by it (already afloat, it just paddles over).
        this.perch = { x: this.meal.x, y: world.waterTop, z: this.z, water: true };
        this.sitting = 0;
      }
    }

    if (this.sitting > 0 && this.perch) {
      // Sitting: a little hop now and then, and off again when it's had its rest (not while it's asleep).
      this.sitting -= asleep || world.rain > 0.5 ? 0 : dt;
      if (this.perch.water) this.paddle(dt, world, asleep);
      else {
        this.x = this.perch.x;
        this.y = this.perch.y;
      }
      this.vx = this.vy = 0;
      this.effort += (0.05 - this.effort) * Math.min(1, dt * 4);
      if (this.meal && Math.abs(this.meal.x - this.x) < 20) {
        this.meal.eaten = true;
        this.meal = null;
        world.notes.push({ kind: 'ate', who: this.id });
        heart(world, this.x, this.y - 30, 8);
      }
      if (this.sitting <= 0) {
        if (this.perch.water) burst(world, this.x, world.waterTop, 8);
        this.perch = null;
        this.flyFor = 8 + Math.random() * 20;
        this.vy = -world.height * 0.25;
        this.pickGoal(world);
      }
    } else {
      this.fly(dt, world, asleep);
    }
    this.setPose(world);
  }

  /** Afloat: paddling about the surface (over to food if there is some), bobbing, and dabbling now and then. */
  private paddle(dt: number, world: World, asleep: boolean) {
    if (this.meal) this.paddleTo = this.meal.x;
    else if (!asleep && Math.abs(this.paddleTo - this.x) < 8 && Math.random() < dt * 0.4) {
      const to = this.x + (Math.random() - 0.5) * world.width * 0.4;
      if (this.onWater(world, to)) this.paddleTo = to;
    }
    const dx = asleep && !this.meal ? 0 : this.paddleTo - this.x;
    if (Math.abs(dx) > 2 && this.dabble <= 0) {
      const speed = world.height * 0.035 * this.pace * (this.meal ? 2.5 : 1);
      const step = Math.sign(dx) * Math.min(Math.abs(dx), speed * dt);
      if (this.onWater(world, this.x + step)) this.x += step;
      else this.paddleTo = this.x;
      this.facing += (Math.sign(dx) - this.facing) * Math.min(1, dt * 3);
      // Its feet paddle (legs marked as 🦵 parts kick).
      this.flap += dt * 6;
    }
    this.dabble -= dt;
    if (!asleep && !this.meal && this.dabble < -4 && Math.random() < dt * 0.06) {
      this.dabble = this.dabbleFor = 1.5 + Math.random() * 1.5;
    }
    this.perch!.x = this.x;
    this.y = world.waterTop;
  }

  private fly(dt: number, world: World, asleep: boolean) {
    this.flyFor -= dt;
    // Time to rest (or roost for the night, or wait out the rain).
    if (!this.perch && !this.starring && (this.flyFor <= 0 || asleep || world.rain > 0.5) && !this.leader?.perch) {
      this.perch = this.findPerch(world, asleep);
      if (!this.perch) this.flyFor = 6;
    }
    if (this.leader?.perch && !this.perch && this.leader.sitting > 0) {
      // The flock lands together, near its leader: scattered about it, nearer and further back, not in
      // one neat row (and now and then on a plant close by).
      const p = this.leader.perch;
      // Going home: the whole flock follows it in.
      if (p.den) this.perch = { ...p };
      const x = clamp(p.x + (this.rank + 1) * (25 + Math.random() * 35) * (this.rank % 2 ? 1 : -1), 20, world.width - 20);
      const z = clamp(p.z + (Math.random() - 0.5) * 0.5, 0.02, 0.98);
      const plant = p.water ? undefined : world.hideouts.find((h) => Math.abs(h.x - x) < h.halfWidth && (world.land || h.bottom - h.height < world.waterTop - 10));
      if (p.den) {
        // (Following it in, above.)
      } else if (p.water) this.perch = this.onWater(world, x) ? { x, y: world.waterTop, z: p.z, water: true } : null;
      else if (plant && Math.random() < 0.4) this.perch = { x, y: plant.bottom - plant.height * (0.55 + Math.random() * 0.4), z: plant.z };
      else this.perch = world.land || world.floorAt(x) < world.waterTop - 8 ? { x, y: sandY(world, z, x), z } : null;
    }

    let tx = this.goal.x;
    let ty = this.goal.y;
    if (this.perch) {
      tx = this.perch.x;
      ty = this.perch.y;
    } else if (this.starring) {
      // On camera: a loop-the-loop in front of everyone.
      tx = world.width / 2 + Math.cos(world.time * 0.9) * world.width * 0.25;
      ty = world.height * 0.3 + Math.sin(world.time * 1.8) * world.height * 0.12;
    } else if (this.leader) this.pickGoal(world);
    else if (Math.hypot(tx - this.x, ty - this.y) < 40) this.pickGoal(world);

    // Heading home, it comes in to the den's depth on the way.
    if (this.perch?.den) this.z += (this.perch.z - this.z) * Math.min(1, dt * 1.5);
    const speed = world.height * (this.perch ? 0.22 : 0.18) * this.pace * (this.meal ? 1.5 : 1);
    const dx = tx - this.x;
    const dy = ty - this.y;
    const dist = Math.max(1, Math.hypot(dx, dy));
    const want = Math.min(speed, dist * 2);
    const turn = Math.min(1, dt * 2.5);
    this.vx += ((dx / dist) * want - this.vx) * turn;
    this.vy += ((dy / dist) * want - this.vy) * turn;
    // A gentle rise and fall as it flaps.
    const wobble = Math.sin(this.flap * 0.5) * world.height * 0.02;
    this.x += this.vx * dt;
    this.y += (this.vy + wobble) * dt;
    if (this.perch && dist < 8) {
      if (this.perch.water) {
        // A splash down, then a good long paddle.
        burst(world, this.x, world.waterTop, 10);
        this.paddleTo = this.x;
        this.sitting = this.meal ? 4 : asleep ? 30 : 15 + Math.random() * 30;
      } else if (this.perch.den) {
        this.z = this.perch.z;
        this.sitting = asleep ? 30 : 6 + Math.random() * 14;
      } else this.sitting = this.meal ? 2 : asleep ? 30 : 4 + Math.random() * 14;
      return;
    }
    if (Math.abs(this.vx) > 10) this.facing += (Math.sign(this.vx) - this.facing) * Math.min(1, dt * 4);
    // Now and then it stops flapping and glides for a moment.
    this.gliding -= dt;
    if (this.gliding < -6 && Math.random() < dt * 0.3) this.gliding = 1 + Math.random() * 2;
    const gliding = this.gliding > 0 && !this.perch;
    this.effort += ((gliding ? 0.2 : 1.6) - this.effort) * Math.min(1, dt * 3);
    this.flap += dt * (gliding ? 2 : 12) * this.pace;
  }

  private setPose(world: World) {
    const p = this.pose;
    const s = this.scale(world);
    const flying = this.sitting <= 0;
    p.x = this.x;
    p.y = this.y;
    p.sx = this.facing * s;
    p.sy = s * (flying ? 1 : 1 + Math.sin(world.time * 2) * 0.015);
    p.rot = flying ? clamp(Math.atan2(this.vy, Math.abs(this.vx) + 1) * 0.5, -0.5, 0.5) * Math.sign(this.facing || 1) : 0;
    if (!flying && this.perch?.water) {
      // Afloat: sitting low in the water and bobbing. A dabble tips it head-down, tail up.
      p.y += this.drawing.height * s * 0.3 + Math.sin(world.time * 1.6 + this.pace * 9) * 1.5;
      const tip = clamp(Math.min(this.dabble, this.dabbleFor - this.dabble) * 2.5, 0, 1);
      p.rot = tip * 1.1 * Math.sign(this.facing || 1);
    }
    p.z = this.z;
    p.phase = this.flap;
    p.effort = 1 + Math.min(1, this.effort);
    p.drowsy = this.dozing;
    p.star = this.starring;
    const ground = world.land ? sandY(world, this.perch?.z ?? this.z, this.x) : null;
    p.puff = ground === null ? -1 : Math.max(0, ground - this.y);
    p.den = 0;
    const den = !flying ? this.perch?.den : undefined;
    if (den) {
      // In its den: just in front of the back wall, behind the front, small enough to fit.
      const fit = Math.min(1, (den.height * 0.6) / Math.max(1, this.drawing.height * s));
      p.z = den.z - 0.005;
      p.sx *= fit;
      p.sy *= fit;
      p.puff = 0;
      p.den = den.open ? 2 : 1;
    }
  }
}
