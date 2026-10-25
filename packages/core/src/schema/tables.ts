// Every user table from docs/10-domain-model.md. This file is the single source of truth for stored data.

import { c, table, type RowOf, type TableDef, type ValuesOf } from "./columns.ts";

export const SCHEMA_NAME = "touchdown";
export const SCHEMA_VERSION = 5;

export const SOURCE_KINDS = ["manual", "fr24_csv", "sheet", "csv", "api"] as const;
export const SEAT_POSITIONS = ["window", "middle", "aisle"] as const;
export const CABIN_CLASSES = ["economy", "premium_economy", "business", "first", "private"] as const;
export const FLIGHT_REASONS = ["leisure", "business", "crew", "other"] as const;
export const PHASES = ["approaching", "landing", "taking_off", "taxiing", "parked", "towing", "overflight", "other"] as const;
export const AIRFRAME_STATUSES = ["active", "stored", "retired", "written_off", "unknown"] as const;
export const TRACK_PROVIDERS = ["fr24_csv", "fr24_kml", "adsblol", "aeroapi", "gpx", "other"] as const;
export const PROVENANCE_SOURCES = ["user", "import", "lookup", "agent", "derived"] as const;
export const HISTORY_REASONS = ["edit", "import", "sync_conflict", "migration"] as const;
/** How the user settled a sync conflict: the value kept stays, or the other device's value is used. */
export const CONFLICT_RESOLUTIONS = ["kept", "other"] as const;
export const AGENT_CHECKERS = ["claude", "codex", "none"] as const;
/** Where the log lives and what Touchdown's server may do (docs/32-modes-and-sharing.md). */
export const DATA_MODES = ["standard", "private", "local"] as const;

const sourceColumns = [
  c.enum("sourceKind", SOURCE_KINDS),
  c.ref("sourceBatchId", "import_batches"),
  c.integer("sourceRow"),
] as const;

export const flights = table("flights", "user", [
  c.date("scheduledDate"),
  c.text("flightNumber"),
  c.ref("airlineId", "operators"),
  c.text("airlineRaw"),
  c.ref("operatingAirlineId", "operators"),
  c.ref("fromAirportId", "airports"),
  c.ref("toAirportId", "airports"),
  c.text("fromRaw"),
  c.text("toRaw"),
  c.ref("divertedToAirportId", "airports"),
  c.datetime("boardingAt"),
  c.datetime("departureScheduledAt"),
  c.datetime("departureAt"),
  c.datetime("takeoffAt"),
  c.datetime("landingAt"),
  c.datetime("arrivalScheduledAt"),
  c.datetime("arrivalAt"),
  c.text("departureTerminal"),
  c.text("departureGate"),
  c.text("arrivalTerminal"),
  c.text("arrivalGate"),
  c.text("seat"),
  c.enum("seatPosition", SEAT_POSITIONS),
  c.enum("cabinClass", CABIN_CLASSES),
  c.text("bookingClass"),
  c.text("fareBrand"),
  c.enum("reason", FLIGHT_REASONS),
  c.text("ticketNumber", { private: true }),
  c.text("bookingRef", { private: true }),
  c.text("registration"),
  c.text("registrationRaw"),
  c.text("typeCode"),
  c.text("typeCodeRaw"),
  c.text("model"),
  c.text("modelRaw"),
  c.ref("airframeId", "airframes"),
  c.text("livery"),
  c.text("specialLivery"),
  c.real("distanceKmOverride"),
  c.integer("durationMinOverride"),
  c.text("notes"),
  ...sourceColumns,
]);

export const sightings = table("sightings", "user", [
  c.date("seenOn"),
  c.datetime("seenAt"),
  c.ref("airportId", "airports"),
  c.text("airportRaw"),
  c.text("spotName"),
  c.real("lat"),
  c.real("lon"),
  c.text("registration"),
  c.text("registrationRaw"),
  c.ref("operatorId", "operators"),
  c.text("operatorRaw"),
  c.text("typeCode"),
  c.text("typeCodeRaw"),
  c.text("model"),
  c.text("modelRaw"),
  c.ref("airframeId", "airframes"),
  c.enum("phase", PHASES),
  c.text("livery"),
  c.text("specialLivery"),
  c.integer("photoCount"),
  c.text("notes"),
  ...sourceColumns,
]);

export const sightingTags = table("sighting_tags", "child", [
  c.ref("sightingId", "sightings", { required: true }),
  c.text("tag"),
]);

