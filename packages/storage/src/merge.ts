// Merging two versions of a row made side by side (docs/12, "Sync algorithm"), field by field, as a spreadsheet
// merges cells. Against the version both started from: a field changed on one device takes that change; a field
// changed on both to different values is a conflict, kept as the later version has it and listed for the user. Notes
// are merged as text, as a shared document is, when the two edits touch different words. An entry deleted on one
// device and edited on the other stays, with the edits, and the deletion is a conflict. Without the version both
// started from, every field that differs is a conflict.

import { TABLES, type TableName } from "@touchdown/core";
import type { StoredRow } from "./types.ts";

/** Free text, merged word by word. */
const TEXT = new Set(["notes", "note"]);

export interface FieldConflict {
  /** A column, or "deleted" for an entry deleted on one device and edited on the other. */
  field: string;
  kept: unknown;
  other: unknown;
  /** Whether the value kept is this device's. */
  keptMine: boolean;
}

export interface RowMerge {
  /** Every column of the table, and `deleted`. */
  values: Record<string, unknown>;
  conflicts: FieldConflict[];
}

export const sameValue = (a: unknown, b: unknown) => (a ?? null) === (b ?? null) || JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/** The table's own columns: what an edit changes. */
export const dataFields = (table: TableName): string[] => TABLES[table].columns.map((c) => c.name);

/** Merge `mine` and `theirs`, made side by side from `base` (null when not known). */
export function mergeRow(table: TableName, base: StoredRow | null, mine: StoredRow, theirs: StoredRow, mineLater: boolean): RowMerge {
  const values: Record<string, unknown> = {};
  const conflicts: FieldConflict[] = [];
  const fields = dataFields(table);
  for (const f of fields) {
    const m = mine[f] ?? null;
    const t = theirs[f] ?? null;
    if (sameValue(m, t)) {
      values[f] = m;
      continue;
    }
    if (base) {
      const b = base[f] ?? null;
      if (sameValue(m, b)) {
        values[f] = t;
        continue;
      }
      if (sameValue(t, b)) {
        values[f] = m;
        continue;
      }
      if (TEXT.has(f) && (b === null || typeof b === "string") && (m === null || typeof m === "string") && (t === null || typeof t === "string")) {
        const text = mergeText(b ?? "", m ?? "", t ?? "");
        if (text !== null) {
          values[f] = text || null;
          continue;
        }
      }
    }
    values[f] = mineLater ? m : t;
    conflicts.push({ field: f, kept: values[f], other: mineLater ? t : m, keptMine: mineLater });
  }

  const md = !!mine.deleted;
  const td = !!theirs.deleted;
  if (md === td) values.deleted = md;
  else {
    const live = md ? theirs : mine;
    // Restored on one device: it stays restored.
    if (base && !!base.deleted) values.deleted = false;
    // Deleted on one device, untouched on the other: deleted.
    else if (base && fields.every((f) => sameValue(live[f], base[f]))) values.deleted = true;
    else {
      values.deleted = false;
      conflicts.push({ field: "deleted", kept: false, other: true, keptMine: !md });
    }
  }
  return { values, conflicts };
}

// ---------- text ----------

interface Hunk {
  /** The base's words start..end are replaced by `words`. */
  start: number;
  end: number;
  words: string[];
}

const words = (s: string) => s.match(/\s+|\S+/g) ?? [];

/** The changes that turn `a` into `b`, from their longest common subsequence. Null when too long to compare. */
function hunks(a: string[], b: string[]): Hunk[] | null {
  const n = a.length;
  const m = b.length;
  if (n * m > 1_000_000) return null;
  const lcs = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) lcs[i]![j] = a[i] === b[j] ? lcs[i + 1]![j + 1]! + 1 : Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!);
  const out: Hunk[] = [];
  let cur: Hunk | null = null;
  let i = 0;
  let j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && a[i] === b[j]) {
      if (cur) out.push(cur);
      cur = null;
      i++;
      j++;
    } else if (j < m && (i === n || lcs[i]![j + 1]! >= lcs[i + 1]![j]!)) {
      cur ??= { start: i, end: i, words: [] };
      cur.words.push(b[j]!);
      j++;
    } else {
      cur ??= { start: i, end: i, words: [] };
      cur.end = i + 1;
      i++;
    }
  }
  if (cur) out.push(cur);
  return out;
}

/** Whether two changes touch the same words of the base (an insertion touches the words on either side of it). */
function touch(x: Hunk, y: Hunk): boolean {
  if (x.start === x.end || y.start === y.end) {
    const [p, r] = x.start === x.end ? [x.start, y] : [y.start, x];
    return r.start <= p && p <= r.end;
  }
  return x.start < y.end && y.start < x.end;
}

const sameHunk = (x: Hunk, y: Hunk) => x.start === y.start && x.end === y.end && x.words.join("") === y.words.join("");

/** Both edits of a text applied to it, when they change different words; null when they overlap. */
export function mergeText(base: string, mine: string, theirs: string): string | null {
  const b = words(base);
  const hm = hunks(b, words(mine));
  const ht = hunks(b, words(theirs));
  if (!hm || !ht) return null;
  const all = [...hm];
  for (const y of ht) {
    if (hm.some((x) => sameHunk(x, y))) continue;
    if (hm.some((x) => touch(x, y))) return null;
    all.push(y);
  }
  const out = [...b];
  for (const h of all.sort((x, y) => y.start - x.start)) out.splice(h.start, h.end - h.start, ...h.words);
  return out.join("");
}
