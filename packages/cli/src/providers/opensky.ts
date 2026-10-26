// OpenSky aircraft database, complete snapshot of 2025-08 (docs/13-reference-data.md, "Airframe facts"):
// one CSV download, read locally. Gives the serial number for most airliners, the line number and first
// flight for a few. Licence: OpenSky terms (non-profit research and education), accepted for this app (Q-LICENSES).

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { modelFromSource, registrationMatchForm, type AirframeFacts, type Evidence, type RefIndex } from "@touchdown/core";
import type { Provider, ProviderResult } from "../airframes.ts";
import { privatePath, shownPath } from "../paths.ts";

export const OPENSKY_URL = "https://s3.opensky-network.org/data-samples/metadata/aircraft-database-complete-2025-08.csv";
export const OPENSKY_FILE = privatePath("reference/opensky-aircraft-database-complete-2025-08.csv");
const SNAPSHOT_AT = "2025-08-01T00:00Z";
const USER_AGENT = "Touchdown/0.1 (personal aircraft log)";

// Columns of the snapshot. Some name fields contain unquoted commas, so the fields used here are read from
// the end of the row (registration onwards), and the middle ones only when the row has exactly 32 fields.
const COLUMNS = 32;
const TAIL = ["prevReg", "regUntil", "registered", "registration", "selCal", "serialNumber", "status", "typecode", "vdl"] as const;

export interface OpenSkyRow {
  /** The aircraft's ICAO 24-bit address, lower-case hex. */
  icao24: string;
  registration: string;
  /** When OpenSky last updated the row (YYYY-MM-DD). */
  updated: string;
  serialNumber: string;
  typecode: string;
  status: string;
  registered: string;
  regUntil: string;
  built: string;
  firstFlightDate: string;
  lineNumber: string;
  manufacturerName: string;
  model: string;
  operatorIcao: string;
  operatorName: string;
}
type Row = OpenSkyRow;

/** Split one line: fields are bare or in single quotes, with '' for a quote inside. */
export function splitOpenSkyLine(line: string): string[] {
  const out: string[] = [];
  let i = 0;
  while (i <= line.length) {
    if (line[i] === "'") {
      let v = "";
      i++;
      for (;;) {
        if (i >= line.length) break;
        if (line[i] === "'") {
          if (line[i + 1] === "'") {
            v += "'";
            i += 2;
            continue;
          }
          i++;
          break;
        }
        v += line[i++];
      }
      out.push(v);
      // Skip to the next comma.
      while (i < line.length && line[i] !== ",") i++;
      i++;
    } else {
      const j = line.indexOf(",", i);
      const end = j < 0 ? line.length : j;
      out.push(line.slice(i, end));
      i = end + 1;
    }
  }
  return out;
}

