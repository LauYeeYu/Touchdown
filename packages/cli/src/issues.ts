// `touchdown issues` and `touchdown imports` (docs/34, "Reading"): the Issues page, and the Import page's history.

import { checkAll, flightDay, conflictsToShow, PRIVATE_FIELDS, RULES, type Finding, type Row, type Severity } from "@touchdown/core";
import { FIELD_LABEL, orderIssues } from "@touchdown/core/view";
import { list, t } from "@touchdown/i18n/cli";
import { findingJson, openFindings } from "./shape.ts";
import { argsOrHelp, fail, flightRefLabel, openOrFail, optionLines, printJson, readFrom, readOptions, section, sightingRefLabel, table, usage, type OpenedLog } from "./read.ts";
import { bold, dim, green, red, yellow, tc } from "./term.ts";
import { issuesChangeCommand, issuesChangeHelp } from "./change.ts";

export const issuesHelp = () => `${usage(`./touchdown issues [--severity S[,S…] | all] [--rule ID] [--log FILE] [--json]
       ./touchdown issues --accepted [--log FILE] [--json]`)}

${t("cliRead.issues.help")}

${optionLines(15, [
  ["--severity S", t("cliRead.issues.option.severity")],
  ["--rule ID", t("cliRead.issues.option.rule")],
  ["--accepted", t("cliRead.issues.option.accepted")],
])}
${readOptions(15)}

${issuesChangeHelp()}`;

