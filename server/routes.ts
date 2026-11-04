import express, { Router } from 'express';
import {
  ATTACHMENT_KINDS,
  CREATURE_TYPES,
  MAX_ATTACHMENTS,
  MAX_PARTS,
  MOTIONS,
  PART_MOTIONS,
  TANK_COMMANDS,
  habitatOf,
  isAttachmentColor,
  motionOf,
  type Attachment,
  type Motion,
  type Part,
} from '../shared/types.ts';
import { addStory, historyBetween, listStories, record } from './history.ts';
import { addDrawing, listDrawings, removeDrawing, updateDrawing } from './store.ts';
import { BIOMES, type Biome } from '../shared/world/biomes.ts';
import { placeById, placeName } from '../shared/world/places.ts';
import { EGG_GAP, HATCH_TIME, arrange, drawingAdded, drawingRemoved, drawingUpdated, feed, runCommand, schedule, stopForUpdate, whereSpecies } from './world.ts';
import { broadcast } from './ws.ts';
import { rateLimit, requirePin } from './security.ts';
import { updateInfo } from './update.ts';
import { cleanText } from './text.ts';
import { MAX_PACK_DRAWINGS, changePack, exportPack, forgetPack, installPack, listPacks, makePack, type PackItem } from './packs.ts';
import { changeWorld, exportWorld, forgetWorld, installWorld, isWorldInstalled, listWorlds, makeWorld, newWorldId, parseWorld } from './worlds.ts';

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const MAX_DIMENSION = 1024;

export const api = Router();
// Plenty for a family tapping away, not for a flood.
const changes = rateLimit(300, 60);
const uploads = rateLimit(30, 60, 'That\'s a lot of drawings at once: wait a minute, then try again.');
api.use((req, res, next) => (req.method === 'GET' ? next() : changes(req, res, next)));
// Pack files hold a lot of drawings at once: they get more room, on their own route (after the PIN).
const json = express.json({ limit: '8mb' });
api.use((req, res, next) => (req.path === '/packs/install' || req.path === '/worlds/install' ? next() : json(req, res, next)));

api.get('/drawings', (_req, res) => {
  res.json(listDrawings());
});

/** Validates a submitted drawing body; returns an error message or the cleaned metadata and PNG bytes. */
function parseDrawing(body: any) {
  const { type, name, artist, image } = body ?? {};
  // Older pages send only a type; map it to that type's default motion.
  const motion: Motion | undefined = MOTIONS.includes(body?.motion)
    ? body.motion
    : CREATURE_TYPES.includes(type)
      ? motionOf({ type })
      : undefined;
  if (!motion) return { error: `motion must be one of ${MOTIONS.join(', ')}` };
  const png = decodePng(image);
  if (!png) return { error: 'image must be a PNG data URL' };
  const { width, height } = png;
  if (!width || !height || width > MAX_DIMENSION || height > MAX_DIMENSION) {
    return { error: `image must be at most ${MAX_DIMENSION}px on each side` };
  }
  const parts = parseParts(body.parts);
  if (!parts) return { error: `parts must be a list of at most ${MAX_PARTS} valid parts` };
  let partsPng = null;
  if (parts.length) {
    partsPng = decodePng(body.partsImage);
    if (!partsPng || partsPng.width !== width || partsPng.height !== height) {
      return { error: 'partsImage must be a PNG the same size as image' };
    }
  }
  let glowPng = null;
  if (body.glowImage !== undefined) {
    glowPng = decodePng(body.glowImage);
    if (!glowPng || glowPng.width !== width || glowPng.height !== height) {
      return { error: 'glowImage must be a PNG the same size as image' };
    }
  }
  // What's painted behind parts; without it, parts leave their usual shadow.
  let behindPng = null;
  if (parts.some((p) => p.behind) && body.behindImage !== undefined) {
    behindPng = decodePng(body.behindImage);
    if (!behindPng || behindPng.width !== width || behindPng.height !== height) {
      return { error: 'behindImage must be a PNG the same size as image' };
    }
  }
  if (!behindPng) for (const p of parts) delete p.behind;
  const attachments = parseAttachments(body.attachments);
  if (!attachments) return { error: `attachments must be a list of at most ${MAX_ATTACHMENTS} valid extras` };
  const meta = {
    type: habitatOf(motion),
    motion,
    name: cleanText(name, 'Mystery'),
    artist: cleanText(artist, 'Anonymous'),
    width,
    height,
    attachments,
    nocturnal: body.nocturnal === true,
    // Only animals get about: plants and decorations stay put.
    explorer: body.explorer === true && !['plant', 'decor'].includes(motion) ? true : undefined,
    parts,
    glow: glowPng !== null,
    // Where the species lives, and whether it comes in groups (unset: the usual for its style).
    habitats: Array.isArray(body.habitats) && body.habitats.length
      ? [...new Set<Biome>(body.habitats.filter((b: unknown) => BIOMES.includes(b as Biome)))]
      : undefined,
    group: typeof body.group === 'boolean' ? body.group : undefined,
    home: typeof body.home === 'string' && placeById(body.home)?.live ? body.home : undefined,
    size: body.size === 'small' || body.size === 'big' ? body.size : undefined,
    // Which worlds, and exactly which places (ones not here yet are kept, for when their world arrives).
    worlds: keyList(body.worlds, 20),
    places: keyList(body.places, 60),
  };
  return { meta, png: png.bytes, extra: { parts: partsPng?.bytes ?? null, glow: glowPng?.bytes ?? null, behind: behindPng?.bytes ?? null } };
}

