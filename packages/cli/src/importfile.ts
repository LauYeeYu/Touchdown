// `touchdown import FILE…` (docs/34, step 5): a spreadsheet or the my.flightradar24.com export, read as the Import
// page reads it (the columns worked out, settled at the terminal or with --map, remembered by their headers), checked
// against the log as it is now, then put in the inbox as one file for review: on the Import page or with
// `touchdown review`, which read it exactly as they would read the file itself. Nothing reaches the log without that
// review. With --out the command builds a backup instead (main.ts).

import { basename } from "node:path";
import {
  checkAll,
  copyStore,
  INBOX_SCHEMA,
  INBOX_VERSION,
  matchCandidates,
  prepareImport,
  refOverridesOf,
  resolveAirframes,
  Store,
  type Cell,
  type InboxFile,
  type InboxSheet,
  type RefIndex,
} from "@touchdown/core";
import { waitingIn } from "./add.ts";
import { readSheetFile } from "./columns.ts";
import { freeName, inboxPlace, loadLog, stamp, writeInboxFile, type LoadedLog } from "./log.ts";
import { userPath } from "./paths.ts";
import { EXIT, fail, printJson } from "./read.ts";
import { label, questions, rowTitle, shownValue } from "./review.ts";
import { chosenStorage } from "./storage.ts";
import { bold, dim, green, plural, red, yellow } from "./term.ts";

/** Options that belong to building a backup (--out), not to the inbox. */
const BACKUP_OPTIONS = ["--today", "--all-findings", "--apply-fixes", "--tracks", "--tracks-adsblol", "--airframes"];

/** How many rows with something to say are printed; --json lists them all. */
const SHOWN = 30;

export interface FileReport {
  file: string;
  /** The sheet (tab) read, for a workbook with more than one. */
  sheet: string | null;
  format: "fr24_csv" | "sheet";
  kind: "flights" | "sightings";
  /** What each column holds, for any layout but the Flightradar24 export's; unused columns left out. */
  columns: { header: string; field: string }[] | null;
  rows: number;
  /** waiting: in the inbox already, in a file not imported yet. */
  counts: { new: number; update: number; conflict: number; identical: number; duplicate: number; waiting: number };
  problems: { row: number; title: string; severity: "error" | "warning"; rule: string; message: string }[];
  differs: { row: number; title: string; fields: { field: string; label: string; yours: string; file: string }[] }[];
  written: string | null;
  notWritten: "dry-run" | "errors" | "nothing new" | null;
}

interface Options {
  files: string[];
  maps: string[];
  dryRun: boolean;
  json: boolean;
  keepErrors: boolean;
  log?: string;
}

function options(args: string[]): Options | { error: string } {
  const o: Options = { files: [], maps: [], dryRun: false, json: false, keepErrors: false };
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a === "--dry-run") o.dryRun = true;
    else if (a === "--json") o.json = true;
    else if (a === "--keep-errors") o.keepErrors = true;
    else if (a === "--map" || a === "--log") {
      const v = args[++i];
      if (v === undefined || v.startsWith("--")) return { error: `${a} needs a value.` };
      if (a === "--map") o.maps.push(v);
      else o.log = userPath(v);
    } else if (BACKUP_OPTIONS.includes(a)) return { error: `${a} is for building a backup: give --out FILE.zip as well.` };
    else if (a.startsWith("--")) return { error: `There is no option ${a}.` };
    else o.files.push(userPath(a));
  }
  return o.files.length ? o : { error: "Give the files to import." };
}

/** The sheet as the inbox keeps it: for a mapped layout, only the columns used. */
function inboxSheet(fileName: string, sheet: { name: string; header: string[]; rows: Cell[][]; firstRow: number }, mapping: InboxSheet["mapping"]): InboxSheet {
  if (!mapping) return { fileName, name: sheet.name, header: sheet.header, rows: sheet.rows, firstRow: sheet.firstRow, mapping: null };
  const used = mapping.fields.flatMap((f, i) => (f === "ignore" ? [] : [i]));
  return {
    fileName,
    name: sheet.name,
    header: used.map((i) => sheet.header[i]!),
    rows: sheet.rows.map((r) => used.map((i) => r[i] ?? null)),
    firstRow: sheet.firstRow,
    mapping: { kind: mapping.kind, fields: used.map((i) => mapping.fields[i]!) },
  };
}

