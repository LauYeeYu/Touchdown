// Spreadsheet layouts the user confirmed on the Import page, remembered in this browser by the file's headers
// (docs/21, "Source: any spreadsheet"). A convenience: without it the columns are worked out again.

import type { ColumnField, RowKind } from "@touchdown/core";
import { localJson, setLocalValue } from "../lib/localValue.ts";

const KEY = "td-mapping:";

export function savedMapping(signature: string): { kind: RowKind; fields: ColumnField[] } | null {
  const m = localJson<{ kind?: string; fields?: unknown }>(KEY + signature);
  return m && (m.kind === "sightings" || m.kind === "flights") && Array.isArray(m.fields) ? (m as { kind: RowKind; fields: ColumnField[] }) : null;
}

export function saveMapping(signature: string, m: { kind: RowKind; fields: ColumnField[] }): void {
  setLocalValue(KEY + signature, JSON.stringify(m));
}
