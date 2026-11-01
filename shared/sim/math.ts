import type { Drawing } from '../types.ts';

export const TAU = Math.PI * 2;
export const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** Deterministic random numbers per drawing, so plants and decor keep their spot across reloads. */
export function seededRandom(seed: string) {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  let a = h >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return (min = 0, max = 1) => min + next() * (max - min);
}

/**
 * Depth z runs 0 (front glass) to 1 (back wall). Far things are smaller (and, on screen, washed toward the
 * water colour).
 */
export const depthScale = (z: number) => 1 - 0.45 * z;

/** Babies hatch a bit over half size and grow up over their first week. */
export function growScale(hatched: number | undefined, now = Date.now()) {
  if (hatched === undefined) return 1;
  const days = (now - hatched) / 86_400_000;
  return 0.6 + 0.35 * Math.min(1, Math.max(0, days) / 7);
}

/** How grown a blended baby is (drawn babies' originals). */
export const babyScale = (drawing: Drawing, now = Date.now()) =>
  growScale(drawing.parents ? (drawing.hatchAt ?? drawing.createdAt) : undefined, now);

/** 0 during the day, up to 0.5 at night, easing through dawn (5–8h) and dusk (18–21h). */
export function nightDarkness(hour: number) {
  const max = 0.5;
  if (hour >= 8 && hour < 18) return 0;
  if (hour >= 21 || hour < 5) return max;
  if (hour < 8) return max * (1 - (hour - 5) / 3);
  return (max * (hour - 18)) / 3;
}

/** Which seasonal touches are on, by the date. */
export function seasonOf(date = new Date()) {
  const month = date.getMonth() + 1;
  const day = date.getDate();
  return {
    snow: month === 12 || month <= 2,
    halloween: (month === 10 && day >= 15) || (month === 11 && day === 1),
    lights: month === 12 || (month === 1 && day <= 6),
    valentine: month === 2 && day >= 7 && day <= 14,
  };
}
export type Season = ReturnType<typeof seasonOf>;

const NO_SEASON: Season = { snow: false, halloween: false, lights: false, valentine: false };
/** Holidays the ⚙️ menu can switch to by name. */
export const SEASONS: Record<string, Season> = {
  none: NO_SEASON,
  halloween: { ...NO_SEASON, halloween: true },
  christmas: { ...NO_SEASON, snow: true, lights: true },
  snow: { ...NO_SEASON, snow: true },
  valentine: { ...NO_SEASON, valentine: true },
};
