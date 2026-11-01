import { motionOf, type CreatureType, type Drawing } from '../types.ts';
import type { Saved, SimCreature } from './creature.ts';
import { SimCrawler } from './crawler.ts';
import { SimEgg } from './egg.ts';
import { SimFood } from './food.ts';
import { babyScale, nightDarkness } from './math.ts';
import { SimStill } from './still.ts';
import { SimSwimmer } from './swimmer.ts';
import { burst, newWorld, type Hideout, type World } from './world.ts';

/** Babies get their own few places, so they never crowd out the family's drawings. */
export type Bucket = CreatureType | 'baby';
export const bucketOf = (d: Drawing): Bucket => (d.parents ? 'baby' : d.type);

/** How many of each kind the tank shows at once; older ones retire to the gallery. */
export const CAPS: Record<Bucket, number> = { swimmer: 40, crawler: 10, plant: 24, decor: 14, baby: 6 };

/** The drawings that live in the tank: the newest of each kind, up to its cap. */
export function shownDrawings(drawings: Drawing[]) {
  const counts: Record<Bucket, number> = { swimmer: 0, crawler: 0, plant: 0, decor: 0, baby: 0 };
  return [...drawings].sort((a, b) => b.createdAt - a.createdAt).filter((d) => counts[bucketOf(d)]++ < CAPS[bucketOf(d)]);
}

/** Night creatures come out once it's getting properly dark. */
const NIGHT = 0.25;

/**
 * One tank's life: its creatures, food, schools, currents and the time of day. The server runs the real one
 * (so every screen shows the same tank); the draw page's preview runs a little one of its own.
 */
export class Tank {
  readonly food = new SimFood();
  readonly world: World = newWorld(this.food);
  readonly creatures = new Map<string, SimCreature>();
  /** The hour to show, or null for the real time. */
  hour: number | null = null;
  /** 0 in daylight, 0.5 at full night; eases when the hour changes. */
  darkness = -1;
  /** The blacklight: on or off, and how far it has faded in (0..1). */
  blacklightOn = false;
  blacklight = 0;
  private nextSchoolAt = 40 + Math.random() * 40;
  private currentIn = 150 + Math.random() * 150;
  private currentFor = 0;
  private currentDir = 1;

  get isNight() {
    return this.darkness >= NIGHT;
  }

  /** Adds a drawing's creature: an egg until it hatches. saved puts it back where it was before a restart. */
  add(drawing: Drawing, dropIn: boolean, saved?: Saved) {
    const creature = this.make(drawing, dropIn, saved);
    this.creatures.set(drawing.id, creature);
    if (dropIn && creature.kind !== 'egg') burst(this.world, creature.pose.x, 0);
    return creature;
  }

  private make(drawing: Drawing, dropIn: boolean, saved?: Saved): SimCreature {
    if ((drawing.hatchAt ?? 0) > Date.now()) return new SimEgg(drawing, this.world, dropIn);
    switch (motionOf(drawing)) {
      case 'crawler':
        return new SimCrawler(drawing, this.world, dropIn, saved);
      case 'plant':
        return new SimStill(drawing, 'plant', this.world);
      case 'decor':
        return new SimStill(drawing, 'decor', this.world);
      default:
        return new SimSwimmer(drawing, this.world, dropIn, saved);
    }
  }

  /** An edited drawing: same creature, carrying on from where it was. */
  replace(drawing: Drawing) {
    const old = this.creatures.get(drawing.id);
    const saved = old && 'save' in old ? (old as SimSwimmer).save() : undefined;
    this.creatures.delete(drawing.id);
    this.add(drawing, false, saved);
  }

  remove(id: string) {
    this.creatures.delete(id);
  }

  /** Brings the creatures in line with the drawings (the newest of each kind, up to its cap). */
  sync(drawings: Drawing[], saved: Record<string, Saved> = {}) {
    const shown = shownDrawings(drawings);
    const ids = new Set(shown.map((d) => d.id));
    for (const id of this.creatures.keys()) if (!ids.has(id)) this.remove(id);
    for (const d of shown) {
      const had = this.creatures.get(d.id);
      if (!had) this.add(d, false, saved[d.id]);
      else if (had.drawing.updatedAt !== d.updatedAt) this.replace(d);
    }
  }

