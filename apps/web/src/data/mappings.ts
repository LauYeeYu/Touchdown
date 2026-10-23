// Spreadsheet layouts the user confirmed on the Import page, remembered in this browser by the file's headers
// (docs/21, "Source: any spreadsheet"). A convenience: without it the columns are worked out again.

import type { ColumnField, RowKind } from "@touchdown/core";

const KEY = "td-mapping:";

export function savedMapping(signature: string): { kind: RowKind; fields: ColumnField[] } | null {
  try {
    const m = JSON.parse(localStorage.getItem(KEY + signature) ?? "null") as { kind?: string; fields?: unknown } | null;
    return m && (m.kind === "sightings" || m.kind === "flights") && Array.isArray(m.fields) ? (m as { kind: RowKind; fields: ColumnField[] }) : null;
  } catch {
    return null;
  }
}

export function saveMapping(signature: string, m: { kind: RowKind; fields: ColumnField[] }): void {
  try {
    localStorage.setItem(KEY + signature, JSON.stringify(m));
  } catch {
    /* storage unavailable: the columns are worked out again next time */
  }
}
