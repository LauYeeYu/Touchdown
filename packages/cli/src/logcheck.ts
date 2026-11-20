// `touchdown check log` (docs/22-agent-verification.md, "Records in the log"): the agent check of records already in
// the log, such as sightings added in the web app, which no check has seen. Each record's registration is looked up
// as in a spotting session (the log, the OpenSky snapshot, adsbdb, Flightradar24 with --fr24), the agent checks the
// record against what the sources say, and each suggestion is shown with its reason. The ones taken go to the inbox
// as one change file, each edit naming the agent, for review on the Import page or with ./touchdown review: nothing
// reaches the log before. This computer remembers what the agent has seen, so the next run sends only what is new.

import { t } from "@touchdown/i18n/cli";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { createInterface } from "node:readline/promises";
import {
  agentPayload,
  applyChanges,
  CHECK_BATCH_SIZE,
  CHECK_REQUEST_SCHEMA,
  CHECK_VERSION,
  copyStore,
  evidenceForAgent,
  flightDay,
  flightEdit,
  isValidDate,
  logCheckRecord,
  logRecordFingerprint,
  logRecordKey,
  recordsToCheck,
  sightingEdit,
  suggestionEditInput,
  todayIn,
  type AgentSuggestion,
  type CheckRecord,
  type CheckRequest,
  type Checker,
  type InboxChange,
  type LogRecord,
} from "@touchdown/core";
import { findAgent, type Agent } from "./agents.ts";
import { confidenceLabel, ensureSelfTest, fieldLabel, PROMPT_FILE, runCheck } from "./check.ts";
import { writeChanges } from "./change.ts";
import { registrationLookups } from "./lookups.ts";
import { privatePath } from "./paths.ts";
import { EXIT, fail, openOrFail, type OpenedLog } from "./read.ts";
import { openFindings } from "./shape.ts";
import { agentForRun, AGENT_NAME, agentRules, savedSendNotes } from "./settings.ts";
import { bold, colour, dim, green, tc, yellow } from "./term.ts";

/**
 * What the agent has seen, by log: record key → the record's fields as it saw them (logRecordFingerprint), and as
 * they will be once the suggestions taken are imported.
 */
const SEEN_FILE = privatePath("cache/log-check.json");
const PARALLEL = 3;

interface Options {
  since?: string;
  all: boolean;
  limit?: number;
  checker?: Checker;
  model?: string;
  useHigh: boolean;
  notes: boolean;
  fr24: boolean;
  chromePort: number;
  adsbdb: boolean;
  offline: boolean;
  selfTest: boolean;
  dryRun: boolean;
}

function options(args: string[], help: () => never): Options {
  const o: Options = { all: false, useHigh: false, notes: false, fr24: false, chromePort: 9222, adsbdb: true, offline: false, selfTest: false, dryRun: false };
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    const next = () => args[++i] ?? help();
    if (a === "--since") {
      o.since = next();
      if (!isValidDate(o.since)) return fail(false, t("cliWrite.checkLog.since", { value: o.since }));
    } else if (a === "--all-records") o.all = true;
    else if (a === "--limit") o.limit = Math.max(1, Number(next()) || 1);
    else if (a === "--agent") {
      const v = next();
      if (v !== "claude" && v !== "codex") help();
      o.checker = v;
    } else if (a === "--model") o.model = next();
    else if (a === "--use-high") o.useHigh = true;
    else if (a === "--notes") o.notes = true;
    else if (a === "--fr24") o.fr24 = true;
    else if (a === "--port") o.chromePort = Number(next()) || 9222;
    else if (a === "--no-adsbdb") o.adsbdb = false;
    else if (a === "--offline") o.offline = true;
    else if (a === "--self-test") o.selfTest = true;
    else if (a === "--dry-run") o.dryRun = true;
    else help();
  }
  if (o.all && o.since) help();
  return o;
}

// ---------- what the agent has seen ----------