  startCurrent() {
    this.currentFor = 25;
    this.currentDir = Math.random() < 0.5 ? -1 : 1;
    this.currentIn = 200 + Math.random() * 250;
  }

  /** A new school forms right away. */
  startSchool() {
    this.world.school = null;
    this.nextSchoolAt = 0;
  }

  step(dt: number) {
    const world = this.world;
    world.time += dt;

    // Eases toward the hour's darkness, so switching the time from the ⚙️ menu fades rather than snaps.
    const now = new Date();
    const want = nightDarkness(this.hour ?? now.getHours() + now.getMinutes() / 60);
    this.darkness = this.darkness < 0 ? want : this.darkness + (want - this.darkness) * Math.min(1, dt * 0.7);
    if (Math.abs(want - this.darkness) < 0.002) this.darkness = want;
    this.blacklight += ((this.blacklightOn ? 1 : 0) - this.blacklight) * Math.min(1, dt * 1.2);
    world.sleepiness = Math.min(1, this.darkness / 0.5);

    this.hatchEggs();
    world.fish = [];
    const hideouts: Hideout[] = [];
    for (const c of this.creatures.values()) {
      // Night creatures only come out after dark.
      const out = !c.drawing.nocturnal || c.kind === 'egg' || this.isNight;
      if (out && !c.pose.out) world.notes.push({ kind: 'out', who: c.drawing.id });
      c.pose.out = out;
      if (!out) continue;
      if (c instanceof SimSwimmer) world.fish.push(c);
      else if (c instanceof SimStill) hideouts.push(c.hideout());
    }
    world.hideouts = hideouts;
    this.updateSchool();
    this.updateCurrent(dt);
    this.food.update(dt, world);
    for (const c of this.creatures.values()) if (c.pose.out) c.update(dt, world);
  }

  /** The egg cracks and the baby swims out right where it was. */
  private hatchEggs() {
    for (const [id, c] of this.creatures) {
      if (!(c instanceof SimEgg) || !c.ready) continue;
      const at = c.pose;
      const baby = this.make(c.drawing, false);
      if (baby instanceof SimSwimmer) baby.placeAt(at);
      this.creatures.set(id, baby);
      burst(this.world, at.x, at.y, 16);
      this.world.notes.push({ kind: 'hatch', who: id });
    }
  }

  /** Every couple of minutes a few fish team up and follow a leader for a while. */
  private updateSchool() {
    const world = this.world;
    const school = world.school;
    if (school) {
      if (world.time > school.until || !world.fish.includes(school.leader)) {
        if (world.time > school.until && school.members[0]) {
          world.notes.push({ kind: 'school-end', leader: school.leader.drawing.id, first: school.members[0].drawing.id });
        }
        world.school = null;
      } else school.members = school.members.filter((m) => world.fish.includes(m));
      return;
    }
    if (world.time < this.nextSchoolAt || world.sleepiness > 0.4) return;
    this.nextSchoolAt = world.time + 70 + Math.random() * 80;
    const candidates = world.fish.filter((f) => f.style.schools && f.personality !== 'shy').sort(() => Math.random() - 0.5);
    if (candidates.length < 3) return;
    const [leader, ...rest] = candidates;
    world.school = { leader, members: rest.slice(0, 2 + Math.floor(Math.random() * 4)), until: world.time + 25 };
    world.notes.push({ kind: 'school', leader: leader.drawing.id, members: world.school.members.map((m) => m.drawing.id) });
  }

  /** Every few minutes a gentle current sweeps through for a little while. */
  private updateCurrent(dt: number) {
    this.currentIn -= dt;
    if (this.currentIn <= 0 && this.currentFor <= 0) this.startCurrent();
    this.currentFor = Math.max(0, this.currentFor - dt);
    // Swells up and dies away smoothly.
    this.world.current = this.currentDir * this.world.height * 0.03 * Math.sin((this.currentFor / 25) * Math.PI) ** 2;
  }

  /** Two grown-up fish that could have a baby together. */
  canParent(d: Drawing) {
    return !d.parents && motionOf(d) === 'fish';
  }

  /** How big a baby has grown (1 once it's a week old). */
  grownUp(d: Drawing) {
    return d.parents !== undefined && babyScale(d) >= 0.95;
  }
}
