// A parsed source row, before it is matched and committed (docs/21-import-export.md, stages 1–3).

import type { AirframeFacts } from "../identity/facts.ts";
import type { FlightValues, PROVENANCE_SOURCES, SightingValues } from "../schema/tables.ts";

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
  airframeFacts: { firstFlightDate?: string; lookup?: AirframeFacts };
  /** Where values came from when it was not the file itself (a spotting session's lookups or agent). */
  provenance?: { field: string; source: (typeof PROVENANCE_SOURCES)[number]; detail: string | null }[];
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

/** "sheet" is any spreadsheet read through a column mapping (mapping.ts). */
export type SourceFormat = "fr24_csv" | "sheet" | "touchdown_inbox";

export interface ParsedSource {
  format: SourceFormat;
  fileName: string;
  candidates: Candidate[];
  rowsRead: number;
  /** The agent that checked the rows before they reached the import (a spotting session's inbox). */
  agentChecker?: "claude" | "codex" | null;
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