/** `./touchdown import FILE…` without --out. */
export async function importCommand(args: string[], ref: RefIndex, help: string): Promise<void> {
  const o = options(args);
  const json = args.includes("--json");
  if ("error" in o) return fail(json, `${o.error}\n\n${help}`);
  const say = (line: string) => {
    if (!json) console.log(line);
  };

  let storage;
  let log: LoadedLog;
  try {
    storage = o.log ? null : await chosenStorage();
    log = await loadLog(ref, { file: o.log, storage });
  } catch (e) {
    return fail(json, (e as Error).message);
  }
  const store = log.store ?? new Store({ deviceId: "cli", validate: false });
  const place = inboxPlace(storage ?? null);
  // Findings the log has already are not the files' to report.
  const before = copyStore(store);
  const known = new Set(checkAll(before, ref, { overlaps: resolveAirframes(before, ref).overlaps }).map((f) => f.fingerprint));
  for (const p of log.problems) say(dim(`Could not read ${p}.`));

  const reports: (FileReport | { file: string; error: string })[] = [];
  let status: number = EXIT.ok;
  for (const path of o.files) {
    const name = basename(path);
    const read = await readSheetFile(path, ref, { maps: o.maps, agent: null, ask: !json && !!process.stdin.isTTY && !!process.stdout.isTTY, say });
    if ("error" in read) {
      reports.push({ file: name, error: read.error });
      say(red(read.error));
      status = EXIT.problem;
      continue;
    }
    const { source } = read;
    const prepared = prepareImport(store, ref, source);
    const waiting = matchCandidates((await waitingIn(place, ref)).store, source.candidates);
    // Reading the inbox adds the operators its files name to the index; the log has none of them yet.
    ref.setUserOverrides(refOverridesOf(store));
    const r: FileReport = {
      file: name,
      sheet: read.sheet.name !== name ? read.sheet.name : null,
      format: source.format === "fr24_csv" ? "fr24_csv" : "sheet",
      kind: read.mapping?.kind ?? "flights",
      columns: read.mapping ? read.mapping.fields.flatMap((field, i) => (field === "ignore" ? [] : [{ header: read.sheet.header[i] ?? "", field }])) : null,
      rows: source.rowsRead,
      counts: { new: 0, update: 0, conflict: 0, identical: 0, duplicate: 0, waiting: 0 },
      problems: [],
      differs: [],
      written: null,
      notWritten: null,
    };
    for (const [i, m] of prepared.matches.entries()) {
      if (m.kind === "identical") {
        r.counts.identical++;
        continue;
      }
      if (waiting[i]?.kind === "identical") {
        r.counts.waiting++;
        continue;
      }
      r.counts[m.kind]++;
      const row = m.candidate.sourceRow;
      const title = rowTitle(m);
      for (const x of m.candidate.issues) if (x.severity !== "info") r.problems.push({ row, title, severity: x.severity, rule: x.ruleId, message: x.message });
      for (const f of prepared.findings.get(i) ?? []) if (!known.has(f.fingerprint) && f.severity !== "info") r.problems.push({ row, title, severity: f.severity, rule: f.ruleId, message: f.message });
      const qs = questions(m);
      if (qs.length) r.differs.push({ row, title, fields: qs.map((q) => ({ field: q.field, label: label(q.field), yours: shownValue(ref, q.field, q.existing), file: shownValue(ref, q.field, q.incoming) })) });
    }
    const toImport = r.counts.new + r.counts.update + r.counts.conflict + r.counts.duplicate;
    const errors = r.problems.filter((p) => p.severity === "error").length;
    if (o.dryRun) r.notWritten = "dry-run";
    else if (errors && !o.keepErrors) r.notWritten = "errors";
    else if (!toImport) r.notWritten = "nothing new";
    else {
      const file: InboxFile = {
        schema: INBOX_SCHEMA,
        version: INBOX_VERSION,
        createdAt: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
        checker: null,
        sightings: [],
        sheet: inboxSheet(name, read.sheet, read.mapping),
      };
      try {
        const inboxName = await freeName(place, `import-${stamp()}-${name.replace(/[^A-Za-z0-9._-]+/g, "-")}`);
        await writeInboxFile(place, inboxName, file, ref);
        r.written = inboxName;
      } catch (e) {
        return fail(json, (e as Error).message);
      }
    }
    if (errors && r.notWritten === "errors" && status === EXIT.ok) status = EXIT.notFound;
    reports.push(r);
    if (!json) printReport(r, log.from, place.name, place.shared);
  }

  if (json) printJson({ ok: status === EXIT.ok, checkedAgainst: log.from, logProblems: log.problems, place: place.name, sharedInbox: place.shared, files: reports });
  process.exit(status);
}

