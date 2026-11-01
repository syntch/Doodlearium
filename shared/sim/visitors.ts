import type { Biome } from '../world/biomes.ts';
import type { Season } from './math.ts';

/**
 * Rare visitors: a whale passing far behind the glass, a diver swimming by... The server decides when one
 * comes; every screen draws it (client/tank/events.ts) from the same start time and seed.
 *
 * They come in packs, so themed sets can be swapped in and out (say, a space pack when someone's into
 * space). The water pack always plays; others join with the season. Each visitor comes to the places it
 * suits (no biomes: anywhere).
 */
export interface VisitorInfo {
  name: string;
  icon: string;
  /** For the history and the "coming up" list: "A whale passed by". */
  text: string;
  /** How often it's picked compared with others in play (1 = normal). */
  weight: number;
  seconds: number;
  biomes?: Biome[];
}

export const VISITOR_PACKS: Record<string, VisitorInfo[]> = {
  water: [
    { name: 'whale', icon: '🐋', text: 'a whale', weight: 1, seconds: 45, biomes: ['ocean'] },
    { name: 'diver', icon: '🤿', text: 'a diver', weight: 1, seconds: 30, biomes: ['lake', 'ocean'] },
    { name: 'heron', icon: '🪶', text: 'a heron', weight: 1, seconds: 30, biomes: ['pond'] },
    { name: 'ducks', icon: '🦆', text: 'some ducks', weight: 1, seconds: 36, biomes: ['pond', 'lake'] },
    { name: 'gulls', icon: '🐦', text: 'some seagulls', weight: 1, seconds: 26, biomes: ['seashore'] },
  ],
  spooky: [{ name: 'ghost', icon: '👻', text: 'a friendly ghost', weight: 1.5, seconds: 22 }],
};

export const ALL_VISITORS = Object.values(VISITOR_PACKS).flat();

export const visitorPacks = (season: Season) => ['water', ...(season.halloween ? ['spooky'] : [])];

/** A random visitor from the packs in play that suits the biome, or a named one. */
export function pickVisitor(season: Season, name?: string, biome?: Biome): VisitorInfo | undefined {
  const pool = name
    ? ALL_VISITORS.filter((v) => v.name === name)
    : visitorPacks(season)
        .flatMap((p) => VISITOR_PACKS[p] ?? [])
        .filter((v) => !biome || !v.biomes || v.biomes.includes(biome));
  const total = pool.reduce((s, v) => s + v.weight, 0);
  let roll = Math.random() * total;
  return pool.find((v) => (roll -= v.weight) <= 0) ?? pool[0];
}

/** How long documentary mode follows one creature. */
export const FILM_SECONDS = 28;
