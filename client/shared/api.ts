import type { ClientMessage, Drawing, HistoryEntry, NewDrawing, NewEgg, ServerMessage, SpeciesWhere, Story, TankCommand, TankCommandValue } from '../../shared/types.ts';

export async function fetchDrawings(): Promise<Drawing[]> {
  const res = await fetch('/api/drawings');
  if (!res.ok) throw new Error(`Failed to load drawings (${res.status})`);
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
  const label = button.textContent;
  button.onclick = async () => {
    button.disabled = true;
    const ok = await feedFish().catch(() => false);
    button.textContent = ok ? '🍤 Fed!' : '🍤 Still eating…';
    setTimeout(() => {
      button.textContent = label;
      button.disabled = false;
    }, 1600);
  };
}

export async function deleteDrawing(id: string) {
  const res = await fetch(`/api/drawings/${id}`, { method: 'DELETE' });
  if (!res.ok && res.status !== 404) throw new Error(`Delete failed (${res.status})`);
}

/**
 * Connects to the live feed and reconnects forever; `onOpen` fires on every (re)connect so callers can resync.
 * Returns a way to tell the server things (dropped while disconnected: say them again in onOpen).
 */
export function connectLive(onMessage: (msg: ServerMessage) => void, onOpen?: () => void) {
  const url = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;
  let retryMs = 1000;
  let ws: WebSocket;
  const open = () => {
    ws = new WebSocket(url);
    ws.onopen = () => {
      retryMs = 1000;
      onOpen?.();
    };
    ws.onmessage = (event) => onMessage(JSON.parse(event.data));
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
