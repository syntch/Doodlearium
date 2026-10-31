import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Attachment, CreatureType, Drawing, Motion, Part } from '../shared/types.ts';

export const DATA_DIR = join(import.meta.dirname, '..', 'data');
export const DRAWINGS_DIR = join(DATA_DIR, 'drawings');
const DB_FILE = join(DATA_DIR, 'db.json');

let drawings: Drawing[] = [];
let writing = Promise.resolve();

export async function loadStore() {
  await mkdir(DRAWINGS_DIR, { recursive: true });
  try {
    drawings = JSON.parse(await readFile(DB_FILE, 'utf8'));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    drawings = [];
  }
}

/** Serialized, atomic (write-then-rename) save so a crash never leaves a half-written db. */
function save() {
  writing = writing.then(async () => {
    const tmp = `${DB_FILE}.tmp`;
    await writeFile(tmp, JSON.stringify(drawings, null, 2));
    await rename(tmp, DB_FILE);
  });
  return writing;
}

export const listDrawings = () => drawings;

type DrawingMeta = {
  type: CreatureType;
  motion: Motion;
  name: string;
  artist: string;
  width: number;
  height: number;
  attachments: Attachment[];
  nocturnal: boolean;
  parts: Part[];
};

const partsFile = (id: string) => join(DRAWINGS_DIR, `${id}.parts.png`);

/** Saves or (with no parts) removes the drawing's part image. */
async function writeParts(id: string, partsPng: Buffer | null) {
  if (partsPng) await writeFile(partsFile(id), partsPng);
  else await rm(partsFile(id), { force: true });
}

export async function addDrawing(meta: DrawingMeta, png: Buffer, partsPng: Buffer | null): Promise<Drawing> {
  const drawing: Drawing = { id: randomUUID(), createdAt: Date.now(), ...meta };
  await writeFile(join(DRAWINGS_DIR, `${drawing.id}.png`), png);
  await writeParts(drawing.id, partsPng);
  drawings.push(drawing);
  await save();
  return drawing;
}

export async function updateDrawing(
  id: string,
  meta: DrawingMeta,
  png: Buffer,
  partsPng: Buffer | null,
): Promise<Drawing | null> {
  const drawing = drawings.find((d) => d.id === id);
  if (!drawing) return null;
  await writeFile(join(DRAWINGS_DIR, `${id}.png`), png);
  await writeParts(id, partsPng);
  Object.assign(drawing, meta, { updatedAt: Date.now() });
  await save();
  return drawing;
}

export async function removeDrawing(id: string): Promise<boolean> {
  const index = drawings.findIndex((d) => d.id === id);
  if (index === -1) return false;
  drawings.splice(index, 1);
  await save();
  await rm(join(DRAWINGS_DIR, `${id}.png`), { force: true });
  await writeParts(id, null);
  return true;
}
