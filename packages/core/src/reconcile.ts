// Settling what two devices made side by side (docs/12, "Settling what two devices made"). Sync merges versions of
// one row; this settles rows that mean the same thing but were made twice, once on each device before either saw the
// other's: the same file imported on both, an operator or a family choice added on both, a finding accepted on both,
// a tag added on both, two tracks for one flight. Every device settles them the same way (the earlier or the smaller
// id stays), so the result syncs without new conflicts. Nothing is dropped: what is kept takes the other's values
// where it has none, and a value set differently on each is listed for the user (conflicts.ts).

import { conflictMatters, listConflict } from "./conflicts.ts";
import { toUtcIso } from "./time/index.ts";
import { resolveAirframes, type ResolveResult } from "./identity/resolve.ts";
import { settlePhases } from "./phases.ts";
import { refOverridesOf } from "./edit.ts";
import type { RefIndex } from "./ref/index.ts";
import { TABLES, type TableName } from "./schema/tables.ts";
import { rowVersion, type Store } from "./store.ts";

export interface ReconcileReport {
  /** Rows made twice and merged into one. */
  merged: number;
  /** Saved views given a new name, two having had the same. */
  renamed: number;
  /** Entries deleted on one device and added to on another, kept and listed. */
  restored: number;
}

type Values = Record<string, unknown>;

const SYSTEM = new Set(["id", "rev", "updatedAt", "updatedBy", "basedOn", "versionVector", "deleted"]);
const byId = (a: { id: string }, b: { id: string }) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
const same = (a: unknown, b: unknown) => (a ?? null) === (b ?? null);
const fields = (table: TableName) => TABLES[table].columns.map((c) => c.name as string);
const norm = (s: string | null | undefined) => (s ?? "").trim().toLowerCase().replace(/\s+/g, " ");

/** Later of two versions, as sync orders them: `updatedAt`, then `updatedBy`, then `rev`. */
function later(a: Values, b: Values): boolean {
  if (a.updatedAt !== b.updatedAt) return String(a.updatedAt) > String(b.updatedAt);
  if (a.updatedBy !== b.updatedBy) return String(a.updatedBy) > String(b.updatedBy);
  return Number(a.rev) > Number(b.rev);
}

/** Rows of `table` grouped by `key` (null leaves a row out), each group in id order. */
function groupsOf<N extends TableName>(store: Store, table: N, key: (r: Values) => string | null): Values[][] {
  const out = new Map<string, Values[]>();
  for (const r of store.all(table) as unknown as Values[]) {
    const k = key(r);
    if (k === null) continue;
    out.set(k, [...(out.get(k) ?? []), r]);
  }
  return [...out.values()].filter((g) => g.length > 1).map((g) => g.sort(byId as never));
}

/**
 * Fold `from` into `into` (rows of one table): `into` takes the values it has none of, and each value set differently
 * on the two is listed, `into`'s kept. `from` is removed.
 */
function fold(store: Store, table: TableName, into: Values, from: Values, now: number, listed = fields(table)) {
  const patch: Values = {};
  for (const f of fields(table)) {
    if (SYSTEM.has(f) || same(into[f], from[f])) continue;
    if (into[f] == null) patch[f] = from[f];
    else if (from[f] != null && listed.includes(f)) listConflict(store, { tableName: table, recordId: String(into.id), field: f, kept: into[f], other: from[f], keptRow: into, otherRow: from, seed: String(from.id), now });
  }
  if (Object.keys(patch).length) store.update(table, String(into.id), patch as never);
  store.remove(table, String(from.id));
}

/** Point every reference to `from` at `into`. */
function repoint(store: Store, refs: [TableName, string][], from: string, into: string) {
  for (const [table, column] of refs) {
    for (const r of store.all(table) as unknown as Values[]) if (r[column] === from) store.update(table, String(r.id), { [column]: into } as never);
  }
}

/** The data of a record, without its id, system columns, import bookkeeping and aircraft link (worked out again). */
function recordData(table: TableName, r: Values): string {
  return JSON.stringify(fields(table).filter((f) => !["sourceBatchId", "sourceKind", "airframeId"].includes(f)).map((f) => r[f] ?? null));
}

