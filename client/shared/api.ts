import type { ClientMessage, Drawing, HistoryEntry, IncomingPack, NewDrawing, NewEgg, Pack, PackInstall, ServerMessage, SpeciesWhere, Story, TankCommand, TankCommandValue, UpdateInfo, WorldPack } from '../../shared/types.ts';

import { setWorlds } from '../../shared/world/places.ts';
import type { WorldDef } from '../../shared/world/places.ts';
import type { Biome } from '../../shared/world/biomes.ts';

const PIN_KEY = 'doodlearium-pin';
/** How long a device remembers the grown-up PIN after it's typed in: then it asks again. */
const PIN_KEEP_MS = 60 * 60_000;

/** Learns which worlds (and so which places) there are: call before anything looks up a place. */
/**
 * Loads every world (switched-off ones too, marked off). Their places are looked up only where the page
 * asks for them all (the gallery, history and worlds pages, which name every place); elsewhere, only the
 * worlds that are on are open.
 */
export async function loadWorlds(all = false): Promise<WorldPack[]> {
  const res = await fetch('/api/worlds');
  if (!res.ok) throw await failure(res, 'Failed to load the worlds');
  const worlds: WorldPack[] = await res.json();
  if (all) setWorlds(worlds as WorldDef[]);
  else setWorlds(worlds as WorldDef[], worlds.filter((w) => w.off).map((w) => w.id));
  return worlds;
}

/** Switches a drawing, a pack or a world off (kept, but away from the world) or back on. */
export async function switchOff(kind: 'drawings' | 'packs' | 'worlds', id: string, off: boolean) {
  const res = kind === 'packs' ? await fetch(`/api/packs/${id}`, asJson('PUT', { off })) : await fetch(`/api/${kind}/${id}/switch`, asJson('POST', { off }));
  if (!res.ok) throw await failure(res, `Switching it ${off ? 'off' : 'on'} failed`);
  return res.json();
}

/** The PIN this device remembers, if it was typed in within the hour (one from before that, or kept the old way, is forgotten). */
function storedPin() {
  try {
    const kept = JSON.parse(localStorage.getItem(PIN_KEY) ?? 'null');
    if (typeof kept?.pin === 'string' && typeof kept.at === 'number' && Date.now() - kept.at < PIN_KEEP_MS) return kept.pin;
    localStorage.removeItem(PIN_KEY);
  } catch {
    try {
      localStorage.removeItem(PIN_KEY);
    } catch {}
  }
  return '';
}

/** Whether this device remembers the PIN right now. */
export const pinRemembered = () => storedPin() !== '';

/** Forgets the PIN on this device, so the next big change asks for it. */
export function forgetPin() {
  try {
    localStorage.removeItem(PIN_KEY);
  } catch {}
}

/**
 * Sends a request that may need the grown-up PIN: when the server asks for it, asks whoever's here, and
 * remembers it on this device for an hour once it works.
 */
async function withPin(url: string, init: RequestInit): Promise<Response> {
  let pin = storedPin();
  let asked = false;
  for (;;) {
    const res = await fetch(url, { ...init, headers: { ...(init.headers as Record<string, string>), ...(pin ? { 'X-Doodlearium-Pin': pin } : {}) } });
    if (res.status !== 401 || !(await res.clone().json().catch(() => null))?.pin) {
      if (asked && res.ok) {
        try {
          localStorage.setItem(PIN_KEY, JSON.stringify({ pin, at: Date.now() }));
        } catch {
          // Not remembered: it'll be asked for again next time.
        }
      }
      return res;
    }
    await leaveFullscreen();
    const answer = prompt(pin ? 'That PIN is not right. Grown-up PIN:' : 'This needs the grown-up PIN:');
    if (!answer) return res;
    pin = answer.trim();
    asked = true;
  }
}

/**
 * Out of full screen before asking anything: some browsers (Firefox) hold a question back until
 * full screen ends, so the screen just seems to freeze.
 */