/** A short list of ids (worlds, places), or undefined for none. */
function keyList(value: unknown, max: number) {
  if (!Array.isArray(value)) return undefined;
  const list = [...new Set(value.filter((v): v is string => typeof v === 'string' && v.length <= 64 && /^[\w.-]+$/.test(v)))].slice(0, max);
  return list.length ? list : undefined;
}

/** A PNG data URL's bytes and size, or null if it isn't one. */
function decodePng(value: unknown) {
  const prefix = 'data:image/png;base64,';
  if (typeof value !== 'string' || !value.startsWith(prefix)) return null;
  const bytes = Buffer.from(value.slice(prefix.length), 'base64');
  if (bytes.length < 24 || !bytes.subarray(0, 8).equals(PNG_SIGNATURE)) return null;
  // IHDR chunk: width and height are big-endian uint32s at bytes 16 and 20.
  return { bytes, width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

function parseParts(value: unknown): Part[] | null {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > MAX_PARTS) return null;
  const result: Part[] = [];
  for (const p of value) {
    const hinge = p?.hinge;
    if (
      !PART_MOTIONS.includes(p?.motion) ||
      !Array.isArray(hinge) ||
      hinge.length !== 4 ||
      !hinge.every((n: unknown) => typeof n === 'number' && n >= -1 && n <= 2)
    ) {
      return null;
    }
    const tuning = (n: unknown) => (n === undefined ? 1 : typeof n === 'number' && n >= 0.25 && n <= 3 ? n : null);
    const speed = tuning(p.speed);
    const amount = tuning(p.amount);
    if (speed === null || amount === null) return null;
    const part: Part = { motion: p.motion, hinge: [hinge[0], hinge[1], hinge[2], hinge[3]], speed, amount };
    if (p.flip === true) part.flip = true;
    if (p.lift === true) part.lift = true;
    if (p.behind === true) part.behind = true;
    result.push(part);
  }
  return result;
}

function parseAttachments(value: unknown): Attachment[] | null {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > MAX_ATTACHMENTS) return null;
  const inRange = (n: unknown, min: number, max: number) => typeof n === 'number' && n >= min && n <= max;
  const result: Attachment[] = [];
  for (const a of value) {
    if (
      !ATTACHMENT_KINDS.includes(a?.kind) ||
      !inRange(a.x, -1, 2) ||
      !inRange(a.y, -1, 2) ||
      !inRange(a.scale, 0.25, 3) ||
      !isAttachmentColor(a.color)
    ) {
      return null;
    }
    result.push({ kind: a.kind, x: a.x, y: a.y, scale: a.scale, color: a.color });
  }
  return result;
}

