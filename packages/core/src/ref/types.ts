// Reference tables shipped with the app (docs/10-domain-model.md, "Reference tables").
// packages/refdata builds them; the app reads them with the user's *_overrides applied on top.

export interface Airport {
  id: string; // ap_<icao lower>, or ap_<ourairports ident lower> when there is no ICAO code; the user's own: a ULID
  icao: string | null;
  iata: string | null;
  name: string;
  city: string | null;
  country: string; // ISO 3166-1 alpha-2
  lat: number;
  lon: number;
  elevationFt: number | null;
  tz: string; // IANA time zone
}

export type OperatorKind =
  | "airline"
  | "cargo"
  | "charter"
  | "business"
  | "private"
  | "government"
  | "military"
  | "manufacturer"
  | "lessor"
  | "other";

export interface Operator {
  id: string; // op_<icao lower>; op_iata_<iata lower> when there is no ICAO code; op_private for private owners
  icao: string | null;
  iata: string | null;
  name: string;
  callsign: string | null;
  country: string | null;
  kind: OperatorKind;
  validFrom: string | null; // YYYY-MM-DD
  validTo: string | null; // YYYY-MM-DD; null = still operating
}

export type EngineType = "jet" | "turboprop" | "piston" | "electric" | "other";
export type WakeCategory = "L" | "M" | "H" | "J";

export interface AircraftType {
  designator: string; // ICAO type designator
  manufacturer: string;
  name: string;
  familyId: string | null;
  engineType: EngineType | null;
  engineCount: number | null;
  wtc: WakeCategory | null;
}

export interface Family {
  id: string; // e.g. A320, B737, E175
  name: string;
  manufacturer: string;
}

/**
 * A type's figures from its Wikipedia article (docs/13-reference-data.md, "Type figures"), metric, null where the
 * article gives none. `article` and `revision` say where they were read.
 */
export interface TypeSpecs {
  designator: string;
  article: string;
  revision: number;
  lengthM: number | null;
  /** The wingspan; a helicopter's main rotor diameter. */
  spanM: number | null;
  heightM: number | null;
  fuselageWidthM: number | null;
  wingAreaM2: number | null;
  sweepDeg: number | null;
  mtowKg: number | null;
  rangeKm: number | null;
  cruiseKmh: number | null;
  cruiseMach: number | null;
  seatsTypical: number | null;
  seatsMax: number | null;
  engines: string | null;
}

/** What a type is for, from its classes in Wikidata (docs/13-reference-data.md, "Type figures"). */
export type TypeRole = "airliner" | "business" | "light" | "helicopter" | "military" | "other";

/**
 * A type's figures from Wikidata (docs/13-reference-data.md, "Type figures"), for the types without curated figures
 * and to fill gaps in those. One item a designator, metric, null where the item states none. `item` and `revision`
 * say where they were read.
 */
export interface TypeWikidata {
  designator: string;
  /** The item's id, as "Q6475". */
  item: string;
  revision: number;
  /** The item's English label. */
  label: string | null;
  role: TypeRole | null;
  lengthM: number | null;
  /** The wingspan; a helicopter's main rotor diameter. */
  spanM: number | null;
  heightM: number | null;
  mtowKg: number | null;
  rangeKm: number | null;
  cruiseKmh: number | null;
  seatsMax: number | null;
  engines: string | null;
  /** YYYY-MM-DD, YYYY-MM or YYYY, as precise as the item states it. */
  firstFlight: string | null;
  introduced: string | null;
  built: number | null;
}

/** A family's history from its main article's infobox. */
export interface FamilyFacts {
  familyId: string;
  article: string;
  revision: number;
  firstFlight: string | null;
  introduced: string | null;
  built: number | null;
  builtAsOf: string | null;
  status: string | null;
}

/**
 * A family's shape seen from above, for its silhouettes (G11): what its figures do not say. Fractions are of the
 * length, the half-span or the fuselage's width. `checked`: a person has compared the drawing with the real aircraft
 * (G11), so it may be shown.
 */
