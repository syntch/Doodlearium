import type { Drawing } from '../types.ts';
import { seededRandom } from '../sim/math.ts';
import type { Biome } from './biomes.ts';

/** A part of the world with its own feel; each species lives in one or two of them. */
export interface Region {
  id: string;
  name: string;
}

export const REGIONS: Region[] = [
  { id: 'valley', name: 'Green Valley' },
  { id: 'coast', name: 'Sunny Coast' },
  { id: 'highlands', name: 'Misty Highlands' },
];

/** A place on the map you can zoom into. Places that aren't live yet show "coming soon". */
export interface Place {
  id: string;
  name: string;
  biome: Biome;
  region: string;
  /** Where its icon sits on the map (MAP_W × MAP_H). */
  x: number;
  y: number;
  live: boolean;
}

export const MAP_W = 1000;
export const MAP_H = 700;

/** The world. The Lake is the tank the family had from the start (its id must stay 'lake'). */
export const PLACES: Place[] = [
  { id: 'lake', name: 'Sparkle Lake', biome: 'lake', region: 'valley', x: 430, y: 300, live: true },
  { id: 'pond', name: 'Lily Pond', biome: 'pond', region: 'valley', x: 250, y: 420, live: true },
  { id: 'ocean', name: 'Big Blue Ocean', biome: 'ocean', region: 'coast', x: 860, y: 520, live: true },
  { id: 'seashore', name: 'Shell Beach', biome: 'seashore', region: 'coast', x: 700, y: 430, live: true },
  { id: 'meadow', name: 'Buttercup Meadow', biome: 'meadow', region: 'valley', x: 330, y: 560, live: false },
  { id: 'farm', name: 'Sunny Farm', biome: 'farm', region: 'valley', x: 520, y: 520, live: false },
  { id: 'hills', name: 'Rolling Hills', biome: 'hills', region: 'highlands', x: 300, y: 150, live: false },
  { id: 'forest', name: 'Whispering Woods', biome: 'forest', region: 'highlands', x: 140, y: 250, live: false },
];

export const LIVE_PLACES = PLACES.filter((p) => p.live);
export const placeById = (id: string | undefined) => PLACES.find((p) => p.id === id);
export const placeName = (id: string | undefined) => placeById(id)?.name ?? 'the tank';

/**
 * The regions a species lives in: one or two, picked from its id so they never change, plus the region of
 * the home its artist picked.
 */
export function regionsOf(d: Drawing): string[] {
  const rand = seededRandom(`${d.id}:regions`);
  const first = Math.floor(rand() * REGIONS.length);
  const ids = new Set([REGIONS[first].id]);
  if (rand() < 0.5) ids.add(REGIONS[(first + 1 + Math.floor(rand() * (REGIONS.length - 1))) % REGIONS.length].id);
  const home = placeById(d.home);
  if (home) ids.add(home.region);
  return [...ids];
}
