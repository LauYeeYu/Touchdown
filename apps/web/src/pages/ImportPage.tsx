// Import (docs/21-import-export.md, docs/31-ui.md): choose a file, see how each row matches the log and
// what the checks say, decide on conflicts, optionally have an agent check the rows (docs/22), then commit as one
// batch that can be undone.

import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import {
  applySuggestions,
  buildCheckRequest,
  checkBatchId,
  fieldsOf,
  guessMapping,
  headerSignature,
  isFr24Export,
  mappingProblem,
  parseSource,
  PRIVATE_FIELDS,
  readMapped,
  unsureColumns,
  readCsv,
  readInbox,
  readXlsx,
  recordIdOf,
  storedFields,
  type AgentField,
  type AgentSuggestion,
  type Candidate,
  type CheckResultFile,
  prepareImport,
  type CommitDecision,
  type InboxChange,
  type PreparedImport,
  type ParsedSource,
  type SheetData,
  type SheetMapping,
} from "@touchdown/core";
import { useApp } from "../data/context.tsx";
import { ColumnMapping, type ColumnChoice } from "../components/ColumnMapping.tsx";
import { savedMapping, saveMapping } from "../data/mappings.ts";
import { discardSession, madeBy, markImported, recordsText, sessionLabel, useWaitingSessions, type WaitingSession } from "../data/inbox.ts";
import type { AppData } from "../data/app.ts";
import { dayMonthYear, FIELD_LABEL, plural } from "../lib/format.ts";
import { Icon } from "../lib/icons.tsx";
import { toast } from "../components/overlay.tsx";
import { AgentCheckPanel, AgentSuggestions, choiceKey, type Choice } from "../components/AgentCheck.tsx";
import { ChangeReview } from "../components/ChangeReview.tsx";

const FORMAT_LABEL = { fr24_csv: "my.flightradar24.com export", sheet: "spreadsheet", touchdown_inbox: "file from the inbox" } as const;
const PRIVATE = new Set(PRIVATE_FIELDS.map((f) => f.split(".")[1]!));

type Prepared = PreparedImport;

/** Run the import on a copy of the log to get every check before anything is saved (core: prepareImport). */
const prepare = (app: AppData, source: ParsedSource): Prepared => prepareImport(app.store, app.ref, source);

function label(c: Candidate): { title: string; sub: string } {
  if (c.table === "flights") {
    const v = c.values;
    return { title: [v.flightNumber, v.scheduledDate && dayMonthYear(v.scheduledDate)].filter(Boolean).join(" · ") || "Flight", sub: [v.fromRaw, v.toRaw].filter(Boolean).join(" → ") + (v.registration ? ` · ${v.registration}` : "") + (v.typeCode ? ` · ${v.typeCode}` : "") };
  }
  const v = c.values;
  return { title: [v.registration, v.seenOn && dayMonthYear(v.seenOn)].filter(Boolean).join(" · ") || "Sighting", sub: [v.airportRaw, v.operatorRaw, v.typeCode].filter(Boolean).join(" · ") };
}

/** An inbox file (`touchdown spot`, `touchdown add`); a check request or result gets a pointer to where it belongs. */
function readJsonFile(buf: Uint8Array, name: string, app: AppData): { source: ParsedSource; changes: InboxChange[] } | { error: string } {
  let json: unknown;
  try {
    json = JSON.parse(new TextDecoder("utf-8").decode(buf));
  } catch {
    return { error: `${name} is not valid JSON.` };
  }
  const schema = (json as { schema?: unknown } | null)?.schema;
  if (schema === "touchdown-check-result") return { error: `${name} is an agent check result. Choose the file it was made for first, then load the result under "Check with an agent".` };
  if (schema === "touchdown-check-request") return { error: `${name} is a check request. Run \`npm run touchdown -- check\` on it, then load the result it writes.` };
  const r = readInbox(json, name, app.ref);
  return "error" in r ? { error: `${name}: ${r.error}.` } : r;
}

/** "2 flights not in your log yet", "3 changes to make", or both. */
const waitingText = (w: WaitingSession) =>
  [w.flights + w.sightings ? `${recordsText(w.flights, w.sightings)} not in your log yet` : null, w.changing ? `${plural(w.changing, "change")} to make` : null].filter(Boolean).join("; ");

