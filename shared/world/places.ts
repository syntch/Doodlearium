import type { Drawing } from '../types.ts';
import { seededRandom } from '../sim/math.ts';
import type { Biome } from './biomes.ts';
import { EARTH } from './earth.ts';

/** A part of a world with its own feel; each species lives in one or two of each world's regions. */
export interface Region {
  id: string;
  name: string;
}

/** How a world's map is drawn: Earth's own, islands in a sea, or planets among the stars. */
export const MAP_STYLES = ['earth', 'islands', 'space'] as const;
export type MapStyle = (typeof MAP_STYLES)[number];

/** A place on a world's map you can zoom into. */
export interface Place {
  id: string;
  name: string;
  /** What kind of place it is: how it looks and who suits it. */
  biome: Biome;
  region: string;
  /** Where its porthole sits on the map (MAP_W × MAP_H). */
  x: number;
  y: number;
  /** A colour scheme for its kind (see LOOKS in shared/world/looks.ts; unset: the kind's usual). */
  look?: string;
}

/** A world as it's defined: its map and its places. */
export interface WorldDef {
  id: string;
  name: string;
  /** An emoji for it in the worlds strip. */
  icon: string;
  mapStyle: MapStyle;
  regions: Region[];
  places: Place[];
}

/** A place in the world it belongs to (every place on the server, in every world, is one of these). */
export interface LivePlace extends Place {
  world: string;
  live: true;
}

export const MAP_W = 1000;
export const MAP_H = 700;

let worlds: WorldDef[] = [EARTH];
/** Worlds that are here but switched off: none of their places are open. */
let switchedOff = new Set<string>();
/** Every place in every world. (These change as worlds are installed: always read them, never keep a copy.) */
export let PLACES: LivePlace[] = [];
export let LIVE_PLACES: LivePlace[] = [];
export let REGIONS: Region[] = [];

/** The worlds there are: Earth first, then the ones installed or made here (off: the ids of those switched off). */
export function setWorlds(list: WorldDef[], off: string[] = []) {
  switchedOff = new Set(off);
  worlds = [EARTH, ...list.filter((w) => w.id !== EARTH.id && !switchedOff.has(w.id))];
  PLACES = worlds.flatMap((w) => w.places.map((p) => ({ ...p, world: w.id, live: true as const })));
  LIVE_PLACES = PLACES;
  REGIONS = worlds.flatMap((w) => w.regions);
}
setWorlds([]);

export const allWorlds = () => worlds;
/** A world that's here, but switched off. */
export const isWorldOff = (id: string) => switchedOff.has(id);
export const worldById = (id: string | undefined) => worlds.find((w) => w.id === id);
export const placeById = (id: string | undefined) => PLACES.find((p) => p.id === id);
export const placeName = (id: string | undefined) => placeById(id)?.name ?? 'the tank';
/** The world a place is in (Earth for one that's gone). */
export const worldOf = (place: string | undefined) => worldById(placeById(place)?.world) ?? EARTH;
export const placesIn = (world: string) => PLACES.filter((p) => p.world === world);

/**
 * The regions a species lives in, in each world: one or two of the world's own, picked from its id so they
 * never change, plus the region of the home its artist picked. (Earth's are picked just as they always were.)
 */
export function regionsOf(d: Drawing): string[] {
  const ids = new Set<string>();
  for (const w of worlds) {
    if (!w.regions.length) continue;
    const rand = seededRandom(w.id === EARTH.id ? `${d.id}:regions` : `${d.id}:regions:${w.id}`);
    const first = Math.floor(rand() * w.regions.length);
    ids.add(w.regions[first].id);
    if (w.regions.length > 1 && rand() < 0.5) ids.add(w.regions[(first + 1 + Math.floor(rand() * (w.regions.length - 1))) % w.regions.length].id);
  }
  const home = placeById(d.home);
  if (home) ids.add(home.region);
  return [...ids];
}
