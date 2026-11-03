/** Which is newer: compares the numbers in two versions in turn (1.10 is newer than 1.9). */
export function compareVersions(a: string, b: string) {
  const na = a.match(/\d+/g)?.map(Number) ?? [];
  const nb = b.match(/\d+/g)?.map(Number) ?? [];
  for (let i = 0; i < Math.max(na.length, nb.length); i++) {
    const diff = (na[i] ?? 0) - (nb[i] ?? 0);
    if (diff) return Math.sign(diff);
  }
  return a.localeCompare(b);
}