/** The log's key in the file: the storage it is read from, else the backup file. */
const logKey = (log: OpenedLog) => (log.storage ? JSON.stringify(log.storage.choice) : log.from);

type Seen = Map<string, string[]>;

function readSeen(key: string): Seen {
  try {
    const all = JSON.parse(readFileSync(SEEN_FILE, "utf8")) as Record<string, Record<string, string[]>>;
    return new Map(Object.entries(all[key] ?? {}).filter(([, v]) => Array.isArray(v)));
  } catch {
    return new Map();
  }
}

function saveSeen(key: string, seen: Seen) {
  let all: Record<string, Record<string, string[]>> = {};
  try {
    if (existsSync(SEEN_FILE)) all = JSON.parse(readFileSync(SEEN_FILE, "utf8")) as typeof all;
  } catch {
    /* started again */
  }
  all[key] = Object.fromEntries(seen);
  mkdirSync(dirname(SEEN_FILE), { recursive: true });
  writeFileSync(SEEN_FILE, JSON.stringify(all) + "\n", { mode: 0o600 });
}

// ---------- the terminal ----------

/** What a record is: "Sighting N9001Z at BOS on 2026-01-10", "Flight BA9001 on 2025-03-14, LHR → JFK". */
function recordTitle(rec: CheckRecord): string {
  const f = rec.fields;
  if (rec.kind === "flight") {
    const name = f.flightNumber ?? f.registration ?? "";
    return t("cliWrite.review.flightTitle", { hasName: name ? "yes" : "no", name, hasDate: f.date ? "yes" : "no", date: f.date ?? "", hasRoute: f.from || f.to ? "yes" : "no", from: f.from ?? "?", to: f.to ?? "?" });
  }
  const reg = f.registration ?? "";
  return t("cliWrite.review.sightingTitle", { hasReg: reg ? "yes" : "no", registration: reg, hasAirport: f.airport ? "yes" : "no", airport: f.airport ?? "", hasDate: f.date ? "yes" : "no", date: f.date ?? "" });
}

function status(line: string) {
  if (colour) process.stdout.write(`\r\x1b[2K${dim(line)}`);
}

// ---------- the command ----------

