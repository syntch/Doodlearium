import express, { Router } from 'express';
import {
  ATTACHMENT_KINDS,
  CREATURE_TYPES,
  MAX_ATTACHMENTS,
  isAttachmentColor,
  type Attachment,
  type CreatureType,
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
  if (!CREATURE_TYPES.includes(type)) return { error: `type must be one of ${CREATURE_TYPES.join(', ')}` };
  const prefix = 'data:image/png;base64,';
  if (typeof image !== 'string' || !image.startsWith(prefix)) return { error: 'image must be a PNG data URL' };
  const png = Buffer.from(image.slice(prefix.length), 'base64');
  if (png.length < 24 || !png.subarray(0, 8).equals(PNG_SIGNATURE)) return { error: 'image is not a valid PNG' };
  // IHDR chunk: width and height are big-endian uint32s at bytes 16 and 20.
  const width = png.readUInt32BE(16);
  const height = png.readUInt32BE(20);
  if (!width || !height || width > MAX_DIMENSION || height > MAX_DIMENSION) {
    return { error: `image must be at most ${MAX_DIMENSION}px on each side` };
  }
  const attachments = parseAttachments(body.attachments);
  if (!attachments) return { error: `attachments must be a list of at most ${MAX_ATTACHMENTS} valid extras` };
  const meta = {
    type: type as CreatureType,
    name: cleanText(name, 'Mystery'),
    artist: cleanText(artist, 'Anonymous'),
    width,
    height,
    attachments,
  };
  return { meta, png };
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
  const drawing = await addDrawing(parsed.meta, parsed.png);
  broadcast({ type: 'drawing:added', drawing });
  res.status(201).json(drawing);
});

api.put('/drawings/:id', async (req, res) => {
  const parsed = parseDrawing(req.body);
  if ('error' in parsed) {
    res.status(400).json({ error: parsed.error });
    return;
  }
  const drawing = await updateDrawing(req.params.id, parsed.meta, parsed.png);
  if (!drawing) {
    res.status(404).json({ error: 'not found' });
    return;
  }
  broadcast({ type: 'drawing:updated', drawing });
  res.json(drawing);
});

api.delete('/drawings/:id', async (req, res) => {
  if (!(await removeDrawing(req.params.id))) {
    res.status(404).json({ error: 'not found' });
    return;
  }
  broadcast({ type: 'drawing:removed', id: req.params.id });
  res.status(204).end();
});
