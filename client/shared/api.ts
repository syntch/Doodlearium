import type { Drawing, NewDrawing, ServerMessage } from '../../shared/types.ts';

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