export async function checkLogCommand(args: string[], help: () => never): Promise<void> {
  const o = options(args, help);
  const interactive = !!process.stdin.isTTY && !!process.stdout.isTTY;
  const log = await openOrFail(false);
  const { store, ref } = log;
  const key = logKey(log);
  const seen = readSeen(key);

  const picked = recordsToCheck(store, ref, seen, { all: o.all, since: o.since ?? null });
  const records: LogRecord[] = o.limit ? picked.slice(0, o.limit) : picked;
  const which = o.all ? "all" : o.since ? "since" : "new";
  const label = (text: string) => `  ${text.padEnd(10)}`;
  console.log(bold(t("cliWrite.check.title")));
  console.log(`${label(t("cliWrite.check.label.input"))}${t("cliWrite.checkLog.input", { from: log.from, count: records.length, which, since: o.since ?? "", limited: records.length < picked.length ? "yes" : "no", total: picked.length })}`);
  if (!records.length) {
    console.log(`\n${t("cliWrite.checkLog.nothing", { which })}`);
    process.exit(EXIT.ok);
  }
  const includeNotes = o.notes || savedSendNotes();
  console.log(dim(`${label(t("cliWrite.check.label.sends"))}${t("cliWrite.check.sends", { notes: includeNotes && records.some((r) => r.row.notes) ? "yes" : "no" })}`));
  const sourceNames = [t("cliWrite.checkLog.yourLog"), t("cliWrite.spot.header.openSky"), o.adsbdb ? "adsbdb" : null, o.fr24 ? t("cliWrite.spot.header.fr24", { port: o.chromePort }) : null].filter(Boolean);
  console.log(`${label(t("cliWrite.spot.header.sources"))}${sourceNames.join(", ")}${o.offline ? dim(` ${t("cliWrite.spot.header.offline")}`) : ""}`);

  // The agent: chosen at the terminal the first time and remembered; --agent for one run. A dry run needs none.
  let agent: Agent | null = null;
  if (!o.dryRun) {
    const choice = await agentForRun(o.checker);
    if (typeof choice === "object") return fail(false, choice.error);
    if (choice === "none") return fail(false, t("cliWrite.check.needsAgent", { none: AGENT_NAME.none }));
    const found = findAgent(choice);
    if ("error" in found) return fail(false, found.error);
    agent = found;
    console.log(`${label(t("cliWrite.check.label.agent"))}${t("cliWrite.check.agent", { agent: agent.name, version: agent.version, hasModel: o.model ? "yes" : "no", model: o.model ?? "" })}`);
    console.log(dim(`${label(t("cliWrite.check.label.lockdown"))}${t("cliWrite.check.lockdown", { codex: agent.checker === "codex" ? "yes" : "no", features: agent.disable.length })}`));
  }

  const rl = interactive ? createInterface({ input: process.stdin, output: process.stdout }) : null;
  const ask = async (q: string, yes: boolean) => {
    if (!rl) return yes;
    const a = (await rl.question(`${q} ${dim(yes ? "[Y/n]" : "[y/N]")} `)).trim().toLowerCase();
    return a ? a === "y" || a === "yes" : yes;
  };
  const lookups = registrationLookups(ref, store, o, {
    progress: (l) => console.log(dim(`  ${l}`)),
    problem: (() => {
      const said = new Set<string>();
      return (source, line) => {
        if (said.has(source)) return;
        said.add(source);
        if (colour) process.stdout.write("\r\x1b[2K");
        console.log(yellow(`  ${line}`));
      };
    })(),
  });
  const calls = Math.ceil(records.length / CHECK_BATCH_SIZE);
  if (agent && calls > 1 && !(await ask(`\n${t("cliWrite.review.checkQuestion", { rows: records.length, agent: agent.name, calls })}`, true))) process.exit(EXIT.ok);

  // What the sources say about each record's aircraft, the record itself left out of the log.
  console.log("");
  const today = todayIn();
  const findings = openFindings(log).filter((f) => f.severity !== "info");
  const request: CheckRequest = { schema: CHECK_REQUEST_SCHEMA, version: CHECK_VERSION, batchId: "chk-log", createdAt: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"), format: "touchdown_inbox", rules: agentRules(), records: [] };
  try {
    for (const [i, r] of records.entries()) {
      status(t("cliWrite.checkLog.lookingUp", { done: i, total: records.length }));
      const date = (r.table === "flights" ? (r.row.scheduledDate ?? flightDay(r.row)) : r.row.seenOn) ?? today;
      const evidence = r.row.registration ? await lookups.lookUp(r.row.registration, date, { self: { id: r.row.id } }) : [];
      const own = findings.filter((f) => f.records.some((x) => x.table === r.table && x.id === r.row.id)).map((f) => f.message);
      request.records.push(logCheckRecord(store, ref, r, { recordId: `row-${i + 1}`, findings: own, evidence: evidenceForAgent(evidence), includeNotes }));
    }
  } finally {
    await lookups.close();
  }
  if (colour) process.stdout.write("\r\x1b[2K");
  console.log(dim(t("cliWrite.checkLog.lookedUp", { count: records.length })));

  if (o.dryRun || !agent) {
    console.log(`\n${t("cliWrite.check.dryRun")}\n`);
    console.log(JSON.stringify(agentPayload(request.records.slice(0, CHECK_BATCH_SIZE), request.rules, ref), null, 2));
    process.exit(EXIT.ok);
  }

  const passed = await ensureSelfTest(agent, readFileSync(PROMPT_FILE, "utf8"), ref, o.model, o.selfTest, (text, end) => (end ? console.log(text) : process.stdout.write(text)));
  if (!passed) process.exit(EXIT.problem);
  const { result } = await runCheck(agent, ref, request, request.records, { batchSize: CHECK_BATCH_SIZE, parallel: PARALLEL, model: o.model }, true);
  if (result.failed.length) console.log(yellow(t("cliWrite.checkLog.noAnswer", { count: result.failed.reduce((n, f) => n + f.recordIds.length, 0) })));

  // Each suggestion with its reason; used only when the user says so, or with --use-high when the agent is sure.
  const byId = new Map(request.records.map((rec, i) => [rec.recordId, { rec, r: records[i]! }]));
  const taken = new Map<string, AgentSuggestion[]>();
  const withSuggestions = result.records.filter((x) => x.suggestions.length);
  if (withSuggestions.length) console.log(`\n${tc("cliWrite.review.suggestionsTitle", {}, { bold, dim })}`);
  else console.log(`\n${t("cliWrite.checkLog.nothingToChange", { count: result.checked })}`);
  for (const x of withSuggestions) {
    const at = byId.get(x.recordId);
    if (!at) continue;
    console.log(`${bold(recordTitle(at.rec))}${x.note ? dim(`  ${x.note}`) : ""}`);
    for (const s of x.suggestions) {
      const high = s.confidence === "high";
      console.log(`    ${fieldLabel(s.field)}: ${s.current || t("cli.value.empty")} → ${bold(s.suggested || t("cli.value.clear"))}  ${(high ? green : s.confidence === "medium" ? yellow : dim)(confidenceLabel(s.confidence))}  ${dim(s.reason)}`);
      const use = o.useHigh && high ? true : rl ? await ask(`    ${t("cliWrite.review.useIt")}`, false) : false;
      if (use) taken.set(x.recordId, [...(taken.get(x.recordId) ?? []), s]);
    }
  }
  const notes = result.records.filter((x) => !x.suggestions.length && x.note);
  for (const x of notes) {
    const at = byId.get(x.recordId);
    if (at) console.log(`${bold(recordTitle(at.rec))}  ${dim(x.note)}`);
  }

  // The suggestions taken, one edit a record, each naming the agent.
  const changes: InboxChange[] = [];
  const problems: string[] = [];
  for (const [recordId, list] of taken) {
    const { rec, r } = byId.get(recordId)!;
    const input = suggestionEditInput(store, r, list);
    const built = r.table === "flights" ? flightEdit(store, ref, r.row, input) : sightingEdit(store, ref, r.row, input);
    if ("error" in built) problems.push(t("cliWrite.checkLog.notTaken", { record: recordTitle(rec), error: built.error }));
    else changes.push({ ...built.change, agent: agent.checker });
  }

  // What the agent has now seen: every record it answered for, as it is and as it will be once the changes taken are
  // imported, so a record is sent again only when it changes otherwise.
  const failed = new Set(result.failed.flatMap((f) => f.recordIds));
  const after = changes.length ? copyStore(store) : store;
  if (changes.length) applyChanges(after, ref, changes, () => true, { fileName: "check" });
  for (const [recordId, { r }] of byId) {
    if (failed.has(recordId)) continue;
    const now = r.table === "flights" ? after.get("flights", r.row.id) : after.get("sightings", r.row.id);
    const as = [logRecordFingerprint(store, ref, r)];
    if (now && changes.length) as.push(logRecordFingerprint(after, ref, { table: r.table, row: now } as LogRecord));
    seen.set(logRecordKey(r), [...new Set(as)]);
  }
  saveSeen(key, seen);
  rl?.close();

  console.log("");
  if (!changes.length) {
    for (const p of problems) console.log(yellow(`  ${p}`));
    console.log(withSuggestions.length ? t("cliWrite.checkLog.noneTaken") : t("cliWrite.checkLog.remembered"));
    process.exit(EXIT.ok);
  }
  // Reported and written as every changing command's changes are: the plan, the findings, the inbox file.
  await writeChanges(log, "check", changes, { json: false, dryRun: false, keepErrors: false }, problems);
}
