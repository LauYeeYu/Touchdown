// Match, commit and undo (docs/21-import-export.md, stages 4–10 and "Undo").

import { looksLikeOperatorName, operatorFromOverride, type RefIndex } from "../ref/index.ts";
import type { Flight, FlightValues, Sighting, SightingValues } from "../schema/tables.ts";
import type { Store } from "../store.ts";
import type { Candidate, ParsedSource } from "./candidate.ts";
import { flightDay } from "../derive.ts";
import { addDays, instant, toUtcIso } from "../time/index.ts";
import { resolveAirframes } from "../identity/resolve.ts";

export type MatchKind = "new" | "identical" | "update" | "conflict" | "duplicate";

export interface FieldDiff {
  field: string;
  existing: unknown;
  incoming: unknown;
}

export interface Correction extends FieldDiff {
  reason: string;
}

export interface Match {
  candidate: Candidate;
  kind: MatchKind;
  existingId: string | null;
  fills: string[]; // fields empty in the existing record that the row fills
  conflicts: FieldDiff[];
  /** Fields the row corrects with evidence of its own (applied unless the user says otherwise). */
  corrections: Correction[];
  /** For "duplicate": index of the earlier row in this file it repeats (one sighting per aircraft, place and day). */
  duplicateOf: number | null;
}

const DAY_MS = 86_400_000;

/**
 * The existing record put the takeoff on the scheduled date; this row's boarding time shows the flight left
 * after midnight, a day later (docs/21, "Building date-times from clock times"). Take the row's takeoff and
 * landing.
 */
function afterMidnightCorrections(existing: Flight, incoming: Partial<FlightValues>): Correction[] {
  const board = instant(incoming.boardingAt);
  const newTake = instant(incoming.takeoffAt);
  const oldTake = instant(existing.takeoffAt);
  if (board === null || newTake === null || oldTake === null || existing.boardingAt) return [];
  if (Math.abs(newTake - oldTake - DAY_MS) > 2 * 60_000 || !(oldTake < board && board < newTake)) return [];
  const reason = `The flight left after midnight: boarding was at ${incoming.boardingAt!.slice(11, 16)} the evening before.`;
  const out: Correction[] = [{ field: "takeoffAt", existing: existing.takeoffAt, incoming: incoming.takeoffAt, reason }];
  const oldLand = instant(existing.landingAt);
  const newLand = instant(incoming.landingAt);
  if (oldLand !== null && newLand !== null && Math.abs(newLand - oldLand - DAY_MS) <= 2 * 60_000) {
    out.push({ field: "landingAt", existing: existing.landingAt, incoming: incoming.landingAt, reason });
  }
  return out;
}

// Bookkeeping fields that never count as a difference.
const IGNORE = new Set(["sourceKind", "sourceBatchId", "sourceRow", "airframeId"]);
// Raw columns follow their normalised field; a different spelling of the same value is not a conflict.
const RAW_OF: Record<string, string> = {
  airlineRaw: "airlineId",
  fromRaw: "fromAirportId",
  toRaw: "toAirportId",
  registrationRaw: "registration",
  typeCodeRaw: "typeCode",
  modelRaw: "model",
  operatorRaw: "operatorId",
  airportRaw: "airportId",
};

function sameValue(field: string, a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a === "string" && typeof b === "string") {
    if (field.endsWith("At")) {
      const ta = instant(a);
      const tb = instant(b);
      // Sources round to the minute differently.
      if (ta !== null && tb !== null) return Math.abs(ta - tb) <= 2 * 60_000;
    }
    return a.trim().toLowerCase() === b.trim().toLowerCase();
  }
  return false;
}

function flightKeys(v: Partial<FlightValues> | Flight): string[] {
  const date = v.scheduledDate ?? flightDay(v as Flight);
  if (!date) return [];
  const keys: string[] = [];
  // The scheduled date can differ from the takeoff date by one day between sources.
  for (const d of [date, addDays(date, -1), addDays(date, 1)]) {
    if (v.flightNumber && v.fromAirportId) keys.push(`fn|${d}|${v.flightNumber}|${v.fromAirportId}`);
    if (v.fromAirportId && v.toAirportId) keys.push(`rt|${d}|${v.fromAirportId}|${v.toAirportId}`);
  }
  return keys;
}

function primaryFlightKeys(v: Partial<FlightValues> | Flight): string[] {
  const date = v.scheduledDate ?? flightDay(v as Flight);
  if (!date) return [];
  const keys: string[] = [];
  if (v.flightNumber && v.fromAirportId) keys.push(`fn|${date}|${v.flightNumber}|${v.fromAirportId}`);
  if (v.fromAirportId && v.toAirportId) keys.push(`rt|${date}|${v.fromAirportId}|${v.toAirportId}`);
  return keys;
}