export const importsHelp = () => `${usage("./touchdown imports [--log FILE] [--json]")}

${t("cliRead.imports.help")}

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
    return f ? t("cliRead.issues.record.flight", { label: flightRefLabel(f) }) : r.id;
  }
  if (r.table === "sightings") {
    const s = log.store.get("sightings", r.id);
    return s ? t("cliRead.issues.record.sighting", { label: sightingRefLabel(s, log.ref) }) : r.id;
  }
  return `${r.table} ${r.id}`;
}

const PRIVATE = new Set(PRIVATE_FIELDS.map((f) => f.split(".")[1]!));

/** A value of a sync conflict (JSON text) as shown: private values never are. */
function conflictValue(field: string, json: string | null): string {
  if (PRIVATE.has(field)) return t("cliRead.issues.conflict.private");
  const v = json === null ? null : (JSON.parse(json) as unknown);
  return v === null || v === "" ? "—" : String(v);
}

function conflictJson(log: OpenedLog, c: Row<"sync_conflicts">) {
  const hidden = PRIVATE.has(c.field);
  const row = log.store.peek(c.tableName as never, c.recordId) as Record<string, unknown> | null;
  return {
    id: c.id,
    table: c.tableName,
    record: c.recordId,
    recordLabel: recordLabel(log, { table: c.tableName, id: c.recordId }),
    field: c.field,
    private: hidden,
    inLog: hidden ? null : (row?.[c.field] ?? null),
    other: hidden ? null : (JSON.parse(c.otherValue ?? "null") as unknown),
    keptBy: c.keptBy,
    keptAt: c.keptAt,
    otherBy: c.otherBy,
    otherAt: c.otherAt,
  };
}

const mark = (s: Severity) => (s === "error" ? red("!") : s === "warning" ? yellow("?") : dim("i"));

export async function issuesCommand(args: string[]) {
  if (args[0] === "accept" || args[0] === "reopen" || args[0] === "fix") return issuesChangeCommand(args);
  const a = argsOrHelp(args, { values: ["--severity", "--rule"], flags: ["--accepted"] }, issuesHelp());
  const json = a.flags.has("--json");
  const sevText = a.values.get("--severity") ?? "error,warning";
  const severities = sevText === "all" ? SEVERITIES : (sevText.split(",").map((x) => x.trim()) as Severity[]);
  if (severities.some((x) => !SEVERITIES.includes(x))) return fail(json, t("cliRead.issues.severityInvalid"));
  const rule = a.values.get("--rule");
  if (rule && !RULES[rule]) return fail(json, t("cliRead.issues.noRule", { rule }));
  const log = await openOrFail(json, a.values.get("--log"));

  if (a.flags.has("--accepted")) return accepted(log, json);
  const open = openFindings(log);
  const conflicts = conflictsToShow(log.store);
  const count = (s: Severity) => open.filter((f) => f.severity === s).length;
  const shown = orderIssues(
    open.filter((f) => severities.includes(f.severity) && (!rule || f.ruleId === rule)),
    (f) => findingDate(log, f),
  );

  if (json)
    return printJson({
      ok: true,
      from: log.from,
      open: { changedOnTwoDevices: conflicts.length, errors: count("error"), warnings: count("warning"), notes: count("info") },
      changedOnTwoDevices: conflicts.map((c) => conflictJson(log, c)),
      groups: shown.map(([ruleId, list]) => ({ rule: ruleId, title: RULES[ruleId]?.title ?? ruleId, findings: list.map((f) => ({ ...findingJson(f), date: findingDate(log, f) || null, recordLabels: f.records.map((r) => recordLabel(log, r)) })) })),
    });

  const e = count("error");
  const w = count("warning");
  const c = conflicts.length;
  const parts = [c && t("cliRead.issues.head.conflicts", { count: c }), e && t("cliRead.issues.head.errors", { count: e }), w && t("cliRead.issues.head.warnings", { count: w })].filter(Boolean) as string[];
  const head = !parts.length ? t("cliRead.issues.head.nothing") : t("cliRead.issues.head", { parts: list(parts) });
  const notes = count("info");
  console.log(`${bold(head.charAt(0).toUpperCase() + head.slice(1))} ${dim([notes ? t("cliRead.issues.notes", { count: notes }) : null, readFrom(log)].filter(Boolean).join(" "))}`);
  if (c) {
    const lines: string[] = [];
    for (const x of conflicts) {
      const label =
        x.field === "deleted"
          ? t("cliRead.issues.conflict.deleted")
          : t("cliRead.issues.conflict.field", {
              field: FIELD_LABEL[x.field] ?? x.field,
              kept: conflictValue(x.field, JSON.stringify((log.store.peek(x.tableName as never, x.recordId) as Record<string, unknown> | null)?.[x.field] ?? null)),
              other: conflictValue(x.field, x.otherValue),
            });
      lines.push(`${yellow("≠")} ${label}`);
      lines.push(dim(`    ${recordLabel(log, { table: x.tableName, id: x.recordId })} · ${t("cliRead.issues.id", { id: x.id })}`));
    }
    lines.push(dim(t("cliRead.issues.conflict.choose")));
    for (const line of section(tc("cliRead.issues.conflict.title", { count: c }, { dim }), lines)) console.log(line);
  }
  for (const [ruleId, findings] of shown) {
    const lines: string[] = [];
    for (const f of findings) {
      lines.push(`${mark(f.severity)} ${f.message}`);
      lines.push(dim(`    ${[...f.records.map((r) => recordLabel(log, r)), t("cliRead.issues.id", { id: f.fingerprint })].join(" · ")}`));
      f.fixes.forEach((x, i) => lines.push(`    ${green(t("cliRead.issues.fix", { n: i + 1 }))} ${x.label}`));
    }
    for (const line of section(tc("cliRead.issues.group", { title: RULES[ruleId]?.title ?? ruleId, count: findings.length, rule: ruleId }, { dim }), lines)) console.log(line);
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
  console.log(`${tc("cliRead.issues.accepted.count", { count: acks.length }, { b: bold })} ${dim(readFrom(log))}`);
  for (const { ack, finding } of acks) {
    console.log("");
    const title = `${(ack.ruleId && RULES[ack.ruleId]?.title) ?? ack.ruleId}`;
    console.log(`${green("✓")} ${finding ? t("cliRead.issues.accepted.finding", { title, message: finding.message }) : tc("cliRead.issues.accepted.gone", { title }, { dim })}`);
    if (ack.note) console.log(`    ${ack.note}`);
    console.log(dim(`    ${t("cliRead.issues.id", { id: ack.id })}`));
  }
}

export async function importsCommand(args: string[]) {
  const a = argsOrHelp(args, {}, importsHelp());
  const json = a.flags.has("--json");
  const log = await openOrFail(json, a.values.get("--log"));
  const batches = log.store.all("import_batches").sort((x, y) => (y.createdAt ?? "").localeCompare(x.createdAt ?? ""));
  if (json)
    return printJson({
      ok: true,
      from: log.from,
      imports: batches.map((b) => ({ id: b.id, at: b.createdAt, file: b.fileName, kind: b.sourceKind, rowsRead: b.rowsRead, rowsImported: b.rowsAccepted, rowsLeftOut: b.rowsRejected, rowsChangedByAgent: b.rowsEdited, agent: b.agentChecker, status: b.status })),
    });
  console.log(`${tc("cliRead.imports.count", { count: batches.length }, { b: bold })} ${dim(readFrom(log))}`);
  if (!batches.length) return;
  console.log("");
  const rows = batches.map((b) => [(b.createdAt ?? "").replace("T", " ").slice(0, 16), b.fileName ?? "", String(b.rowsAccepted ?? 0), b.status === "undone" ? t("cliRead.imports.undone") : "", b.id]);
  for (const line of table([{ head: t("cliRead.imports.column.at") }, { head: t("cliRead.imports.column.file"), flex: true }, { head: t("cliRead.imports.column.rows"), align: "right" }, { head: "" }, { head: t("cliRead.imports.column.id") }], rows)) console.log(line);
}