api.post('/drawings', uploads, async (req, res) => {
  const parsed = parseDrawing(req.body);
  if ('error' in parsed) {
    res.status(400).json({ error: parsed.error });
    return;
  }
  const drawing = await addDrawing(parsed.meta, parsed.png, parsed.extra);
  broadcast({ type: 'drawing:added', drawing });
  const place = drawingAdded(drawing);
  record('joined', [drawing.id], `🎨 ${drawing.name}, drawn by ${drawing.artist}, moved into ${placeName(place)}.`, place);
  res.status(201).json({ ...drawing, place });
});

api.put('/drawings/:id', uploads, async (req: express.Request<{ id: string }>, res) => {
  const parsed = parseDrawing(req.body);
  if ('error' in parsed) {
    res.status(400).json({ error: parsed.error });
    return;
  }
  const drawing = await updateDrawing(req.params.id, parsed.meta, parsed.png, parsed.extra);
  if (!drawing) {
    res.status(404).json({ error: 'not found' });
    return;
  }
  broadcast({ type: 'drawing:updated', drawing });
  drawingUpdated(drawing);
  res.json(drawing);
});

/** Eggs are a treat: at most one every few hours (see world.ts). The ⚙️ menu can lay one any time. */
api.post('/eggs', async (req, res) => {
  const parsed = parseDrawing(req.body);
  if ('error' in parsed) {
    res.status(400).json({ error: parsed.error });
    return;
  }
  const all = listDrawings();
  const parents = req.body?.parents;
  const valid = (id: unknown) => all.some((d) => d.id === id && !d.parents);
  if (!Array.isArray(parents) || parents.length !== 2 || parents[0] === parents[1] || !parents.every(valid)) {
    res.status(400).json({ error: 'parents must be two different drawings that are not babies themselves' });
    return;
  }
  const now = Date.now();
  const lastEgg = Math.max(0, ...all.filter((d) => d.parents).map((d) => d.createdAt));
  // The tank's ⚙️ menu can lay one any time.
  if (now - lastEgg < EGG_GAP && req.body.now !== true) {
    res.status(429).json({ error: 'Not time for another egg yet' });
    return;
  }
  const nest = typeof req.body.nest === 'number' ? Math.min(0.95, Math.max(0.05, req.body.nest)) : 0.5;
  // Laid where its parents are: that's its home.
  const home = typeof req.body.place === 'string' && placeById(req.body.place)?.live ? req.body.place : parsed.meta.home;
  const meta = { ...parsed.meta, home, parents: [parents[0], parents[1]] as [string, string], hatchAt: now + HATCH_TIME, nest };
  // Babies take after their parents' moving parts and glowing paint too.
  const drawing = await addDrawing(meta, parsed.png, parsed.extra);
  broadcast({ type: 'drawing:added', drawing });
  const place = drawingAdded(drawing);
  const names = drawing.parents!.map((id) => all.find((d) => d.id === id)?.name ?? 'someone');
  record('egg', [drawing.id, ...drawing.parents!], `🥚 ${names[0]} and ${names[1]} laid an egg at ${placeName(place)}.`, place);
  res.status(201).json(drawing);
});

let lastFeed = 0;
api.post('/feed', (req, res) => {
  const now = Date.now();
  // A little cooldown so an excited button-masher doesn't bury the tank in food.
  if (now - lastFeed < 1500) {
    res.status(429).json({ error: 'The fish are still eating!' });
    return;
  }
  lastFeed = now;
  const x = typeof req.body?.x === 'number' && req.body.x >= 0 && req.body.x <= 1 ? req.body.x : 0.15 + Math.random() * 0.7;
  feed(x, typeof req.body?.place === 'string' ? req.body.place : undefined);
  res.status(204).end();
});

/** A ⚙️ menu command for the tank: { command, value }, and (to schedule it) at, in ms since 1970. */
function parseCommand(body: any) {
  const { command, value = null, place } = body ?? {};
  const okValue = value === null || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value)) || (typeof value === 'string' && value.length <= 40);
  return TANK_COMMANDS.includes(command) && okValue ? { command, value, place: typeof place === 'string' ? place : undefined } : null;
}

