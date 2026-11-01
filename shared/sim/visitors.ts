import type { Season } from './math.ts';

/**
 * Rare visitors: a whale passing far behind the glass, a diver swimming by... The server decides when one
 * comes; every screen draws it (client/tank/events.ts) from the same start time and seed.
 *
 * They come in packs, so themed sets can be swapped in and out (say, a space pack when someone's into
 * space). The ocean pack always plays; others join with the season.
 */
export interface VisitorInfo {
  name: string;
  icon: string;
  /** For the history and the "coming up" list: "A whale passed by". */
  text: string;
  /** How often it's picked compared with others in play (1 = normal). */
  weight: number;
  seconds: number;
}

export const VISITOR_PACKS: Record<string, VisitorInfo[]> = {
  ocean: [
    { name: 'whale', icon: '🐋', text: 'a whale', weight: 1, seconds: 45 },
    { name: 'diver', icon: '🤿', text: 'a diver', weight: 1, seconds: 30 },
  ],
  spooky: [{ name: 'ghost', icon: '👻', text: 'a friendly ghost', weight: 1.5, seconds: 22 }],
};

export const ALL_VISITORS = Object.values(VISITOR_PACKS).flat();

export const visitorPacks = (season: Season) => ['ocean', ...(season.halloween ? ['spooky'] : [])];

/** A random visitor from the packs in play, or a named one. */
export function pickVisitor(season: Season, name?: string) {
  const pool = name ? ALL_VISITORS.filter((v) => v.name === name) : visitorPacks(season).flatMap((p) => VISITOR_PACKS[p] ?? []);
  const total = pool.reduce((s, v) => s + v.weight, 0);
  let roll = Math.random() * total;
  return pool.find((v) => (roll -= v.weight) <= 0) ?? pool[0];
}

/** How long documentary mode follows one creature. */
export const FILM_SECONDS = 28;
