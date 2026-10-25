// `touchdown issues` and `touchdown imports` (docs/34, "Reading"): the Issues page, and the Import page's history.

import { checkAll, flightDay, RULES, type Finding, type Severity } from "@touchdown/core";
import { orderIssues } from "@touchdown/core/view";
import { findingJson, openFindings } from "./shape.ts";
import { argsOrHelp, fail, flightRefLabel, openOrFail, printJson, readOptions, section, sightingRefLabel, table, type OpenedLog } from "./read.ts";
import { bold, dim, green, plural, red, yellow } from "./term.ts";
import { issuesChangeCommand, ISSUES_CHANGE_HELP } from "./change.ts";

export const ISSUES_HELP = `Usage: ./touchdown issues [--severity S[,S…] | all] [--rule ID] [--log FILE] [--json]
       ./touchdown issues --accepted [--log FILE] [--json]

The Issues page: every open finding, grouped by rule in the page's order, with the records it is about and its
suggested fixes. Each finding's id is the one to name it by. With --accepted, the warnings you marked as right.

  --severity S   error, warning, info (notes), comma-separated, or all; errors and warnings by default
  --rule ID      one rule only, such as C-FLIGHT-OVERLAP
  --accepted     the accepted warnings instead
${readOptions(15)}

${ISSUES_CHANGE_HELP}`;

export const IMPORTS_HELP = `Usage: ./touchdown imports [--log FILE] [--json]

The imports into your log, newest first, as the Import page's history lists them: when, the file, how many
rows were imported, and whether the import was undone. Each one's id is the one to undo it by.

${readOptions(13)}`;

const SEVERITIES: Severity[] = ["error", "warning", "info"];

/** A finding's date, for its place in its group: its first record's day. */
function findingDate(log: OpenedLog, f: Finding): string {
  const r = f.records[0];
  if (r?.table === "flights") {
    const flight = log.store.get("flights", r.id);
    return (flight && (flightDay(flight) ?? flight.scheduledDate)) ?? "";
  }
  if (r?.table === "sightings") return log.store.get("sightings", r.id)?.seenOn ?? "";
  return "";
}

function recordLabel(log: OpenedLog, r: { table: string; id: string }): string {
  if (r.table === "flights") {
    const f = log.store.get("flights", r.id);
    return f ? `flight ${flightRefLabel(f)}` : r.id;
  }
  if (r.table === "sightings") {
    const s = log.store.get("sightings", r.id);
    return s ? `sighting ${sightingRefLabel(s, log.ref)}` : r.id;
  }
  return `${r.table} ${r.id}`;
}

const mark = (s: Severity) => (s === "error" ? red("!") : s === "warning" ? yellow("?") : dim("i"));

export async function issuesCommand(args: string[]) {
  if (args[0] === "accept" || args[0] === "reopen" || args[0] === "fix") return issuesChangeCommand(args);
  const a = argsOrHelp(args, { values: ["--severity", "--rule"], flags: ["--accepted"] }, ISSUES_HELP);
  const json = a.flags.has("--json");
  const sevText = a.values.get("--severity") ?? "error,warning";
  const severities = sevText === "all" ? SEVERITIES : (sevText.split(",").map((x) => x.trim()) as Severity[]);
  if (severities.some((x) => !SEVERITIES.includes(x))) return fail(json, "--severity takes error, warning, info (comma-separated) or all.");
  const rule = a.values.get("--rule");
  if (rule && !RULES[rule]) return fail(json, `There is no rule ${rule}.`);
  const log = await openOrFail(json, a.values.get("--log"));

  if (a.flags.has("--accepted")) return accepted(log, json);
  const open = openFindings(log);
  const count = (s: Severity) => open.filter((f) => f.severity === s).length;
  const shown = orderIssues(
    open.filter((f) => severities.includes(f.severity) && (!rule || f.ruleId === rule)),
    (f) => findingDate(log, f),
  );

  if (json)
    return printJson({
      ok: true,
      from: log.from,
      open: { errors: count("error"), warnings: count("warning"), notes: count("info") },
      groups: shown.map(([ruleId, list]) => ({ rule: ruleId, title: RULES[ruleId]?.title ?? ruleId, findings: list.map((f) => ({ ...findingJson(f), date: findingDate(log, f) || null, recordLabels: f.records.map((r) => recordLabel(log, r)) })) })),
    });

  const e = count("error");
  const w = count("warning");
  const head = e + w === 0 ? "Nothing to review. Every check passed or was accepted." : [e && `${plural(e, "entry", "entries")} ${e === 1 ? "looks" : "look"} wrong`, w && `${plural(w, "entry", "entries")} ${w === 1 ? "is" : "are"} worth a look`].filter(Boolean).join(" and ") + ".";
  const notes = count("info");
  console.log(`${bold(head.charAt(0).toUpperCase() + head.slice(1))} ${dim(`${notes ? `${plural(notes, "note")} besides (--severity info). ` : ""}Read from ${log.from}.`)}`);
  for (const [ruleId, list] of shown) {
    const lines: string[] = [];
    for (const f of list) {
      lines.push(`${mark(f.severity)} ${f.message}`);
      lines.push(dim(`    ${f.records.map((r) => recordLabel(log, r)).join(" · ")} · id ${f.fingerprint}`));
      f.fixes.forEach((x, i) => lines.push(`    ${green(`fix ${i + 1}:`)} ${x.label}`));
    }
    for (const line of section(`${RULES[ruleId]?.title ?? ruleId} ${dim(`· ${plural(list.length, "finding")} · ${ruleId}`)}`, lines)) console.log(line);
  }
}

