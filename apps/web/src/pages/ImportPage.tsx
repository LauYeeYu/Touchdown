// Import (docs/21-import-export.md, docs/31-ui.md): choose a file, see how each row matches the log and
// what the checks say, decide on conflicts, then commit as one batch that can be undone.

import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import {
  checkAll,
  commitImport,
  matchCandidates,
  parseSource,
  PRIVATE_FIELDS,
  readCsv,
  readXlsx,
  resolveAirframes,
  Store,
  type Candidate,
  type CommitDecision,
  type Finding,
  type Match,
  type ParsedSource,
  type SheetData,
  type TableName,
} from "@touchdown/core";
import { useApp } from "../data/context.tsx";
import type { AppData } from "../data/app.ts";
import { dayMonthYear, plural } from "../lib/format.ts";
import { Icon } from "../lib/icons.tsx";
import { toast } from "../components/overlay.tsx";

const FORMAT_LABEL = { fr24_csv: "my.flightradar24.com export", flight_log_sheet: "flight log spreadsheet", spotting_sheet: "spotting spreadsheet" } as const;
const PRIVATE = new Set(PRIVATE_FIELDS.map((f) => f.split(".")[1]!));
const FIELD_LABEL: Record<string, string> = {
  takeoffAt: "Takeoff",
  landingAt: "Landing",
  boardingAt: "Boarding",
  typeCode: "Type code",
  typeCodeRaw: "Type code as typed",
  registration: "Registration",
  registrationRaw: "Registration as typed",
  seat: "Seat",
  airlineId: "Airline",
  airlineRaw: "Airline code",
  model: "Model",
  modelRaw: "Model as typed",
  notes: "Notes",
  ticketNumber: "Ticket number",
};

interface Prepared {
  source: ParsedSource;
  matches: Match[];
  findings: Map<number, Finding[]>; // by match index
}

/** Run the import on a scratch copy of the log to get every check before anything is saved. */
function prepare(app: AppData, source: ParsedSource): Prepared {
  const matches = matchCandidates(app.store, source.candidates);
  const scratch = new Store({ deviceId: "preview", validate: false });
  for (const t of ["flights", "sightings", "airframes", "registration_periods", "field_provenance", "sighting_tags", "external_ids", "issue_acks"] as TableName[]) scratch.load(t, app.store.allWithDeleted(t) as never);
  const r = commitImport(scratch, app.ref, source, matches);
  const res = resolveAirframes(scratch, app.ref);
  const all = checkAll(scratch, app.ref, { overlaps: res.overlaps });
  const idOf = new Map<number, string>();
  const created = new Map<string, string>();
  for (const t of ["flights", "sightings"] as const) for (const row of scratch.all(t)) if (row.sourceBatchId === r.batchId && row.sourceRow !== null) created.set(`${t}:${row.sourceRow}`, row.id);
  matches.forEach((m, i) => {
    const id = m.existingId ?? created.get(`${m.candidate.table}:${m.candidate.sourceRow}`);
    if (id) idOf.set(i, id);
  });
  const acked = new Set(app.store.all("issue_acks").map((a) => `${a.ruleId}|${a.fingerprint}`));
  const findings = new Map<number, Finding[]>();
  matches.forEach((m, i) => {
    const id = idOf.get(i);
    if (!id) return;
    const list = all.filter((f) => !acked.has(`${f.ruleId}|${f.fingerprint}`) && f.severity !== "info" && f.records.some((x) => x.table === m.candidate.table && x.id === id));
    if (list.length) findings.set(i, list);
  });
  return { source, matches, findings };
}

function label(c: Candidate): { title: string; sub: string } {
  if (c.table === "flights") {
    const v = c.values;
    return { title: [v.flightNumber, v.scheduledDate && dayMonthYear(v.scheduledDate)].filter(Boolean).join(" · ") || "Flight", sub: [v.fromRaw, v.toRaw].filter(Boolean).join(" → ") + (v.registration ? ` · ${v.registration}` : "") + (v.typeCode ? ` · ${v.typeCode}` : "") };
  }
  const v = c.values;
  return { title: [v.registration, v.seenOn && dayMonthYear(v.seenOn)].filter(Boolean).join(" · ") || "Sighting", sub: [v.airportRaw, v.operatorRaw, v.typeCode].filter(Boolean).join(" · ") };
}

