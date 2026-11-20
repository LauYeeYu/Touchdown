// The agent check of records already in the log (docs/22-agent-verification.md, "Records in the log"), for
// `touchdown check log`: which records it takes, each record as the agent is sent it, and the edit input for the
// suggestions the user takes, which go to the inbox as an ordinary change file for review.

import type { RefIndex } from "../ref/index.ts";
import type { Flight, Sighting } from "../schema/tables.ts";
import type { Store } from "../store.ts";
import { phasesOf } from "../phases.ts";
import { AGENT_FIELDS, asTypedFields, recordFields, type AgentEvidence, type AgentField, type AgentSuggestion, type CheckRecord } from "./check.ts";
import type { EditInput } from "../import/changes.ts";

export type LogRecord = { table: "flights"; row: Flight } | { table: "sightings"; row: Sighting };

/** A record's key in the list of records checked: "sightings:01J…". */
export const logRecordKey = (r: LogRecord) => `${r.table}:${r.row.id}`;

/**
 * A record's fields as the agent sees them. A sighting's phase is in a table of its own: it is sent when there is
 * one, and a sighting seen in several phases is sent without it, so no suggestion can replace them with one.
 */
export function logRecordFields(store: Store, ref: RefIndex, r: LogRecord): Partial<Record<AgentField, string>> {
  if (r.table === "flights") return recordFields({ table: "flights", values: r.row }, ref);
  const phases = phasesOf(store, r.row.id);
  return recordFields({ table: "sightings", values: { ...r.row, phase: phases.length === 1 ? (phases[0] as Sighting["phase"]) : null } }, ref);
}

/** What the agent was sent about a record, as a string: a record whose fields are the same again is not sent again. */
export function logRecordFingerprint(store: Store, ref: RefIndex, r: LogRecord): string {
  const fields = logRecordFields(store, ref, r);
  return JSON.stringify(Object.keys(fields).sort().map((k) => [k, fields[k as AgentField]]));
}

/**
 * The records a log check takes (docs/22, "Records in the log"). With `all`, every flight and sighting; with `since`
 * (a date), those added or changed on it or later; otherwise those the agent has not seen as they are now: not in
 * `checked` (record key → fingerprint, kept by the CLI) with the same fields, and not from an import the agent
 * checked. In order of registration, then date, so one aircraft's records go to the agent together.
 */
export function recordsToCheck(store: Store, ref: RefIndex, checked: ReadonlyMap<string, string>, o: { all?: boolean; since?: string | null } = {}): LogRecord[] {
  const agentBatches = new Set(store.all("import_batches").filter((b) => b.agentChecker === "claude" || b.agentChecker === "codex").map((b) => b.id));
  const all: LogRecord[] = [...store.all("flights").map((row) => ({ table: "flights" as const, row })), ...store.all("sightings").map((row) => ({ table: "sightings" as const, row }))];
  const taken = all.filter((r) => {
    if (o.all) return true;
    if (o.since) return (r.row.updatedAt ?? "").slice(0, 10) >= o.since;
    const seen = checked.get(logRecordKey(r));
    if (seen !== undefined) return seen !== logRecordFingerprint(store, ref, r);
    return !(r.row.sourceBatchId && agentBatches.has(r.row.sourceBatchId));
  });
  const date = (r: LogRecord) => (r.table === "flights" ? r.row.scheduledDate : r.row.seenOn) ?? "";
  return taken.sort((a, b) => (a.row.registration ?? "~").localeCompare(b.row.registration ?? "~") || date(a).localeCompare(date(b)) || a.row.id.localeCompare(b.row.id));
}

/** A record in the log as the agent is sent it: the same shape as an import's row, with what lookups say. */
export function logCheckRecord(store: Store, ref: RefIndex, r: LogRecord, o: { recordId: string; findings: string[]; evidence: AgentEvidence[]; includeNotes: boolean }): CheckRecord {
  const fields = logRecordFields(store, ref, r);
  const asTyped = r.table === "flights" ? asTypedFields({ table: "flights", values: r.row }, fields) : asTypedFields({ table: "sightings", values: r.row }, fields);
  const rec: CheckRecord = { recordId: o.recordId, kind: r.table === "sightings" ? "sighting" : "flight", fields, asTyped, findings: o.findings, evidence: o.evidence };
  if (o.includeNotes && r.row.notes) rec.notes = r.row.notes;
  return rec;
}

/** The field of `touchdown edit` an agent field is: a sighting's operator is its airline there. */
const EDIT_FIELD: Partial<Record<AgentField, string>> = { operator: "airline" };

/**
 * The edit input for the suggestions taken on one record, as `touchdown edit --set` would read them; an empty
 * suggestion clears the field. Only the fields the agent may suggest for the record's kind, and no phase for a
 * sighting seen in several (it was not sent one).
 */
export function suggestionEditInput(store: Store, r: LogRecord, taken: Pick<AgentSuggestion, "field" | "suggested">[]): EditInput {
  const allowed = new Set<string>(AGENT_FIELDS[r.table === "flights" ? "flight" : "sighting"]);
  if (r.table === "sightings" && phasesOf(store, r.row.id).length > 1) allowed.delete("phase");
  const input: EditInput = {};
  for (const s of taken) if (allowed.has(s.field)) input[EDIT_FIELD[s.field] ?? s.field] = s.suggested.trim() || null;
  return input;
}