function sightingKey(v: Partial<SightingValues> | Sighting): string | null {
  if (!v.seenOn || !v.registration) return null;
  return `${v.seenOn}|${v.registration}|${v.airportId ?? v.airportRaw ?? ""}`;
}

/** Compare parsed rows with the records already stored (stage 4). */
export function matchCandidates(store: Store, candidates: Candidate[]): Match[] {
  const flightIndex = new Map<string, Flight>();
  for (const f of store.all("flights")) for (const k of primaryFlightKeys(f)) if (!flightIndex.has(k)) flightIndex.set(k, f);
  const sightingIndex = new Map<string, Sighting>();
  for (const s of store.all("sightings")) {
    const k = sightingKey(s);
    if (k && !sightingIndex.has(k)) sightingIndex.set(k, s);
  }
  const used = new Set<string>();
  const firstInFile = new Map<string, number>();
  return candidates.map((c, index) => {
    if (c.table === "sightings") {
      // One sighting per aircraft, place and day: a repeat within the file merges into the first row.
      const k = sightingKey(c.values);
      if (k) {
        const first = firstInFile.get(k);
        if (first !== undefined) return { candidate: c, kind: "duplicate", existingId: null, fills: [], conflicts: [], corrections: [], duplicateOf: first };
        firstInFile.set(k, index);
      }
    }
    let existing: Flight | Sighting | undefined;
    if (c.table === "flights") {
      for (const k of flightKeys(c.values)) {
        const hit = flightIndex.get(k);
        if (hit && !used.has(hit.id)) {
          existing = hit;
          break;
        }
      }
    } else {
      const k = sightingKey(c.values);
      const hit = k ? sightingIndex.get(k) : undefined;
      if (hit && !used.has(hit.id)) existing = hit;
    }
    if (!existing) return { candidate: c, kind: "new", existingId: null, fills: [], conflicts: [], corrections: [], duplicateOf: null };
    used.add(existing.id);
    const fills: string[] = [];
    const conflicts: FieldDiff[] = [];
    for (const [field, incoming] of Object.entries(c.values)) {
      if (IGNORE.has(field) || incoming === null || incoming === undefined || incoming === "") continue;
      const cur = (existing as Record<string, unknown>)[field];
      if (cur === null || cur === undefined || cur === "") fills.push(field);
      else if (!sameValue(field, cur, incoming)) {
        const normalised = RAW_OF[field];
        // A raw spelling that normalises to the same value is not a conflict.
        if (normalised && sameValue(normalised, (existing as Record<string, unknown>)[normalised], (c.values as Record<string, unknown>)[normalised])) continue;
        conflicts.push({ field, existing: cur, incoming });
      }
    }
    const corrections = c.table === "flights" ? afterMidnightCorrections(existing as Flight, c.values) : [];
    const corrected = new Set(corrections.map((x) => x.field));
    const rest = conflicts.filter((x) => !corrected.has(x.field));
    const kind: MatchKind = rest.length ? "conflict" : fills.length || corrections.length ? "update" : "identical";
    return { candidate: c, kind, existingId: existing.id, fills, conflicts: rest, corrections, duplicateOf: null };
  });
}

export interface CommitDecision {
  skip?: boolean;
  /** For conflicts: fields where the incoming value replaces the existing one. Default: keep existing. */
  takeIncoming?: string[];
  /** Corrections the user turned down: the existing value stays. */
  rejectCorrections?: string[];
  /** For a duplicate sighting: store it as its own sighting instead of merging it. */
  keepSeparate?: boolean;
}

export interface CommitResult {
  batchId: string;
  created: number;
  updated: number;
  skipped: number;
  merged: number; // repeated sightings folded into the first row
}

/**
 * Fold a repeated sighting (same aircraft, place and day) into the first one: empty fields are filled, a
 * different phase and any notes are kept in the notes, and photo notes (tags) are combined.
 */
