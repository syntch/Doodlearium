import { habitatOf, motionOf, type CreatureType, type Drawing } from '../types.ts';
import type { Placement } from '../sim/creature.ts';
import { defaultHabitats, habitatsOf, isGroup, suits, type Biome } from './biomes.ts';
import { LIVE_PLACES, placeById, regionsOf, type Place } from './places.ts';

/**
 * One creature in the world. Every drawing is a species: its named original (whose id is the drawing's
 * id) lives in one place, and the world adds more of it ("a Clowny") wherever it suits.
 */
export interface Individual {
  id: string;
  /** The drawing it's one of. */
  species: string;
  place: string;
  /** The original, with the drawing's own name. */
  named?: boolean;
  /** An egg laid by two of the same species: when it hatches, and where across the tank (0..1). */
  hatchAt?: number;
  nest?: number;
  /** Put just so by the family (plants and decorations): it stays, right there. */
  placement?: Placement;
}

/** How many of each kind a place holds. */
const TARGETS: Partial<Record<Biome, Partial<Record<CreatureType, number>>>> = {
  lake: { swimmer: 26, crawler: 6, plant: 18, decor: 5 },
  pond: { swimmer: 14, crawler: 5, plant: 16, decor: 3, walker: 2, flier: 3 },
  ocean: { swimmer: 28, crawler: 6, plant: 14, decor: 5 },
  seashore: { swimmer: 14, crawler: 8, plant: 8, decor: 4, walker: 2, flier: 4 },
  meadow: { walker: 8, flier: 6, plant: 16, decor: 4 },
  farm: { walker: 10, flier: 4, plant: 10, decor: 5 },
  hills: { walker: 8, flier: 6, plant: 12, decor: 4 },
  forest: { walker: 8, flier: 6, plant: 18, decor: 4 },
  space: { swimmer: 18, crawler: 4, plant: 8, decor: 4, flier: 6 },
  station: { walker: 10, flier: 5, plant: 6, decor: 6 },
  moon: { walker: 8, flier: 3, plant: 8, decor: 5 },
  garden: { walker: 8, flier: 6, plant: 18, decor: 3 },
};
/** Fewer than this many species to choose from, and a place borrows from other regions. */
const MIN_CHOICE = 4;
const MAX_DECOR_EACH = 2;

export const bucketOf = (d: Drawing): CreatureType => habitatOf(motionOf(d));
/** Blended babies and explorers are one of a kind: there's only ever the original. */
export const isUnique = (d: Drawing) => Boolean(d.parents) || d.explorer === true;
/** A den goes wherever the creatures that live in it are, and nowhere else. */
export const isDen = (d: Drawing) => bucketOf(d) === 'decor' && Boolean(d.den?.for.length);

/** The worlds a drawing lives in: its own choice, else its packs' (see server/packs.ts), else Earth. */
export type WorldsOf = (d: Drawing) => string[];
export const ownWorlds: WorldsOf = (d) => (d.worlds?.length ? d.worlds : ['earth']);

/**
 * Every place a species could live: the exact places its artist tapped on the map (those that suit it), or
 * else, in each of its worlds, the places of the kinds it was given (or, where there are none of those, the
 * usual kinds for its style).
 */
export function homesOf(d: Drawing, worlds: string[]): Place[] {
  const motion = motionOf(d);
  if (d.places?.length) {
    const exact = LIVE_PLACES.filter((p) => d.places!.includes(p.id) && suits(motion, p.biome));
    if (exact.length) return exact;
  }
  const kinds = habitatsOf(d);
  const usual = defaultHabitats(motion);
  return worlds.flatMap((w) => {
    const inWorld = LIVE_PLACES.filter((p) => p.world === w);
    const chosen = inWorld.filter((p) => kinds.includes(p.biome));
    return chosen.length ? chosen : inWorld.filter((p) => usual.includes(p.biome));
  });
}