/** Does a ⚙️ menu command now; answers with a line to show, if there is one. */
api.post('/tank', (req, res) => {
  const parsed = parseCommand(req.body);
  if (!parsed) {
    res.status(400).json({ error: `command must be one of ${TANK_COMMANDS.join(', ')}` });
    return;
  }
  res.json({ say: runCommand(parsed.command, parsed.value, parsed.place) });
});

/** Does a ⚙️ menu command later (up to a week ahead). */
api.post('/schedule', (req, res) => {
  const parsed = parseCommand(req.body);
  const at = req.body?.at;
  if (!parsed || typeof at !== 'number' || at < Date.now() - 60_000 || at > Date.now() + 7 * 86_400_000) {
    res.status(400).json({ error: 'needs a command and a time within the next week' });
    return;
  }
  schedule(parsed.command, parsed.value, at, parsed.place);
  res.status(204).end();
});

/**
 * Moves or resizes a plant or decoration: { place, id, x, z, scale } (x and z 0..1, scale its size at the
 * back), or { place, id, reset: true } to put it back where it grew.
 */
api.post('/arrange', (req, res) => {
  const { place, id, x, z, scale, reset } = req.body ?? {};
  const drawing = typeof id === 'string' ? listDrawings().find((d) => d.id === id.split('~')[0]) : undefined;
  const numbers = [x, z, scale].every((n) => typeof n === 'number' && Number.isFinite(n));
  if (typeof place !== 'string' || !drawing || (!reset && !numbers)) {
    res.status(400).json({ error: 'needs a place, a plant or decoration, and where (or reset)' });
    return;
  }
  const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
  // Between a pebble and the whole height of the place.
  const big = Math.max(drawing.width, drawing.height);
  const placement = reset ? null : { x: clamp(x, 0, 1), z: clamp(z, 0, 1), scale: clamp(scale, 20 / big, 900 / big) };
  if (!arrange(place, id, placement)) {
    res.status(404).json({ error: 'not a plant or decoration in that place' });
    return;
  }
  res.status(204).end();
});

/** Sends every screen to a place: { place }. */
api.post('/show', (req, res) => {
  const place = req.body?.place;
  if (typeof place !== 'string' || !placeById(place)?.live) {
    res.status(400).json({ error: 'needs a place that is open' });
    return;
  }
  broadcast({ type: 'show', place });
  res.status(204).end();
});

/** Where every species lives, by drawing id. */
api.get('/population', (_req, res) => {
  res.json(whereSpecies());
});

/** The tank's history: ?from=&to= (ms since 1970) and ?who= (a drawing id) narrow it down. */
api.get('/history', (req, res) => {
  const num = (v: unknown) => (typeof v === 'string' && v && Number.isFinite(Number(v)) ? Number(v) : undefined);
  res.json(historyBetween(num(req.query.from), num(req.query.to), typeof req.query.who === 'string' ? req.query.who : undefined));
});

api.get('/stories', async (_req, res) => {
  res.json(await listStories());
});

/** Keeps a story written from the history. */
api.post('/stories', async (req, res) => {
  const { title, text, from, to } = req.body ?? {};
  const story = cleanText(text, '', 50_000, true);
  if (typeof text !== 'string' || text.length > 60_000 || !story || !Number.isFinite(from) || !Number.isFinite(to)) {
    res.status(400).json({ error: 'a story needs its text and the stretch of history it covers' });
    return;
  }
  res.status(201).json(await addStory({ title: cleanText(title, 'A story from Doodlearium', 120), text: story, from, to }));
});

api.delete('/drawings/:id', requirePin, async (req: express.Request<{ id: string }>, res) => {
  if (!(await removeDrawing(req.params.id))) {
    res.status(404).json({ error: 'not found' });
    return;
  }
  broadcast({ type: 'drawing:removed', id: req.params.id });
  drawingRemoved();
  res.status(204).end();
});

/** The ⚙️ menu's 🔄 Update: the version running and (?check=1) what's new on GitHub. */
api.get('/update', async (req, res) => {
  res.json(await updateInfo(req.query.check === '1'));
});

/** Updates to the newest version and starts again (screens reload when it's back). */
api.post('/update', requirePin, async (_req, res) => {
  const info = await updateInfo(false);
  if (!info.can) {
    res.status(409).json({ error: info.why });
    return;
  }
  res.json({ ok: true });
  stopForUpdate();
});

