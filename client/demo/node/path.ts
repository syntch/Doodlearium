/** Node's path.join, for the server's code running in the page (where there's no folder it starts from). */
export function join(...parts: (string | undefined)[]) {
  const out: string[] = [];
  for (const part of parts.flatMap((p) => (p ?? '').split(/[\\/]+/))) {
    if (!part || part === '.') continue;
    if (part === '..') out.pop();
    else out.push(part);
  }
  return out.join('/');
}
