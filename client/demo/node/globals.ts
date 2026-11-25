/**
 * The two things of Node's that the server's code expects to find lying around: `process` and `Buffer`.
 * Imported before any of the server's modules (see ../transport.ts), so they're there when those start.
 */

/** Bytes, with the few extras of Node's Buffer that the server uses. */
export class Bytes extends Uint8Array {
  equals(other: Uint8Array) {
    return this.length === other.length && this.every((b, i) => b === other[i]);
  }

  readUInt32BE(at: number) {
    return new DataView(this.buffer, this.byteOffset, this.byteLength).getUint32(at);
  }

  override toString(encoding?: string) {
    if (encoding !== 'base64') return new TextDecoder().decode(this);
    let text = '';
    for (let i = 0; i < this.length; i += 0x8000) text += String.fromCharCode(...this.subarray(i, i + 0x8000));
    return btoa(text);
  }
}

/** Buffer.from: text (as it is, or from base64) or a list of bytes. */
function from(value: string | ArrayLike<number>, encoding?: string) {
  if (typeof value !== 'string') return new Bytes(value);
  if (encoding !== 'base64') return new Bytes(new TextEncoder().encode(value));
  try {
    const text = atob(value.replace(/[^A-Za-z0-9+/]/g, ''));
    const bytes = new Bytes(text.length);
    for (let i = 0; i < text.length; i++) bytes[i] = text.charCodeAt(i);
    return bytes;
  } catch {
    return new Bytes(0);
  }
}

/** What the server does when it's told to stop (it saves the world): here, when the page is left. */
function once(signal: string, stop: () => void) {
  if (signal !== 'SIGTERM') return;
  addEventListener('pagehide', stop);
  document.addEventListener('visibilitychange', () => document.visibilityState === 'hidden' && stop());
}

Object.assign(globalThis, {
  Buffer: Object.assign(Bytes, { from }),
  process: { env: {}, once, exit: () => {} },
});
