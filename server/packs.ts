// Drawing packs: named groups of drawings, put together in the gallery, exported to a .doodlepack file and
// installed in another Doodlearium. Each drawing in a pack carries a key (its id where it was first drawn,
// kept as `origin` wherever it's installed), so installing a newer version of the pack updates the drawings
// it already brought rather than adding them again, and ones taken out of the pack go.
import { createHash, randomUUID } from 'node:crypto';
import { readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Drawing, Pack, PackFile, PackFileDrawing, PackInstall } from '../shared/types.ts';
import { historyBetween, record } from './history.ts';
import { DATA_DIR, DRAWINGS_DIR, addDrawing, listDrawings, markPacked, removeDrawing, setDenFor, setParents, updateDrawing, type ExtraImages } from './store.ts';
import { drawingAdded, drawingRemoved, drawingUpdated } from './world.ts';
import { allWorlds, isWorldOff, worldById } from '../shared/world/places.ts';
import { broadcast } from './ws.ts';

const PACKS_FILE = join(DATA_DIR, 'packs.json');
export const MAX_PACK_DRAWINGS = 200;

let packs: Pack[] = [];
let writing = Promise.resolve();

export async function loadPacks() {
  try {
    packs = JSON.parse(await readFile(PACKS_FILE, 'utf8'));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    packs = [];
  }
  await rememberWhenPacked();
}

/**
 * Drawings installed before packs remembered when (packedAt): the history's line for the last install or
 * update of a pack with them in it says when it finished, so an edit after that was the family's own.
 * (Needs the drawings and the history loaded first.)
 */
async function rememberWhenPacked() {
  const missing = listDrawings().filter((d) => d.origin && d.packedAt === undefined);
  if (!missing.length) return;
  const lines = historyBetween().filter((e) => e.type === 'pack' && /was installed|was updated to/.test(e.text));
  for (const d of missing) {
    const last = lines.findLast((e) => e.who.includes(d.id));
    await markPacked(d.id, last?.at);
  }
}

/** Saves (write-then-rename, like the drawings) and tells every gallery. */
function save() {
  writing = writing.then(async () => {
    await writeFile(`${PACKS_FILE}.tmp`, JSON.stringify(packs, null, 2));
    await rename(`${PACKS_FILE}.tmp`, PACKS_FILE);
  });
  broadcast({ type: 'packs' });
  return writing;
}

/** The same drawing wherever it's been installed. */
const keyOf = (d: Drawing) => d.origin ?? d.id;

/** Drops drawings that have since been removed. */
function tidy(pack: Pack) {
  const ids = new Set(listDrawings().map((d) => d.id));
  pack.drawings = pack.drawings.filter((id) => ids.has(id));
  return pack;
}

/** The packs, each saying whether it's changed since it was last exported (and, if installed, which drawings were edited here). */
export const listPacks = () =>
  packs.map((p) => ({ ...tidy(p), changed: !p.exported || p.exported.signature !== signature(p), ...(p.installed && { edited: editedIn(p) }) }));

/**
 * An installed pack's drawings that were edited here since the pack put them here, which an update would
 * replace (see rememberWhenPacked for ones installed before packs remembered).
 */
function editedIn(pack: Pack) {
  const all = new Map(listDrawings().map((d) => [d.id, d]));
  return pack.drawings.filter((id) => {
    const d = all.get(id);
    if (!d?.origin || d.updatedAt === undefined) return false;
    return d.updatedAt > (d.packedAt ?? d.updatedAt);
  });
}

/**
 * The worlds a drawing lives in: the ones it was given itself, else its packs' (all of them, for a drawing in
 * more than one), else Earth. Worlds that aren't here (yet) don't count.
 */
export function worldsOfDrawing(d: Drawing): string[] {
  const chosen = chosenWorldsOf(d);
  return chosen.length ? chosen : ['earth'];
}

/**
 * Whether a drawing is in the world: it isn't switched off, it isn't only in packs that are all switched
 * off, and its worlds aren't all switched off.
 */
export function isPresent(d: Drawing): boolean {
  if (d.off) return false;
  const inPacks = packs.filter((p) => p.drawings.includes(d.id));
  if (inPacks.length && inPacks.every((p) => p.off)) return false;
  const wanted = d.worlds?.length ? d.worlds : [...new Set(inPacks.filter((p) => !p.off).flatMap((p) => p.worlds ?? []))];
  const known = wanted.filter((w) => worldById(w) || isWorldOff(w));
  return !(known.length && known.every(isWorldOff));
}

