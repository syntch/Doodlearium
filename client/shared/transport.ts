/**
 * How the pages reach the server: requests to its API, and the live feed. Everything goes through here
 * (see api.ts), so this is the one file the browser-only demo build swaps out: there, the world runs in
 * the page itself and nothing is sent anywhere (see vite.demo.config.ts and client/demo/).
 */

/** What api.ts needs of the live feed's socket. */
export type LiveSocket = Pick<WebSocket, 'onopen' | 'onmessage' | 'onclose' | 'readyState' | 'send'>;

/** Asks the server's API: path starts with /api/. */
export const http = (path: string, init?: RequestInit): Promise<Response> => fetch(path, init);

/** Opens the live feed. */
export const openSocket = (): LiveSocket => new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`);
