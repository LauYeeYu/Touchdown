// Findings produced by the checks (docs/20-validation.md). Checks never block saving.

import { tDynamic } from "@touchdown/i18n";
import type { TableName } from "../schema/tables.ts";

export type Severity = "error" | "warning" | "info";

export interface RecordRef {
  table: TableName;
  id: string;
}

export interface SuggestedFix {
  table: TableName;
  id: string;
  field: string;
  value: string | number | boolean | null;
  also?: { field: string; value: string | number | boolean | null }[]; // further fields changed together
  label: string; // what accepting does, e.g. "Set type code to B752"
  /**
   * Add this name as the user's own operator, and set `field` to it on every record that has the name and no
   * operator (`value` is unused). For an airline field holding a company's name ("Hyundai").
   */
  operatorName?: string;
}

export interface Finding {
  ruleId: string;
  severity: Severity;
  records: RecordRef[];
  fields: string[];
  message: string;
  fixes: SuggestedFix[];
  /** Hash of the rule, the records and the values that triggered it. An accepted warning returns when it changes. */
  fingerprint: string;
}

/** A rule's title, read when used: the interface's language is chosen after this module loads. */
function rule(id: string, severity: Severity | "varies"): { title: string; severity: Severity | "varies" } {
  return {
    get title() {
      return tDynamic(`rules.title.${id}`);
    },
    severity,
  };
}

export const RULES: Record<string, { title: string; severity: Severity | "varies" }> = {
  "V-REG-FORMAT": rule("V-REG-FORMAT", "warning"),
  "V-DATE-SANE": rule("V-DATE-SANE", "error"),
  "V-AIRPORT-KNOWN": rule("V-AIRPORT-KNOWN", "error"),
  "V-AIRPORT-SAME": rule("V-AIRPORT-SAME", "warning"),
  "V-OPERATOR-KNOWN": rule("V-OPERATOR-KNOWN", "error"),
  "V-TYPE-KNOWN": rule("V-TYPE-KNOWN", "error"),
  "V-MODEL-TYPE": rule("V-MODEL-TYPE", "warning"),
  "V-MODEL-PARSE": rule("V-MODEL-PARSE", "warning"),
  "V-FLIGHTNO-FORMAT": rule("V-FLIGHTNO-FORMAT", "warning"),
  "V-FLIGHTNO-AIRLINE": rule("V-FLIGHTNO-AIRLINE", "warning"),
  "V-SEAT-FORMAT": rule("V-SEAT-FORMAT", "warning"),
  "V-TIMES-ORDER": rule("V-TIMES-ORDER", "error"),
  "V-TIME-OFFSET": rule("V-TIME-OFFSET", "error"),
  "V-DAY-ROLLOVER": rule("V-DAY-ROLLOVER", "varies"),
  "V-SCHEDULE-DATE": rule("V-SCHEDULE-DATE", "varies"),
  "V-TRACK-TIMES": rule("V-TRACK-TIMES", "error"),
  "V-TRACK-ROUTE": rule("V-TRACK-ROUTE", "warning"),
  "V-DURATION-SPEED": rule("V-DURATION-SPEED", "warning"),
  "V-DISTANCE-DIFF": rule("V-DISTANCE-DIFF", "info"),
  "V-BEFORE-FIRST-FLIGHT": rule("V-BEFORE-FIRST-FLIGHT", "error"),
  "V-REG-COUNTRY": rule("V-REG-COUNTRY", "info"),
  "V-INCOMPLETE": rule("V-INCOMPLETE", "info"),
  "V-PRIVATE-IN-NOTES": rule("V-PRIVATE-IN-NOTES", "info"),
  "C-TYPE-MISMATCH": rule("C-TYPE-MISMATCH", "error"),
  "C-REG-OVERLAP": rule("C-REG-OVERLAP", "error"),
  "C-OPERATOR-MISMATCH": rule("C-OPERATOR-MISMATCH", "warning"),
  "C-DUP-FLIGHT": rule("C-DUP-FLIGHT", "warning"),
  "C-DUP-SIGHTING": rule("C-DUP-SIGHTING", "info"),
  "C-DUP-TICKET": rule("C-DUP-TICKET", "warning"),
  "C-FLIGHT-OVERLAP": rule("C-FLIGHT-OVERLAP", "error"),
  "C-CODE-VARIANTS": rule("C-CODE-VARIANTS", "warning"),
  "C-LIVERY-NAME": rule("C-LIVERY-NAME", "info"),
  "C-LIVERY-MISSING": rule("C-LIVERY-MISSING", "warning"),
  "C-SAME-DAY": rule("C-SAME-DAY", "info"),
  // Found while importing: compares the source row with what the importer derived.
  "I-SOURCE-DIFF": rule("I-SOURCE-DIFF", "warning"),
};

export const SEVERITY_ORDER: Record<Severity, number> = { error: 0, warning: 1, info: 2 };
