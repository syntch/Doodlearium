import type { WorldDef } from './places.ts';

/**
 * Earth: the world the family started with, built in (it can't be uninstalled). Its places keep the ids they
 * always had, so saved worlds, homes and history carry on; the Lake was the very first tank.
 */
export const EARTH: WorldDef = {
  id: 'earth',
  name: 'Earth',
  icon: '🌍',
  mapStyle: 'earth',
  regions: [
    { id: 'valley', name: 'Green Valley' },
    { id: 'coast', name: 'Sunny Coast' },
    { id: 'highlands', name: 'Misty Highlands' },
  ],
  places: [
    { id: 'lake', name: 'Sparkle Lake', biome: 'lake', region: 'valley', x: 430, y: 300 },
    { id: 'pond', name: 'Lily Pond', biome: 'pond', region: 'valley', x: 250, y: 420 },
    { id: 'ocean', name: 'Big Blue Ocean', biome: 'ocean', region: 'coast', x: 860, y: 520 },
    { id: 'seashore', name: 'Shell Beach', biome: 'seashore', region: 'coast', x: 700, y: 430 },
    { id: 'meadow', name: 'Buttercup Meadow', biome: 'meadow', region: 'valley', x: 330, y: 598 },
    { id: 'farm', name: 'Sunny Farm', biome: 'farm', region: 'valley', x: 520, y: 520 },
    { id: 'hills', name: 'Rolling Hills', biome: 'hills', region: 'highlands', x: 300, y: 150 },
    { id: 'forest', name: 'Whispering Woods', biome: 'forest', region: 'highlands', x: 140, y: 250 },
  ],
};
