import type { Server } from 'node:http';
import { WebSocket, WebSocketServer } from 'ws';
import type { ServerMessage } from '../shared/types.ts';

let wss: WebSocketServer;

export function attachWebSocket(server: Server) {
  wss = new WebSocketServer({ server, path: '/ws' });
}

export function broadcast(message: ServerMessage) {
  const data = JSON.stringify(message);
  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN) client.send(data);
  }
}
