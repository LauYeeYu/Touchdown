// What an import review starts from (docs/21, stages 4–9; docs/34, "The review"), on the Import page and in
// `touchdown review`: the rows matched against the log, then imported into a copy of it so that every check runs,
// and the findings each row would bring. Nothing is written to the log.

import { refOverridesOf } from "../edit.ts";
import { resolveAirframes } from "../identity/resolve.ts";
import type { RefIndex } from "../ref/index.ts";
import { checkAll } from "../rules/check.ts";
import type { Finding } from "../rules/types.ts";
import type { Store } from "../store.ts";
import type { ParsedSource } from "./candidate.ts";
import { copyStore } from "./changes.ts";
import { commitImport, matchCandidates, type Match } from "./pipeline.ts";

export interface PreparedImport {
  source: ParsedSource;
  matches: Match[];
  /** Findings each row would bring, by match index: not accepted, notes left out. */
  findings: Map<number, Finding[]>;
}

export function prepareImport(store: Store, ref: RefIndex, source: ParsedSource): PreparedImport {
  const matches = matchCandidates(store, source.candidates);
  const scratch = copyStore(store);
  try {
    const r = commitImport(scratch, ref, source, matches);
    const all = checkAll(scratch, ref, { overlaps: resolveAirframes(scratch, ref).overlaps });
    const created = new Map<string, string>();
    for (const t of ["flights", "sightings"] as const) for (const row of scratch.all(t)) if (row.sourceBatchId === r.batchId && row.sourceRow !== null) created.set(`${t}:${row.sourceRow}`, row.id);
    const acked = new Set(store.all("issue_acks").map((a) => `${a.ruleId}|${a.fingerprint}`));
    const findings = new Map<number, Finding[]>();
    matches.forEach((m, i) => {
      const id = m.existingId ?? created.get(`${m.candidate.table}:${m.candidate.sourceRow}`);
      if (!id) return;
      const list = all.filter((f) => !acked.has(`${f.ruleId}|${f.fingerprint}`) && f.severity !== "info" && f.records.some((x) => x.table === m.candidate.table && x.id === id));
      if (list.length) findings.set(i, list);
    });
    return { source, matches, findings };
  } finally {
    // Operators written by name were added to the index for the copy; the log has none of them yet.
    ref.setUserOverrides(refOverridesOf(store));
  }
}