export function parseOpenSkyRow(line: string): Row | null {
  const f = splitOpenSkyLine(line);
  if (f.length < COLUMNS) return null;
  const tail = Object.fromEntries(TAIL.map((k, i) => [k, f[f.length - TAIL.length + i]!.trim()])) as Record<(typeof TAIL)[number], string>;
  const aligned = f.length === COLUMNS;
  return {
    icao24: (f[0] ?? "").trim().toLowerCase(),
    registration: tail.registration,
    updated: /^\d{4}-\d{2}-\d{2}/.test(f[1] ?? "") ? f[1]!.slice(0, 10) : "",
    serialNumber: tail.serialNumber,
    typecode: tail.typecode,
    status: tail.status,
    registered: tail.registered,
    regUntil: tail.regUntil,
    built: f[4]!.trim(),
    firstFlightDate: aligned ? f[8]!.trim() : "",
    lineNumber: aligned ? f[11]!.trim() : "",
    manufacturerName: aligned ? f[13]!.trim() : "",
    model: aligned ? f[14]!.trim() : "",
    // The operator columns sit after free-text columns, so they are read only from a row that splits cleanly.
    operatorIcao: aligned ? f[21]!.trim() : "",
    operatorName: aligned ? f[18]!.trim() : "",
  };
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

export function openSkyFacts(r: Row, ref: RefIndex): AirframeFacts {
  const typeCode = r.typecode && ref.type(r.typecode) ? r.typecode.toUpperCase() : null;
  const year = /^(\d{4})/.exec(r.built)?.[1];
  return {
    provider: "opensky",
    url: null,
    fetchedAt: SNAPSHOT_AT,
    registration: r.registration,
    manufacturer: ref.manufacturerOf(typeCode) ?? (r.manufacturerName || null),
    msn: r.serialNumber || null,
    lineNumber: r.lineNumber || null,
    typeText: [r.manufacturerName, r.model].filter(Boolean).join(" ") || typeCode,
    typeCode,
    firstFlightDate: DATE.test(r.firstFlightDate) ? r.firstFlightDate : null,
    deliveryDate: null,
    status: null,
    // Build dates in the snapshot are often only a year (written as 1 January), so only the year is trusted.
    notBefore: year ? `${year}-01-01` : null,
    notBeforeLabel: year ? `was built in ${year}` : null,
    registrations: DATE.test(r.registered) || DATE.test(r.regUntil) ? [{ registration: r.registration, from: DATE.test(r.registered) ? r.registered : null, to: DATE.test(r.regUntil) ? r.regUntil : null, operator: null }] : [],
  };
}

async function ensureFile(log: (l: string) => void): Promise<string | null> {
  if (existsSync(OPENSKY_FILE)) return OPENSKY_FILE;
  log(`Downloading the OpenSky aircraft database (about 110 MB, once) to ${shownPath(OPENSKY_FILE)}…`);
  const res = await fetch(OPENSKY_URL, { headers: { "User-Agent": USER_AGENT } }).catch(() => null);
  if (!res?.ok) return null;
  mkdirSync(dirname(OPENSKY_FILE), { recursive: true });
  writeFileSync(OPENSKY_FILE, new Uint8Array(await res.arrayBuffer()));
  return OPENSKY_FILE;
}

/** What a snapshot row says for a spotting session: type, model, operator and the airframe facts. */
export function openSkyEvidence(r: Row, ref: RefIndex): Evidence {
  const facts = openSkyFacts(r, ref);
  const op = r.operatorIcao && ref.operatorByCode(r.operatorIcao)?.icao === r.operatorIcao.toUpperCase() ? r.operatorIcao.toUpperCase() : null;
  return {
    source: "opensky",
    typeCode: facts.typeCode,
    model: modelFromSource(r.model, facts.typeCode, ref),
    operator: op,
    operatorName: r.operatorName || null,
    asOf: r.updated || SNAPSHOT_AT.slice(0, 10),
    note: null,
    facts: facts.msn ? facts : null,
    url: null,
  };
}

/** The snapshot by registration (match form), every row that has one. Downloaded on first use. */
export function openSkyIndex(log: (l: string) => void): () => Promise<Map<string, Row[]> | { error: string }> {
  let index: Map<string, Row[]> | null = null;
  let failed: string | null = null;
  return async () => {
    if (failed) return { error: failed };
    if (index) return index;
    const path = await ensureFile(log);
    if (!path) {
      failed = "could not download the OpenSky aircraft database";
      return { error: failed };
    }
    index = new Map();
    const lines = readFileSync(path, "utf8").split("\n");
    for (let i = 1; i < lines.length; i++) {
      const r = lines[i] ? parseOpenSkyRow(lines[i]!) : null;
      if (!r?.registration) continue;
      const key = registrationMatchForm(r.registration);
      index.set(key, [...(index.get(key) ?? []), r]);
    }
    return index;
  };
}

export function openSkyProvider(ref: RefIndex, log: (l: string) => void): Provider {
  const load = openSkyIndex(log);
  return {
    id: "opensky",
    name: "OpenSky",
    prefer: [],
    gives: ["msn", "lineNumber", "firstFlightDate"],
    async lookup(registration): Promise<ProviderResult> {
      const index = await load();
      if (!(index instanceof Map)) return { kind: "error", reason: index.error };
      const rows = index.get(registrationMatchForm(registration))?.filter((r) => r.serialNumber);
      if (!rows?.length) return { kind: "none" };
      return { kind: "found", candidates: rows.map((r) => openSkyFacts(r, ref)) };
    },
  };
}