export async function leaveFullscreen() {
  if (document.fullscreenElement) await document.exitFullscreen().catch(() => {});
}

/** The error a response carries, or a plain one. */
const failure = async (res: Response, what: string) => new Error((await res.json().catch(() => null))?.error ?? `${what} (${res.status})`);

export async function fetchDrawings(): Promise<Drawing[]> {
  const res = await fetch('/api/drawings');
  if (!res.ok) throw new Error(`Failed to load drawings (${res.status})`);
  return res.json();
}

// --- 📦 drawing packs ---------------------------------------------------------------------------------------

const asJson = (method: string, body: unknown): RequestInit => ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

export async function fetchPacks(): Promise<Pack[]> {
  const res = await fetch('/api/packs');
  if (!res.ok) throw await failure(res, 'Failed to load packs');
  return res.json();
}

export async function makePack(name: string, drawings: string[]): Promise<Pack> {
  const res = await fetch('/api/packs', asJson('POST', { name, drawings }));
  if (!res.ok) throw await failure(res, 'Saving the pack failed');
  return res.json();
}

export async function changePack(id: string, change: { name?: string; version?: string; drawings?: string[]; worlds?: string[] }): Promise<Pack> {
  const res = await fetch(`/api/packs/${id}`, asJson('PUT', change));
  if (!res.ok) throw await failure(res, 'Saving the pack failed');
  return res.json();
}

/** Uninstalls a pack (or takes apart one made here); answers how many drawings went with it. */
export async function removePack(id: string): Promise<number> {
  const res = await withPin(`/api/packs/${id}`, { method: 'DELETE' });
  if (!res.ok) throw await failure(res, 'Removing the pack failed');
  return (await res.json()).removed;
}

/** Saves the pack as a .doodlepack file on this device. */
export async function exportPack(id: string) {
  await saveDownload(`/api/packs/${id}/export`, 'drawings.doodlepack');
}

/** Asks the server for a file and saves it on this device, under the name the server gives it. */
async function saveDownload(url: string, fallback: string) {
  const res = await fetch(url, { method: 'POST' });
  if (!res.ok) throw await failure(res, 'Exporting failed');
  const name = /filename="?([^";]+)"?/.exec(res.headers.get('Content-Disposition') ?? '')?.[1] ?? fallback;
  const link = document.createElement('a');
  link.href = URL.createObjectURL(await res.blob());
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 60_000);
}

/** Installs a pack file's text (or updates the pack to it). */
export async function installPack(text: string): Promise<PackInstall> {
  const res = await withPin('/api/packs/install', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: text });
  if (!res.ok) throw await failure(res, 'Installing failed');
  return res.json();
}

/** What the world maker sends: the world's name, icon, map style and places (ids kept for places it had). */
export interface WorldChange {
  name: string;
  icon: string;
  mapStyle: WorldDef['mapStyle'];
  places: { id?: string; name: string; biome: Biome; x: number; y: number; look?: string }[];
  version?: string;
}

export async function makeWorld(world: WorldChange): Promise<WorldPack> {
  const res = await fetch('/api/worlds', asJson('POST', world));
  if (!res.ok) throw await failure(res, 'Saving the world failed');
  return res.json();
}

export async function changeWorld(id: string, world: WorldChange): Promise<WorldPack> {
  const res = await fetch(`/api/worlds/${id}`, asJson('PUT', world));
  if (!res.ok) throw await failure(res, 'Saving the world failed');
  return res.json();
}

/** Uninstalls a world (or takes apart one made here): its creatures move to places that suit them elsewhere. */
export async function removeWorld(id: string) {
  const res = await withPin(`/api/worlds/${id}`, { method: 'DELETE' });
  if (!res.ok) throw await failure(res, 'Removing the world failed');
}

/** Saves the world as a .doodleworld file on this device. */
export async function exportWorld(id: string) {
  await saveDownload(`/api/worlds/${id}/export`, 'world.doodleworld');
}

