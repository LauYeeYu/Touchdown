// Reference tables shipped with the app (docs/10-domain-model.md, "Reference tables").
// packages/refdata builds them; the app reads them with the user's *_overrides applied on top.

export interface Airport {
  id: string; // ap_<icao lower>, or ap_<ourairports ident lower> when there is no ICAO code
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