export interface SilhouetteShape {
  kind: "jet" | "prop" | "helicopter";
  /** The nose's length in fuselage widths (1.6 a round airliner's, 3 a pointed one), and the tail cone's. */
  nose?: number;
  tail?: number;
  /** A helicopter's tail boom, as a share of the length: a thin tube behind the cabin. */
  boom?: number;
  /** The wing: its root's leading edge along the fuselage, its root chord (of the length), the tip's chord (of the root's). */
  wing: { at: number; root: number; tip: number; device?: "winglet" | "raked" | "sharklet" | "blended" | null };
  /**
   * Engines on the wing at fractions of the half-span (`over`: on pylons above its rear, as a HondaJet's), or beside the
   * tail (two; a trijet's third, in the tail, does not show from above).
   */
  engines?: { wing?: number[]; over?: boolean; rear?: 2 | 3; size?: number };
  /** The tailplane: its span (of the wingspan; none for a delta), its root's leading edge along the fuselage and its sweep. */
  stab: { span: number; at: number; sweep: number; root?: number };
  /** Propellers' diameter in metres, at the engines or the nose. */
  prop?: number;
  /** A helicopter's main rotor blades. */
  blades?: number;
  /** For drawing only, where the figures give none: the fuselage's width (m) and the wing's sweep (degrees). */
  width?: number;
  sweep?: number;
}

export interface ModelPattern {
  designator: string;
  pattern: string; // regex source, matched against the standard model form (e.g. "A321-271NX")
  example: string;
}

export interface RegistrationPrefix {
  prefix: string; // as written in the display form, e.g. "N", "B-", "B-H", "JA", "D-"
  country: string; // ISO 3166-1 alpha-2
  pattern: string; // regex source matched against the display form, e.g. "^N[1-9][0-9A-HJ-NP-Z]{0,4}$"
}

export interface RefTables {
  airports: Airport[];
  operators: Operator[];
  aircraftTypes: AircraftType[];
  families: Family[];
  modelPatterns: ModelPattern[];
  registrationPrefixes: RegistrationPrefix[];
}

// On-disk layout of one reference table: column names once, then one array per row.
export interface RefTableFile {
  table: string;
  version: string; // build date, YYYY-MM-DD
  sources: string[]; // attribution lines
  columns: string[];
  rows: unknown[][];
}

export function rowsToObjects<T>(file: RefTableFile): T[] {
  return file.rows.map((row) => {
    const out: Record<string, unknown> = {};
    file.columns.forEach((c, i) => (out[c] = row[i] ?? null));
    return out as T;
  });
}

/**
 * The user's own airport (an airport_overrides row) in the reference shape. Null while it lacks a position or a time
 * zone, which every airport needs (distances, maps, local times).
 */
export function airportFromOverride(row: {
  id: string;
  icao: string | null;
  iata: string | null;
  name: string | null;
  city: string | null;
  country: string | null;
  lat: number | null;
  lon: number | null;
  elevationFt: number | null;
  tz: string | null;
}): Airport | null {
  if (row.lat === null || row.lon === null || !row.tz) return null;
  return {
    id: row.id,
    icao: row.icao,
    iata: row.iata,
    name: row.name ?? row.icao ?? row.iata ?? row.id,
    city: row.city,
    country: row.country ?? "",
    lat: row.lat,
    lon: row.lon,
    elevationFt: row.elevationFt,
    tz: row.tz,
  };
}

/** The user's own operator (an operator_overrides row) in the reference shape. */
export function operatorFromOverride(row: {
  id: string;
  icao: string | null;
  iata: string | null;
  name: string | null;
  callsign: string | null;
  country: string | null;
  kind: OperatorKind | null;
  validFrom: string | null;
  validTo: string | null;
}): Operator {
  return {
    id: row.id,
    icao: row.icao,
    iata: row.iata,
    name: row.name ?? row.icao ?? row.iata ?? "Operator",
    callsign: row.callsign,
    country: row.country,
    kind: row.kind ?? "other",
    validFrom: row.validFrom,
    validTo: row.validTo,
  };
}