/** Installs a world file's text (or updates the world to it): says how many places opened and closed. */
export async function installWorld(text: string): Promise<{ world: WorldPack; opened: number; closed: number; updated: boolean }> {
  const res = await withPin('/api/worlds/install', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: text });
  if (!res.ok) throw await failure(res, 'Installing failed');
  return res.json();
}

/** Where every species lives, by drawing id. */
export async function fetchPopulation(): Promise<Record<string, SpeciesWhere>> {
  const res = await fetch('/api/population');
  if (!res.ok) throw new Error(`Failed to load who lives where (${res.status})`);
  return res.json();
}

/** Adds a new species: the reply says which place its original moved into. */
export async function submitDrawing(drawing: NewDrawing): Promise<Drawing & { place?: string }> {
  const res = await fetch('/api/drawings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(drawing),
  });
  if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? `Upload failed (${res.status})`);
  return res.json();
}

export async function updateDrawing(id: string, drawing: NewDrawing): Promise<Drawing> {
  const res = await fetch(`/api/drawings/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(drawing),
  });
  if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? `Save failed (${res.status})`);
  return res.json();
}

/** Asks the server to lay an egg; resolves to false if it isn't time for one yet (unless now is set). */
export async function layEgg(egg: NewEgg, now = false): Promise<boolean> {
  const res = await fetch('/api/eggs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...egg, now }),
  });
  return res.ok;
}

/** Drops food in one place, or (no place) everywhere. Resolves to false if the fish were fed moments ago. */
export async function feedFish(x?: number, place?: string): Promise<boolean> {
  const res = await fetch('/api/feed', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ x, place }),
  });
  return res.ok;
}

/** Does a ⚙️ menu command (in place, for the ones that happen somewhere); resolves to a line to show, if any. */
export async function sendTankCommand(command: TankCommand, value: TankCommandValue = null, place?: string): Promise<string> {
  const res = await fetch('/api/tank', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ command, value, place }),
  });
  if (!res.ok) throw new Error(`Command failed (${res.status})`);
  return (await res.json()).say ?? '';
}

/** Moves or resizes a plant or decoration in a place (null: puts it back where it grew). */
export async function arrangeStill(place: string, id: string, placement: { x: number; z: number; scale: number } | null) {
  const res = await fetch('/api/arrange', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ place, id, ...(placement ?? { reset: true }) }),
  });
  if (!res.ok) throw new Error(`Arranging failed (${res.status})`);
}

/** Sends every screen to a place. */
export async function showEverywhere(place: string) {
  const res = await fetch('/api/show', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ place }),
  });
  if (!res.ok) throw new Error(`Show failed (${res.status})`);
}

/** Does a ⚙️ menu command later: at is in ms since 1970. */
export async function scheduleTankCommand(command: TankCommand, value: TankCommandValue, at: number, place?: string) {
  const res = await fetch('/api/schedule', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ command, value, at, place }),
  });
  if (!res.ok) throw new Error(`Scheduling failed (${res.status})`);
}

/** The tank's history, oldest first: from and to are ms since 1970, who a drawing id. */
export async function fetchHistory(query: { from?: number; to?: number; who?: string } = {}): Promise<HistoryEntry[]> {
  const params = new URLSearchParams(Object.entries(query).filter(([, v]) => v !== undefined).map(([k, v]) => [k, String(v)]));
  const res = await fetch(`/api/history?${params}`);
  if (!res.ok) throw new Error(`Failed to load the history (${res.status})`);
  return res.json();
}

export async function fetchStories(): Promise<Story[]> {
  const res = await fetch('/api/stories');
  if (!res.ok) throw new Error(`Failed to load stories (${res.status})`);
  return res.json();
}

export async function saveStory(story: Pick<Story, 'title' | 'text' | 'from' | 'to'>): Promise<Story> {
  const res = await fetch('/api/stories', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(story),
  });
  if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? `Save failed (${res.status})`);
  return res.json();
}

/** Turns a button into a Feed button with a little "Fed!" confirmation. */
export function setupFeedButton(button: HTMLButtonElement) {
  // (Its words are in a span, which a phone hides to leave just the 🍤.)
  const label = button.innerHTML;
  button.onclick = async () => {
    button.disabled = true;
    const ok = await feedFish().catch(() => false);
    button.innerHTML = `🍤 <span class="label">${ok ? 'Fed!' : 'Still eating…'}</span>`;
    setTimeout(() => {
      button.innerHTML = label;
      button.disabled = false;
    }, 1600);
  };
}

/** Copies a drawing as the family's own (in no pack, so pack updates leave it be). */
export async function copyDrawing(id: string, name?: string): Promise<Drawing & { place: string }> {
  const res = await fetch(`/api/drawings/${id}/copy`, asJson('POST', name === undefined ? {} : { name }));
  if (!res.ok) throw await failure(res, 'Copying failed');
  return res.json();
}

/** The built-in packs ⬇️ Update now brings newer versions of, with their drawings changed here. */
export async function fetchIncomingPacks(): Promise<IncomingPack[]> {
  const res = await fetch('/api/update/packs');
  if (!res.ok) throw await failure(res, 'Checking the packs failed');
  return res.json();
}

export async function deleteDrawing(id: string) {
  const res = await withPin(`/api/drawings/${id}`, { method: 'DELETE' });
  if (!res.ok && res.status !== 404) throw await failure(res, 'Delete failed');
}

/** The version running, and (with check) what's new on GitHub. */
export async function fetchUpdateInfo(check: boolean): Promise<UpdateInfo> {
  const res = await fetch(`/api/update${check ? '?check=1' : ''}`);
  if (!res.ok) throw await failure(res, 'Checking failed');
  return res.json();
}

/** Has the server update itself and start again. */
export async function startUpdate() {
  const res = await withPin('/api/update', { method: 'POST' });
  if (!res.ok) throw await failure(res, 'Update failed');
}

/** A note across the page while the server updates itself (the page reloads when it's back). */
function showUpdating() {
  if (document.getElementById('doodlearium-updating')) return;
  const note = document.createElement('div');
  note.id = 'doodlearium-updating';
  note.textContent = '🔄 Updating Doodlearium… back in a minute or so';
  Object.assign(note.style, {
    position: 'fixed', left: '50%', top: '16px', transform: 'translateX(-50%)', zIndex: '100000', padding: '10px 20px',
    borderRadius: '14px', background: 'rgba(12, 32, 56, 0.9)', color: '#fff', font: '600 18px system-ui, sans-serif',
    boxShadow: '0 4px 18px rgba(0,0,0,0.3)', pointerEvents: 'none',
  });
  document.body.append(note);
}

/**
 * Connects to the live feed and reconnects forever; `onOpen` fires on every (re)connect so callers can resync.
 * Returns a way to tell the server things (dropped while disconnected: say them again in onOpen). When the
 * server comes back as a new run (after an update or a restart), the page reloads to pick up any new pages.
 */
export function connectLive(onMessage: (msg: ServerMessage) => void, onOpen?: () => void) {
  const url = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;
  let retryMs = 1000;
  let ws: WebSocket;
  let version: string | null = null;
  const open = () => {
    ws = new WebSocket(url);
    ws.onopen = () => {
      retryMs = 1000;
      onOpen?.();
    };
    ws.onmessage = (event) => {
      const msg: ServerMessage = JSON.parse(event.data);
      if (msg.type === 'hello') {
        if (version && version !== msg.version) location.reload();
        version = msg.version;
        return;
      }
      if (msg.type === 'updating') showUpdating();
      // Places open and close as worlds come and go: learn them before anyone looks one up.
      if (msg.type === 'worlds') setWorlds(msg.worlds);
      onMessage(msg);
    };
    ws.onclose = () => {
      setTimeout(open, retryMs);
      retryMs = Math.min(retryMs * 2, 15000);
    };
  };
  open();
  return (message: ClientMessage) => {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(message));
  };
}
