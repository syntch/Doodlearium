/**
 * The browser-only demo's stand-in for ../shared/transport.ts (swapped in by vite.demo.config.ts). Instead
 * of reaching a server, it runs the server's own code right here in the page: the same routes, the same
 * world, ten times a second. That code finds browser stand-ins where it expects Node's files, Express and
 * WebSockets (node/, express.ts, ws.ts), so its "data folder" is kept in this browser and nothing is sent
 * anywhere. Starting creatures come from the packs and worlds in bundled/.
 */
import './node/globals.ts';
import { join } from './node/path.ts';
import { bundledStamp, openFiles, pictureUrl, readFile, saved, writeFile } from './node/fs.ts';
import { connectPage } from './ws.ts';
import type { PageRouter } from './express.ts';
import { showBusy } from './notice.ts';
import { setPictureSource } from '../../shared/types.ts';
import type { LiveSocket } from '../shared/transport.ts';
import { installBundled } from '../../server/bundled.ts';
import { loadHistory } from '../../server/history.ts';
import { loadPacks } from '../../server/packs.ts';
import { loadWorlds } from '../../server/worlds.ts';
import { api } from '../../server/routes.ts';
import { DATA_DIR, DRAWINGS_DIR, loadStore } from '../../server/store.ts';
import { onConnect, onWatch, startWorld } from '../../server/world.ts';
import { attachWebSocket } from '../../server/ws.ts';

/** Which of bundled/ has been installed here already (so it's only fetched again when it changes). */
const BUNDLED_FILE = join(DATA_DIR, 'demo-bundled.txt');

// Drawings' pictures come out of the data folder kept in this browser.
setPictureSource((file) => pictureUrl(join(DRAWINGS_DIR, file)));

/** Starts everything, in the order the server does (server/index.ts). */
const ready = (async () => {
  await openFiles();
  await loadStore();
  await loadHistory();
  await loadPacks();
  await loadWorlds();
  await startWorld();
  if ((await readFile(BUNDLED_FILE, 'utf8').catch(() => '')) !== bundledStamp) {
    const done = showBusy('🐠 Filling the world with creatures…');
    try {
      await installBundled();
      await writeFile(BUNDLED_FILE, bundledStamp);
      await saved();
    } finally {
      done();
    }
  }
  attachWebSocket(undefined as never, { onConnect, onWatch });
})();
ready.catch((err) => console.error('The demo could not start', err));

const routes = api as unknown as PageRouter;

/** Answers a request to the API here in the page. */
export async function http(path: string, init: RequestInit = {}): Promise<Response> {
  await ready;
  const url = new URL(path, location.origin);
  const method = (init.method ?? 'GET').toUpperCase();
  let body: unknown;
  try {
    body = typeof init.body === 'string' ? JSON.parse(init.body) : undefined;
  } catch {
    return Response.json({ error: 'That is not something Doodlearium can read.' }, { status: 400 });
  }
  const reply = await routes.answer({
    method,
    path: url.pathname.replace(/^\/api/, ''),
    query: Object.fromEntries(url.searchParams),
    body,
    headers: {},
  });
  // Anything changed is safely kept before the page hears back (it may be about to move to another page).
  if (method !== 'GET') await saved();
  return new Response(reply.body, { status: reply.status, headers: reply.headers });
}

/** Opens the live feed: a socket in name only, straight to the world running in this page. */
export function openSocket(): LiveSocket {
  let server: ReturnType<typeof connectPage> | undefined;
  const page = {
    readyState: WebSocket.CONNECTING as number,
    onopen: null as LiveSocket['onopen'],
    onmessage: null as LiveSocket['onmessage'],
    onclose: null as LiveSocket['onclose'],
    send: (data: string) => server?.emit('message', data),
  };
  const socket = page as unknown as WebSocket;
  void ready.then(() => {
    server = connectPage((data) => page.onmessage?.call(socket, { data } as MessageEvent));
    page.readyState = WebSocket.OPEN;
    page.onopen?.call(socket, new Event('open'));
  });
  return socket;
}
