// What a share link shows, picked out of the log's own tables when the link is opened (docs/32-modes-and-sharing.md,
// "Reading the log live"). The server reads only the tables listed here for the link's kind, never a private one, and
// sends only what this returns: the link's records and the rows they point to, without deleted entries, private
// columns, sync columns or import bookkeeping. It depends on the schema alone, so the server can use it without the
// rest of core.

import { PRIVATE_FIELDS, TABLES, type TableName } from "./schema/tables.ts";

export const SHARE_KINDS = ["flight", "sighting", "aircraft", "log"] as const;
export type ShareKind = (typeof SHARE_KINDS)[number];

/** The owner's corrections and groupings, so the shared pages read as the owner's do. */
const OWNERS = ["airport_overrides", "operator_overrides", "aircraft_type_overrides", "family_overrides"] as const satisfies readonly TableName[];

/**
 * The owner's display choices a link keeps, so its pages read as the owner's do (miles, ICAO codes). Nothing else of
 * the settings row is sent: it also says where the log is stored and the home airport.
 */
export const SHARE_SETTINGS = ["distanceUnit", "codeDisplay", "modelNaming"] as const;

/** The tables the server reads for each kind (docs/32, "What the server reads"). */
export const SHARE_TABLES: Record<ShareKind, readonly TableName[]> = {
  flight: ["flights", "airframes", "photo_links", "tracks", "settings", ...OWNERS],
  sighting: ["sightings", "sighting_phases", "sighting_tags", "photo_links", "airframes", "settings", ...OWNERS],
  aircraft: ["airframes", "registration_periods", "operator_periods", "flights", "sightings", "sighting_phases", "tracks", "settings", ...OWNERS],
  log: ["flights", "sightings", "sighting_phases", "sighting_tags", "photo_links", "airframes", "registration_periods", "operator_periods", "tracks", "settings", ...OWNERS],
};

export type ShareRow = Record<string, unknown>;
export type ShareTables = Partial<Record<TableName, ShareRow[]>>;

export interface ShareContent {
  format: "touchdown-share";
  version: 1;
  kind: ShareKind;
  /** The record the link shows now: an aircraft link's may be the aircraft its own was merged into. */
  subject: string | null;
  /** The record is no longer in the log (deleted, or not found). */
  gone: boolean;
  tables: ShareTables;
}

/** An aircraft link's anchor: one of the aircraft's flights or sightings, followed when the aircraft is merged away. */
export type ShareAnchor = `flights/${string}` | `sightings/${string}`;

const SYSTEM = new Set(["rev", "updatedAt", "updatedBy", "basedOn", "versionVector", "deleted"]);
const BOOKKEEPING = new Set(["sourceKind", "sourceBatchId", "sourceRow"]);
const PRIVATE = new Set(PRIVATE_FIELDS);

/** A row as a link shows it: its own columns, without sync columns, import bookkeeping or anything private. */
export function shareRow(table: TableName, row: ShareRow): ShareRow {
  const out: ShareRow = { id: row.id };
  for (const col of TABLES[table].columns) {
    if (SYSTEM.has(col.name) || BOOKKEEPING.has(col.name) || PRIVATE.has(`${table}.${col.name}`)) continue;
    out[col.name] = row[col.name] ?? null;
  }
  return out;
}

const live = (rows: ShareRow[] | undefined) => (rows ?? []).filter((r) => !r.deleted);

/**
 * Pick a link's content out of the tables read for it. `tables` holds the rows of the kind's tables as stored, deleted
 * ones included; a table not given is taken as empty. Only the kind's tables are ever used, whatever else is given.
 */
