/**
 * Typed-in text, made safe to show anywhere: no invisible control or direction-flipping characters (which
 * can make a name read backwards or hide what follows it), spaces run together, and at most `max`
 * characters (counting an emoji as one, so it's never cut in half). Line breaks stay with `lines`.
 */
export function cleanText(value: unknown, fallback: string, max = 40, lines = false) {
  if (typeof value !== 'string') return fallback;
  let text = value.normalize('NFC').replace(/\r\n?/g, '\n');
  // Zero-width joiners stay: they hold emoji like 👨‍👩‍👧 together.
  text = text.replace(/(?!‍)[\p{Cc}\p{Cf}\p{Co}\p{Cn}]/gu, (c) => (c === '\n' || c === '\t' ? c : ''));
  text = lines
    ? text.replace(/[^\S\n]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n')
    : text.replace(/\s+/g, ' ');
  return [...text.trim()].slice(0, max).join('').trim() || fallback;
}
