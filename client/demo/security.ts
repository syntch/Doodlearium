/**
 * Stands in for server/security.ts in the browser-only demo. There, the "server" is the page itself and
 * the only one asking is whoever's looking at it: there's nobody to keep out, slow down or ask for a PIN.
 */
type Next = () => void;
const letThrough = (_req: unknown, _res: unknown, next: Next) => next();

export const rateLimit = (_count: number, _seconds: number, _message?: string) => letThrough;
export const requirePin = letThrough;
export const allowedSocket = () => true;
