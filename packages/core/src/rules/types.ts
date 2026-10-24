// Findings produced by the checks (docs/20-validation.md). Checks never block saving.

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

export const RULES: Record<string, { title: string; severity: Severity | "varies" }> = {
  "V-REG-FORMAT": { title: "Registration format", severity: "warning" },
  "V-DATE-SANE": { title: "Date out of range", severity: "error" },
  "V-AIRPORT-KNOWN": { title: "Unknown airport", severity: "error" },
  "V-AIRPORT-SAME": { title: "Same departure and arrival airport", severity: "warning" },
  "V-OPERATOR-KNOWN": { title: "Unknown airline", severity: "error" },
  "V-TYPE-KNOWN": { title: "Unknown type code", severity: "error" },
  "V-MODEL-TYPE": { title: "Model does not match type code", severity: "warning" },
  "V-MODEL-PARSE": { title: "Model not recognised", severity: "warning" },
  "V-FLIGHTNO-FORMAT": { title: "Flight number format", severity: "warning" },
  "V-FLIGHTNO-AIRLINE": { title: "Flight number and airline differ", severity: "warning" },
  "V-SEAT-FORMAT": { title: "Seat format", severity: "warning" },
  "V-TIMES-ORDER": { title: "Times out of order", severity: "error" },
  "V-TIME-OFFSET": { title: "UTC offset does not match the airport", severity: "error" },
  "V-DAY-ROLLOVER": { title: "Takeoff date", severity: "varies" },
  "V-DURATION-SPEED": { title: "Implausible speed", severity: "warning" },
  "V-DISTANCE-DIFF": { title: "Distance differs from great circle", severity: "info" },
  "V-BEFORE-FIRST-FLIGHT": { title: "Before the aircraft's first flight", severity: "error" },
  "V-REG-COUNTRY": { title: "Registration country differs from airline country", severity: "info" },
  "V-INCOMPLETE": { title: "Missing fields", severity: "info" },
  "V-PRIVATE-IN-NOTES": { title: "Private data in notes", severity: "info" },
  "C-TYPE-MISMATCH": { title: "Type code differs from the aircraft's", severity: "error" },
  "C-REG-OVERLAP": { title: "Registration on two aircraft at once", severity: "error" },
  "C-OPERATOR-MISMATCH": { title: "Operator differs from the aircraft's", severity: "warning" },
  "C-DUP-FLIGHT": { title: "Duplicate flight", severity: "warning" },
  "C-DUP-SIGHTING": { title: "Duplicate sighting", severity: "info" },
  "C-DUP-TICKET": { title: "Duplicate ticket coupon", severity: "warning" },
  "C-FLIGHT-OVERLAP": { title: "Flights overlap in time", severity: "error" },
  "C-CODE-VARIANTS": { title: "Code spelt in different ways", severity: "warning" },
  "C-LIVERY-NAME": { title: "Livery spelt in different ways", severity: "info" },
  "C-LIVERY-MISSING": { title: "Special livery missing", severity: "warning" },
  "C-SAME-DAY": { title: "Flown and photographed on the same day", severity: "info" },
  // Found while importing: compares the source row with what the importer derived.
  "I-SOURCE-DIFF": { title: "Source values disagree", severity: "warning" },
};

export const SEVERITY_ORDER: Record<Severity, number> = { error: 0, warning: 1, info: 2 };