export const photoLinks = table("photo_links", "child", [
  c.enum("ownerTable", ["flights", "sightings"], { required: true }),
  c.id("ownerId", { required: true }),
  c.text("url"),
  c.text("label"),
]);

export const airframes = table("airframes", "user", [
  c.text("identityKey", { unique: true }),
  c.boolean("provisional"),
  c.text("manufacturer"),
  c.text("msn"),
  c.text("lineNumber"),
  c.text("typeCode"),
  c.text("model"),
  c.date("firstFlightDate"),
  c.date("deliveryDate"),
  c.enum("status", AIRFRAME_STATUSES),
  c.text("factsProvider"),
  c.datetime("factsFetchedAt"),
  c.text("notes"),
]);

export const registrationPeriods = table("registration_periods", "child", [
  c.ref("airframeId", "airframes", { required: true }),
  c.text("registration"),
  c.date("validFrom"),
  c.date("validTo"),
  c.text("icaoHex"),
  c.text("source"),
]);

export const operatorPeriods = table("operator_periods", "child", [
  c.ref("airframeId", "airframes", { required: true }),
  c.ref("operatorId", "operators"),
  c.date("validFrom"),
  c.date("validTo"),
  c.text("source"),
]);

export const tracks = table("tracks", "child", [
  c.ref("flightId", "flights", { required: true }),
  c.enum("provider", TRACK_PROVIDERS),
  c.enum("coverage", ["complete", "partial"]),
  c.integer("pointCount"),
  c.datetime("firstPointAt"),
  c.datetime("lastPointAt"),
  c.real("distanceKm"),
  c.text("attribution"),
  c.datetime("importedAt"),
]);

export const trackPoints = table("track_points", "points", [
  c.ref("trackId", "tracks", { required: true }),
  c.integer("seq", { required: true }),
  c.integer("t", { required: true }),
  c.real("lat", { required: true }),
  c.real("lon", { required: true }),
  c.integer("altitudeFt"),
  c.integer("groundSpeedKt"),
  c.integer("headingDeg"),
]);

export const fieldProvenance = table("field_provenance", "child", [
  c.text("ownerTable", { required: true }),
  c.id("ownerId", { required: true }),
  c.text("field"),
  c.enum("source", PROVENANCE_SOURCES),
  c.text("detail"),
  c.datetime("recordedAt"),
]);

export const externalIds = table("external_ids", "child", [
  c.text("ownerTable", { required: true }),
  c.id("ownerId", { required: true }),
  c.text("system"),
  c.text("key"),
  c.text("value"),
]);

export const recordHistory = table("record_history", "child", [
  c.text("tableName", { required: true }),
  c.id("recordId", { required: true }),
  c.integer("recordRev"),
  c.json("row"),
  c.datetime("changedAt"),
  c.ref("batchId", "import_batches"),
  c.enum("reason", HISTORY_REASONS),
]);

/**
 * One field edited on two devices before either saw the other's edit (docs/12, "Sync algorithm"). Sync keeps one value
 * and the other waits here until the user chooses on the Issues page. Values are JSON text ("\"12A\"", "null").
 */
export const syncConflicts = table("sync_conflicts", "child", [
  c.text("tableName", { required: true }),
  // The row's key: an id, or a fixed one such as the settings row's.
  c.text("recordId", { required: true }),
  c.text("field", { required: true }),
  c.text("keptValue"),
  c.text("otherValue"),
  c.text("keptBy"),
  c.datetime("keptAt"),
  c.text("otherBy"),
  c.datetime("otherAt"),
  c.datetime("detectedAt"),
  c.datetime("resolvedAt"),
  c.enum("resolution", CONFLICT_RESOLUTIONS),
]);

export const importBatches = table("import_batches", "user", [
  c.datetime("createdAt"),
  c.enum("sourceKind", SOURCE_KINDS),
  c.text("fileName"),
  c.text("fileHash"),
  c.text("mappingPreset"),
  c.integer("rowsRead"),
  c.integer("rowsAccepted"),
  c.integer("rowsEdited"),
  c.integer("rowsRejected"),
  c.enum("agentChecker", AGENT_CHECKERS),
  c.enum("status", ["committed", "undone"]),
]);

export const issueAcks = table("issue_acks", "user", [c.text("ruleId"), c.text("fingerprint"), c.text("note")]);

export const issueAckRecords = table("issue_ack_records", "child", [
  c.ref("ackId", "issue_acks", { required: true }),
  c.text("tableName"),
  c.id("recordId"),
]);

