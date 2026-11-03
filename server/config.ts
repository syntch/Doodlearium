import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DATA_DIR } from './store.ts';

/**
 * Who the server answers:
 * - home: devices on private home-network addresses (10.x, 192.168.x, 172.16-31.x, this PC; and 100.64-127.x,
 *   which Tailscale uses);
 * - subnet: only devices on the same network as one of this PC's own connections (and this PC);
 * - anywhere: everyone who can reach it (only if you've put it behind something that checks who's visiting).
 */
export type Access = 'home' | 'subnet' | 'anywhere';
const ACCESS: Access[] = ['home', 'subnet', 'anywhere'];

export interface Config {
  access: Access;
  /** Asked for before big changes (🔄 Update, deleting a drawing). Empty: no PIN. */
  pin: string;
  /** Names the server is reached by, besides addresses, single names (http://doodlearium:3000) and .local/.lan/.home ones. */
  hosts: string[];
}

export const CONFIG_FILE = join(DATA_DIR, 'config.json');

const DEFAULTS = {
  _help: 'access: "home" (devices on your home network), "subnet" (only this PC\'s own network) or "anywhere". pin: asked before updating or deleting drawings ("" for none). hosts: extra names the server is reached by. Restart the server after changing this.',
  access: 'home',
  pin: '',
  hosts: [],
};

/** Reads data/config.json (writing one with the defaults the first time). DOODLEARIUM_ACCESS and DOODLEARIUM_PIN override it. */
function load(): Config {
  let file: Partial<Config> = {};
  if (existsSync(CONFIG_FILE)) {
    try {
      file = JSON.parse(readFileSync(CONFIG_FILE, 'utf8'));
    } catch (err) {
      console.warn(`Could not read ${CONFIG_FILE}; using the defaults`, err);
    }
  } else {
    try {
      mkdirSync(DATA_DIR, { recursive: true });
      writeFileSync(CONFIG_FILE, `${JSON.stringify(DEFAULTS, null, 2)}\n`);
    } catch {
      // A read-only data folder: the defaults will do.
    }
  }
  const access = (process.env.DOODLEARIUM_ACCESS ?? file.access) as Access;
  const pin = process.env.DOODLEARIUM_PIN ?? file.pin;
  return {
    access: ACCESS.includes(access) ? access : 'home',
    pin: typeof pin === 'string' || typeof pin === 'number' ? String(pin).trim() : '',
    hosts: Array.isArray(file.hosts) ? file.hosts.filter((h): h is string => typeof h === 'string').map((h) => h.toLowerCase()) : [],
  };
}

export const config = load();
