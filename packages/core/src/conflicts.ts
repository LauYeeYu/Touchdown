// What sync lists for the user, and how (docs/12, "Sync algorithm" and "Settling what two devices made"). A field
// edited on two devices is listed only when the user could have set it: values the app works out again (an
// aircraft's provisional facts, a record's aircraft link) and bookkeeping are left to the later version and to the
// app, which works them out again.

import { ulidFrom } from "./ids.ts";
import type { TableName } from "./schema/tables.ts";
import type { Store } from "./store.ts";
import { toUtcIso } from "./time/index.ts";

/** Tables the app keeps by itself: edits on two devices are never the user's to settle. */
const KEPT_BY_THE_APP = new Set<string>(["record_history", "sync_conflicts", "import_batches", "field_provenance", "external_ids", "tracks", "track_points", "issue_ack_records", "registration_periods", "operator_periods"]);

/** Where a record came from in an import: bookkeeping, not the record. */
const IMPORT_COLUMNS = new Set(["sourceKind", "sourceBatchId", "sourceRow"]);

/** Where this device keeps the log: each device records its own. */
const STORAGE_SETTINGS = new Set(["storageBackend", "storageAdapter", "storageLocation", "storageAccount"]);

function setByUser(store: Store, table: string, recordId: string, field: string): boolean {
  return store.all("field_provenance").some((p) => p.ownerTable === table && p.ownerId === recordId && p.field === field && p.source === "user");
}

/** Whether a field edited on two devices is listed for the user to choose. */
export function conflictMatters(store: Store, table: string, recordId: string, field: string): boolean {
  if (KEPT_BY_THE_APP.has(table)) return false;
  if (table === "flights" || table === "sightings") {
    if (IMPORT_COLUMNS.has(field)) return false;
    // The aircraft link is worked out from the registration, unless the user set it.
    if (field === "airframeId") return setByUser(store, table, recordId, "airframeId");
    return true;
  }
  if (table === "airframes") {
    // A provisional aircraft's facts are worked out from its records, and one with no records is removed by itself.
    if (field === "deleted") return store.all("field_provenance").some((p) => p.ownerTable === "airframes" && p.ownerId === recordId && p.source === "user");
    return setByUser(store, table, recordId, field);
  }
  if (table === "settings") return !STORAGE_SETTINGS.has(field);
  return true;
}

export interface ListedConflict {
  tableName: TableName;
  recordId: string;
  field: string;
  kept: unknown;
  other: unknown;
  /** The versions the two values come from, for who made them and when. */
  keptRow: Record<string, unknown> | null;
  otherRow: Record<string, unknown> | null;
  /** What makes this conflict the same on every device that finds it (the rows it comes from). */
  seed: string;
  now: number;
}

/**
 * List a value the app could not settle by itself, once: every device that finds it makes the same id from `seed`.
 * Returns whether it was new.
 */
export function listConflict(store: Store, c: ListedConflict): boolean {
  if (!conflictMatters(store, c.tableName, c.recordId, c.field)) return false;
  const at = Math.max(Date.parse(String(c.keptRow?.updatedAt)) || 0, Date.parse(String(c.otherRow?.updatedAt)) || 0);
  const id = ulidFrom(at, `${c.tableName}|${c.recordId}|${c.field}|${c.seed}`);
  if (store.peek("sync_conflicts", id)) return false;
  store.insert(
    "sync_conflicts",
    {
      tableName: c.tableName,
      recordId: c.recordId,
      field: c.field,
      keptValue: JSON.stringify(c.kept ?? null),
      otherValue: JSON.stringify(c.other ?? null),
      keptBy: c.keptRow ? String(c.keptRow.updatedBy) : null,
      keptAt: c.keptRow ? String(c.keptRow.updatedAt) : null,
      otherBy: c.otherRow ? String(c.otherRow.updatedBy) : null,
      otherAt: c.otherRow ? String(c.otherRow.updatedAt) : null,
      detectedAt: toUtcIso(c.now),
    },
    id,
  );
  return true;
}
