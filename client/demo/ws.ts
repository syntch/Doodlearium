/**
 * Just enough of the `ws` package for the server's live feed (server/ws.ts) to run in the page: the one
 * screen it ever talks to is this page (see transport.ts).
 */

type Listener = (...args: any[]) => void;

/** The server's end of the connection to this page. */
export class WebSocket {
  static readonly OPEN = 1;
  readyState = WebSocket.OPEN;
  private listeners = new Map<string, Listener[]>();

  constructor(private toPage: (data: string) => void) {}

  /** Arrives a moment later, as it would down a wire (and as the text it was when it was sent). */
  send(data: string) {
    queueMicrotask(() => this.toPage(data));
  }

  on(event: string, listener: Listener) {
    this.listeners.set(event, [...(this.listeners.get(event) ?? []), listener]);
    return this;
  }

  emit(event: string, ...args: unknown[]) {
    for (const listener of this.listeners.get(event) ?? []) listener(...args);
  }
}

let server: WebSocketServer | undefined;

export class WebSocketServer {
  connected: (socket: WebSocket) => void = () => {};

  constructor(_options?: unknown) {
    server = this;
  }

  on(event: string, listener: Listener) {
    if (event === 'connection') this.connected = listener;
    return this;
  }
}

/** Connects the page to the server's live feed: toPage gets everything it sends. Returns the server's end. */
export function connectPage(toPage: (data: string) => void) {
  if (!server) throw new Error('The live feed has not started');
  const socket = new WebSocket(toPage);
  server.connected(socket);
  return socket;
}