/** The worlds picked for a drawing (by itself, else by its packs), or none. */
export function chosenWorldsOf(d: Drawing): string[] {
  const here = new Set(allWorlds().map((w) => w.id));
  const own = (d.worlds ?? []).filter((w) => here.has(w));
  if (own.length) return own;
  return [...new Set(packs.filter((p) => p.drawings.includes(d.id)).flatMap((p) => p.worlds ?? []))].filter((w) => here.has(w));
}

/** The next version: the last number in it goes up one (1 → 2, 1.4 → 1.5); without one, ".2" goes on the end. */
export function nextVersion(version: string) {
  return /\d+(?!.*\d)/.test(version) ? version.replace(/\d+(?!.*\d)/, (n) => String(Number(n) + 1)) : `${version}.2`;
}

/** What's in a pack right now (which drawings, and which edit of each), to tell whether it's changed. */
function signature(pack: Pack) {
  const all = new Map(listDrawings().map((d) => [d.id, d]));
  const items = pack.drawings
    .map((id) => all.get(id))
    .filter((d) => d !== undefined)
    .map((d) => `${keyOf(d)}@${d.updatedAt ?? d.createdAt}`)
    .sort();
  return createHash('sha256').update(JSON.stringify([pack.name, items, pack.worlds ?? []])).digest('hex').slice(0, 16);
}

export async function makePack(name: string, drawings: string[]) {
  const now = Date.now();
  const pack: Pack = { id: randomUUID(), name, version: '1', drawings, installed: false, createdAt: now, updatedAt: now };
  packs.push(pack);
  await save();
  return pack;
}

export async function changePack(id: string, change: { name?: string; version?: string; drawings?: string[]; worlds?: string[]; off?: boolean }) {
  const pack = packs.find((p) => p.id === id);
  if (!pack) return null;
  const switched = change.off !== undefined && change.off !== Boolean(pack.off);
  const { off, ...rest } = change;
  Object.assign(pack, rest, { updatedAt: Date.now() });
  if (off) pack.off = true;
  else if (off === false) delete pack.off;
  await save();
  if (switched) record('pack', [], off ? `💤 The ${pack.name} pack was switched off for now.` : `📦 The ${pack.name} pack was switched back on.`);
  // Its drawings may live somewhere else now (or be away, or back).
  if (change.worlds || change.drawings || switched) drawingRemoved();
  return tidy(pack);
}

/**
 * Forgets a pack. Uninstalling one that was installed also removes the drawings it brought (but not ones
 * drawn here, or that another pack has too). Returns how many drawings went, or null if there's no such pack.
 */
export async function forgetPack(id: string) {
  const pack = packs.find((p) => p.id === id);
  if (!pack) return null;
  packs = packs.filter((p) => p !== pack);
  const removed = pack.installed ? await removeBrought(pack.drawings) : 0;
  await save();
  if (pack.worlds?.length && !removed) drawingRemoved();
  record('pack', [], `📦 The ${pack.name} pack was ${pack.installed ? 'uninstalled' : 'taken apart'}.`);
  return removed;
}

/** Removes drawings that came in packs, if no other pack has them. */
async function removeBrought(ids: string[]) {
  const kept = new Set(packs.flatMap((p) => p.drawings));
  let removed = 0;
  for (const id of ids) {
    const drawing = listDrawings().find((d) => d.id === id);
    if (!drawing?.origin || kept.has(id)) continue;
    await removeDrawing(id);
    broadcast({ type: 'drawing:removed', id });
    removed++;
  }
  if (removed) drawingRemoved();
  return removed;
}

const dataUrl = async (file: string) => {
  try {
    return `data:image/png;base64,${(await readFile(join(DRAWINGS_DIR, file))).toString('base64')}`;
  } catch {
    return undefined;
  }
};

