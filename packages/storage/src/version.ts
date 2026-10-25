// Row versions for sync (docs/12, "Sync algorithm").

import { includesVector, rowVersion } from "@touchdown/core";
import type { StoredRow } from "./types.ts";

export const versionOf = (row: StoredRow) => rowVersion(row);

/** Last writer wins: the later `updatedAt`, then `updatedBy`, then `rev` (two edits on one device within a second). */
export function isNewer(a: StoredRow, b: StoredRow): boolean {
  const at = String(a.updatedAt ?? "");
  const bt = String(b.updatedAt ?? "");
  if (at !== bt) return at > bt;
  const ab = String(a.updatedBy ?? "");
  const bb = String(b.updatedBy ?? "");
  if (ab !== bb) return ab > bb;
  return Number(a.rev ?? 0) > Number(b.rev ?? 0);
}

/**
 * Whether `later` was made on top of `earlier`: its version vector includes every edit of the other's, and more. For a
 * row last written before version vectors existed: it names `earlier` as the other device's version it was edited
 * from, or both come from one device, whose versions of a row follow one another.
 */
export function isBasedOn(later: StoredRow, earlier: StoredRow): boolean {
  const vectors = includesVector(later.versionVector, earlier.versionVector);
  if (vectors !== null) return vectors && !includesVector(earlier.versionVector, later.versionVector);
  if (later.basedOn != null && later.basedOn === versionOf(earlier)) return true;
  return later.updatedBy === earlier.updatedBy && isNewer(later, earlier);
}