function accepted(log: OpenedLog, json: boolean) {
  // Every finding, the accepted ones included, to show what each acceptance is about.
  const all = checkAll(log.store, log.ref);
  const byKey = new Map(all.map((f) => [`${f.ruleId}|${f.fingerprint}`, f]));
  const acks = log.store.all("issue_acks").map((ack) => ({ ack, finding: byKey.get(`${ack.ruleId}|${ack.fingerprint}`) ?? null }));
  if (json)
    return printJson({
      ok: true,
      from: log.from,
      accepted: acks.map(({ ack, finding }) => ({ id: ack.id, rule: ack.ruleId, title: (ack.ruleId && RULES[ack.ruleId]?.title) ?? ack.ruleId, fingerprint: ack.fingerprint, note: ack.note, message: finding?.message ?? null, stillApplies: !!finding })),
    });
  console.log(`${bold(plural(acks.length, "accepted warning"))}. ${dim(`Read from ${log.from}.`)}`);
  for (const { ack, finding } of acks) {
    console.log("");
    console.log(`${green("✓")} ${(ack.ruleId && RULES[ack.ruleId]?.title) ?? ack.ruleId}${finding ? `: ${finding.message}` : dim(" (the values have changed since; it no longer applies)")}`);
    if (ack.note) console.log(`    ${ack.note}`);
    console.log(dim(`    id ${ack.id}`));
  }
}

export async function importsCommand(args: string[]) {
  const a = argsOrHelp(args, {}, IMPORTS_HELP);
  const json = a.flags.has("--json");
  const log = await openOrFail(json, a.values.get("--log"));
  const batches = log.store.all("import_batches").sort((x, y) => (y.createdAt ?? "").localeCompare(x.createdAt ?? ""));
  if (json)
    return printJson({
      ok: true,
      from: log.from,
      imports: batches.map((b) => ({ id: b.id, at: b.createdAt, file: b.fileName, kind: b.sourceKind, rowsRead: b.rowsRead, rowsImported: b.rowsAccepted, rowsLeftOut: b.rowsRejected, rowsChangedByAgent: b.rowsEdited, agent: b.agentChecker, status: b.status })),
    });
  console.log(`${bold(plural(batches.length, "import"))}. ${dim(`Read from ${log.from}.`)}`);
  if (!batches.length) return;
  console.log("");
  const rows = batches.map((b) => [(b.createdAt ?? "").replace("T", " ").slice(0, 16), b.fileName ?? "", String(b.rowsAccepted ?? 0), b.status === "undone" ? "undone" : "", b.id]);
  for (const line of table([{ head: "When (UTC)" }, { head: "File", flex: true }, { head: "Rows", align: "right" }, { head: "" }, { head: "Id" }], rows)) console.log(line);
}
