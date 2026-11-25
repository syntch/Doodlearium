import type { IncomingMessage, Server } from 'node:http';
import { WebSocket, WebSocketServer } from 'ws';
import type { ClientMessage, ServerMessage } from '../shared/types.ts';
import { allowedSocket } from './security.ts';

/** This run of the server: screens that see it change reload, to pick up new pages after an update. */
const VERSION = String(Date.now());

/** A connected screen, and the place it's showing (null: the map, or not said yet). */
export interface Screen {
  send(message: ServerMessage): void;
  place: string | null;
}

const screens = new Map<WebSocket, Screen>();

/** onConnect sends a newly connected screen what it needs; onWatch, when it moves to another place. */
export function attachWebSocket(
  server: Server,
  handlers: { onConnect(screen: Screen): void; onWatch(screen: Screen): void },
) {
  // Screens only ever say which place they're watching, so messages are kept small.
  const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 16 * 1024, verifyClient: ({ req }: { req: IncomingMessage }) => allowedSocket(req) });
  wss.on('connection', (socket) => {
    const screen: Screen = { send: (message) => socket.send(JSON.stringify(message)), place: null };
    screens.set(socket, screen);
    socket.on('close', () => screens.delete(socket));
    socket.on('message', (data) => {
      let message: ClientMessage;
      try {
        message = JSON.parse(String(data));
      } catch {
        return;
      }
      if (message?.type === 'watch' && (message.place === null || typeof message.place === 'string')) {
        screen.place = message.place;
        handlers.onWatch(screen);
      }
    });
    screen.send({ type: 'hello', version: VERSION });
    handlers.onConnect(screen);
  });
}

const open = () => [...screens].filter(([socket]) => socket.readyState === WebSocket.OPEN).map(([, screen]) => screen);

export const clientCount = () => open().length;

/** Screens showing a place right now. */
export const watchers = (place: string) => open().filter((s) => s.place === place);

export function broadcast(message: ServerMessage) {
  const data = JSON.stringify(message);
  for (const [socket] of screens) if (socket.readyState === WebSocket.OPEN) socket.send(data);
}

/** Sends to the screens showing one place. */
export function broadcastTo(place: string, message: ServerMessage) {
  const list = watchers(place);
  if (!list.length) return;
  const data = JSON.stringify(message);
  for (const [socket, screen] of screens) if (screen.place === place && socket.readyState === WebSocket.OPEN) socket.send(data);
}

/** Sends to just one screen (the one connected longest), for jobs only one of them should do. */
export function sendToOne(message: ServerMessage) {
  const screen = open()[0];
  if (!screen) return false;
  screen.send(message);
  return true;
}
