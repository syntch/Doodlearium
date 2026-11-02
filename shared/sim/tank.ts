import { motionOf, type Drawing } from '../types.ts';
import { isGroup, type Biome } from '../world/biomes.ts';
import type { Saved, SimCreature, Spec } from './creature.ts';
import { SimCrawler } from './crawler.ts';
import { SimEgg } from './egg.ts';
import { SimFood } from './food.ts';
import { growScale, nightDarkness } from './math.ts';
import { SimStill } from './still.ts';
import { SimSwimmer } from './swimmer.ts';
import { SimWalker } from './walker.ts';
import { SimFlier } from './flier.ts';
import { burst, heart, newWorld, sandY, type Hideout, type School, type World } from './world.ts';

/** Night creatures come out once it's getting properly dark. */
const NIGHT = 0.25;
/** Schools of one species keep to this size; a big group swims as several. */
const SCHOOL_SIZE = 7;

/**
 * One place's life: its creatures, food, schools, currents and the time of day. The server runs one for every
 * place in the world (so every screen shows the same thing); the draw page's preview runs a little one of
 * its own. Who lives here comes from outside (see shared/world/population.ts).
 */
export class Tank {
  readonly food = new SimFood();
  readonly world: World;
  readonly creatures = new Map<string, SimCreature>();
  private specs = new Map<string, Spec>();
  /** The hour to show, or null for the real time. */
  hour: number | null = null;
  /** 0 in daylight, 0.5 at full night; eases when the hour changes. */
  darkness = -1;
  /** The blacklight: on or off, and how far it has faded in (0..1). */
  blacklightOn = false;
  blacklight = 0;
  private nextSchoolAt = 40 + Math.random() * 40;
  private pairIn = 60 + Math.random() * 60;
  private currentIn = 150 + Math.random() * 150;
  private currentFor = 0;
  private currentDir = 1;
  /** The weather: how hard it's raining and snowing, and how bright a rainbow is (each 0..1, easing in and out). */
  readonly weather = { rain: 0, snow: 0, rainbow: 0 };
  private showerFor = 0;
  private showerKind: 'rain' | 'snow' = 'rain';
  private rainbowFor = 0;

  constructor(readonly biome: Biome = 'lake') {
    this.world = newWorld(this.food, biome);
  }

  get isNight() {
    return this.darkness >= NIGHT;
  }

  /** Adds a creature: an egg until it hatches. saved puts it back where it was before a restart. */
  add(spec: Spec, dropIn: boolean, saved?: Saved) {
    const creature = this.make(spec, dropIn, saved);
    this.creatures.set(spec.id, creature);
    this.specs.set(spec.id, spec);
    if (dropIn && creature.kind !== 'egg') burst(this.world, creature.pose.x, this.world.waterTop);
    return creature;
  }

  private make({ id, drawing, hatchAt, nest, grownFrom, placement }: Spec, dropIn: boolean, saved?: Saved): SimCreature {
    if ((hatchAt ?? 0) > Date.now()) return new SimEgg(id, drawing, this.world, dropIn, hatchAt!, nest ?? 0.5);
    // A land baby born just now (no egg) starts out beside its parents.
    if (this.world.land && !saved && nest !== undefined && grownFrom !== undefined && Date.now() - grownFrom < 60_000) {
      const z = 0.3 + Math.random() * 0.4;
      saved = { x: nest * this.world.width, y: sandY(this.world, z, nest * this.world.width), z };
      heart(this.world, saved.x, saved.y - 60, 14);
    }
    const motion = motionOf(drawing);
    switch (motion) {
      case 'crawler':
        return new SimCrawler(id, drawing, this.world, dropIn, saved);
      case 'flier':
        return new SimFlier(id, drawing, this.world, dropIn, saved, grownFrom);
      case 'walker':
      case 'hopper':
      case 'slitherer':
        // Pond-side animals live in the water too: there they crawl along the bottom (snakes swim like eels).
        if (this.world.land) return new SimWalker(id, drawing, this.world, dropIn, saved, grownFrom);
        if (motion === 'slitherer') return new SimSwimmer(id, drawing, this.world, dropIn, saved, grownFrom);
        return new SimCrawler(id, drawing, this.world, dropIn, saved);
      case 'plant':
        return new SimStill(id, drawing, 'plant', this.world, placement);
      case 'decor':
        return new SimStill(id, drawing, 'decor', this.world, placement);
      default:
        return new SimSwimmer(id, drawing, this.world, dropIn, saved, grownFrom);
    }
  }

  /** An edited drawing: the same creature, carrying on from where it was. */
  replace(spec: Spec) {
    const old = this.creatures.get(spec.id);
    const saved = old && 'save' in old ? (old as SimSwimmer).save() : undefined;
    this.creatures.delete(spec.id);
    this.add(spec, false, saved);
  }

  remove(id: string) {
    this.creatures.delete(id);
    this.specs.delete(id);
  }