export function shareContent(kind: ShareKind, subject: string | null, anchor: ShareAnchor | null, tables: ShareTables): ShareContent {
  const allowed = new Set<TableName>(SHARE_TABLES[kind]);
  const rows = (t: TableName) => (allowed.has(t) ? live(tables[t]) : []);
  const byId = (t: TableName, id: unknown) => (id ? rows(t).find((r) => r.id === id) : undefined);
  const out: ShareTables = {};
  const put = (t: TableName, list: ShareRow[]) => {
    if (!allowed.has(t)) return;
    out[t] = [...(out[t] ?? []), ...list.map((r) => shareRow(t, r))];
  };
  for (const t of OWNERS) put(t, rows(t));
  const settings = rows("settings")[0];
  if (settings) out.settings = [{ id: settings.id, ...Object.fromEntries(SHARE_SETTINGS.map((k) => [k, settings[k] ?? null])) }];
  const done = (shown: string | null, gone = false): ShareContent => ({ format: "touchdown-share", version: 1, kind, subject: shown, gone, tables: gone ? {} : out });

  switch (kind) {
    case "flight": {
      const f = byId("flights", subject);
      if (!f) return done(subject, true);
      put("flights", [f]);
      put("airframes", [byId("airframes", f.airframeId)].filter((r): r is ShareRow => !!r));
      put("photo_links", rows("photo_links").filter((p) => p.ownerTable === "flights" && p.ownerId === f.id));
      put("tracks", rows("tracks").filter((t) => t.flightId === f.id));
      return done(subject);
    }
    case "sighting": {
      const s = byId("sightings", subject);
      if (!s) return done(subject, true);
      put("sightings", [s]);
      put("sighting_phases", rows("sighting_phases").filter((p) => p.sightingId === s.id));
      put("sighting_tags", rows("sighting_tags").filter((t) => t.sightingId === s.id));
      put("photo_links", rows("photo_links").filter((p) => p.ownerTable === "sightings" && p.ownerId === s.id));
      put("airframes", [byId("airframes", s.airframeId)].filter((r): r is ShareRow => !!r));
      return done(subject);
    }
    case "aircraft": {
      let a = byId("airframes", subject);
      // Merged into another: the aircraft the anchor record belongs to now (docs/32, "When things change").
      if (!a && anchor) {
        const [table, id] = anchor.split("/") as ["flights" | "sightings", string];
        a = byId("airframes", byId(table, id)?.airframeId);
      }
      if (!a) return done(subject, true);
      put("airframes", [a]);
      put("registration_periods", rows("registration_periods").filter((p) => p.airframeId === a.id));
      put("operator_periods", rows("operator_periods").filter((p) => p.airframeId === a.id));
      const flights = rows("flights").filter((f) => f.airframeId === a.id);
      const flightIds = new Set(flights.map((f) => f.id));
      put("flights", flights);
      put("tracks", rows("tracks").filter((t) => flightIds.has(t.flightId as string)));
      const sightings = rows("sightings").filter((s) => s.airframeId === a.id);
      put("sightings", sightings);
      const ids = new Set(sightings.map((s) => s.id));
      put("sighting_phases", rows("sighting_phases").filter((p) => ids.has(p.sightingId as string)));
      return done(a.id as string);
    }
    case "log": {
      const flights = rows("flights");
      const sightings = rows("sightings");
      const records = new Set([...flights.map((f) => `flights/${f.id}`), ...sightings.map((s) => `sightings/${s.id}`)]);
      const sightingIds = new Set(sightings.map((s) => s.id));
      const flightIds = new Set(flights.map((f) => f.id));
      put("flights", flights);
      put("sightings", sightings);
      put("sighting_phases", rows("sighting_phases").filter((p) => sightingIds.has(p.sightingId as string)));
      put("sighting_tags", rows("sighting_tags").filter((t) => sightingIds.has(t.sightingId as string)));
      put("photo_links", rows("photo_links").filter((p) => records.has(`${p.ownerTable}/${p.ownerId}`)));
      put("airframes", rows("airframes"));
      put("registration_periods", rows("registration_periods"));
      put("operator_periods", rows("operator_periods"));
      put("tracks", rows("tracks").filter((t) => flightIds.has(t.flightId as string)));
      return done(null);
    }
  }
}

/**
 * The recorded tracks a link may show, by flight id: those of the flights in its content (a flight link's own, an
 * aircraft's flights, every flight of a whole log). A flight outside the content has none.
 */
export function shareTracks(content: ShareContent): Map<string, string> {
  const flights = new Set((content.tables.flights ?? []).map((f) => f.id));
  const out = new Map<string, string>();
  for (const t of content.tables.tracks ?? []) if (flights.has(t.flightId) && typeof t.id === "string") out.set(t.flightId as string, t.id);
  return out;
}

