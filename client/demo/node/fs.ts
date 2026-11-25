/// <reference types="vite/client" />
/**
 * Node's fs/promises, for the server's code running in the page. Its data folder is kept in this browser
 * (IndexedDB), and never leaves it; bundled/ is the starter packs and worlds that ship with the demo.
 */
import { Bytes } from './globals.ts';

type Content = string | Uint8Array;

const DB_NAME = 'doodlearium-demo';
const STORE = 'files';

/** Everything in the data folder, by path: read into memory when the page opens, written through as it changes. */
const files = new Map<string, Content>();
let db: IDBDatabase | null = null;

/** The starter worlds and packs, by file name: fetched only when they're read. */
const bundled = new Map(
  Object.entries(import.meta.glob<string>('../../../bundled/*', { query: '?url', import: 'default', eager: true })).map(([path, url]) => [path.split('/').pop()!, url]),
);
/** Changes whenever what's bundled does (each file's address has its contents' fingerprint in it). */
export const bundledStamp = [...bundled.values()].sort().join('|');

const request = <T>(req: IDBRequest<T>) =>
  new Promise<T>((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

/** Opens the data folder kept in this browser. Where the browser won't keep one, it lasts until the page is left. */
export async function openFiles() {
  try {
    const open = indexedDB.open(DB_NAME, 1);
    open.onupgradeneeded = () => open.result.createObjectStore(STORE);
    db = await request(open);
    const store = db.transaction(STORE).objectStore(STORE);
    const [keys, values] = await Promise.all([request(store.getAllKeys()), request(store.getAll())]);
    keys.forEach((key, i) => files.set(String(key), values[i]));
  } catch (err) {
    console.warn('This browser is not keeping the demo between visits', err);
    db = null;
  }
}

// Changes are written a moment later, a batch at a time (the server's code saves often, and in bursts).
let pending = new Map<string, Content | null>();
let timer: number | undefined;
let writing: Promise<unknown> = Promise.resolve();

function keep(path: string, content: Content | null) {
  if (content === null) files.delete(path);
  else files.set(path, content);
  pictures.delete(path);
  if (!db) return;
  pending.set(path, content);
  // A page being left gets no "moment later".
  if (document.visibilityState === 'hidden') flush();
  else timer ??= window.setTimeout(flush, 40);
}

function flush() {
  clearTimeout(timer);
  timer = undefined;
  if (!db || !pending.size) return;
  const batch = pending;
  pending = new Map();
  try {
    const tx = db.transaction(STORE, 'readwrite');
    for (const [path, content] of batch) {
      if (content === null) tx.objectStore(STORE).delete(path);
      else tx.objectStore(STORE).put(content, path);
    }
    const done = new Promise<void>((resolve) => {
      tx.oncomplete = () => resolve();
      tx.onabort = () => {
        console.warn('The demo could not be saved in this browser', tx.error);
        resolve();
      };
    });
    writing = Promise.all([writing, done]);
  } catch (err) {
    console.warn('The demo could not be saved in this browser', err);
  }
}

/** Resolves once everything changed so far is safely kept. */
export async function saved() {
  flush();
  await writing;
}

/** Forgets everything kept in this browser (for starting the demo over). */
export async function wipeFiles() {
  clearTimeout(timer);
  pending.clear();
  await writing;
  db?.close();
  db = null;
  await request(indexedDB.deleteDatabase(DB_NAME)).catch(() => {});
}

// A drawing's pictures are shown straight from the data folder, as data: addresses.
const pictures = new Map<string, string>();

/** An address for a PNG in the data folder (one that fails to load, like a missing file would, if it isn't there). */
export function pictureUrl(path: string) {
  let url = pictures.get(path);
  if (url === undefined) {
    const content = files.get(path);
    url = content instanceof Uint8Array ? `data:image/png;base64,${new Bytes(content).toString('base64')}` : 'data:,';
    pictures.set(path, url);
  }
  return url;
}

// --- fs/promises, as the server's code uses it ------------------------------------------------------------

const missing = (path: string) => Object.assign(new Error(`ENOENT: no such file or directory, '${path}'`), { code: 'ENOENT' });
const inBundled = (path: string) => (path.startsWith('bundled/') ? path.slice('bundled/'.length) : undefined);

export function readFile(path: string): Promise<Bytes>;
export function readFile(path: string, encoding: 'utf8'): Promise<string>;
export async function readFile(path: string, encoding?: 'utf8'): Promise<string | Bytes> {
  let content = files.get(path);
  const name = inBundled(path);
  if (name !== undefined) {
    const url = bundled.get(name);
    const res = url ? await fetch(url) : undefined;
    if (!res?.ok) throw missing(path);
    content = new Uint8Array(await res.arrayBuffer());
  }
  if (content === undefined) throw missing(path);
  if (encoding) return typeof content === 'string' ? content : new TextDecoder().decode(content);
  return typeof content === 'string' ? new Bytes(new TextEncoder().encode(content)) : new Bytes(content);
}

export async function writeFile(path: string, content: Content) {
  keep(path, content);
}

export async function appendFile(path: string, text: string) {
  const had = files.get(path);
  keep(path, `${typeof had === 'string' ? had : ''}${text}`);
}

export async function rename(from: string, to: string) {
  const content = files.get(from);
  if (content === undefined) throw missing(from);
  keep(to, content);
  keep(from, null);
}

export async function copyFile(from: string, to: string) {
  const content = files.get(from);
  if (content === undefined) throw missing(from);
  keep(to, content);
}

export async function rm(path: string, options?: { force?: boolean }) {
  if (!files.has(path) && !options?.force) throw missing(path);
  if (files.has(path)) keep(path, null);
}

export async function mkdir(_path: string, _options?: { recursive?: boolean }) {}

export async function readdir(dir: string) {
  if (dir === 'bundled') return [...bundled.keys()];
  const names = new Set<string>();
  for (const path of files.keys()) if (path.startsWith(`${dir}/`)) names.add(path.slice(dir.length + 1).split('/')[0]);
  return [...names];
}
