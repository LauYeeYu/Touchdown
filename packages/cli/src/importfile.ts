// `touchdown import FILE…` (docs/34, step 5): a spreadsheet or the my.flightradar24.com export, read as the Import
// page reads it (the columns worked out, settled at the terminal or with --map, remembered by their headers), checked
// against the log as it is now, then put in the inbox as one file for review: on the Import page or with
// `touchdown review`, which read it exactly as they would read the file itself. Nothing reaches the log without that
// review. With --out the command builds a backup instead (main.ts).

import { t } from "@touchdown/i18n/cli";
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
import { bold, dim, green, red, tc, units, yellow } from "./term.ts";

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
      if (v === undefined || v.startsWith("--")) return { error: t("cli.args.needsValue", { option: a }) };
      if (a === "--map") o.maps.push(v);
      else o.log = userPath(v);
    } else if (BACKUP_OPTIONS.includes(a)) return { error: t("cliWrite.import.backupOption", { option: a }) };
    else if (a.startsWith("--")) return { error: t("cli.args.noOption", { option: a }) };
    else o.files.push(userPath(a));
  }
  return o.files.length ? o : { error: t("cliWrite.import.noFiles") };
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
  for (const p of log.problems) say(dim(t("cliWrite.import.couldNotRead", { problem: p })));

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
  const parts = [
    c.new ? t("cliWrite.import.counts.new", { n: c.new }) : null,
    c.update ? t("cliWrite.import.counts.update", { n: c.update }) : null,
    c.conflict ? t("cliWrite.import.counts.conflict", { n: c.conflict }) : null,
    c.duplicate ? t("cliWrite.import.counts.duplicate", { n: c.duplicate }) : null,
    c.waiting ? t("cliWrite.import.counts.waiting", { n: c.waiting }) : null,
    c.identical ? t("cliWrite.import.counts.identical", { n: c.identical }) : null,
  ].filter((x): x is string => !!x);
  console.log(`\n${tc("cliWrite.import.file", { file: r.file, tabbed: r.sheet ? "yes" : "no", sheet: r.sheet ?? "", format: r.format, kind: r.kind, rows: r.rows, from }, { bold })}`);
  console.log(`  ${units(parts) || t("cliWrite.import.counts.nothing")}`);

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
    for (const f of d.fields) e.lines.push(t("cliWrite.import.differs", { label: f.label, yours: f.yours, file: f.file }));
    e.mark ||= yellow("≠");
  }
  const sorted = [...rows].sort(([a], [b]) => a - b);
  for (const [row, e] of sorted.slice(0, SHOWN)) {
    console.log(`  ${e.mark} ${dim(t("cli.row", { n: row }))}  ${e.title}`);
    for (const l of e.lines) console.log(`      ${l}`);
  }
  if (sorted.length > SHOWN) console.log(dim(`  ${t("cliWrite.import.more", { count: sorted.length - SHOWN })}`));
  if (r.differs.length) console.log(dim(`  ${t("cliWrite.import.yoursStays")}`));

  const errors = r.problems.filter((p) => p.severity === "error").length;
  if (r.written) {
    console.log(tc("cliWrite.import.written", { place, file: r.written }, { green }));
    console.log(tc("cli.notInLogYet", { shared: shared ? "yes" : "no" }, { yellow }));
  } else if (r.notWritten === "errors") console.log(red(t("cliWrite.import.notWritten", { count: errors })));
  else if (r.notWritten === "nothing new") console.log(dim(t("cliWrite.import.nothingNew")));
  else if (r.notWritten === "dry-run") console.log(dim(t("cliWrite.import.dryRun")));
}
