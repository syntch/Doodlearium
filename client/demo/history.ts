/**
 * Stands in for server/history.ts in the browser-only demo. The demo's world only lives while a page is
 * open, so it has no History page; what happens is still passed along to the page (and remembered for a
 * while, for the server's code that looks back), but never written down.
 */
import type { HistoryEntry, Story } from '../../shared/types.ts';
import { broadcast } from '../../server/ws.ts';

const KEPT = 500;
let entries: HistoryEntry[] = [];

export async function loadHistory() {}

export function record(type: string, who: string[], text: string, place = '') {
  const entry: HistoryEntry = { at: Date.now(), type, place, who, text };
  entries.push(entry);
  if (entries.length > KEPT) entries = entries.slice(-KEPT);
  broadcast({ type: 'history', entry });
}

export function historyBetween(from = 0, to = Infinity, who?: string) {
  return entries.filter((e) => e.at >= from && e.at <= to && (!who || e.who.includes(who)));
}

export const listStories = async (): Promise<Story[]> => [];

export async function addStory(story: Omit<Story, 'id' | 'createdAt'>): Promise<Story> {
  return { ...story, id: String(Date.now()), createdAt: Date.now() };
}
