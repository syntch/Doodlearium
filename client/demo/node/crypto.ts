/** The bits of Node's crypto the server's code uses, for running it in the page. */

export const randomUUID = (): string =>
  typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : // (Pages not served over https, other than from this computer, don't get randomUUID.)
      [...crypto.getRandomValues(new Uint8Array(16))].map((b, i) => (([4, 6, 8, 10].includes(i) ? '-' : '') + b.toString(16).padStart(2, '0'))).join('');

/**
 * The server uses a hash only to tell whether a pack or a world has changed since it was last exported, so
 * here a quick one will do (it isn't SHA-256, and isn't for secrets).
 */
export function createHash(_algorithm: string) {
  let text = '';
  return {
    update(more: string) {
      text += more;
      return this;
    },
    digest(_encoding: 'hex') {
      let hex = '';
      for (let seed = 1; seed <= 8; seed++) {
        let h = 0x811c9dc5 ^ (seed * 0x9e3779b1);
        for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193);
        hex += (h >>> 0).toString(16).padStart(8, '0');
      }
      return hex;
    },
  };
}