// --- 📦 drawing packs (see packs.ts) ----------------------------------------------------------------------

/** Pack ids and drawing keys: a UUID, or something like one. */
const isKey = (v: unknown): v is string => typeof v === 'string' && /^[\w-]{1,64}$/.test(v);

/** A list of drawings here, for a pack: an error, or their ids. */
function parsePackDrawings(value: unknown) {
  const ids = new Set(listDrawings().map((d) => d.id));
  if (!Array.isArray(value) || value.length > MAX_PACK_DRAWINGS || !value.every((id) => typeof id === 'string' && ids.has(id))) {
    return null;
  }
  return [...new Set<string>(value)];
}

api.get('/packs', (_req, res) => {
  res.json(listPacks());
});

/** Puts a new pack together: { name, drawings }. */
api.post('/packs', async (req, res) => {
  const drawings = parsePackDrawings(req.body?.drawings);
  if (!drawings?.length) {
    res.status(400).json({ error: `a pack needs between 1 and ${MAX_PACK_DRAWINGS} drawings` });
    return;
  }
  res.status(201).json(await makePack(cleanText(req.body.name, 'My pack', 60), drawings));
});

/** Renames a pack, sets its version, changes which drawings are in it or which worlds it's for: { name?, version?, drawings?, worlds? }. */
api.put('/packs/:id', async (req: express.Request<{ id: string }>, res) => {
  const { name, version } = req.body ?? {};
  const drawings = req.body?.drawings === undefined ? undefined : parsePackDrawings(req.body.drawings);
  if (drawings === null || drawings?.length === 0) {
    res.status(400).json({ error: `a pack needs between 1 and ${MAX_PACK_DRAWINGS} drawings` });
    return;
  }
  const change = {
    ...(name !== undefined && { name: cleanText(name, 'My pack', 60) }),
    ...(version !== undefined && { version: cleanText(version, '1', 20) }),
    ...(drawings && { drawings }),
    ...(req.body?.worlds !== undefined && { worlds: keyList(req.body.worlds, 20) ?? [] }),
  };
  const pack = await changePack(req.params.id, change);
  if (!pack) res.status(404).json({ error: 'no such pack' });
  else res.json(pack);
});

/** Uninstalls a pack (removing the drawings it brought: that needs the PIN), or takes apart one made here. */
api.delete(
  '/packs/:id',
  (req, res, next) => (listPacks().find((p) => p.id === req.params.id)?.installed ? requirePin(req, res, next) : next()),
  async (req: express.Request<{ id: string }>, res) => {
    const removed = await forgetPack(req.params.id);
    if (removed === null) res.status(404).json({ error: 'no such pack' });
    else res.json({ removed });
  },
);

/** The pack as a .doodlepack file (its version goes up first if it's changed since last time). */
api.post('/packs/:id/export', async (req: express.Request<{ id: string }>, res) => {
  const file = await exportPack(req.params.id);
  if (!file) {
    res.status(404).json({ error: 'no such pack' });
    return;
  }
  const filename = `${file.name} v${file.version}.doodlepack`.replace(/[^\w .()-]+/g, '_');
  res.attachment(filename).json(file);
});

/** Installs a .doodlepack file, or updates the pack to the version in it. Every drawing is checked first. */
api.post('/packs/install', requirePin, uploads, express.json({ limit: '200mb' }), async (req, res) => {
  const file = req.body ?? {};
  const fail = (error: string) => void res.status(400).json({ error });
  if (file.format !== 'doodlearium-pack' || file.formatVersion !== 1 || !isKey(file.id)) return fail("That isn't a Doodlearium drawing pack.");
  if (!Array.isArray(file.drawings) || !file.drawings.length || file.drawings.length > MAX_PACK_DRAWINGS) {
    return fail(`A pack has between 1 and ${MAX_PACK_DRAWINGS} drawings.`);
  }
  const parsed = parsePackFile(file);
  if ('error' in parsed) return fail(parsed.error);
  res.json(await installPack(parsed.pack, parsed.items));
});