/** Where an explorer can go: the places it could live in those worlds that have room for its kind. */
export function tourOf(d: Drawing, worlds: string[]): Place[] {
  const bucket = bucketOf(d);
  return homesOf(d, worlds).filter((p) => (TARGETS[p.biome]?.[bucket] ?? 0) > 0);
}

/** Where an explorer is right now (its trips are planned by the server), or undefined for everyone else. */
export type PinnedOf = (d: Drawing) => string | undefined;

const suffix = () => Math.random().toString(36).slice(2, 8);

/**
 * Brings the world's population in line with the drawings: everyone's original has a fitting place, members
 * whose species is gone (or no longer suits their place) leave, and every place is topped up to its numbers.
 * fresh drawings (just drawn) are picked more often, so they show up right away.
 */
export function populate(
  drawings: Drawing[],
  individuals: Individual[],
  fresh = new Set<string>(),
  worldsOf: WorldsOf = ownWorlds,
  pinnedOf: PinnedOf = () => undefined,
): Individual[] {
  const byId = new Map(drawings.map((d) => [d.id, d]));
  const homes = new Map(drawings.map((d) => [d.id, new Set(homesOf(d, worldsOf(d)).map((p) => p.id))]));
  // A den can be anywhere the creatures who live in it can.
  for (const d of drawings) if (isDen(d)) homes.set(d.id, new Set(d.den!.for.flatMap((r) => [...(homes.get(r) ?? [])])));
  const fits = (d: Drawing, p: Place) => homes.get(d.id)!.has(p.id);
  /** Places a species can live: in its regions, or anywhere it fits if none of those suit it. */
  const rangeOf = (d: Drawing) => {
    const regions = regionsOf(d);
    const inRange = LIVE_PLACES.filter((p) => fits(d, p) && regions.includes(p.region));
    return inRange.length ? inRange : LIVE_PLACES.filter((p) => fits(d, p));
  };
  let list = individuals.filter((i) => {
    const d = byId.get(i.species);
    const place = placeById(i.place);
    return d && place?.live && (i.named || (!isUnique(d) && (fits(d, place) || i.hatchAt)));
  });
  const ranges = new Map(drawings.map((d) => [d.id, rangeOf(d)]));
  const count = (place: string, bucket: CreatureType) =>
    list.filter((i) => i.place === place && bucketOf(byId.get(i.species)!) === bucket).length;

  // Every original has a place: its home if it has one, where it was if that still suits, or the least
  // crowded place that does.
  for (const d of drawings) {
    const had = list.find((i) => i.id === d.id);
    const home = placeById(d.home);
    const stay = had && fits(d, placeById(had.place)!) ? had.place : undefined;
    const range = ranges.get(d.id)!;
    const best = [...range].sort((a, b) => count(a.id, bucketOf(d)) - count(b.id, bucketOf(d)))[0]?.id;
    const pinned = placeById(pinnedOf(d));
    const place = pinned?.live ? pinned.id : home?.live && fits(d, home) ? home.id : (stay ?? best);
    if (!place) {
      list = list.filter((i) => i.id !== d.id);
      continue;
    }
    if (had) had.place = place;
    else list.push({ id: d.id, species: d.id, place, named: true });
  }

  // A species just drawn arrives with company: in each of its places, a few of the most common of its kind
  // move on to make room.
  const now = Date.now();
  for (const d of drawings) {
    if (!fresh.has(d.id) || isUnique(d) || isDen(d)) continue;
    const bucket = bucketOf(d);
    for (const place of ranges.get(d.id)!) {
      const target = TARGETS[place.biome]?.[bucket] ?? 0;
      const want = bucket === 'decor' ? 1 : bucket === 'plant' ? 4 : isGroup(d) ? 3 + Math.floor(Math.random() * 5) : 2;
      const have = list.filter((i) => i.place === place.id && i.species === d.id).length;
      for (let k = have; k < Math.min(want, target); k++) {
        if (count(place.id, bucket) >= target) {
          const movable = list.filter(
            (i) => i.place === place.id && !i.named && !i.placement && i.species !== d.id && !((i.hatchAt ?? 0) > now) && bucketOf(byId.get(i.species)!) === bucket,
          );
          const most = (s: string) => movable.filter((i) => i.species === s).length;
          const leaving = movable.sort((a, b) => most(b.species) - most(a.species))[0];
          if (!leaving) break;
          list = list.filter((i) => i !== leaving);
        }
        list.push({ id: `${d.id}~${suffix()}`, species: d.id, place: place.id });
      }
    }
  }

  // Then top up each place with more of the species that suit it.
  const worldCount = new Map<string, number>();
  for (const i of list) worldCount.set(i.species, (worldCount.get(i.species) ?? 0) + 1);
  for (const place of LIVE_PLACES) {
    const targets = TARGETS[place.biome];
    if (!targets) continue;
    for (const bucket of Object.keys(targets) as CreatureType[]) {
      const target = targets[bucket] ?? 0;
      const kinds = drawings.filter((d) => bucketOf(d) === bucket && !isUnique(d) && !isDen(d) && fits(d, place));
      const local = kinds.filter((d) => ranges.get(d.id)!.includes(place));
      const pool = local.length >= Math.min(MIN_CHOICE, kinds.length) ? local : kinds;
      // Any one species fills at most half of a place's swimmers (unless it's the only one; plants can carpet it).
      const maxEach = bucket === 'decor' ? MAX_DECOR_EACH : bucket === 'plant' ? target : Math.ceil(target / Math.min(2, Math.max(1, pool.length)));
      let n = count(place.id, bucket);
      const here = (d: Drawing) => list.filter((i) => i.place === place.id && i.species === d.id).length;
      while (n < target) {
        const choices = pool.filter((d) => here(d) < maxEach);
        if (!choices.length) break;
        const weight = (d: Drawing) => (fresh.has(d.id) ? 4 : 1) / (1 + (worldCount.get(d.id) ?? 0));
        let roll = Math.random() * choices.reduce((s, d) => s + weight(d), 0);
        const d = choices.find((c) => (roll -= weight(c)) <= 0) ?? choices[0];
        const group = isGroup(d) ? 3 + Math.floor(Math.random() * 5) : 1;
        const add = Math.min(group, target - n, maxEach - here(d));
        for (let k = 0; k < add; k++) list.push({ id: `${d.id}~${suffix()}`, species: d.id, place: place.id });
        worldCount.set(d.id, (worldCount.get(d.id) ?? 0) + add);
        n += add;
      }
    }
  }

  // Dens: one in every place where some of the creatures who live in it are (the original in one of them).
  for (const d of drawings) {
    if (!isDen(d)) continue;
    const wanted = new Set(list.filter((i) => d.den!.for.includes(i.species) && !((i.hatchAt ?? 0) > now)).map((i) => i.place));
    const original = list.find((i) => i.id === d.id);
    if (original && !original.placement && !wanted.has(original.place)) {
      const free = [...wanted].find((p) => !list.some((i) => i.species === d.id && i.place === p));
      if (free) original.place = free;
    }
    list = list.filter((i) => i.species !== d.id || i.named || i.placement || wanted.has(i.place));
    for (const p of wanted) if (!list.some((i) => i.species === d.id && i.place === p)) list.push({ id: `${d.id}~${suffix()}`, species: d.id, place: p });
  }
  return list;
}

/** Now and then one of a place's members moves on (populate then brings someone else). Eggs stay put. */
export function turnover(individuals: Individual[], place: string): Individual[] {
  const now = Date.now();
  const movers = individuals.filter((i) => i.place === place && !i.named && !i.placement && !((i.hatchAt ?? 0) > now));
  const leaving = movers[Math.floor(Math.random() * movers.length)];
  return leaving ? individuals.filter((i) => i !== leaving) : individuals;
}