const show = (field: string, v: unknown) => (PRIVATE.has(field) ? "(private)" : v === null || v === undefined ? "—" : String(v));

export function ImportPage() {
  const { app, version } = useApp();
  // The file as read, prepared, and its batch id for the agent check (from its bytes, so the same file read again
  // fits a result).
  const [base, setBase] = useState<{ source: ParsedSource; batchId: string; asRead: Prepared } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [decisions, setDecisions] = useState<Map<number, CommitDecision>>(new Map());
  const [filter, setFilter] = useState<"attention" | "all" | "new" | "update" | "identical" | "duplicate" | "agent">("attention");
  const [agent, setAgent] = useState<CheckResultFile | null>(null);
  // The spotting session being reviewed, when the file came from the inbox: it leaves the inbox once imported.
  const [origin, setOrigin] = useState<string | null>(null);
  // A change file under review (docs/34): its name, its changes, and the inbox file it came from, if it did.
  const [changeFile, setChangeFile] = useState<{ name: string; changes: InboxChange[]; inbox: string | null } | null>(null);
  const [changesMade, setChangesMade] = useState<{ applied: number; messages: string[] } | null>(null);
  // A spreadsheet's columns: what was worked out, what the user chose, and whether the column step is showing.
  const [columns, setColumns] = useState<{ sheet: SheetData; guess: SheetMapping; choice: ColumnChoice; fileName: string; bytes: Uint8Array; how: string } | null>(null);
  const [choosingColumns, setChoosingColumns] = useState(false);
  const waiting = useWaitingSessions();
  const search = useSearch({ from: "/import" });
  const navigate = useNavigate();
  const [choices, setChoices] = useState<Map<string, Choice>>(new Map());

  // The suggestions in use, by record id. The review is prepared again from the file with them applied, so the
  // checks run on the corrected values and a suggestion can be taken back.
  const accepted = useMemo(() => {
    const m = new Map<string, AgentSuggestion[]>();
    for (const r of agent?.records ?? []) {
      const used = r.suggestions.filter((x) => choices.get(choiceKey(r.recordId, x.field)) === "used");
      if (used.length) m.set(r.recordId, used);
    }
    return m;
  }, [agent, choices]);
  const acceptedKey = [...accepted].map(([id, l]) => `${id}:${l.map((x) => `${x.field}=${x.suggested}`).join(",")}`).join(";");
  const asRead = base?.asRead ?? null;
  const prepared = useMemo(
    () => (!base || !asRead ? null : accepted.size ? prepare(app, applySuggestions(base.source, accepted, app.ref)) : asRead),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [asRead, acceptedKey],
  );
  const [result, setResult] = useState<{ batchId: string; created: number; updated: number; skipped: number; merged: number } | null>(null);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const batches = useMemo(() => app.store.all("import_batches").sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? "")), [app, version]);

  /** Opens a parsed file for review. `inbox` names the spotting session it came from, if it did. */
  const open = async (source: ParsedSource, bytes: Uint8Array, inbox: string | null = null) => {
    const p = prepare(app, source);
    setBase({ source, batchId: await checkBatchId(bytes), asRead: p });
    setOrigin(inbox);
    setAgent(null);
    setChoices(new Map());
    setDecisions(new Map());
    // A row with something open (a spotting session's doubts, a conflict, a finding) opens the review on those rows.
    setFilter(p.findings.size || p.matches.some((m) => m.kind === "conflict" || m.candidate.issues.some((x) => x.severity !== "info")) ? "attention" : "all");
  };

  const useColumns = async () => {
    if (!columns) return;
    saveMapping(headerSignature(columns.sheet.header), columns.choice);
    setChoosingColumns(false);
    setColumns({ ...columns, how: "as you set them" });
    await open(readMapped(columns.sheet, columns.choice, columns.fileName, app.ref), columns.bytes);
  };

  const openSession = (w: WaitingSession) => {
    setError(null);
    setResult(null);
    setChangesMade(null);
    setColumns(null);
    // A file of changes (from ./touchdown edit and the other changing commands) has its own review.
    if (w.changing && !(w.flights + w.sightings)) {
      setChangeFile({ name: w.name, changes: w.changes, inbox: w.name });
      return;
    }
    void open(w.source, new TextEncoder().encode(`${w.name}@${w.modified}`), w.name);
  };

  // "Review and import" in the bar: open the session named in the address, once the inbox has been read.
  useEffect(() => {
    if (!search.inbox || base) return;
    const w = waiting.find((x) => x.name === search.inbox);
    if (!w) return;
    openSession(w);
    void navigate({ to: "/import", search: {}, replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search.inbox, waiting, base]);

  const onFile = async (file: File) => {
    setError(null);
    setResult(null);
    setChangesMade(null);
    setBusy(true);
    try {
      const buf = new Uint8Array(await file.arrayBuffer());
      const isZip = buf[0] === 0x50 && buf[1] === 0x4b;
      let source: ParsedSource | null = null;
      setColumns(null);
      if (file.name.toLowerCase().endsWith(".json")) {
        const inbox = readJsonFile(buf, file.name, app);
        if ("error" in inbox) {
          setError(inbox.error);
          return;
        }
        if (inbox.changes.length && !inbox.source.candidates.length) {
          setChangeFile({ name: file.name, changes: inbox.changes, inbox: null });
          return;
        }
        source = inbox.source;
      } else {
        let sheets: SheetData[];
        if (file.name.toLowerCase().endsWith(".xlsx")) sheets = readXlsx(buf);
        else if (isZip) {
          setError("This looks like a zip file. To load a Touchdown backup, use Restore in Settings.");
          return;
        } else sheets = [readCsv(new TextDecoder("utf-8").decode(buf), file.name)];
        const fr24 = sheets.find((s) => isFr24Export(s.header));
        if (fr24) source = parseSource(fr24, file.name, app.ref);
        else {
          // Any other layout: the first sheet (tab) whose columns hold enough, else the first with rows, for the user to map.
          const guesses = sheets.filter((s) => s.rows.length).map((sheet) => ({ sheet, guess: guessMapping(sheet, app.ref) }));
          const pick = guesses.find((x) => !mappingProblem(fieldsOf(x.guess))) ?? guesses[0];
          if (!pick) {
            setError(`${file.name} has no rows to read.`);
            return;
          }
          const saved = savedMapping(headerSignature(pick.sheet.header));
          const fit = saved && saved.fields.length === pick.sheet.header.length ? saved : null;
          const choice = fit ?? fieldsOf(pick.guess);
          const ctx = { sheet: pick.sheet, guess: pick.guess, choice, fileName: file.name, bytes: buf, how: fit ? "as you set them before" : "worked out from the headers and values" };
          setColumns(ctx);
          // Unclear columns, or not enough to read rows: the user looks first.
          if (!fit && (unsureColumns(pick.guess).length || mappingProblem(choice))) {
            setChoosingColumns(true);
            return;
          }
          source = readMapped(pick.sheet, choice, file.name, app.ref);
        }
      }
      if (!source) return;
      await open(source, buf);
    } catch (e) {
      setError(`Could not read ${file.name}: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  // Fields an accepted suggestion sets, by row index: they replace what the log has, and get an agent provenance row.
  const agentFields = useMemo(() => {
    const m = new Map<number, string[]>();
    if (!base) return m;
    base.source.candidates.forEach((c, i) => {
      const list = accepted.get(recordIdOf(c));
      if (list) m.set(i, list.flatMap((x) => storedFields(c.table === "sightings" ? "sighting" : "flight", x.field)));
    });
    return m;
  }, [base, accepted]);

  const commit = () => {
    if (!prepared) return;
    const withAgent = new Map(decisions);
    for (const [i, fields] of agentFields) {
      const d = withAgent.get(i) ?? {};
      withAgent.set(i, { ...d, takeIncoming: [...new Set([...(d.takeIncoming ?? []), ...fields])] });
    }
    const r = app.commitImport(prepared.source, prepared.matches, withAgent, agent && agentFields.size ? { checker: agent.checker, fields: agentFields } : undefined);
    setResult(r);
    setBase(null);
    setAgent(null);
    setChoices(new Map());
    if (origin) void markImported(app, origin, r.batchId);
    setOrigin(null);
    toast(`Imported: ${plural(r.created, "new record")}, ${plural(r.updated, "record")} filled in${r.merged ? `, ${plural(r.merged, "repeat")} merged` : ""}.`);
  };

  /** The file from the inbox under review is not wanted: it is deleted, and nothing goes into the log. */
  const discardReviewed = (name: string) => {
    const w = waiting.find((x) => x.name === name);
    const what = w ? recordsText(w.flights, w.sightings, w.changing) : plural(base?.source.rowsRead ?? 0, "record");
    if (!window.confirm(`Discard this file? The ${what} in it ${(w?.waiting ?? base?.source.rowsRead) === 1 ? "does" : "do"} not reach your log, and the file is deleted from the inbox.`)) return;
    setBase(null);
    setOrigin(null);
    setChangeFile(null);
    void discardSession(app, name).then(() => toast("Discarded: the file is deleted from the inbox."));
  };

  if (changeFile) {
    const inbox = changeFile.inbox;
    return (
      <ChangeReview
        fileName={changeFile.name}
        label={inbox ? sessionLabel(inbox) : changeFile.name}
        madeBy={inbox ? madeBy(inbox) : null}
        changes={changeFile.changes}
        fromInbox={!!inbox}
        onBack={() => setChangeFile(null)}
        onDiscard={() => inbox && discardReviewed(inbox)}
        onImported={(applied, batchId, messages) => {
          if (inbox) void markImported(app, inbox, batchId);
          setChangeFile(null);
          setChangesMade({ applied, messages });
          toast(`Imported: ${plural(applied, "change")} made.`);
        }}
      />
    );
  }

  const setDecision = (i: number, patch: Partial<CommitDecision>) => setDecisions((d) => new Map(d).set(i, { ...(d.get(i) ?? {}), ...patch }));

  if (choosingColumns && columns) {
    return (
      <div className="page page--form">
        <nav className="crumbs" aria-label="Back">
          <button
            type="button"
            className="link-btn"
            onClick={() => {
              setChoosingColumns(false);
              if (!base) setColumns(null);
            }}
          >
            <Icon name="arrow-left" /> {base ? "Back to the rows" : "Choose another file"}
          </button>
        </nav>
        <h1 className="form-title">Columns of {columns.fileName}</h1>
        <p className="form-sub">Touchdown worked out what each column holds. Look at the ones marked unclear, change anything that is wrong, then read the rows.</p>
        <ColumnMapping
          guess={columns.guess}
          value={columns.choice}
          onChange={(choice) => setColumns({ ...columns, choice })}
          onUse={() => void useColumns()}
          onCancel={() => {
            setChoosingColumns(false);
            setColumns(null);
            setBase(null);
          }}
        />
      </div>
    );
  }

  if (prepared && base && asRead) {
    const { source, matches, findings } = prepared;
    const counts = { new: 0, update: 0, identical: 0, conflict: 0, duplicate: 0 };
    for (const m of matches) counts[m.kind]++;
    const agentOf = new Map((agent?.records ?? []).map((r) => [r.recordId, r]));
    const agentRow = (i: number) => agentOf.get(recordIdOf(matches[i]!.candidate));
    const pending = (i: number) => {
      const r = agentRow(i);
      return !!r && (r.suggestions.some((x) => !choices.has(choiceKey(r.recordId, x.field))) || (!r.suggestions.length && !!r.note));
    };
    const rowIssues = (i: number) => matches[i]!.candidate.issues.filter((x) => x.severity !== "info");
    const needs = (i: number) => matches[i]!.kind === "conflict" || matches[i]!.corrections.length > 0 || findings.has(i) || rowIssues(i).length > 0 || pending(i);
    const shown = matches
      .map((m, i) => ({ m, i }))
      .filter(({ m, i }) => (filter === "attention" ? needs(i) : filter === "all" ? true : filter === "agent" ? !!agentRow(i) : filter === "update" ? m.kind === "update" || m.kind === "conflict" : m.kind === filter));
    const all = (agent?.records ?? []).flatMap((r) => r.suggestions.map((x) => ({ r, x })));
    const agentCounts = {
      suggestions: all.length,
      rows: (agent?.records ?? []).filter((r) => r.suggestions.length).length,
      used: all.filter(({ r, x }) => choices.get(choiceKey(r.recordId, x.field)) === "used").length,
      dismissed: all.filter(({ r, x }) => choices.get(choiceKey(r.recordId, x.field)) === "dismissed").length,
      highPending: all.filter(({ r, x }) => x.confidence === "high" && !choices.has(choiceKey(r.recordId, x.field))).length,
    };
    const choose = (recordId: string, field: AgentField, c: Choice | null) =>
      setChoices((prev) => {
        const next = new Map(prev);
        if (c) next.set(choiceKey(recordId, field), c);
        else next.delete(choiceKey(recordId, field));
        return next;
      });
    const skipped = [...decisions.values()].filter((d) => d.skip).length;
    const toImport = matches.filter((m, i) => (m.kind !== "identical" || agentFields.has(i)) && !decisions.get(i)?.skip).length;

    return (
      <div className="page page--wide">
        <nav className="crumbs" aria-label="Back">
          <button
            type="button"
            className="link-btn"
            onClick={() => {
              setBase(null);
              setOrigin(null);
            }}
          >
            <Icon name="arrow-left" /> Choose another file
          </button>
        </nav>
        <h1 className="form-title">Review {source.fileName}</h1>
        <p className="lead lead--flight">
          A {FORMAT_LABEL[source.format]} with {plural(source.rowsRead, "row")}: {plural(counts.new, "new record")}, {plural(counts.update, "record")} that fill gaps, {plural(counts.conflict, "record")} that disagree with your log, and {counts.identical} already there.
          {counts.duplicate > 0 && ` ${plural(counts.duplicate, "row repeats", "rows repeat")} an aircraft already seen at the same place that day; ${counts.duplicate === 1 ? "it is" : "they are"} merged into the first row.`}
        </p>
        {source.format === "sheet" && columns && (
          <p className="form-sub">
            Columns {columns.how}: {plural(columns.choice.fields.filter((f) => f !== "ignore").length, "column")} used, {columns.choice.fields.filter((f) => f === "ignore").length} not.{" "}
            <button type="button" className="link-btn" onClick={() => setChoosingColumns(true)}>
              Change the columns
            </button>
          </p>
        )}
        {source.format === "touchdown_inbox" ? (
          <p className="form-sub">
            {source.fileName.startsWith("add-")
              ? "Checked against your log by ./touchdown add. Values marked as coming from a lookup or an agent are saved with their source."
              : `Filled and checked in a spotting session (${source.agentChecker ? `with ${source.agentChecker === "codex" ? "Codex" : "Claude Code"}` : "without an agent"}). Values from a lookup or the agent are saved with their source.`}
          </p>
        ) : (
        <AgentCheckPanel
          batchId={base.batchId}
          ref={app.ref}
          request={() =>
            buildCheckRequest(base.source, app.ref, {
              batchId: base.batchId,
              findings: new Map([...asRead.findings].map(([i, list]) => [i, list.map((f) => f.message)])),
              // The CLI adds its own rules and leaves notes out unless it is set to send them.
              rules: [],
              includeNotes: true,
            })
          }
          result={agent}
          counts={agentCounts}
          onResult={(r) => {
            setAgent(r);
            setChoices(new Map());
            if (r?.records.length) setFilter("agent");
          }}
          onUseHigh={() =>
            setChoices((prev) => {
              const next = new Map(prev);
              for (const { r, x } of all) if (x.confidence === "high" && !next.has(choiceKey(r.recordId, x.field))) next.set(choiceKey(r.recordId, x.field), "used");
              return next;
            })
          }
          onShow={() => setFilter("agent")}
        />
        )}
        <div className="chips" role="radiogroup" aria-label="Show rows">
          {(
            [
              ["attention", `Need a look (${matches.filter((_, i) => needs(i)).length})`],
              ["all", `All (${matches.length})`],
              ["new", `New (${counts.new})`],
              ["update", `Updates (${counts.update + counts.conflict})`],
              ["identical", `Already there (${counts.identical})`],
              ...(counts.duplicate ? ([["duplicate", `Repeats (${counts.duplicate})`]] as [typeof filter, string][]) : []),
              ...(agent?.records.length ? ([["agent", `Agent (${agent.records.length})`]] as [typeof filter, string][]) : []),
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
            const fromAgent = new Set(agentFields.get(i) ?? []);
            const ar = agentRow(i);
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
                          <td>
                            {show(c.field, c.incoming)}
                            {fromAgent.has(c.field) && <span className="diff-note"> · from the agent</span>}
                          </td>
                          <td>
                            <input
                              type="checkbox"
                              aria-label={`Use the file's ${FIELD_LABEL[c.field] ?? c.field}`}
                              title={fromAgent.has(c.field) ? "Set by the agent suggestion you used" : undefined}
                              disabled={fromAgent.has(c.field)}
                              checked={fromAgent.has(c.field) || !!d.takeIncoming?.includes(c.field)}
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
                {ar && (ar.suggestions.length > 0 || ar.note) && <AgentSuggestions record={ar} choices={choices} onChoose={(field, c) => choose(ar.recordId, field, c)} />}
              </li>
            );
          })}
        </ul>
        {shown.length > 400 && <p className="section__aside">Showing the first 400 rows of this list.</p>}
        <div className="commit-bar">
          <p>
            {plural(toImport, "row")} will be imported{skipped ? `, ${skipped} skipped` : ""}
            {agentCounts.used ? `, with ${plural(agentCounts.used, "agent suggestion")}` : ""}. Checks are saved with the records and can be fixed later under Issues. You can undo the whole import.
          </p>
          <div className="commit-bar__actions">
            {origin && (
              <button type="button" className="btn btn--ghost" onClick={() => discardReviewed(origin)}>
                Discard this file
              </button>
            )}
            <button type="button" className="btn btn--primary" onClick={commit} disabled={!toImport}>
              <Icon name="check" />
              Import {plural(toImport, "row")}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="page page--form">
      <div className="view-top" />
      <h1 className="form-title">Import</h1>
      <p className="form-sub">Nothing is saved until you have reviewed the rows. Every import can be undone.</p>
      {waiting.length > 0 && (
        <section className="section section--waiting">
          <div className="section__head">
            <h2 className="section__title">Waiting to be imported</h2>
          </div>
          <ul className="rows">
            {waiting.map((w) => (
              <li key={w.name} className="history-row">
                <span>
                  <b>{sessionLabel(w.name)}</b>
                  <small>
                    {waitingText(w)}, from {madeBy(w.name)}
                  </small>
                </span>
                <span className="history-row__actions">
                  <button type="button" className="btn btn--primary btn--small" onClick={() => openSession(w)}>
                    Review
                  </button>
                  <button
                    type="button"
                    className="btn btn--ghost btn--small"
                    onClick={() => {
                      if (window.confirm(`Discard this file? The ${recordsText(w.flights, w.sightings, w.changing)} in it ${w.waiting === 1 ? "does" : "do"} not reach your log, and the file is deleted.`)) void discardSession(app, w.name);
                    }}
                  >
                    Discard
                  </button>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
      <label className={`dropzone${busy ? " is-busy" : ""}`}>
        <Icon name="upload" />
        <span>
          <b>{busy ? "Reading…" : "Choose a file"}</b>
          <span>A my.flightradar24.com CSV export, your flight log or spotting spreadsheet as CSV or Excel (.xlsx), or a file from the inbox of ./touchdown spot or add (.json). Import the FR24 export first, then the flight log: matching flights are merged.</span>
        </span>
        <input
          type="file"
          accept=".csv,.xlsx,.json,text/csv,application/json"
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
      {changesMade && (
        <div className="import-done">
          <p className="status-line status-line--good">
            <Icon name="circle-check" />
            <span>
              Made {plural(changesMade.applied, "change")} to your log. {changesMade.messages.join(" ")} Undo {changesMade.applied === 1 ? "it" : "them"} in the history below. <Link to="/issues">See what to review</Link>.
            </span>
          </p>
        </div>
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
                    {b.createdAt ? new Date(b.createdAt).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" }) : ""} · {b.mappingPreset === "touchdown_changes" ? `${plural(b.rowsAccepted ?? 0, "change")} made` : `${plural(b.rowsAccepted ?? 0, "row")} imported`}
                    {b.status === "undone" ? " · undone" : ""}
                  </small>
                </span>
                {b.status === "committed" && (
                  <button
                    type="button"
                    className="btn btn--quiet btn--small"
                    onClick={() => {
                      if (!window.confirm(b.mappingPreset === "touchdown_changes" ? `Undo the changes from ${b.fileName}? Everything they changed gets its earlier values back.` : `Undo the import of ${b.fileName}? Records it created are removed and records it changed get their old values back.`)) return;
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
