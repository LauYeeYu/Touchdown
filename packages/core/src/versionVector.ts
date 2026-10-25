// Version vectors (docs/12, "Sync algorithm"): for each device, how many of its edits a version of a row includes.
// Stored as text in the `versionVector` system column, "dev_a=3,cli_b=1", devices in order. A version that includes
// every edit another version includes was made on top of it; two versions that each lack an edit of the other were
// made side by side. Clocks play no part.

export type VersionVector = Map<string, number>;

export function parseVector(text: unknown): VersionVector {
  const out: VersionVector = new Map();
  if (typeof text !== "string") return out;
  for (const part of text.split(",")) {
    const at = part.lastIndexOf("=");
    const n = Number(part.slice(at + 1));
    if (at > 0 && Number.isInteger(n) && n > 0) out.set(part.slice(0, at), n);
  }
  return out;
}

export function formatVector(v: VersionVector): string {
  return [...v.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([d, n]) => `${d}=${n}`)
    .join(",");
}

/** The vector of a new version made by `device` on top of the given ones. */
export function nextVector(device: string, ...on: unknown[]): string {
  const out: VersionVector = new Map();
  for (const text of on) for (const [d, n] of parseVector(text)) out.set(d, Math.max(out.get(d) ?? 0, n));
  out.set(device, (out.get(device) ?? 0) + 1);
  return formatVector(out);
}

/**
 * Whether the version with vector `a` includes every edit of the one with `b`. Null when either has none (a row last
 * written before version vectors existed): then only `basedOn` can tell.
 */
export function includesVector(a: unknown, b: unknown): boolean | null {
  if (typeof a !== "string" || typeof b !== "string" || !a || !b) return null;
  const va = parseVector(a);
  for (const [d, n] of parseVector(b)) if ((va.get(d) ?? 0) < n) return false;
  return true;
}