/**
 * The same file imported on two devices: two committed batches of one file name, kind and size. A record the later
 * batch made that the earlier one made too (the same row of the file, the same values) goes, its tags and photos and
 * track moving to the earlier one's record. Records that differ stay, and the duplicate checks list them.
 */
function sameFileImportedTwice(store: Store, report: ReconcileReport) {
  const batches = store.all("import_batches").filter((b) => b.status === "committed" && b.fileName && b.mappingPreset !== "touchdown_changes");
  const groups = new Map<string, typeof batches>();
  for (const b of batches) {
    const k = `${b.fileName}|${b.mappingPreset}|${b.rowsRead}`;
    groups.set(k, [...(groups.get(k) ?? []), b]);
  }
  for (const list of groups.values()) {
    if (list.length < 2) continue;
    list.sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)) || byId(a, b));
    const [first, ...rest] = list;
    for (const table of ["flights", "sightings"] as const) {
      const kept = new Map<string, Values>();
      for (const r of store.all(table) as unknown as Values[]) if (r.sourceBatchId === first!.id && r.sourceRow != null) kept.set(`${r.sourceRow}|${recordData(table, r)}`, r);
      for (const b of rest) {
        for (const r of store.all(table) as unknown as Values[]) {
          if (r.sourceBatchId !== b.id || r.sourceRow == null) continue;
          const twin = kept.get(`${r.sourceRow}|${recordData(table, r)}`);
          if (!twin) continue;
          const to = String(twin.id);
          const from = String(r.id);
          for (const t of store.all("sighting_tags")) if (t.sightingId === from) store.update("sighting_tags", t.id, { sightingId: to });
          for (const p of store.all("sighting_phases")) if (p.sightingId === from) store.update("sighting_phases", p.id, { sightingId: to });
          for (const p of store.all("photo_links")) if (p.ownerId === from) store.update("photo_links", p.id, { ownerId: to });
          for (const e of store.all("external_ids")) if (e.ownerId === from) store.update("external_ids", e.id, { ownerId: to });
          for (const t of store.all("tracks")) if (t.flightId === from) store.update("tracks", t.id, { flightId: to });
          store.remove(table, from);
          report.merged++;
        }
      }
    }
  }
}

/** The user's own operator added on two devices (by name, or by code): one stays, and every record points at it. */
function operatorsAddedTwice(store: Store, now: number, report: ReconcileReport) {
  const key = (o: Values) => (o.icao ? `icao:${String(o.icao).toUpperCase()}` : o.iata ? `iata:${String(o.iata).toUpperCase()}` : o.name ? `name:${norm(String(o.name))}` : null);
  for (const [into, ...rest] of groupsOf(store, "operator_overrides", key)) {
    for (const from of rest) {
      repoint(store, [["flights", "airlineId"], ["flights", "operatingAirlineId"], ["sightings", "operatorId"], ["operator_periods", "operatorId"]], String(from.id), String(into!.id));
      // A name written in other capitals or spacing is the same name: the first spelling stays.
      const sameName = norm(String(into!.name ?? "")) === norm(String(from.name ?? ""));
      fold(store, "operator_overrides", into!, from, now, fields("operator_overrides").filter((f) => !(sameName && f === "name")));
      report.merged++;
    }
  }
}

/** A type moved to a family on two devices: the later choice stays, and a different one is listed. */
function familiesChosenTwice(store: Store, now: number, report: ReconcileReport) {
  for (const group of groupsOf(store, "family_overrides", (o) => (o.designator ? String(o.designator) : null))) {
    const into = group.reduce((a, b) => (later(b, a) ? b : a));
    for (const from of group) {
      if (from === into) continue;
      if (!same(into.familyId, from.familyId)) listConflict(store, { tableName: "family_overrides", recordId: String(into.id), field: "familyId", kept: into.familyId, other: from.familyId, keptRow: into, otherRow: from, seed: String(from.id), now });
      store.remove("family_overrides", String(from.id));
      report.merged++;
    }
  }
}