function mergeSighting(store: Store, targetId: string, v: Partial<SightingValues>, tags: string[], batchId: string, now: number) {
  const cur = store.get("sightings", targetId);
  if (!cur) return;
  store.insert("record_history", {
    tableName: "sightings",
    recordId: cur.id,
    recordRev: cur.rev,
    row: cur as unknown as Record<string, unknown>,
    changedAt: toUtcIso(now),
    batchId,
    reason: "import",
  });
  const patch: Record<string, unknown> = {};
  for (const [k, val] of Object.entries(v)) {
    if (IGNORE.has(k) || val === null || val === undefined || val === "") continue;
    if ((cur as Record<string, unknown>)[k] === null) patch[k] = val;
  }
  const notes = [cur.notes];
  if (v.phase && cur.phase && v.phase !== cur.phase) notes.push(`Also ${v.phase.replace(/_/g, " ")}`);
  if (v.notes && v.notes !== cur.notes) notes.push(v.notes);
  const joined = [...new Set(notes.filter(Boolean))].join("; ");
  if (joined !== (cur.notes ?? "")) patch.notes = joined || null;
  if (Object.keys(patch).length) store.update("sightings", cur.id, patch as never);
  const have = new Set(store.all("sighting_tags").filter((t) => t.sightingId === cur.id).map((t) => t.tag));
  for (const tag of tags) if (!have.has(tag)) store.insert("sighting_tags", { sightingId: cur.id, tag });
}

/** Write accepted rows as one import batch (stage 10). Empty incoming fields never overwrite values. */
export function commitImport(
  store: Store,
  ref: RefIndex,
  source: ParsedSource,
  matches: Match[],
  decisions: Map<number, CommitDecision> = new Map(),
  opts: { fileHash?: string; now?: number } = {},
): CommitResult {
  return store.batch(() => {
    const now = opts.now ?? Date.now();
    const batch = store.insert("import_batches", {
      createdAt: toUtcIso(now),
      sourceKind: source.format === "fr24_csv" ? "fr24_csv" : "sheet",
      fileName: source.fileName,
      fileHash: opts.fileHash ?? null,
      mappingPreset: source.format,
      rowsRead: source.rowsRead,
      agentChecker: "none",
      status: "committed",
    });
    const result: CommitResult = { batchId: batch.id, created: 0, updated: 0, skipped: 0, merged: 0 };
    addNamedOperators(store, ref, matches.map((m) => m.candidate));
    const facts: { table: "flights" | "sightings"; id: string; facts: Candidate["airframeFacts"] }[] = [];
    const recordOf = new Map<number, string>();

    matches.forEach((m, i) => {
      const d = decisions.get(i) ?? {};
      if (m.kind === "identical" && m.existingId) recordOf.set(i, m.existingId);
      if (d.skip || m.kind === "identical") {
        result.skipped++;
        return;
      }
      const c = m.candidate;
      let id: string;
      const target = m.kind === "duplicate" && !d.keepSeparate && m.duplicateOf !== null ? recordOf.get(m.duplicateOf) : undefined;
      if (m.kind === "duplicate" && target && c.table === "sightings") {
        mergeSighting(store, target, c.values, c.tags, batch.id, now);
        recordOf.set(i, target);
        result.merged++;
        return;
      }
      if (m.kind === "new" || m.kind === "duplicate") {
        const row = store.insert(c.table, { ...c.values, sourceBatchId: batch.id } as never);
        id = row.id;
        result.created++;
      } else {
        const existing = store.get(c.table, m.existingId)!;
        store.insert("record_history", {
          tableName: c.table,
          recordId: existing.id,
          recordRev: existing.rev,
          row: existing as unknown as Record<string, unknown>,
          changedAt: toUtcIso(now),
          batchId: batch.id,
          reason: "import",
        });
        const patch: Record<string, unknown> = {};
        for (const f of m.fills) patch[f] = (c.values as Record<string, unknown>)[f];
        for (const x of m.corrections) if (!d.rejectCorrections?.includes(x.field)) patch[x.field] = x.incoming;
        for (const f of d.takeIncoming ?? []) patch[f] = (c.values as Record<string, unknown>)[f];
        store.update(c.table, existing.id, patch as never);
        id = existing.id;
        result.updated++;
      }
      recordOf.set(i, id);
      for (const e of c.external) {
        const dup = store.all("external_ids").some((x) => x.ownerId === id && x.system === e.system && x.key === e.key);
        if (!dup) store.insert("external_ids", { ownerTable: c.table, ownerId: id, ...e });
      }
      if (c.table === "sightings") {
        const have = new Set(store.all("sighting_tags").filter((t) => t.sightingId === id).map((t) => t.tag));
        for (const tag of c.tags) if (!have.has(tag)) store.insert("sighting_tags", { sightingId: id, tag });
      }
      if (Object.keys(c.airframeFacts).length) facts.push({ table: c.table, id, facts: c.airframeFacts });
    });

    store.update("import_batches", batch.id, {
      rowsAccepted: result.created + result.updated,
      rowsRejected: result.skipped,
      rowsEdited: 0,
    });

    resolveAirframes(store, ref);
    applyAirframeFacts(store, facts, source.fileName, now);
    return result;
  });
}

