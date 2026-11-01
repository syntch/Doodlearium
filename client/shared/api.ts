import type { Drawing, HistoryEntry, NewDrawing, NewEgg, ServerMessage, Story, TankCommand, TankCommandValue } from '../../shared/types.ts';

export async function fetchDrawings(): Promise<Drawing[]> {
  const res = await fetch('/api/drawings');
  if (!res.ok) throw new Error(`Failed to load drawings (${res.status})`);
  return res.json();
}

export async function submitDrawing(drawing: NewDrawing): Promise<Drawing> {
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

/** Drops food into every open tank. Resolves to false if the fish were fed moments ago. */
export async function feedFish(x?: number): Promise<boolean> {
  const res = await fetch('/api/feed', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ x }),
  });
  return res.ok;
}

/** Does a ⚙️ menu command in the tank (every screen shows it); resolves to a line to show, if any. */
export async function sendTankCommand(command: TankCommand, value: TankCommandValue = null): Promise<string> {
  const res = await fetch('/api/tank', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ command, value }),
  });
  if (!res.ok) throw new Error(`Command failed (${res.status})`);
  return (await res.json()).say ?? '';
}

/** Does a ⚙️ menu command later: at is in ms since 1970. */
export async function scheduleTankCommand(command: TankCommand, value: TankCommandValue, at: number) {
  const res = await fetch('/api/schedule', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ command, value, at }),
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

/** Connects to the live feed and reconnects forever; `onOpen` fires on every (re)connect so callers can resync. */
export function connectLive(onMessage: (msg: ServerMessage) => void, onOpen?: () => void) {
  const url = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;
  let retryMs = 1000;
  const open = () => {
    const ws = new WebSocket(url);
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
}