  /** Where everyone is, to carry on from after a restart. */
  save() {
    const saved: Record<string, Saved> = {};
    for (const [id, c] of this.creatures) if ('save' in c) saved[id] = (c as SimSwimmer).save();
    return saved;
  }

  /** Brings the creatures in line with who lives here. With dropIn, newcomers arrive from above. */
  sync(specs: Spec[], saved: Record<string, Saved> = {}, dropIn = false) {
    const ids = new Set(specs.map((s) => s.id));
    for (const id of [...this.creatures.keys()]) if (!ids.has(id)) this.remove(id);
    for (const spec of specs) {
      const had = this.specs.get(spec.id);
      if (!had) this.add(spec, dropIn && !saved[spec.id], saved[spec.id]);
      else if (had.drawing.updatedAt !== spec.drawing.updatedAt || JSON.stringify(had.placement) !== JSON.stringify(spec.placement)) {
        this.replace(spec);
      } else if (had.drawing !== spec.drawing) this.specs.set(spec.id, { ...had, drawing: spec.drawing });
    }
  }

  startCurrent() {
    this.currentFor = 25;
    this.currentDir = Math.random() < 0.5 ? -1 : 1;
    this.currentIn = 200 + Math.random() * 250;
  }

  /** A new school forms right away. */
  startSchool() {
    this.world.schools = this.world.schools.filter((s) => s.species);
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
      if (out && !c.pose.out) world.notes.push({ kind: 'out', who: c.id });
      c.pose.out = out;
      if (!out) continue;
      if (c instanceof SimSwimmer) world.fish.push(c);
      else if (c instanceof SimStill) hideouts.push(c.hideout());
    }
    this.updateCurrent(dt);
    this.updateWeather(dt);
    this.updateHerds();
    this.updatePairs(dt);
    this.updateGroups();
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
      const spec = this.specs.get(id)!;
      const baby = this.make({ ...spec, hatchAt: undefined }, false);
      if (baby instanceof SimSwimmer || baby instanceof SimFlier) baby.placeAt(at);
      else if (baby instanceof SimWalker) baby.placeAt(at);
      this.creatures.set(id, baby);
      burst(this.world, at.x, at.y, 16);
      this.world.notes.push({ kind: 'hatch', who: id });
    }
  }

  /** Land animals and fliers whose kind lives in a herd (or flock) follow the first of them about. */
  private updateHerds() {
    const herds = new Map<string, (SimWalker | SimFlier)[]>();
    for (const c of this.creatures.values()) {
      if (!(c instanceof SimWalker || c instanceof SimFlier) || !c.pose.out) continue;
      c.leader = null;
      if (isGroup(c.drawing)) herds.set(c.drawing.id, [...(herds.get(c.drawing.id) ?? []), c]);
    }
    for (const herd of herds.values()) {
      herd.sort((a, b) => (a.id < b.id ? -1 : 1));
      const [first, ...rest] = herd;
      rest.forEach((c, i) => {
        // (A species is all walkers or all fliers, so the leader is always the same kind.)
        c.leader = first as never;
        c.rank = i;
      });
    }
  }

  /**
   * Now and then two land animals that spend time together (two of a herd, or two resting side by side)
   * might have a baby: the server decides (see askForEgg), the same way as for two fish leaving a school.
   */
  private updatePairs(dt: number) {
    this.pairIn -= dt;
    if (this.pairIn > 0) return;
    this.pairIn = 90 + Math.random() * 90;
    const animals = [...this.creatures.values()].filter((c) => (c instanceof SimWalker || c instanceof SimFlier) && c.pose.out && this.canParent(c.drawing));
    const herd = animals.find((c) => (c as SimWalker | SimFlier).leader);
    if (herd && Math.random() < 0.6) {
      this.world.notes.push({ kind: 'school-end', leader: (herd as SimWalker).leader!.id, first: herd.id });
      return;
    }
    const a = animals[Math.floor(Math.random() * animals.length)];
    const b = a && animals.filter((c) => c !== a && Math.abs(c.pose.x - a.pose.x) < 200).sort(() => Math.random() - 0.5)[0];
    if (a && b) this.world.notes.push({ kind: 'school-end', leader: a.id, first: b.id });
  }

  /** Species that live in groups swim as schools of their own kind, for good. */
  private updateGroups() {
    const world = this.world;
    const bySpecies = new Map<string, SimSwimmer[]>();
    for (const f of world.fish) {
      if (!isGroup(f.drawing) || f.puffed) continue;
      bySpecies.set(f.drawing.id, [...(bySpecies.get(f.drawing.id) ?? []), f]);
    }
    const kept: School[] = [];
    for (const [species, fish] of bySpecies) {
      if (fish.length < 3) continue;
      // Keep the same leaders from moment to moment, so the schools don't keep reshuffling.
      const old = world.schools.filter((s) => s.species === species);
      const leaders = old.map((s) => s.leader).filter((l) => fish.includes(l));
      const others = fish.filter((f) => !leaders.includes(f));
      const wanted = Math.ceil(fish.length / SCHOOL_SIZE);
      while (leaders.length < wanted) leaders.push(others.shift()!);
      while (leaders.length > wanted) others.push(leaders.pop()!);
      leaders.forEach((leader, i) => {
        const members = others.filter((_, k) => k % leaders.length === i);
        kept.push({ leader, members, until: Infinity, species });
      });
    }
    const passing = world.schools.find((s) => !s.species);
    world.schools = passing ? [...kept, passing] : kept;
  }

  /** Every couple of minutes a few fish team up and follow a leader for a while. */
  private updateSchool() {
    const world = this.world;
    const school = world.schools.find((s) => !s.species);
    if (school) {
      if (world.time > school.until || !world.fish.includes(school.leader)) {
        if (world.time > school.until && school.members[0]) {
          world.notes.push({ kind: 'school-end', leader: school.leader.id, first: school.members[0].id });
        }
        world.schools = world.schools.filter((s) => s !== school);
      } else school.members = school.members.filter((m) => world.fish.includes(m));
      return;
    }
    if (world.time < this.nextSchoolAt || world.sleepiness > 0.4) return;
    this.nextSchoolAt = world.time + 70 + Math.random() * 80;
    const grouped = new Set(world.schools.flatMap((s) => [s.leader, ...s.members]));
    // Sometimes it's two of a group species pairing off instead (they might lay an egg).
    const groups = world.schools.filter((s) => s.species && s.members.length);
    if (groups.length && Math.random() < 0.3) {
      const g = groups[Math.floor(Math.random() * groups.length)];
      world.notes.push({ kind: 'school-end', leader: g.leader.id, first: g.members[0].id });
      return;
    }
    const candidates = world.fish
      .filter((f) => f.style.schools && f.personality !== 'shy' && !grouped.has(f))
      .sort(() => Math.random() - 0.5);
    if (candidates.length < 3) return;
    const [leader, ...rest] = candidates;
    // Fish of the leader's own kind join first.
    rest.sort((a, b) => Number(b.drawing.id === leader.drawing.id) - Number(a.drawing.id === leader.drawing.id));
    const members = rest.slice(0, 2 + Math.floor(Math.random() * 4));
    world.schools.push({ leader, members, until: world.time + 25 });
    world.notes.push({ kind: 'school', leader: leader.id, members: members.map((m) => m.id) });
  }

  /** A rain or snow shower for a while (a rainbow comes out after rain), or just a rainbow. */
  startWeather(kind: 'rain' | 'snow' | 'rainbow', seconds = 120) {
    if (kind === 'rainbow') {
      this.rainbowFor = 45;
      return;
    }
    this.showerKind = kind;
    this.showerFor = seconds;
    this.rainbowFor = 0;
  }

  /** Is a shower on right now? */
  get showering() {
    return this.showerFor > 0;
  }

  private updateWeather(dt: number) {
    const wasRaining = this.showerFor > 0 && this.showerKind === 'rain';
    this.showerFor = Math.max(0, this.showerFor - dt);
    if (wasRaining && this.showerFor === 0) this.rainbowFor = 45;
    this.rainbowFor = Math.max(0, this.rainbowFor - dt);
    const ease = (now: number, want: number) => now + (want - now) * Math.min(1, dt * 0.25);
    const w = this.weather;
    w.rain = ease(w.rain, this.showerFor > 0 && this.showerKind === 'rain' ? 1 : 0);
    w.snow = ease(w.snow, this.showerFor > 0 && this.showerKind === 'snow' ? 1 : 0);
    w.rainbow = ease(w.rainbow, this.rainbowFor > 0 && w.rain < 0.3 ? 1 : 0);
    this.world.rain = w.rain;
  }

  /** Every few minutes a gentle current sweeps through for a little while. */
  private updateCurrent(dt: number) {
    this.currentIn -= dt;
    if (this.currentIn <= 0 && this.currentFor <= 0) this.startCurrent();
    this.currentFor = Math.max(0, this.currentFor - dt);
    // Swells up and dies away smoothly.
    this.world.current = this.currentDir * this.world.height * 0.03 * Math.sin((this.currentFor / 25) * Math.PI) ** 2;
  }

  /** A grown-up fish that could have a baby. */
  canParent(d: Drawing) {
    return !d.parents && ['fish', 'walker', 'hopper', 'slitherer', 'flier'].includes(motionOf(d));
  }

  /** Whether a baby (hatched at grownFrom) has grown up: a week old. */
  grownUp(id: string) {
    const spec = this.specs.get(id);
    return spec?.grownFrom !== undefined && this.creatures.get(id)?.kind !== 'egg' && growScale(spec.grownFrom) >= 0.95;
  }

  /** Who this creature is. */
  specOf(id: string) {
    return this.specs.get(id);
  }
}
