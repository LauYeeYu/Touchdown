// A parsed source row, before it is matched and committed (docs/21-import-export.md, stages 1–3).

import type { FlightValues, SightingValues } from "../schema/tables.ts";

export interface ImportIssue {
  ruleId: string; // a V- rule, or I-SOURCE-DIFF for disagreements inside the source row
  severity: "error" | "warning" | "info";
  field: string | null;
  message: string;
}

interface CandidateBase {
  sourceRow: number;
  raw: Record<string, string | null>;
  issues: ImportIssue[];
  external: { system: string; key: string; value: string }[];
  /** Facts about the aircraft rather than the record, applied to the linked airframe (e.g. first flight). */
  airframeFacts: { firstFlightDate?: string };
}

export interface FlightCandidate extends CandidateBase {
  table: "flights";
  values: Partial<FlightValues>;
}

export interface SightingCandidate extends CandidateBase {
  table: "sightings";
  values: Partial<SightingValues>;
  tags: string[];
}

export type Candidate = FlightCandidate | SightingCandidate;

export type SourceFormat = "fr24_csv" | "flight_log_sheet" | "spotting_sheet";

export interface ParsedSource {
  format: SourceFormat;
  fileName: string;
  candidates: Candidate[];
  rowsRead: number;
}

export function rawRecord(header: string[], row: (string | number | boolean | null)[]): Record<string, string | null> {
  const out: Record<string, string | null> = {};
  header.forEach((h, i) => {
    if (!h) return;
    const v = row[i];
    out[h] = v === null || v === undefined ? null : String(v);
  });
  return out;
}
