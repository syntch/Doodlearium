import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Attachment, CreatureType, Drawing, Motion, Part, SpeciesSize } from '../shared/types.ts';
import type { Biome } from '../shared/world/biomes.ts';

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
  glow: boolean;
  habitats?: Biome[];
  group?: boolean;
  home?: string;
  size?: SpeciesSize;
  parents?: [string, string];
  hatchAt?: number;
  nest?: number;
};

/** Images that go with a drawing: which pixels are moving parts, which glow, and what's painted behind parts. */
export type ExtraImages = { parts: Buffer | null; glow: Buffer | null; behind: Buffer | null };
const NO_EXTRAS: ExtraImages = { parts: null, glow: null, behind: null };

/** Saves the drawing's extra images, removing any it no longer has. */
async function writeExtras(id: string, extra: ExtraImages) {
  for (const kind of ['parts', 'glow', 'behind'] as const) {
    const file = join(DRAWINGS_DIR, `${id}.${kind}.png`);
    const bytes = extra[kind];
    if (bytes) await writeFile(file, bytes);
    else await rm(file, { force: true });
  }
}

export async function addDrawing(meta: DrawingMeta, png: Buffer, extra: ExtraImages): Promise<Drawing> {
  const drawing: Drawing = { id: randomUUID(), createdAt: Date.now(), ...meta };
  await writeFile(join(DRAWINGS_DIR, `${drawing.id}.png`), png);
  await writeExtras(drawing.id, extra);
  drawings.push(drawing);
  await save();
  return drawing;
}

export async function updateDrawing(
  id: string,
  meta: DrawingMeta,
  png: Buffer,
  extra: ExtraImages,
): Promise<Drawing | null> {
  const drawing = drawings.find((d) => d.id === id);
  if (!drawing) return null;
  await writeFile(join(DRAWINGS_DIR, `${id}.png`), png);
  await writeExtras(id, extra);
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
  await writeExtras(id, NO_EXTRAS);
  return true;
}
