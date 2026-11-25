import { execFile } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import type { IncomingPack, UpdateInfo, UpdateResult } from '../shared/types.ts';
import { compareVersions } from '../shared/versions.ts';
import { listDrawings } from './store.ts';
import { listPacks } from './packs.ts';
import { DATA_DIR } from './store.ts';

/**
 * The ⚙️ menu's 🔄 Update. The server only looks (git fetch) and says what's new; the update itself is done
 * by the launcher (scripts/start.mjs, which `npm start` runs): the server saves the world and stops with
 * UPDATE_EXIT, and the launcher gets the new version, builds it and starts it again (going back to the old
 * one if that fails), leaving what happened in data/update.json.
 */
export const UPDATE_EXIT = 75;
const ROOT = join(import.meta.dirname, '..');
const RESULT_FILE = join(DATA_DIR, 'update.json');
const run = promisify(execFile);

const git = async (...args: string[]) => (await run('git', args, { cwd: ROOT, timeout: 60_000, windowsHide: true })).stdout.trim();

/** Why updating from the ⚙️ menu can't work here, if it can't. */
async function cantUpdate() {
  if (process.env.DOODLEARIUM_LAUNCHER !== '1') {
    return process.env.NODE_ENV === 'production'
      ? 'This server runs in Docker: update it with `docker compose up -d --build`.'
      : 'Start the server with `npm start` to update it from here.';
  }
  try {
    await git('rev-parse', '--abbrev-ref', '@{upstream}');
  } catch {
    return "This copy of Doodlearium wasn't downloaded with git (or its branch doesn't follow GitHub's), so it can't update itself.";
  }
  return undefined;
}

let lastFetch = 0;

/** Where it's at, and (with check) what's new on GitHub. */
export async function updateInfo(check: boolean): Promise<UpdateInfo> {
  const why = await cantUpdate();
  const info: UpdateInfo = { can: !why, why, last: await lastUpdate() };
  try {
    const [hash, date, subject] = (await git('log', '-1', '--format=%h%n%cI%n%s')).split('\n');
    info.version = { hash, date, subject };
  } catch {
    return info;
  }
  if (!check || why) return info;
  // GitHub is asked at most every half a minute, however often the button's pressed.
  if (Date.now() - lastFetch > 30_000) {
    try {
      await git('fetch', '--quiet');
      lastFetch = Date.now();
    } catch (err) {
      info.error = `Couldn't reach GitHub: ${String((err as { stderr?: string }).stderr ?? err).trim().split('\n').at(-1)}`;
      return info;
    }
  }
  const log = await git('log', '--format=%s', '-n', '30', 'HEAD..@{upstream}');
  info.changes = log ? log.split('\n') : [];
  info.dirty = Boolean(await git('status', '--porcelain', '--untracked-files=no'));
  return info;
}

/**
 * The built-in packs (bundled/) that updating will bring newer versions of, where some of their drawings
 * were edited here: updating replaces those, so the ⚙️ menu offers to keep copies first. Read from what
 * the last check fetched from GitHub.
 */
export async function incomingPacks(): Promise<IncomingPack[]> {
  if (await cantUpdate()) return [];
  let files: string[];
  try {
    files = (await git('ls-tree', '--name-only', '@{upstream}', 'bundled/')).split('\n').filter((f) => f.endsWith('.doodlepack'));
  } catch {
    return [];
  }
  const names = new Map(listDrawings().map((d) => [d.id, d.name]));
  const found: IncomingPack[] = [];
  for (const file of files) {
    let pack: { id?: unknown; name?: unknown; version?: unknown };
    try {
      const { stdout } = await run('git', ['show', `@{upstream}:${file}`], { cwd: ROOT, timeout: 60_000, windowsHide: true, maxBuffer: 256 * 1024 * 1024 });
      pack = JSON.parse(stdout);
    } catch {
      continue;
    }
    const have = listPacks().find((p) => p.id === pack.id);
    if (!have?.installed || typeof pack.version !== 'string' || compareVersions(pack.version, have.version) <= 0) continue;
    const edited = (have.edited ?? []).map((id) => ({ id, name: names.get(id) ?? 'A drawing' }));
    if (edited.length) found.push({ id: have.id, name: have.name, version: pack.version, edited });
  }
  return found;
}

async function lastUpdate(): Promise<UpdateResult | undefined> {
  try {
    return JSON.parse(await readFile(RESULT_FILE, 'utf8'));
  } catch {
    return undefined;
  }
}

/** The last update's result, once: the history mentions it the first time the new version starts. */
export async function freshUpdate() {
  const last = await lastUpdate();
  if (!last || last.announced) return undefined;
  await writeFile(RESULT_FILE, JSON.stringify({ ...last, announced: true }, null, 2));
  return last;
}
