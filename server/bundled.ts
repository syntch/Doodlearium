/**
 * Worlds and drawing packs that come with Doodlearium (in bundled/). Each is installed the first time the server
 * sees it, and updated whenever a newer version arrives with an update. One the family has uninstalled stays
 * uninstalled: data/bundled.json remembers every one that has been seen, and which version.
 */
import { readdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { compareVersions } from '../shared/versions.ts';
import { installPack, listPacks, MAX_PACK_DRAWINGS } from './packs.ts';
import { parsePackFile } from './routes.ts';
import { DATA_DIR } from './store.ts';
import { cleanText } from './text.ts';
import { installWorld, listWorlds, parseWorld } from './worlds.ts';

const BUNDLED_DIR = join(import.meta.dirname, '..', 'bundled');
const SEEN_FILE = join(DATA_DIR, 'bundled.json');

export async function installBundled() {
  let names: string[];
  try {
    names = (await readdir(BUNDLED_DIR)).sort();
  } catch {
    return;
  }
  let seen: Record<string, string> = {};
  try {
    seen = JSON.parse(await readFile(SEEN_FILE, 'utf8'));
  } catch {}
  const before = JSON.stringify(seen);

  /** Whether to install it: new here, or an update to one that's still installed. */
  const wanted = (key: string, version: string, installed: { installed?: boolean; version: string } | undefined) => {
    if (!(key in seen)) return !installed || compareVersions(version, installed.version) > 0;
    return Boolean(installed?.installed) && compareVersions(version, installed!.version) > 0;
  };
  const read = async (name: string) => {
    try {
      return JSON.parse(await readFile(join(BUNDLED_DIR, name), 'utf8'));
    } catch (err) {
      console.warn(`Couldn't read bundled/${name}:`, (err as Error).message);
      return null;
    }
  };

  // Worlds first, so the packs' creatures move straight into them.
  for (const name of names.filter((n) => n.endsWith('.doodleworld'))) {
    const file = await read(name);
    if (file?.format !== 'doodlearium-world' || file.formatVersion !== 1 || typeof file.id !== 'string' || file.id === 'earth') continue;
    const version = cleanText(file.version, '1', 20);
    const have = listWorlds().find((w) => w.id === file.id);
    // One made here with the same id is left alone.
    if (have && !have.installed) continue;
    if (wanted(`world:${file.id}`, version, have)) {
      const parsed = parseWorld(file, file.id);
      if ('error' in parsed) {
        console.warn(`bundled/${name} isn't right: ${parsed.error}`);
        continue;
      }
      await installWorld(parsed.world, version);
      console.log(`  ${have ? 'updated' : 'installed'} world: ${parsed.world.name} (version ${version})`);
    }
    seen[`world:${file.id}`] = version;
  }

  for (const name of names.filter((n) => n.endsWith('.doodlepack'))) {
    const file = await read(name);
    if (file?.format !== 'doodlearium-pack' || file.formatVersion !== 1 || typeof file.id !== 'string') continue;
    if (!Array.isArray(file.drawings) || !file.drawings.length || file.drawings.length > MAX_PACK_DRAWINGS) continue;
    const version = cleanText(file.version, '1', 20);
    const have = listPacks().find((p) => p.id === file.id);
    if (have && !have.installed) continue;
    if (wanted(`pack:${file.id}`, version, have)) {
      const parsed = parsePackFile(file);
      if ('error' in parsed) {
        console.warn(`bundled/${name} isn't right: ${parsed.error}`);
        continue;
      }
      await installPack(parsed.pack, parsed.items);
      console.log(`  ${have ? 'updated' : 'installed'} drawing pack: ${parsed.pack.name} (version ${version})`);
    }
    seen[`pack:${file.id}`] = version;
  }

  if (JSON.stringify(seen) !== before) {
    await writeFile(`${SEEN_FILE}.tmp`, JSON.stringify(seen, null, 2));
    await rename(`${SEEN_FILE}.tmp`, SEEN_FILE);
  }
}
