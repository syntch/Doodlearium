import { randomUUID } from 'node:crypto';
import { appendFile, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { HistoryEntry, Story } from '../shared/types.ts';
import { DATA_DIR } from './store.ts';
import { broadcast } from './ws.ts';

const HISTORY_FILE = join(DATA_DIR, 'history.jsonl');
const STORIES_DIR = join(DATA_DIR, 'stories');

let entries: HistoryEntry[] = [];
let writing = Promise.resolve();

export async function loadHistory() {
  await mkdir(STORIES_DIR, { recursive: true });
  try {
    const text = await readFile(HISTORY_FILE, 'utf8');
    entries = text
      .split('\n')
      .filter(Boolean)
      .flatMap((line) => {
        try {
          return [JSON.parse(line) as HistoryEntry];
        } catch {
          return [];
        }
      });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
  }
}

/** Writes something that happened into the tank's history (one line per event, never rewritten). */
export function record(type: string, who: string[], text: string) {
  const entry: HistoryEntry = { at: Date.now(), type, place: 'lake', who, text };
  entries.push(entry);
  writing = writing.then(() => appendFile(HISTORY_FILE, `${JSON.stringify(entry)}\n`)).catch((err) => console.warn('History not saved', err));
  broadcast({ type: 'history', entry });
}

export function historyBetween(from = 0, to = Infinity, who?: string) {
  return entries.filter((e) => e.at >= from && e.at <= to && (!who || e.who.includes(who)));
}

export async function listStories(): Promise<Story[]> {
  const files = (await readdir(STORIES_DIR)).filter((f) => f.endsWith('.json'));
  const stories = await Promise.all(files.map(async (f) => JSON.parse(await readFile(join(STORIES_DIR, f), 'utf8')) as Story));
  return stories.sort((a, b) => b.createdAt - a.createdAt);
}

export async function addStory(story: Omit<Story, 'id' | 'createdAt'>): Promise<Story> {
  const saved: Story = { ...story, id: randomUUID(), createdAt: Date.now() };
  await writeFile(join(STORIES_DIR, `${saved.id}.json`), JSON.stringify(saved, null, 2));
  return saved;
}
