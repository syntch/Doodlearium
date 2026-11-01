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
import { EGG_GAP, HATCH_TIME, drawingAdded, drawingRemoved, drawingUpdated, feed, runCommand, schedule } from './world.ts';
import { broadcast } from './ws.ts';

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const MAX_DIMENSION = 1024;

const cleanText = (value: unknown, fallback: string) =>
  (typeof value === 'string' ? value.trim().slice(0, 40) : '') || fallback;

export const api = Router();
api.use(express.json({ limit: '8mb' }));

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
    parts,
    glow: glowPng !== null,
  };
  return { meta, png: png.bytes, extra: { parts: partsPng?.bytes ?? null, glow: glowPng?.bytes ?? null } };
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

api.post('/drawings', async (req, res) => {
  const parsed = parseDrawing(req.body);
  if ('error' in parsed) {
    res.status(400).json({ error: parsed.error });
    return;
  }
  const drawing = await addDrawing(parsed.meta, parsed.png, parsed.extra);
  broadcast({ type: 'drawing:added', drawing });
  drawingAdded(drawing);
  record('joined', [drawing.id], `🎨 ${drawing.name}, drawn by ${drawing.artist}, joined the tank.`);
  res.status(201).json(drawing);
});

api.put('/drawings/:id', async (req, res) => {
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
  drawingUpdated();
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
  const meta = { ...parsed.meta, parents: [parents[0], parents[1]] as [string, string], hatchAt: now + HATCH_TIME, nest };
  // Babies take after their parents' moving parts and glowing paint too.
  const drawing = await addDrawing(meta, parsed.png, parsed.extra);
  broadcast({ type: 'drawing:added', drawing });
  drawingAdded(drawing);
  const names = drawing.parents!.map((id) => all.find((d) => d.id === id)?.name ?? 'someone');
  record('egg', [drawing.id, ...drawing.parents!], `🥚 ${names[0]} and ${names[1]} laid an egg on the sand.`);
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
  feed(x);
  res.status(204).end();
});

/** A ⚙️ menu command for the tank: { command, value }, and (to schedule it) at, in ms since 1970. */
function parseCommand(body: any) {
  const { command, value = null } = body ?? {};
  const okValue = value === null || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value)) || (typeof value === 'string' && value.length <= 20);
  return TANK_COMMANDS.includes(command) && okValue ? { command, value } : null;
}

/** Does a ⚙️ menu command now; answers with a line to show, if there is one. */
api.post('/tank', (req, res) => {
  const parsed = parseCommand(req.body);
  if (!parsed) {
    res.status(400).json({ error: `command must be one of ${TANK_COMMANDS.join(', ')}` });
    return;
  }
  res.json({ say: runCommand(parsed.command, parsed.value) });
});

/** Does a ⚙️ menu command later (up to a week ahead). */
api.post('/schedule', (req, res) => {
  const parsed = parseCommand(req.body);
  const at = req.body?.at;
  if (!parsed || typeof at !== 'number' || at < Date.now() - 60_000 || at > Date.now() + 7 * 86_400_000) {
    res.status(400).json({ error: 'needs a command and a time within the next week' });
    return;
  }
  schedule(parsed.command, parsed.value, at);
  res.status(204).end();
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
  if (typeof text !== 'string' || !text.trim() || text.length > 50_000 || typeof from !== 'number' || typeof to !== 'number') {
    res.status(400).json({ error: 'a story needs its text and the stretch of history it covers' });
    return;
  }
  const clean = typeof title === 'string' && title.trim() ? title.trim().slice(0, 120) : 'A story from the tank';
  res.status(201).json(await addStory({ title: clean, text: text.trim(), from, to }));
});

api.delete('/drawings/:id', async (req, res) => {
  if (!(await removeDrawing(req.params.id))) {
    res.status(404).json({ error: 'not found' });
    return;
  }
  broadcast({ type: 'drawing:removed', id: req.params.id });
  drawingRemoved();
  res.status(204).end();
});