function printReport(r: FileReport, from: string, place: string, shared: boolean) {
  const c = r.counts;
  const verb = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  const parts = [
    c.new ? `${c.new} new` : null,
    c.update ? verb(c.update, "fills in a record of your log", "fill in records of your log") : null,
    c.conflict ? verb(c.conflict, "differs from your log", "differ from your log") : null,
    c.duplicate ? verb(c.duplicate, "repeats an earlier row (same aircraft, place and day; merged)", "repeat an earlier row (same aircraft, place and day; merged)") : null,
    c.waiting ? verb(c.waiting, "is waiting in the inbox already", "are waiting in the inbox already") : null,
    c.identical ? verb(c.identical, "is in your log already", "are in your log already") : null,
  ].filter(Boolean);
  const what = r.format === "fr24_csv" ? "my.flightradar24.com export" : `spreadsheet of ${r.kind}`;
  console.log(`\n${bold(r.file)}${r.sheet ? ` (tab "${r.sheet}")` : ""}: ${what}, ${plural(r.rows, "row")}, checked against ${from}`);
  console.log(`  ${parts.join(", ") || "nothing"}`);

  // Each row with something to say, with what it is.
  const rows = new Map<number, { title: string; mark: string; lines: string[] }>();
  const entry = (row: number, title: string) => rows.get(row) ?? rows.set(row, { title, mark: "", lines: [] }).get(row)!;
  for (const p of r.problems) {
    const e = entry(p.row, p.title);
    e.lines.push(`${p.message} ${dim(p.rule)}`);
    if (p.severity === "error") e.mark = red("!");
    else e.mark ||= yellow("?");
  }
  for (const d of r.differs) {
    const e = entry(d.row, d.title);
    for (const f of d.fields) e.lines.push(`${f.label}: ${f.yours} in your log, ${f.file} in the file`);
    e.mark ||= yellow("≠");
  }
  const sorted = [...rows].sort(([a], [b]) => a - b);
  for (const [row, e] of sorted.slice(0, SHOWN)) {
    console.log(`  ${e.mark} ${dim(`row ${row}`)}  ${e.title}`);
    for (const l of e.lines) console.log(`      ${l}`);
  }
  if (sorted.length > SHOWN) console.log(dim(`  and ${plural(sorted.length - SHOWN, "more row")} (--json lists them all)`));
  if (r.differs.length) console.log(dim("  Where the file differs, your log's value stays unless you take the file's in the review."));

  const errors = r.problems.filter((p) => p.severity === "error").length;
  if (r.written) {
    console.log(`${green("Written")} to ${place}: ${r.written}. Read back and checked.`);
    console.log(`${yellow("Not in your log yet:")} ${shared ? "run ./touchdown review, or open Touchdown on any device and use “Review and import” at the top." : "start the web app (npm run dev -w @touchdown/web) and use “Review and import” at the top."}`);
  } else if (r.notWritten === "errors") console.log(red(`Not written: ${plural(errors, "error")}. Correct the file, or give --keep-errors to review them on the Import page.`));
  else if (r.notWritten === "nothing new") console.log(dim("Nothing to write: every row is in your log or waiting in the inbox already."));
  else if (r.notWritten === "dry-run") console.log(dim("Checked only (--dry-run): nothing written."));
}
