import type { Server } from 'node:http';
import { WebSocket, WebSocketServer } from 'ws';
import type { ServerMessage } from '../shared/types.ts';

let wss: WebSocketServer | null = null;

/** onConnect sends a newly connected screen what it needs to catch up. */
export function attachWebSocket(server: Server, onConnect: (send: (message: ServerMessage) => void) => void) {
  wss = new WebSocketServer({ server, path: '/ws' });
  wss.on('connection', (socket) => onConnect((message) => socket.send(JSON.stringify(message))));
}

const open = () => [...(wss?.clients ?? [])].filter((c) => c.readyState === WebSocket.OPEN);

export const clientCount = () => open().length;

export function broadcast(message: ServerMessage) {
  const data = JSON.stringify(message);
  for (const client of open()) client.send(data);
}

/** Sends to just one screen (the one connected longest), for jobs only one of them should do. */
export function sendToOne(message: ServerMessage) {
  const client = open()[0];
  if (!client) return false;
  client.send(JSON.stringify(message));
  return true;
}
