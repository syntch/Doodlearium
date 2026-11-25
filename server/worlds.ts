// Worlds: Earth (built in) and the ones made here or installed from a .doodleworld file. Each is a map of
// places, like Earth's, that every screen can travel to; who lives in them comes from the drawings (each
// drawing, or its pack, says which worlds; see shared/world/population.ts). Like drawing packs, a world keeps
// its id wherever it goes, so installing a newer version updates it: its places keep their ids, new ones
// open and ones taken out close (their creatures move to places that suit them).
import { createHash, randomUUID } from 'node:crypto';
import { readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { WorldFile, WorldPack } from '../shared/types.ts';
import { BIOMES, type Biome } from '../shared/world/biomes.ts';
import { EARTH } from '../shared/world/earth.ts';
import { isLookFor } from '../shared/world/looks.ts';
import { MAP_H, MAP_STYLES, MAP_W, setWorlds, type MapStyle, type Place, type Region, type WorldDef } from '../shared/world/places.ts';
import { record } from './history.ts';
import { DATA_DIR } from './store.ts';
import { cleanText } from './text.ts';
import { worldsChanged } from './world.ts';
import { broadcast } from './ws.ts';

const WORLDS_FILE = join(DATA_DIR, 'worlds.json');
export const MAX_PLACES = 16;
const MAX_REGIONS = 6;

let worlds: WorldPack[] = [];
let writing = Promise.resolve();

const offIds = () => worlds.filter((w) => w.off).map((w) => w.id);
/** The worlds that are on. */
const defs = (): WorldDef[] => worlds.filter((w) => !w.off).map(({ id, name, icon, mapStyle, regions, places }) => ({ id, name, icon, mapStyle, regions, places }));

export async function loadWorlds() {
  try {
    worlds = JSON.parse(await readFile(WORLDS_FILE, 'utf8'));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    worlds = [];
  }
  setWorlds(defs(), offIds());
}

/** Saves, opens and closes places to match, and tells every screen. */
function save() {
  setWorlds(defs(), offIds());
  worldsChanged();
  writing = writing.then(async () => {
    await writeFile(`${WORLDS_FILE}.tmp`, JSON.stringify(worlds, null, 2));
    await rename(`${WORLDS_FILE}.tmp`, WORLDS_FILE);
  });
  broadcast({ type: 'worlds', worlds: defs() });
  return writing;
}

const EARTH_PACK: WorldPack = { ...EARTH, version: '1', installed: false, builtin: true, createdAt: 0, updatedAt: 0 };

const signature = (w: WorldDef) =>
  createHash('sha256').update(JSON.stringify([w.name, w.icon, w.mapStyle, w.regions, w.places])).digest('hex').slice(0, 16);

/** Every world: Earth first. */
export const listWorlds = (): WorldPack[] => [
  EARTH_PACK,
  ...worlds.map((w) => ({ ...w, changed: !w.exported || w.exported.signature !== signature(w) })),
];

/** The worlds there are now, by id (for checking a drawing's or a pack's). */
export const worldIds = () => new Set(listWorlds().map((w) => w.id));

/** Pack ids, world ids and place ids: a UUID, or something like one. */
const isKey = (v: unknown, max = 64): v is string => typeof v === 'string' && v.length <= max && /^[\w.-]+$/.test(v);
const shortId = () => randomUUID().slice(0, 8);

/**
 * Checks a world sent from the maker page or in a file: an error, or its cleaned-up details. `id` is the
 * world's (its places' ids start with it); places sent without an id (new ones) get one.
 */
export function parseWorld(body: any, id: string): { error: string } | { world: WorldDef } {
  const mapStyle = body?.mapStyle as MapStyle;
  if (!MAP_STYLES.includes(mapStyle) || mapStyle === 'earth') return { error: 'mapStyle must be islands or space' };
  const raw = body?.places;
  if (!Array.isArray(raw) || !raw.length || raw.length > MAX_PLACES) return { error: `a world has between 1 and ${MAX_PLACES} places` };

  const regionsIn = Array.isArray(body.regions) ? body.regions.slice(0, MAX_REGIONS) : [];
  const regions: Region[] = regionsIn
    .filter((r: any) => isKey(r?.id) && r.id.startsWith(`${id}.`))
    .map((r: any) => ({ id: r.id, name: cleanText(r.name, 'Somewhere', 40) }));
  if (!regions.length) regions.push({ id: `${id}.all`, name: cleanText(body.name, 'Everywhere', 40) });

  const places: Place[] = [];
  const ids = new Set<string>();
  for (const p of raw) {
    const biome = p?.biome as Biome;
    if (!BIOMES.includes(biome)) return { error: `a place's kind must be one of ${BIOMES.join(', ')}` };
    const inside = (n: unknown, max: number) => typeof n === 'number' && Number.isFinite(n) && n >= 30 && n <= max - 30;
    if (!inside(p.x, MAP_W) || !inside(p.y, MAP_H)) return { error: 'every place must be on the map' };
    const placeId = isKey(p.id) && p.id.startsWith(`${id}.`) && !ids.has(p.id) ? p.id : `${id}.${shortId()}`;
    ids.add(placeId);
    places.push({
      id: placeId,
      name: cleanText(p.name, 'Somewhere', 30),
      biome,
      region: regions.some((r) => r.id === p.region) ? p.region : regions[0].id,
      x: Math.round(p.x),
      y: Math.round(p.y),
      ...(isLookFor(biome, p.look) && { look: p.look }),
    });
  }
  const icon = [...cleanText(body.icon, mapStyle === 'space' ? '🌌' : '🏝️', 8)].slice(0, 2).join('');
  return { world: { id, name: cleanText(body.name, 'A new world', 40), icon, mapStyle, regions, places } };
}

export async function makeWorld(def: WorldDef) {
  const now = Date.now();
  const world: WorldPack = { ...def, version: '1', installed: false, createdAt: now, updatedAt: now };
  worlds.push(world);
  await save();
  record('world', [], `🌍 A new world was made: ${world.name}.`);
  return world;
}

/** A fresh id for a world being made (its places' ids start with it). */
export const newWorldId = () => randomUUID();

export async function changeWorld(id: string, def: WorldDef, version?: string) {
  const world = worlds.find((w) => w.id === id);
  if (!world) return null;
  Object.assign(world, def, version ? { version } : {}, { updatedAt: Date.now() });
  await save();
  return world;
}

/** The next version: the last number in it goes up one (1 → 2, 1.4 → 1.5). */
const nextVersion = (v: string) => (/\d+(?!.*\d)/.test(v) ? v.replace(/\d+(?!.*\d)/, (n) => String(Number(n) + 1)) : `${v}.2`);

/** The world as a file to share. If it's changed since it was last exported, its version goes up first. */
export async function exportWorld(id: string): Promise<WorldFile | null> {
  if (id === EARTH.id) {
    return { format: 'doodlearium-world', formatVersion: 1, ...EARTH, version: '1', exportedAt: Date.now() };
  }
  const world = worlds.find((w) => w.id === id);
  if (!world) return null;
  const sig = signature(world);
  if (world.exported && world.exported.signature !== sig && world.version === world.exported.version) world.version = nextVersion(world.version);
  world.exported = { version: world.version, at: Date.now(), signature: sig };
  await save();
  const { id: wid, name, icon, mapStyle, regions, places, version } = world;
  return { format: 'doodlearium-world', formatVersion: 1, id: wid, name, icon, mapStyle, regions, places, version, exportedAt: Date.now() };
}

/** Installs a world, or updates it to the version in the file. */
export async function installWorld(def: WorldDef, version: string) {
  const had = worlds.find((w) => w.id === def.id);
  const now = Date.now();
  const before = new Set(had?.places.map((p) => p.id) ?? []);
  const world: WorldPack = had ?? { ...def, version, installed: true, createdAt: now, updatedAt: now };
  Object.assign(world, def, { version, updatedAt: now });
  if (!had) worlds.push(world);
  world.exported = { version, at: now, signature: signature(world) };
  await save();
  const opened = world.places.filter((p) => !before.has(p.id)).length;
  const closed = [...before].filter((id) => !world.places.some((p) => p.id === id)).length;
  const what = [opened && `${opened} new place${opened === 1 ? '' : 's'}`, closed && `${closed} closed`].filter(Boolean).join(', ');
  record(
    'world',
    [],
    had
      ? `🌍 ${world.name} was updated to version ${version}${what ? `: ${what}` : ''}.`
      : `🌍 A new world arrived: ${world.name} (version ${version}), with ${world.places.length} places to visit.`,
  );
  return { world, opened, closed, updated: Boolean(had) };
}

/** Switches a world off (its places close, and creatures that only live there are away) or back on. */
export async function switchWorld(id: string, off: boolean) {
  const world = worlds.find((w) => w.id === id);
  if (!world) return null;
  if (Boolean(world.off) === off) return world;
  if (off) world.off = true;
  else delete world.off;
  world.updatedAt = Date.now();
  await save();
  record('world', [], off ? `💤 ${world.name} was switched off for now.` : `🌍 ${world.name} was switched back on.`);
  return world;
}

/** Removes a world (its creatures move to places that suit them elsewhere). Earth always stays. */
export async function forgetWorld(id: string) {
  const world = worlds.find((w) => w.id === id);
  if (!world) return false;
  worlds = worlds.filter((w) => w !== world);
  await save();
  record('world', [], `🌍 ${world.name} was ${world.installed ? 'uninstalled' : 'taken apart'}.`);
  return true;
}

export const isWorldInstalled = (id: string) => worlds.find((w) => w.id === id)?.installed === true;
export { isKey as isWorldKey };