const show = (field: string, v: unknown) => (PRIVATE.has(field) ? "(private)" : v === null || v === undefined ? "—" : String(v));

export function ImportPage() {
  const { app, version } = useApp();
  const [prepared, setPrepared] = useState<Prepared | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [decisions, setDecisions] = useState<Map<number, CommitDecision>>(new Map());
  const [filter, setFilter] = useState<"attention" | "all" | "new" | "update" | "identical" | "duplicate">("attention");
  const [result, setResult] = useState<{ batchId: string; created: number; updated: number; skipped: number; merged: number } | null>(null);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const batches = useMemo(() => app.store.all("import_batches").sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? "")), [app, version]);

  const onFile = async (file: File) => {
    setError(null);
    setResult(null);
    setBusy(true);
    try {
      const buf = new Uint8Array(await file.arrayBuffer());
      const isZip = buf[0] === 0x50 && buf[1] === 0x4b;
      let sheets: SheetData[];
      if (file.name.toLowerCase().endsWith(".xlsx")) sheets = readXlsx(buf);
      else if (isZip) {
        setError("This looks like a zip file. To load a Touchdown backup, use Restore in Settings.");
        return;
      } else sheets = [readCsv(new TextDecoder("utf-8").decode(buf), file.name)];
      let source: ParsedSource | null = null;
      for (const s of sheets) {
        source = parseSource(s, file.name, app.ref);
        if (source) break;
      }
      if (!source) {
        setError(`The columns of ${file.name} are not a format Touchdown knows yet (my.flightradar24.com export, or the flight log or spotting spreadsheet). First row: ${sheets[0]?.header.filter(Boolean).slice(0, 8).join(", ")}.`);
        return;
      }
      const p = prepare(app, source);
      setPrepared(p);
      setDecisions(new Map());
      setFilter(p.findings.size || p.matches.some((m) => m.kind === "conflict") ? "attention" : "all");
    } catch (e) {
      setError(`Could not read ${file.name}: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  const commit = () => {
    if (!prepared) return;
    const r = app.commitImport(prepared.source, prepared.matches, decisions);
    setResult(r);
    setPrepared(null);
    toast(`Imported: ${plural(r.created, "new record")}, ${plural(r.updated, "record")} filled in${r.merged ? `, ${plural(r.merged, "repeat")} merged` : ""}.`);
  };

  const setDecision = (i: number, patch: Partial<CommitDecision>) => setDecisions((d) => new Map(d).set(i, { ...(d.get(i) ?? {}), ...patch }));

  if (prepared) {
    const { source, matches, findings } = prepared;
    const counts = { new: 0, update: 0, identical: 0, conflict: 0, duplicate: 0 };
    for (const m of matches) counts[m.kind]++;
    const rowIssues = (i: number) => matches[i]!.candidate.issues.filter((x) => x.severity !== "info");
    const needs = (i: number) => matches[i]!.kind === "conflict" || matches[i]!.corrections.length > 0 || findings.has(i) || rowIssues(i).length > 0;
    const shown = matches.map((m, i) => ({ m, i })).filter(({ m, i }) => (filter === "attention" ? needs(i) : filter === "all" ? true : filter === "update" ? m.kind === "update" || m.kind === "conflict" : m.kind === filter));
    const skipped = [...decisions.values()].filter((d) => d.skip).length;
    const accepted = matches.filter((m, i) => m.kind !== "identical" && !decisions.get(i)?.skip).length;

    return (
      <div className="page page--wide">
        <nav className="crumbs" aria-label="Back">
          <button type="button" className="link-btn" onClick={() => setPrepared(null)}>
            <Icon name="arrow-left" /> Choose another file
          </button>
        </nav>
        <h1 className="form-title">Review {source.fileName}</h1>
        <p className="lead lead--flight">
          A {FORMAT_LABEL[source.format]} with {plural(source.rowsRead, "row")}: {plural(counts.new, "new record")}, {plural(counts.update, "record")} that fill gaps, {plural(counts.conflict, "record")} that disagree with your log, and {counts.identical} already there.
          {counts.duplicate > 0 && ` ${plural(counts.duplicate, "row repeats", "rows repeat")} an aircraft already seen at the same place that day; ${counts.duplicate === 1 ? "it is" : "they are"} merged into the first row.`}
        </p>
        <div className="chips" role="radiogroup" aria-label="Show rows">
          {(
            [
              ["attention", `Need a look (${matches.filter((_, i) => needs(i)).length})`],
              ["all", `All (${matches.length})`],
              ["new", `New (${counts.new})`],
              ["update", `Updates (${counts.update + counts.conflict})`],
              ["identical", `Already there (${counts.identical})`],
              ...(counts.duplicate ? ([["duplicate", `Repeats (${counts.duplicate})`]] as [typeof filter, string][]) : []),
            ] as [typeof filter, string][]
          ).map(([k, l]) => (
            <button key={k} type="button" role="radio" aria-checked={filter === k} className="chip" onClick={() => setFilter(k)}>
              {l}
            </button>
          ))}
        </div>
        <ul className="review-rows">
          {shown.slice(0, 400).map(({ m, i }) => {
            const l = label(m.candidate);
            const d = decisions.get(i) ?? {};
            const f = findings.get(i) ?? [];
            const issues = m.candidate.issues;
            return (
              <li key={i} className={`review-row review-row--${m.kind}${d.skip ? " is-skipped" : ""}`}>
                <div className="review-row__head">
                  <span className={`status status--${m.kind}`}>{m.kind === "new" ? "New" : m.kind === "update" ? "Fills gaps" : m.kind === "conflict" ? "Disagrees" : m.kind === "duplicate" ? "Repeat" : "Already there"}</span>
                  <span className="review-row__title">
                    <b>{l.title}</b>
                    <small>
                      Row {m.candidate.sourceRow}
                      {l.sub && ` · ${l.sub}`}
                    </small>
                  </span>
                  {m.kind !== "identical" && (
                    <label className="check">
                      <input type="checkbox" checked={!d.skip} onChange={(e) => setDecision(i, { skip: !e.target.checked })} />
                      Import
                    </label>
                  )}
                </div>
                {m.kind === "duplicate" && m.duplicateOf !== null && (
                  <p className="review-row__fills">
                    Same aircraft, place and day as row {matches[m.duplicateOf]!.candidate.sourceRow}: merged into that sighting (a different phase goes in its notes).{" "}
                    <label className="check">
                      <input type="checkbox" checked={!!d.keepSeparate} onChange={(e) => setDecision(i, { keepSeparate: e.target.checked })} />
                      Keep as a separate sighting
                    </label>
                  </p>
                )}
                {m.corrections.length > 0 && (
                  <p className="review-row__fills">
                    Takes the file's {m.corrections.map((x) => FIELD_LABEL[x.field]?.toLowerCase() ?? x.field).join(" and ")}: {m.corrections.map((x) => `${show(x.field, x.existing)} → ${show(x.field, x.incoming)}`).join(", ")}. {m.corrections[0]!.reason}{" "}
                    <label className="check">
                      <input
                        type="checkbox"
                        checked={!!d.rejectCorrections?.length}
                        onChange={(e) => setDecision(i, { rejectCorrections: e.target.checked ? m.corrections.map((x) => x.field) : [] })}
                      />
                      Keep the log's times
                    </label>
                  </p>
                )}
                {m.kind === "update" && m.fills.length > 0 && <p className="review-row__fills">Adds {m.fills.filter((x) => !x.endsWith("Raw")).map((x) => FIELD_LABEL[x] ?? x).join(", ")}.</p>}
                {m.conflicts.length > 0 && (
                  <table className="table table--diff">
                    <thead>
                      <tr>
                        <th>Field</th>
                        <th>In your log</th>
                        <th>In the file</th>
                        <th>Use the file's</th>
                      </tr>
                    </thead>
                    <tbody>
                      {m.conflicts.filter((c) => !(c.field.endsWith("Raw") && m.conflicts.some((y) => y.field === c.field.slice(0, -3)))).map((c) => (
                        <tr key={c.field}>
                          <td>{FIELD_LABEL[c.field] ?? c.field}</td>
                          <td>{show(c.field, c.existing)}</td>
                          <td>{show(c.field, c.incoming)}</td>
                          <td>
                            <input
                              type="checkbox"
                              aria-label={`Use the file's ${FIELD_LABEL[c.field] ?? c.field}`}
                              checked={!!d.takeIncoming?.includes(c.field)}
                              onChange={(e) => {
                                const cur = new Set(d.takeIncoming ?? []);
                                // A field and its raw form go together.
                                const pair = [c.field, c.field.endsWith("Raw") ? c.field.slice(0, -3) : `${c.field}Raw`].filter((x) => m.conflicts.some((y) => y.field === x));
                                for (const x of pair) e.target.checked ? cur.add(x) : cur.delete(x);
                                setDecision(i, { takeIncoming: [...cur] });
                              }}
                            />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
                {(issues.length > 0 || f.length > 0) && (
                  <ul className="findings findings--compact">
                    {issues.map((x, k) => (
                      <li key={`i${k}`} className={`finding finding--${x.severity}`}>
                        <Icon name={x.severity === "error" ? "circle-x" : x.severity === "warning" ? "triangle-alert" : "info"} />
                        <p className="finding__text">{x.message}</p>
                      </li>
                    ))}
                    {f.map((x) => (
                      <li key={x.fingerprint} className={`finding finding--${x.severity}`}>
                        <Icon name={x.severity === "error" ? "circle-x" : "triangle-alert"} />
                        <p className="finding__text">{x.message}</p>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
        {shown.length > 400 && <p className="section__aside">Showing the first 400 rows of this list.</p>}
        <div className="commit-bar">
          <p>
            {plural(accepted, "row")} will be imported{skipped ? `, ${skipped} skipped` : ""}. Checks are saved with the records and can be fixed later under Issues. You can undo the whole import.
          </p>
          <button type="button" className="btn btn--primary" onClick={commit} disabled={!accepted}>
            <Icon name="check" />
            Import {plural(accepted, "row")}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="page page--form">
      <div className="view-top" />
      <h1 className="form-title">Import</h1>
      <p className="form-sub">Nothing is saved until you have reviewed the rows. Every import can be undone.</p>
      <label className={`dropzone${busy ? " is-busy" : ""}`}>
        <Icon name="upload" />
        <span>
          <b>{busy ? "Reading…" : "Choose a file"}</b>
          <span>A my.flightradar24.com CSV export, or your flight log or spotting spreadsheet as CSV or Excel (.xlsx). Import the FR24 export first, then the flight log: matching flights are merged.</span>
        </span>
        <input
          type="file"
          accept=".csv,.xlsx,text/csv"
          className="visually-hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void onFile(f);
            e.target.value = "";
          }}
        />
      </label>
      {error && (
        <p className="status-line status-line--check" role="alert">
          <Icon name="triangle-alert" />
          <span>{error}</span>
        </p>
      )}
      {result && (
        <div className="import-done">
          <p className="status-line status-line--good">
            <Icon name="circle-check" />
            <span>
              Imported {plural(result.created, "new record")} and filled in {plural(result.updated, "record")}
              {result.skipped ? `; ${result.skipped} skipped or already there` : ""}. <Link to="/issues">See what to review</Link>.
            </span>
          </p>
        </div>
      )}
      {batches.length > 0 && (
        <section className="section">
          <div className="section__head">
            <h2 className="section__title">Import history</h2>
          </div>
          <ul className="rows">
            {batches.map((b) => (
              <li key={b.id} className="history-row">
                <span>
                  <b>{b.fileName}</b>
                  <small>
                    {b.createdAt ? new Date(b.createdAt).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" }) : ""} · {plural(b.rowsAccepted ?? 0, "row")} imported
                    {b.status === "undone" ? " · undone" : ""}
                  </small>
                </span>
                {b.status === "committed" && (
                  <button
                    type="button"
                    className="btn btn--quiet btn--small"
                    onClick={() => {
                      if (!window.confirm(`Undo the import of ${b.fileName}? Records it created are removed and records it changed get their old values back.`)) return;
                      const r = app.undoImport(b.id);
                      if (r.editedSince.length && window.confirm(`${plural(r.editedSince.length, "record")} were edited after the import and were left alone. Undo those too, losing the edits?`)) app.undoImport(b.id, true);
                      toast(`Undone: ${plural(r.removed, "record")} removed, ${plural(r.restored, "record")} restored.`);
                    }}
                  >
                    <Icon name="undo" />
                    Undo
                  </button>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