/** A finding accepted on two devices: one acceptance stays, with both notes. */
function findingsAcceptedTwice(store: Store, report: ReconcileReport) {
  for (const [into, ...rest] of groupsOf(store, "issue_acks", (a) => (a.ruleId && a.fingerprint ? `${a.ruleId}|${a.fingerprint}` : null))) {
    const notes = [into!.note, ...rest.map((r) => r.note)].filter((n): n is string => typeof n === "string" && !!n.trim());
    const note = [...new Set(notes)].join("; ") || null;
    if (!same(note, into!.note)) store.update("issue_acks", String(into!.id), { note });
    for (const from of rest) {
      for (const r of store.all("issue_ack_records")) if (r.ackId === from.id) store.remove("issue_ack_records", r.id);
      store.remove("issue_acks", String(from.id));
      report.merged++;
    }
  }
}

/** Rows of child tables made twice with the same meaning: the first stays, taking the values it has none of. */
function childrenAddedTwice(store: Store, now: number, report: ReconcileReport) {
  const keys: [TableName, (r: Values) => string | null][] = [
    ["sighting_tags", (r) => (r.tag ? `${r.sightingId}|${r.tag}` : null)],
    ["sighting_phases", (r) => `${r.sightingId}|${r.phase}`],
    ["photo_links", (r) => (r.url ? `${r.ownerTable}|${r.ownerId}|${r.url}` : null)],
    ["registration_periods", (r) => `${r.airframeId}|${r.registration}|${r.validFrom}|${r.validTo}`],
    ["operator_periods", (r) => `${r.airframeId}|${r.operatorId}|${r.validFrom}|${r.validTo}`],
    ["external_ids", (r) => `${r.ownerTable}|${r.ownerId}|${r.system}|${r.key}|${r.value}`],
    ["field_provenance", (r) => `${r.ownerTable}|${r.ownerId}|${r.field}|${r.source}|${r.detail}`],
    ["saved_view_filters", (r) => `${r.viewId}|${r.dimension}|${r.operator}|${r.value}`],
    ["issue_ack_records", (r) => `${r.ackId}|${r.tableName}|${r.recordId}`],
  ];
  for (const [table, key] of keys) {
    for (const [into, ...rest] of groupsOf(store, table, key)) {
      // Labels and the like: the first one's stay, and nothing about them is the user's to settle.
      for (const from of rest) {
        fold(store, table, into!, from, now, table === "photo_links" ? ["label"] : []);
        report.merged++;
      }
    }
  }
}

/** Two saved views of one name: the first keeps it, the others are numbered, "Name (2)". */
function viewsNamedTwice(store: Store, report: ReconcileReport) {
  const taken = new Set(store.all("saved_views").map((v) => norm(v.name)));
  for (const [, ...rest] of groupsOf(store, "saved_views", (v) => (v.name ? norm(String(v.name)) : null))) {
    for (const v of rest) {
      let n = 2;
      while (taken.has(norm(`${v.name} (${n})`))) n++;
      const name = `${String(v.name).trim()} (${n})`;
      taken.add(norm(name));
      store.update("saved_views", String(v.id), { name });
      report.renamed++;
    }
  }
}

/** A track attached to one flight on two devices: the better one stays (complete, more points, newer), with its points. */
function tracksAttachedTwice(store: Store, report: ReconcileReport) {
  const rank = (t: Values) => [t.coverage === "complete" ? 1 : 0, Number(t.pointCount ?? 0), String(t.importedAt ?? "")] as const;
  for (const group of groupsOf(store, "tracks", (t) => String(t.flightId))) {
    const best = group.reduce((a, b) => {
      const [ra, rb] = [rank(a), rank(b)];
      for (let i = 0; i < ra.length; i++) if (ra[i] !== rb[i]) return ra[i]! > rb[i]! ? a : b;
      return a;
    });
    for (const t of group) {
      if (t === best) continue;
      store.purge("track_points", store.all("track_points").filter((p) => p.trackId === t.id).map((p) => `${p.trackId}|${p.seq}`));
      store.remove("tracks", String(t.id));
      report.merged++;
    }
  }
}

