import type { Biome } from './biomes.ts';

/**
 * Colour schemes for the space kinds of place, so one kind can be many places: an icy moon and a red desert
 * one, a gleaming city and a rusty mining town. A place picks one by id (see Place.look); the first is the
 * kind's usual. Colours are 0xRRGGBB.
 */
export interface Look {
  id: string;
  name: string;
  /** The sky (or space) from the top down. */
  sky: [number, number];
  /** The ground, back to front (open space: the asteroids). */
  ground: [number, number];
  /** Lights, glows and signs. */
  accent: number;
  /** A second accent for variety (signs, flowers, spores...). */
  accent2: number;
}

export const LOOKS: Partial<Record<Biome, Look[]>> = {
  space: [
    { id: 'nebula', name: 'Purple nebula', sky: [0x0b0a2a, 0x2a1250], ground: [0x5a4a6a, 0x3a2e48], accent: 0xff7ad9, accent2: 0x6fd3ff },
    { id: 'deep', name: 'Deep blue', sky: [0x02040f, 0x0a1838], ground: [0x4a4e5e, 0x2c2f3a], accent: 0x7fb6ff, accent2: 0xffffff },
    { id: 'golden', name: 'Golden clouds', sky: [0x1a0e05, 0x4a2a0a], ground: [0x6a5032, 0x47331e], accent: 0xffc65a, accent2: 0xff8a3d },
    { id: 'emerald', name: 'Green glow', sky: [0x021410, 0x0b3a2c], ground: [0x3e5a4e, 0x263b32], accent: 0x6effc0, accent2: 0xd2ff6e },
  ],
  station: [
    { id: 'neon', name: 'Neon market', sky: [0x0c0a1e, 0x1d1840], ground: [0x3a3550, 0x26223a], accent: 0xff4fa8, accent2: 0x3ff0ff },
    { id: 'mining', name: 'Rusty mining town', sky: [0x120806, 0x2e140c], ground: [0x5a3a26, 0x3a2418], accent: 0xffa23a, accent2: 0xffe07a },
    { id: 'gleaming', name: 'Gleaming city', sky: [0x6fb8ff, 0xd8ecff], ground: [0xcfd8e8, 0xa9b4c8], accent: 0xffd34a, accent2: 0x3a7bff },
    { id: 'golden', name: 'Golden palace', sky: [0x2a1a04, 0x6a4a10], ground: [0xd8b040, 0xa8842a], accent: 0xfff0a0, accent2: 0xffffff },
  ],
  moon: [
    { id: 'grey', name: 'Grey and dusty', sky: [0x03040c, 0x111a30], ground: [0x9a9aa4, 0x6e6e7a], accent: 0x7fb6ff, accent2: 0xffffff },
    { id: 'icy', name: 'Icy and snowy', sky: [0x10284a, 0x5e8cc4], ground: [0xeef6ff, 0xbcd4ee], accent: 0x9fe8ff, accent2: 0xff9fe0 },
    { id: 'desert', name: 'Red desert', sky: [0x2a0c12, 0x8a3a28], ground: [0xc4643a, 0x9a4626], accent: 0xffb35a, accent2: 0xfff0c0 },
    { id: 'teal', name: 'Teal ruins', sky: [0x062a2e, 0x2a6a6a], ground: [0x5e8a80, 0x3e6660], accent: 0x8affe8, accent2: 0xffd67a },
  ],
  garden: [
    { id: 'lush', name: 'Lush and bright', sky: [0x6ad8ff, 0xffd6f4], ground: [0x5ec46a, 0x3e9a52], accent: 0xff6ad5, accent2: 0xffe14a },
    { id: 'jungle', name: 'Deep jungle', sky: [0x1a4a3a, 0x7ac49a], ground: [0x2e7a3e, 0x1e5a2e], accent: 0xb4ff4a, accent2: 0xff8a3a },
    { id: 'golden', name: 'Golden fields', sky: [0xffb86a, 0xfff0c4], ground: [0xd8b84a, 0xb4943a], accent: 0xff6a4a, accent2: 0xffffff },
    { id: 'mossy', name: 'Mossy forest', sky: [0x3a5a4a, 0xa8c8a0], ground: [0x4e7a3a, 0x365a28], accent: 0xe8ff9a, accent2: 0x9ad8ff },
  ],
};

/** A place's colours: its chosen look, else its kind's usual (undefined for Earth's kinds, which have their own). */
export function lookOf(biome: Biome, look?: string): Look | undefined {
  const looks = LOOKS[biome];
  return looks?.find((l) => l.id === look) ?? looks?.[0];
}

export const isLookFor = (biome: Biome, look: unknown) => typeof look === 'string' && !!LOOKS[biome]?.some((l) => l.id === look);