export const settings = table("settings", "settings", [
  c.enum("distanceUnit", ["km", "mi", "nm"]),
  c.enum("theme", ["system", "light", "dark"]),
  c.enum("codeDisplay", ["iata", "icao", "both"]),
  c.enum("modelNaming", ["standard", "compact"]),
  c.ref("homeAirportId", "airports"),
  c.enum("dataMode", DATA_MODES),
  c.enum("storageBackend", ["json_tables", "sqlite_file", "sqlite_local", "postgres", "d1"]),
  c.enum("storageAdapter", ["gdrive", "localfs", "manual"]),
  c.text("storageLocation"),
  c.text("storageAccount"),
]);

export const familyOverrides = table("family_overrides", "user", [
  c.ref("designator", "aircraft_types"),
  c.ref("familyId", "families"),
]);

export const savedViews = table("saved_views", "user", [
  c.text("name"),
  c.enum("dataset", ["flights", "sightings", "both"]),
  c.text("rowDimension"),
  c.text("columnDimension"),
  c.text("measure"),
]);

export const savedViewFilters = table("saved_view_filters", "child", [
  c.ref("viewId", "saved_views", { required: true }),
  c.text("dimension"),
  c.enum("operator", ["eq", "in", "between"]),
  c.text("value"),
]);

export const airportOverrides = table("airport_overrides", "user", [
  c.text("icao"),
  c.text("iata"),
  c.text("name"),
  c.text("city"),
  c.text("country"),
  c.real("lat"),
  c.real("lon"),
  c.integer("elevationFt"),
  c.text("tz"),
]);

export const operatorOverrides = table("operator_overrides", "user", [
  c.text("icao"),
  c.text("iata"),
  c.text("name"),
  c.text("callsign"),
  c.text("country"),
  c.enum("kind", ["airline", "cargo", "charter", "business", "private", "government", "military", "manufacturer", "lessor", "other"]),
  c.date("validFrom"),
  c.date("validTo"),
]);

export const aircraftTypeOverrides = table("aircraft_type_overrides", "user", [
  c.text("designator"),
  c.text("manufacturer"),
  c.text("name"),
  c.ref("familyId", "families"),
  c.enum("engineType", ["jet", "turboprop", "piston", "electric", "other"]),
  c.integer("engineCount"),
  c.enum("wtc", ["L", "M", "H", "J"]),
]);

export const TABLES = {
  flights,
  sightings,
  sighting_tags: sightingTags,
  photo_links: photoLinks,
  airframes,
  registration_periods: registrationPeriods,
  operator_periods: operatorPeriods,
  tracks,
  track_points: trackPoints,
  field_provenance: fieldProvenance,
  external_ids: externalIds,
  record_history: recordHistory,
  sync_conflicts: syncConflicts,
  import_batches: importBatches,
  issue_acks: issueAcks,
  issue_ack_records: issueAckRecords,
  settings,
  family_overrides: familyOverrides,
  saved_views: savedViews,
  saved_view_filters: savedViewFilters,
  airport_overrides: airportOverrides,
  operator_overrides: operatorOverrides,
  aircraft_type_overrides: aircraftTypeOverrides,
} as const satisfies Record<string, TableDef>;

export type TableName = keyof typeof TABLES;
export type Row<N extends TableName> = RowOf<(typeof TABLES)[N]>;
export type Values<N extends TableName> = ValuesOf<(typeof TABLES)[N]>;

export type Flight = Row<"flights">;
export type Sighting = Row<"sightings">;
export type Airframe = Row<"airframes">;
export type RegistrationPeriod = Row<"registration_periods">;
export type OperatorPeriod = Row<"operator_periods">;
export type SightingTag = Row<"sighting_tags">;
export type Track = Row<"tracks">;
export type TrackPoint = Row<"track_points">;
export type FieldProvenance = Row<"field_provenance">;
export type ExternalId = Row<"external_ids">;
export type ImportBatch = Row<"import_batches">;
export type SyncConflict = Row<"sync_conflicts">;
export type IssueAck = Row<"issue_acks">;
export type Settings = Row<"settings">;

export type FlightValues = Values<"flights">;
export type SightingValues = Values<"sightings">;

export const PRIVATE_FIELDS: readonly string[] = Object.values(TABLES).flatMap((t) =>
  t.columns.filter((col) => "private" in col && col.private).map((col) => `${t.name}.${col.name}`),
);
