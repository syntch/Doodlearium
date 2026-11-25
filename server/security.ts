import type { IncomingMessage } from 'node:http';
import { hostname, networkInterfaces } from 'node:os';
import type { NextFunction, Request, Response } from 'express';
import { config } from './config.ts';

/**
 * Keeping the world to the family, without getting in their way:
 * - only devices on the home network get an answer (see config.ts), so an opened router port doesn't expose it;
 * - only the server's own pages can change things, so a web page open on a family device can't quietly send
 *   it requests (other sites' requests, and "DNS rebinding" tricks that dress them up as this server's);
 * - big changes (🔄 Update, deleting a drawing) can be kept behind a grown-up PIN;
 * - and a few limits and headers against floods and framing.
 */

/** An IPv4 address as a number, or null if it isn't one. */
function ipv4(address: string) {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(address);
  if (!m) return null;
  const parts = m.slice(1).map(Number);
  if (parts.some((p) => p > 255)) return null;
  return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
}

const inRange = (ip: number, base: string, bits: number) => {
  const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
  return ((ip & mask) >>> 0) === ((ipv4(base)! & mask) >>> 0);
};

/** IPv4-mapped IPv6 addresses (::ffff:10.0.0.5) are IPv4 ones. */
const plain = (address: string) => address.replace(/^::ffff:/i, '').toLowerCase();

const isLoopback = (address: string) => {
  const ip = ipv4(address);
  return ip === null ? address === '::1' : inRange(ip, '127.0.0.0', 8);
};

/** Private (home network) addresses, this PC, and Tailscale's. */
function isHome(address: string) {
  const ip = ipv4(address);
  if (ip !== null) {
    return [
      ['127.0.0.0', 8], ['10.0.0.0', 8], ['172.16.0.0', 12], ['192.168.0.0', 16], ['169.254.0.0', 16], ['100.64.0.0', 10],
    ].some(([base, bits]) => inRange(ip, base as string, bits as number));
  }
  // IPv6: this PC, unique-local (fc00::/7) and link-local (fe80::/10).
  return address === '::1' || /^f[cd]/.test(address) || /^fe[89ab]/.test(address);
}

/** On the same network as one of this PC's own connections (or this PC). */
function isSubnet(address: string) {
  if (isLoopback(address)) return true;
  const ip = ipv4(address);
  // IPv6 link-local addresses are on this PC's own links by definition.
  if (ip === null) return /^fe[89ab]/.test(address);
  for (const net of Object.values(networkInterfaces()).flat()) {
    if (!net || net.family !== 'IPv4' || !net.cidr) continue;
    const [base, bits] = net.cidr.split('/');
    if (inRange(ip, base, Number(bits))) return true;
  }
  return false;
}

/** Whether to answer a device at this address. */
export function allowedAddress(raw: string | undefined) {
  if (!raw) return false;
  const address = plain(raw);
  if (config.access === 'anywhere') return true;
  return config.access === 'subnet' ? isSubnet(address) : isHome(address);
}

/**
 * Whether the name in the address bar is one of this server's: an address, a single name (the PC's name,
 * or one set up on the router), a home-network name (.local, .lan, .home...), or one listed in the config.
 * A web page on the internet can't point a name of its own here and get answers.
 */
export function allowedHost(host: string | undefined) {
  if (!host) return false;
  if (config.hosts.includes('*')) return true;
  const name = host.toLowerCase().replace(/:\d+$/, '').replace(/^\[(.*)\]$/, '$1');
  if (ipv4(name) !== null || name.includes(':')) return true;
  if (!name.includes('.') || name === hostname().toLowerCase()) return true;
  if (/\.(localhost|local|lan|home|internal|home\.arpa|test)$/.test(name)) return true;
  return config.hosts.includes(name);
}

/** A request sent by another site's page (browsers say where a request comes from). */
function fromElsewhere(req: IncomingMessage) {
  const origin = req.headers.origin;
  if (!origin) return req.headers['sec-fetch-site'] === 'cross-site';
  try {
    return new URL(origin).host.toLowerCase() !== String(req.headers.host).toLowerCase();
  } catch {
    return true;
  }
}

