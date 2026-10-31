import express, { Router } from 'express';
import {
  ATTACHMENT_KINDS,
  CREATURE_TYPES,
  MAX_ATTACHMENTS,
  MAX_PARTS,
  MOTIONS,
  PART_MOTIONS,
  habitatOf,
  isAttachmentColor,
  motionOf,
  type Attachment,
  type Motion,
  type Part,
} from '../shared/types.ts';
import { addDrawing, listDrawings, removeDrawing, updateDrawing } from './store.ts';
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
  };
  return { meta, png: png.bytes, partsPng: partsPng?.bytes ?? null };
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
    result.push({ motion: p.motion, hinge: [hinge[0], hinge[1], hinge[2], hinge[3]] });
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
  const drawing = await addDrawing(parsed.meta, parsed.png, parsed.partsPng);
  broadcast({ type: 'drawing:added', drawing });
  res.status(201).json(drawing);
});

api.put('/drawings/:id', async (req, res) => {
  const parsed = parseDrawing(req.body);
  if ('error' in parsed) {
    res.status(400).json({ error: parsed.error });
    return;
  }
  const drawing = await updateDrawing(req.params.id, parsed.meta, parsed.png, parsed.partsPng);
  if (!drawing) {
    res.status(404).json({ error: 'not found' });
    return;
  }
  broadcast({ type: 'drawing:updated', drawing });
  res.json(drawing);
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
  broadcast({ type: 'feed', x });
  res.status(204).end();
});

api.delete('/drawings/:id', async (req, res) => {
  if (!(await removeDrawing(req.params.id))) {
    res.status(404).json({ error: 'not found' });
    return;
  }
  broadcast({ type: 'drawing:removed', id: req.params.id });
  res.status(204).end();
});