/** Checks every drawing in a pack file (whose format, id and size have been checked): an error, or what to install. */
export function parsePackFile(file: any): { error: string } | { pack: { id: string; name: string; version: string; worlds?: string[] }; items: PackItem[] } {
  const items: PackItem[] = [];
  const keys = new Set<string>();
  for (const d of file.drawings) {
    const parsed = parseDrawing(d);
    const what = `"${cleanText(d?.name, 'A drawing')}" in the pack`;
    if ('error' in parsed) return { error: `${what} isn't right: ${parsed.error}` };
    if (!isKey(d.key) || keys.has(d.key)) return { error: `${what} is missing its key.` };
    keys.add(d.key);
    const parents = Array.isArray(d.parents) && d.parents.length === 2 && d.parents.every(isKey) ? ([d.parents[0], d.parents[1]] as [string, string]) : undefined;
    items.push({ key: d.key, meta: parsed.meta, png: parsed.png, extra: parsed.extra, parents });
  }
  return { pack: { id: file.id, name: cleanText(file.name, 'A pack', 60), version: cleanText(file.version, '1', 20), worlds: keyList(file.worlds, 20) }, items };
}

// --- 🌍 worlds (see worlds.ts) ----------------------------------------------------------------------------

api.get('/worlds', (_req, res) => {
  res.json(listWorlds());
});

/** Makes a world on the maker page: { name, icon, mapStyle, places: [{ name, biome, x, y, look? }] }. */
api.post('/worlds', async (req, res) => {
  const parsed = parseWorld(req.body, newWorldId());
  if ('error' in parsed) {
    res.status(400).json({ error: parsed.error });
    return;
  }
  res.status(201).json(await makeWorld(parsed.world));
});

/** Changes a world: its name, map, or places (places keep their id; new ones get one). */
api.put('/worlds/:id', async (req: express.Request<{ id: string }>, res) => {
  if (!listWorlds().some((w) => w.id === req.params.id && !w.builtin)) {
    res.status(404).json({ error: 'no such world (and Earth stays as it is)' });
    return;
  }
  const parsed = parseWorld(req.body, req.params.id);
  if ('error' in parsed) {
    res.status(400).json({ error: parsed.error });
    return;
  }
  const version = req.body?.version === undefined ? undefined : cleanText(req.body.version, '1', 20);
  res.json(await changeWorld(req.params.id, parsed.world, version));
});

/** The world as a .doodleworld file (its version goes up first if it's changed since last time). */
api.post('/worlds/:id/export', async (req: express.Request<{ id: string }>, res) => {
  const file = await exportWorld(req.params.id);
  if (!file) {
    res.status(404).json({ error: 'no such world' });
    return;
  }
  res.attachment(`${file.name} v${file.version}.doodleworld`.replace(/[^\w .()-]+/g, '_')).json(file);
});

/** Installs a .doodleworld file, or updates the world to the version in it. */
api.post('/worlds/install', requirePin, uploads, express.json({ limit: '1mb' }), async (req, res) => {
  const file = req.body ?? {};
  const isId = typeof file.id === 'string' && /^[\w-]{1,64}$/.test(file.id) && file.id !== 'earth';
  if (file.format !== 'doodlearium-world' || file.formatVersion !== 1 || !isId) {
    res.status(400).json({ error: "That isn't a Doodlearium world." });
    return;
  }
  if (listWorlds().some((w) => w.id === file.id && !w.installed)) {
    res.status(409).json({ error: 'That world was made here: change it on this page instead.' });
    return;
  }
  const parsed = parseWorld(file, file.id);
  if ('error' in parsed) {
    res.status(400).json({ error: `That world isn't right: ${parsed.error}` });
    return;
  }
  res.json(await installWorld(parsed.world, cleanText(file.version, '1', 20)));
});

/** Uninstalls a world (or takes apart one made here); its creatures move to places that suit them elsewhere. */
api.delete(
  '/worlds/:id',
  (req, res, next) => (isWorldInstalled(req.params.id) ? requirePin(req, res, next) : next()),
  async (req: express.Request<{ id: string }>, res) => {
    if (!(await forgetWorld(req.params.id))) res.status(404).json({ error: 'no such world (and Earth always stays)' });
    else res.status(204).end();
  },
);