/**
 * Rows whose parent went on another device. Registrations and operators of a deleted aircraft go too. A tag, status or
 * photo link added to an entry deleted elsewhere, after the deletion and on another device, keeps the entry, and the
 * deletion is listed; older leftovers are left alone. A record linked by hand to an aircraft deleted elsewhere is
 * linked again from its registration.
 */
function orphans(store: Store, now: number, report: ReconcileReport) {
  const gone = (table: TableName, id: unknown) => {
    const row = store.peek(table, String(id)) as Values | null;
    return row && row.deleted ? row : null;
  };
  for (const table of ["registration_periods", "operator_periods"] as const) {
    for (const p of store.all(table)) if (gone("airframes", p.airframeId)) store.remove(table, p.id);
  }
  const children: { table: "flights" | "sightings"; id: string; child: Values }[] = [
    ...store.all("sighting_tags").map((t) => ({ table: "sightings" as const, id: t.sightingId, child: t as unknown as Values })),
    ...store.all("sighting_phases").map((p) => ({ table: "sightings" as const, id: p.sightingId, child: p as unknown as Values })),
    ...store.all("photo_links").map((p) => ({ table: p.ownerTable, id: p.ownerId, child: p as unknown as Values })),
  ];
  for (const { table, id, child } of children) {
    const parent = gone(table, id);
    if (!parent || child.updatedBy === parent.updatedBy || String(child.updatedAt) < String(parent.updatedAt)) continue;
    store.restore(table, id, parent);
    listConflict(store, { tableName: table, recordId: id, field: "deleted", kept: false, other: true, keptRow: child, otherRow: parent, seed: `deleted|${rowVersion(parent)}`, now });
    report.restored++;
  }
  for (const p of store.all("field_provenance")) {
    if (p.field !== "airframeId" || p.source !== "user" || (p.ownerTable !== "flights" && p.ownerTable !== "sightings")) continue;
    const r = store.get(p.ownerTable as "flights" | "sightings", p.ownerId);
    if (r?.airframeId && gone("airframes", r.airframeId)) store.remove("field_provenance", p.id);
  }
}

/**
 * Listed conflicts with nothing left to choose close by themselves: the value is no longer one the user settles (a
 * link set by hand that is not any more), or the entry already has the other value.
 */
function settledConflicts(store: Store, now: number) {
  for (const c of store.all("sync_conflicts")) {
    if (c.resolvedAt || !(c.tableName in TABLES)) continue;
    const row = store.get(c.tableName as TableName, c.recordId) as Values | null;
    if (!row) continue;
    const moot = !conflictMatters(store, c.tableName, c.recordId, c.field);
    const taken = c.field !== "deleted" && JSON.stringify(row[c.field] ?? null) === c.otherValue && c.otherValue !== c.keptValue;
    if (moot || taken) store.update("sync_conflicts", c.id, { resolvedAt: toUtcIso(now), resolution: taken ? "other" : "kept" });
  }
}

/**
 * Settle what two devices made side by side, then link records to aircraft again (which merges aircraft made twice).
 * Run after rows arrive from sync; it changes nothing when there is nothing to settle.
 */
export function reconcile(store: Store, ref: RefIndex, now: number = Date.now()): { report: ReconcileReport; resolved: ResolveResult } {
  return store.batch(() => {
    const report: ReconcileReport = { merged: 0, renamed: 0, restored: 0 };
    // Statuses still in records (a log or backup from an older version) first, so they settle with the rest.
    settlePhases(store);
    sameFileImportedTwice(store, report);
    operatorsAddedTwice(store, now, report);
    familiesChosenTwice(store, now, report);
    findingsAcceptedTwice(store, report);
    childrenAddedTwice(store, now, report);
    viewsNamedTwice(store, report);
    tracksAttachedTwice(store, report);
    orphans(store, now, report);
    ref.setUserOverrides(refOverridesOf(store));
    const resolved = resolveAirframes(store, ref);
    report.merged += resolved.merged;
    settledConflicts(store, now);
    return { report, resolved };
  });
}