/**
 * An operator written by name that matches no reference operator ("Hyundai" for a company aircraft) is
 * added as the user's own operator, so its records are linked and counted instead of left unknown.
 */
function addNamedOperators(store: Store, ref: RefIndex, candidates: Candidate[]) {
  for (const c of candidates) {
    const isFlight = c.table === "flights";
    const raw = isFlight ? (c.values as Partial<FlightValues>).airlineRaw : (c.values as Partial<SightingValues>).operatorRaw;
    const id = isFlight ? (c.values as Partial<FlightValues>).airlineId : (c.values as Partial<SightingValues>).operatorId;
    if (id || !looksLikeOperatorName(raw)) continue;
    let op = ref.operatorByCode(raw);
    if (!op) {
      const row = store.insert("operator_overrides", { name: raw!.trim(), kind: "other" });
      op = operatorFromOverride(row);
      ref.addOperator(op);
    }
    if (isFlight) (c.values as Partial<FlightValues>).airlineId = op.id;
    else (c.values as Partial<SightingValues>).operatorId = op.id;
  }
}

/** Facts typed next to a record (the flight log's First Flight Date) belong to the airframe. */
function applyAirframeFacts(
  store: Store,
  facts: { table: "flights" | "sightings"; id: string; facts: Candidate["airframeFacts"] }[],
  fileName: string,
  now: number,
) {
  for (const f of facts) {
    const rec = store.get(f.table, f.id);
    const a = rec?.airframeId ? store.get("airframes", rec.airframeId) : null;
    if (!a) continue;
    if (f.facts.firstFlightDate && !a.firstFlightDate) {
      store.update("airframes", a.id, { firstFlightDate: f.facts.firstFlightDate });
      store.insert("field_provenance", {
        ownerTable: "airframes",
        ownerId: a.id,
        field: "firstFlightDate",
        source: "user",
        detail: fileName,
        recordedAt: toUtcIso(now),
      });
    }
  }
}

export interface UndoResult {
  removed: number;
  restored: number;
  editedSince: string[];
}

/**
 * Undo an import batch: tombstone the records it created and restore the versions it replaced. Records
 * edited after the import are listed and left alone unless `force` is set.
 */
export function undoImport(store: Store, ref: RefIndex, batchId: string, force = false): UndoResult {
  return store.batch(() => {
    const result: UndoResult = { removed: 0, restored: 0, editedSince: [] };
    const batch = store.get("import_batches", batchId);
    if (!batch || batch.status === "undone") return result;
    const batchTime = batch.createdAt ?? "";
    // User edits write a history row (reason "edit"); resolver and sync changes do not count.
    const editedLater = new Set(
      store
        .all("record_history")
        .filter((h) => h.reason === "edit" && (h.changedAt ?? "") >= batchTime)
        .map((h) => h.recordId),
    );
    const touchedLater = (r: { id: string }) => editedLater.has(r.id);
    for (const table of ["flights", "sightings"] as const) {
      for (const r of store.all(table)) {
        if (r.sourceBatchId !== batchId) continue;
        if (!force && touchedLater(r)) {
          result.editedSince.push(r.id);
          continue;
        }
        store.remove(table, r.id);
        for (const t of store.all("sighting_tags")) if (t.sightingId === r.id) store.remove("sighting_tags", t.id);
        for (const e of store.all("external_ids")) if (e.ownerId === r.id) store.remove("external_ids", e.id);
        result.removed++;
      }
    }
    for (const h of store.all("record_history")) {
      if (h.batchId !== batchId || h.reason !== "import" || !h.row) continue;
      const table = h.tableName as "flights" | "sightings";
      const cur = store.get(table, h.recordId);
      if (!cur) continue;
      if (!force && touchedLater(cur)) {
        result.editedSince.push(cur.id);
        continue;
      }
      const prev = h.row as Record<string, unknown>;
      const patch: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(prev)) if (!["id", "rev", "updatedAt", "updatedBy", "deleted"].includes(k)) patch[k] = v;
      store.update(table, cur.id, patch as never);
      result.restored++;
    }
    // Records edited since were left alone; the batch stays open so a forced undo can finish the job.
    if (!result.editedSince.length) store.update("import_batches", batchId, { status: "undone" });
    resolveAirframes(store, ref);
    return result;
  });
}