/** The pack as a file to share. If it's changed since it was last exported, its version goes up first. */
export async function exportPack(id: string): Promise<PackFile | null> {
  const pack = packs.find((p) => p.id === id);
  if (!pack) return null;
  tidy(pack);
  const sig = signature(pack);
  // (A version set by hand since the last export stays as it is.)
  if (pack.exported && pack.exported.signature !== sig && pack.version === pack.exported.version) pack.version = nextVersion(pack.version);
  pack.exported = { version: pack.version, at: Date.now(), signature: sig };
  await save();

  const all = listDrawings();
  const inPack = pack.drawings.map((id) => all.find((d) => d.id === id)!);
  const keys = new Map(inPack.map((d) => [d.id, keyOf(d)]));
  const drawings: PackFileDrawing[] = [];
  for (const d of inPack) {
    const image = await dataUrl(`${d.id}.png`);
    if (!image) continue;
    const parents = d.parents?.map((p) => keys.get(p));
    drawings.push({
      key: keyOf(d),
      motion: d.motion ?? 'fish',
      name: d.name,
      artist: d.artist,
      image,
      attachments: d.attachments,
      nocturnal: d.nocturnal,
      explorer: d.explorer,
      parts: d.parts,
      partsImage: d.parts?.length ? await dataUrl(`${d.id}.parts.png`) : undefined,
      glowImage: d.glow ? await dataUrl(`${d.id}.glow.png`) : undefined,
      behindImage: d.parts?.some((p) => p.behind) ? await dataUrl(`${d.id}.behind.png`) : undefined,
      habitats: d.habitats,
      group: d.group,
      home: d.home,
      size: d.size,
      traits: d.traits,
      worlds: d.worlds,
      places: d.places,
      parents: parents?.[0] && parents[1] ? [parents[0], parents[1]] : undefined,
      // Who lives in a den, by their keys (they might be in another pack, or drawn there too).
      den: d.den && { ...d.den, for: d.den.for.map((id) => keyOf(all.find((x) => x.id === id) ?? ({ id } as Drawing))) },
    });
  }
  return { format: 'doodlearium-pack', formatVersion: 1, id: pack.id, name: pack.name, version: pack.version, exportedAt: Date.now(), worlds: pack.worlds, drawings };
}

/** One drawing from a pack file, checked and ready to save (see parseDrawing in routes.ts). */
export interface PackItem {
  key: string;
  meta: Parameters<typeof addDrawing>[0];
  png: Buffer;
  extra: ExtraImages;
  parents?: [string, string];
}

/**
 * Installs a pack, or updates it to the version in the file: drawings it brought before are updated in
 * place (the creatures carry on where they are), new ones move in, and ones taken out of it go.
 */
export async function installPack(file: { id: string; name: string; version: string; worlds?: string[] }, items: PackItem[]): Promise<PackInstall> {
  const had = packs.find((p) => p.id === file.id);
  const before = had ? [...had.drawings] : [];
  const now = Date.now();
  // The pack goes in first, with its worlds, so each drawing moves straight into the right world as it arrives.
  const pack: Pack = had ?? { id: file.id, name: file.name, version: file.version, drawings: [], installed: true, createdAt: now, updatedAt: now };
  pack.worlds = file.worlds;
  if (!had) packs.push(pack);
  const join = (id: string) => void (pack.drawings.includes(id) || pack.drawings.push(id));
  const byKey = new Map(listDrawings().map((d) => [keyOf(d), d]));
  const ids = new Map<string, string>();
  let added = 0;
  let updated = 0;
  for (const item of items) {
    const old = byKey.get(item.key);
    if (old) {
      join(old.id);
      const drawing = (await updateDrawing(old.id, item.meta, item.png, item.extra))!;
      if (drawing.origin) await markPacked(drawing.id);
      broadcast({ type: 'drawing:updated', drawing });
      drawingUpdated(drawing);
      ids.set(item.key, drawing.id);
      updated++;
    } else {
      const drawing = await addDrawing({ ...item.meta, origin: item.key }, item.png, item.extra);
      await markPacked(drawing.id);
      join(drawing.id);
      broadcast({ type: 'drawing:added', drawing });
      drawingAdded(drawing);
      ids.set(item.key, drawing.id);
      added++;
    }
  }
  // Babies and dens point at other drawings: in this pack, or already here (from another pack, say).
  const everyone = new Map(listDrawings().map((d) => [keyOf(d), d.id]));
  for (const item of items) {
    const parents = item.parents?.map((k) => ids.get(k));
    if (parents?.[0] && parents[1]) await setParents(ids.get(item.key)!, [parents[0], parents[1]]);
    if (item.meta.den) await setDenFor(ids.get(item.key)!, item.meta.den.for.map((k: string) => ids.get(k) ?? everyone.get(k) ?? k));
  }

  const drawings = [...new Set(ids.values())];
  const left = before.filter((id) => !drawings.includes(id));
  Object.assign(pack, { name: file.name, version: file.version, drawings, updatedAt: now });
  const removed = await removeBrought(left);
  // Exporting it again unchanged keeps this version.
  pack.exported = { version: pack.version, at: now, signature: signature(pack) };
  await save();

  const what = [added && `${added} new`, updated && `${updated} updated`, removed && `${removed} taken out`].filter(Boolean).join(', ');
  record('pack', drawings, `📦 The ${pack.name} pack ${had ? `was updated to version ${pack.version}` : `(version ${pack.version}) was installed`}: ${what || 'nothing changed'}.`);
  return { pack, added, updated, removed };
}