/** Visits turned away (by address), so each is mentioned once in the server window. */
const turnedAway = new Set<string>();

function noteTurnedAway(address: string, why: string) {
  if (turnedAway.size > 200 || turnedAway.has(address)) return;
  turnedAway.add(address);
  console.warn(`Turned away ${address}: ${why}`);
}

/** Checks every request: who's asking, by what name, and (for changes) from which page. */
export function guard(req: Request, res: Response, next: NextFunction) {
  const address = plain(req.socket.remoteAddress ?? '');
  if (!allowedAddress(address)) {
    noteTurnedAway(address, `not on the home network (access is "${config.access}" in data/config.json). If you didn't expect visitors from there, check the router isn't forwarding a port to this PC.`);
    res.status(403).type('text').send('Doodlearium only answers devices on its home network.');
    return;
  }
  if (!allowedHost(req.headers.host)) {
    noteTurnedAway(address, `asked for it as "${req.headers.host}". If that's a name you use for it, add it to "hosts" in data/config.json.`);
    res.status(403).type('text').send(`Doodlearium doesn't answer to the name "${req.headers.host}". Add it to "hosts" in data/config.json to use it.`);
    return;
  }
  if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && fromElsewhere(req)) {
    res.status(403).json({ error: "Changes can only come from Doodlearium's own pages." });
    return;
  }
  next();
}

/** The same checks for a screen's live connection. */
export function allowedSocket(req: IncomingMessage) {
  return allowedAddress(req.socket.remoteAddress) && allowedHost(req.headers.host) && !fromElsewhere(req);
}

/** Headers that stop other sites showing the pages inside theirs, and browsers second-guessing file types. */
export function securityHeaders(_req: Request, res: Response, next: NextFunction) {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'SAMEORIGIN',
    'Content-Security-Policy': "frame-ancestors 'self'; object-src 'none'; base-uri 'self'",
    'Referrer-Policy': 'same-origin',
  });
  next();
}

/** At most `count` requests per `seconds` from each address (for the ones a flood would hurt). */
export function rateLimit(count: number, seconds: number, message = 'Slow down a little, then try again.') {
  const hits = new Map<string, number[]>();
  return (req: Request, res: Response, next: NextFunction) => {
    const now = Date.now();
    const key = plain(req.socket.remoteAddress ?? '');
    const recent = (hits.get(key) ?? []).filter((t) => now - t < seconds * 1000);
    if (recent.length >= count) {
      res.status(429).json({ error: message });
      return;
    }
    recent.push(now);
    hits.set(key, recent);
    if (hits.size > 1000) hits.clear();
    next();
  };
}

/** When each address last got the PIN wrong: a few tries, then a wait (even for the right one). */
const wrongPins = new Map<string, number[]>();
const PIN_TRIES = 5;
const PIN_WAIT_MS = 5 * 60_000;

/** Big changes need the grown-up PIN (when one is set). The pages ask for it and send it along. */
export function requirePin(req: Request, res: Response, next: NextFunction) {
  if (!config.pin) return next();
  const key = plain(req.socket.remoteAddress ?? '');
  const now = Date.now();
  const wrong = (wrongPins.get(key) ?? []).filter((t) => now - t < PIN_WAIT_MS);
  if (wrong.length >= PIN_TRIES) {
    res.status(429).json({ error: 'Too many wrong PINs: wait a few minutes, then try again.' });
    return;
  }
  const given = req.headers['x-doodlearium-pin'];
  if (given === config.pin) return next();
  if (given) {
    wrong.push(now);
    wrongPins.set(key, wrong);
  }
  res.status(401).json({ error: given ? 'That PIN is not right.' : 'This needs the grown-up PIN.', pin: true });
}

/** A line for the server window about who it answers. */
export function accessNote() {
  const pin = config.pin ? 'a grown-up PIN is set' : 'no grown-up PIN (set "pin" in data/config.json)';
  const who = { home: 'devices on your home network', subnet: "devices on this PC's own network", anywhere: 'anyone who can reach it' }[config.access];
  return `  answering ${who}; ${pin}`;
}
