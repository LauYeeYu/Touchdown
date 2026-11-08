#!/usr/bin/env -S npx tsx
// Touchdown companion CLI: the menu, the help and the commands' dispatch. Here too, from phase 1, `touchdown import
// <files…> --out FILE` builds a backup from files alone: imports them in the order given, merges them, resolves
// airframes, runs the checks and prints findings and summary statistics. Without --out, import puts each file in the
// inbox for review (importfile.ts). Private fields (ticket number, booking reference) are never printed.

import { t, tDynamic } from "@touchdown/i18n/cli";
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import {
  ADSBLOL_ATTRIBUTION,
  attachTrack,
  backupZip,
  betterTrack,
  checkAll,
  matchTrackLegs,
  parseTrackCsv,
  phaseIndex,
  type TrackPointInput,
  combinedStats,
  commitImport,
  DEFAULT_AGENT_RULES,
  flightStats,
  FR24_ATTRIBUTION,
  matchCandidates,
  parseSource,
  PRIVATE_FIELDS,
  readBackup,
  operatorFromOverride,
  RefIndex,
  resolveAirframes,
  RULES,
  SEVERITY_ORDER,
  sightingStats,
  Store,
  type Finding,
  type ParsedSource,
  type Tally,
} from "@touchdown/core";
import { nf } from "@touchdown/core/view";
import { refTables } from "./reftables.ts";
import { writeJsonTables } from "./jsontables.ts";
import { readSheets } from "./sheets.ts";
import { checkCommand, checkHelp } from "./check.ts";
import { readSheetFile } from "./columns.ts";
import { spotCommand, spotHelp } from "./spot.ts";
import { storageCommand, storageHelp } from "./storage.ts";
import { loginCommand, loginHelp, logoutCommand } from "./site.ts";
import { addCommand, addHelp } from "./add.ts";
import { inboxCommand, inboxHelp } from "./inbox.ts";
import { aircraftCommand, aircraftHelp } from "./aircraft.ts";
import { airportCommand, airportHelp } from "./airport.ts";
import { statsCommand, statsHelp } from "./stats.ts";
import { reviewCommand, reviewHelp } from "./review.ts";
import { importCommand } from "./importfile.ts";
import { backupCommand, backupHelp, exportCommand, exportHelp } from "./backup.ts";
import { tracksCommand, tracksHelp } from "./tracklookup.ts";
import { deleteCommand, deleteHelp, editCommand, editHelp, familiesCommand, familiesHelp, settingsCommand, settingsHelp, trackCommand, trackHelp, undoCommand, undoHelp, viewsHelp } from "./change.ts";
import { importsCommand, importsHelp, issuesCommand, issuesHelp } from "./issues.ts";
import { flightCommand, flightHelp, flightsCommand, flightsHelp, sessionsCommand, sessionsHelp, sightingsCommand, sightingsHelp } from "./records.ts";
import { privatePath, shownPath, userPath } from "./paths.ts";
import { AGENT_NAME, chooseAgent, installedVersion, saveAgent, savedAgent, savedRules, savedSendNotes, saveRules, saveSendNotes } from "./settings.ts";
import { bold, dim, red, tc } from "./term.ts";
import { lookupAirframes, lookupAsChanges, type LookupReport } from "./airframes.ts";
import { changeOptions, parse as parseChange, writeChanges } from "./change.ts";
import { fail as failRead, openOrFail } from "./read.ts";
import { PROVIDER_IDS, providers as allProviders } from "./providers/index.ts";

const DEFAULT_CHROME_PORT = 9222;
const DEFAULT_FR24_DELAY_S = 10;
const DEFAULT_CACHE = privatePath("cache/airframes");
const CACHE_DAYS = 90;

const PRIVATE = new Set(PRIVATE_FIELDS.map((f) => f.split(".")[1]!));

const menu = () => tc("cli.menu", {}, { bold });

const lookupHelp = () => t("cli.help.lookup", { chromePort: DEFAULT_CHROME_PORT, fr24Delay: DEFAULT_FR24_DELAY_S, cacheDays: CACHE_DAYS, sources: PROVIDER_IDS.join(", ") });

const importHelp = () => t("cli.help.import", { lookup: lookupHelp() });

const airframesHelp = () => t("cli.help.airframes", { options: changeOptions(15), lookup: lookupHelp() });

const agentHelp = () => t("cli.help.agent");

/** Each command's help, written when it is shown. */
const HELP: Record<string, () => string> = {
  spot: spotHelp,
  check: checkHelp,
  import: importHelp,
  airframes: airframesHelp,
  agent: agentHelp,
  storage: storageHelp,
  add: addHelp,
  inbox: inboxHelp,
  login: loginHelp,
  logout: loginHelp,
  flights: flightsHelp,
  flight: flightHelp,
  sightings: sightingsHelp,
  sessions: sessionsHelp,
  aircraft: aircraftHelp,
  airport: airportHelp,
  stats: statsHelp,
  issues: issuesHelp,
  imports: importsHelp,
  edit: editHelp,
  delete: deleteHelp,
  track: trackHelp,
  tracks: tracksHelp,
  undo: undoHelp,
  families: familiesHelp,
  settings: settingsHelp,
  review: reviewHelp,
  backup: backupHelp,
  views: viewsHelp,
  export: exportHelp,
};

function usage(text = menu(), code = 1): never {
  console.log(text);
  process.exit(code);
}

/** \`touchdown agent …\`: show or change the agent, whether notes are sent to it, and the user's rules. */
async function agentCommand(args: string[]) {
  const name = args[0];
  if (name === "--help" || name === "-h") usage(agentHelp(), 0);
  if (name === "--json") {
    if (args.length > 1) usage(agentHelp());
    const saved = savedAgent();
    const own = savedRules();
    console.log(JSON.stringify({ ok: true, agent: saved ?? null, version: saved && saved !== "none" ? (installedVersion(saved) ?? null) : null, sendNotes: savedSendNotes(), rules: own.length ? own : DEFAULT_AGENT_RULES, ownRules: own.length > 0 }, null, 2));
    return;
  }
  if (name === "notes") {
    if (args[1] !== "on" && args[1] !== "off") usage(agentHelp());
    saveSendNotes(args[1] === "on");
    console.log(args[1] === "on" ? t("cliWrite.agent.notesOn") : t("cliWrite.agent.notesOff"));
    return;
  }
  if (name === "rules") return rulesCommand(args.slice(1));
  if (name) {
    if (name !== "claude" && name !== "codex" && name !== "none") usage(agentHelp());
    if (name !== "none" && !installedVersion(name)) console.log(dim(t("cliWrite.agent.installFirst", { agent: AGENT_NAME[name] })));
    saveAgent(name);
    console.log(t("cliWrite.agent.saved", { agent: AGENT_NAME[name] }));
    return;
  }
  const saved = savedAgent();
  const version = saved && saved !== "none" ? installedVersion(saved) : null;
  console.log(saved ? t("cliWrite.agent.current", { agent: AGENT_NAME[saved], state: saved === "none" ? "none" : version ? "installed" : "missing", version: version ?? "" }) : t("cliWrite.agent.noneYet"));
  console.log(savedSendNotes() ? t("cliWrite.agent.notesSent") : t("cliWrite.agent.notesNotSent"));
  printRules();
  if (process.stdin.isTTY) await chooseAgent();
  else console.log(dim(t("cliWrite.agent.chooseWith")));
}

function printRules() {
  const own = savedRules();
  if (!own.length) {
    console.log(`${t("cliWrite.agent.defaultRules")}\n  ${dim(DEFAULT_AGENT_RULES.join("\n  "))}`);
    return;
  }
  console.log(t("cliWrite.agent.ownRules"));
  own.forEach((r, i) => console.log(`  ${i + 1}  ${r}`));
}

function rulesCommand(args: string[]) {
  const own = savedRules();
  if (args[0] === "add") {
    const text = args.slice(1).join(" ").trim();
    if (!text) usage(agentHelp());
    if (text.length > 500) {
      console.error(red(t("cliWrite.agent.ruleTooLong")));
      process.exit(1);
    }
    saveRules([...own, text]);
    console.log(t("cliWrite.agent.ruleAdded", { n: own.length + 1 }));
    return;
  }
  if (args[0] === "remove") {
    const n = Number(args[1]);
    if (!Number.isInteger(n) || n < 1 || n > own.length) {
      console.error(red(own.length ? t("cliWrite.agent.ruleNumber", { last: own.length }) : t("cliWrite.agent.noRules")));
      process.exit(1);
    }
    saveRules(own.filter((_, i) => i !== n - 1));
    console.log(t("cliWrite.agent.ruleRemoved", { n }));
    return;
  }
  if (args.length) usage(agentHelp());
  printRules();
}

const hm = (min: number) => t("cliWrite.build.hm", { h: Math.floor(min / 60), m: String(Math.round(min % 60)).padStart(2, "0") });

interface LookupArgs {
  enabled: boolean;
  sources: string[] | null;
  all: boolean;
  only: string[];
  limit?: number;
  refresh: boolean;
  offline: boolean;
  overwriteImported: boolean;
  cache: string;
  fr24: boolean;
  chromePort: number;
  fr24DelayS: number;
}

/** Take the lookup options out of the argument list; returns the rest. */
function lookupArgs(args: string[]): { lookup: LookupArgs; rest: string[] } {
  const lookup: LookupArgs = { enabled: false, sources: null, all: false, only: [], refresh: false, offline: false, overwriteImported: false, cache: DEFAULT_CACHE, fr24: false, chromePort: DEFAULT_CHROME_PORT, fr24DelayS: DEFAULT_FR24_DELAY_S };
  const rest: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a === "--airframes") lookup.enabled = true;
    else if (a === "--sources") lookup.sources = args[++i]!.split(",").map((x) => x.trim());
    else if (a === "--all") lookup.all = true;
    else if (a === "--only") lookup.only = args[++i]!.split(",").map((x) => x.trim());
    else if (a === "--limit") lookup.limit = Number(args[++i]);
    else if (a === "--refresh") lookup.refresh = true;
    else if (a === "--offline") lookup.offline = true;
    else if (a === "--overwrite-imported") lookup.overwriteImported = true;
    else if (a === "--cache") lookup.cache = userPath(args[++i]!);
    else if (a === "--fr24") lookup.fr24 = true;
    else if (a === "--chrome-port") lookup.chromePort = Number(args[++i]);
    else if (a === "--fr24-delay") lookup.fr24DelayS = Number(args[++i]);
    else rest.push(a);
  }
  return { lookup, rest };
}

/** The sources the lookup options choose; none when --sources names none of them. */
function providersFor(ref: RefIndex, args: LookupArgs, say: (line: string) => void) {
  const fr24 = args.fr24 || args.sources?.includes("fr24") ? { port: args.chromePort, delayMs: Math.max(5, args.fr24DelayS) * 1000, cacheDir: args.cache, maxAgeDays: CACHE_DAYS, refresh: args.refresh, offline: args.offline } : null;
  const known = allProviders(ref, say, fr24);
  return args.sources ? known.filter((p) => args.sources!.includes(p.id)) : known;
}

async function runLookup(store: Store, ref: RefIndex, args: LookupArgs): Promise<void> {
  const providers = providersFor(ref, args, (l) => console.log(l));
  if (!providers.length) {
    console.log(`\n== ${t("cliWrite.build.lookupNoSources", { known: PROVIDER_IDS.join(", ") })}`);
    return;
  }
  console.log(`\n== ${t("cliWrite.build.lookup")}`);
  const report = await lookupAirframes(store, ref, { providers, all: args.all, only: args.only, limit: args.limit, overwriteImported: args.overwriteImported, log: (l) => console.log(l) });
  for (const line of lookupSummary(report)) console.log(`  ${line}`);
}

function lookupSummary(r: LookupReport): string[] {
  return [
    t("cliWrite.lookup.summary", { looked: r.looked, filled: r.filled, merged: r.merged, rejected: r.rejected.length, notFound: r.notFound.length }),
    ...(r.differs.length ? [t("cliWrite.lookup.differs", { count: r.differs.length })] : []),
    ...[...r.blocked].map(([source, why]) => t("cliWrite.lookup.stopped", { source, why })),
  ];
}

/** `touchdown airframes` without a backup: the answers for the log's aircraft go to the inbox as changes. */
async function airframesIntoLog(args: string[], lookup: LookupArgs) {
  const c = parseChange(args, airframesHelp());
  if (c.positional.length) usage(airframesHelp());
  const log = await openOrFail(c.json, c.log);
  const say = (line: string) => {
    if (!c.json) console.log(line);
  };
  const providers = providersFor(log.ref, lookup, say);
  if (!providers.length) return failRead(c.json, t("cliWrite.lookup.noSources", { sources: PROVIDER_IDS.join(", ") }));
  const { report, changes } = await lookupAsChanges(log.store, log.ref, { providers, all: lookup.all, only: lookup.only, limit: lookup.limit, overwriteImported: lookup.overwriteImported, log: say });
  say("");
  return writeChanges(log, "airframes", changes, c, lookupSummary(report));
}

// The CLI stays in UK English, whatever the terminal's language (docs/31-ui.md, "Language"): its own messages are not
// translated, and in another language the core package's would be, mixing two languages in one report.
async function main(argv: string[]) {
  const [cmd, ...all] = argv;
  if (!cmd || cmd === "help" || cmd === "--help" || cmd === "-h") {
    const topic = all[0];
    if (topic && !HELP[topic]) console.log(`${t("cli.noCommand", { command: topic })}\n`);
    usage(topic && HELP[topic] ? HELP[topic]() : menu(), topic && !HELP[topic] ? 1 : 0);
  }
  if (!HELP[cmd]) {
    console.log(`${t("cli.noCommand", { command: cmd })}\n`);
    usage();
  }
  if (cmd === "check") return checkCommand(all);
  if (cmd === "spot") return spotCommand(all);
  if (cmd === "agent") return agentCommand(all);
  if (cmd === "login") return loginCommand(all, (l) => console.log(dim(l)));
  if (cmd === "logout") return logoutCommand();
  if (cmd === "storage") return storageCommand(all, new RefIndex(refTables()));
  if (cmd === "add") return addCommand(all, new RefIndex(refTables()));
  if (cmd === "inbox") return inboxCommand(all, new RefIndex(refTables()));
  if (cmd === "flights") return flightsCommand(all);
  if (cmd === "flight") return flightCommand(all);
  if (cmd === "sightings") return sightingsCommand(all);
  if (cmd === "sessions") return sessionsCommand(all);
  if (cmd === "aircraft") return aircraftCommand(all);
  if (cmd === "airport") return airportCommand(all);
  if (cmd === "stats") return statsCommand(all);
  if (cmd === "issues") return issuesCommand(all);
  if (cmd === "imports") return importsCommand(all);
  if (cmd === "edit") return editCommand(all);
  if (cmd === "delete") return deleteCommand(all);
  if (cmd === "track") return trackCommand(all);
  if (cmd === "tracks") return tracksCommand(all);
  if (cmd === "undo") return undoCommand(all);
  if (cmd === "families") return familiesCommand(all);
  if (cmd === "settings") return settingsCommand(all);
  if (cmd === "review") return reviewCommand(all);
  if (cmd === "backup") return backupCommand(all);
  if (cmd === "export") return exportCommand(all);
  if (all.includes("--help") || all.includes("-h")) usage(HELP[cmd]!(), 0);
  // Without --out, import puts the files in the inbox for review (docs/34); with it, it builds a backup.
  if (cmd === "import" && !all.includes("--out")) return importCommand(all, new RefIndex(refTables()), importHelp());
  const { lookup, rest } = lookupArgs(all);
  if (cmd === "airframes") return airframesCommand(rest, lookup);
  const files: string[] = [];
  let today: string | undefined;
  let out: string | undefined;
  let allFindings = false;
  let applyFixes = false;
  const trackDirs: { path: string; provider: "fr24_csv" | "adsblol" }[] = [];
  const maps: string[] = [];
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i]!;
    if (a === "--today") today = rest[++i];
    else if (a === "--out") out = userPath(rest[++i]!);
    else if (a === "--all-findings") allFindings = true;
    else if (a === "--apply-fixes") applyFixes = true;
    else if (a === "--map") maps.push(rest[++i]!);
    else if (a === "--tracks") trackDirs.push({ path: userPath(rest[++i]!), provider: "fr24_csv" });
    else if (a === "--tracks-adsblol") trackDirs.push({ path: userPath(rest[++i]!), provider: "adsblol" });
    else files.push(userPath(a));
  }
  if (!files.length) usage(importHelp());

  const ref = new RefIndex(refTables());
  const store = new Store({ deviceId: "cli" });

  for (const file of files) {
    // Any layout: the columns are worked out (a layout confirmed before, or --map, decides), not asked about.
    const read = await readSheetFile(file, ref, { maps, agent: null, ask: false });
    if ("error" in read) {
      console.log(`\n${read.error}`);
      continue;
    }
    const parsed = read.source;
    const matches = matchCandidates(store, parsed.candidates);
    const kinds = { new: 0, identical: 0, update: 0, conflict: 0, duplicate: 0 };
    for (const m of matches) kinds[m.kind]++;
    console.log(`\n== ${t("cliWrite.build.file", { file: basename(file), format: parsed.format, rows: parsed.rowsRead, new: kinds.new, update: kinds.update, identical: kinds.identical, conflict: kinds.conflict, duplicate: kinds.duplicate })}`);
    const corrected = matches.filter((m) => m.corrections.length);
    if (corrected.length) {
      console.log(`  ${t("cliWrite.build.corrections")}`);
      for (const m of corrected) {
        const v = m.candidate.values as Record<string, unknown>;
        console.log(`   ${t("cliWrite.build.correction", { row: m.candidate.sourceRow, flight: String(v.flightNumber ?? ""), date: String(v.scheduledDate ?? ""), corrections: m.corrections.map((x) => `${x.field} ${String(x.existing)} → ${String(x.incoming)}`).join("; "), reason: m.corrections[0]!.reason })}`);
      }
    }

    const rowIssues = parsed.candidates.flatMap((c) => c.issues.map((i) => ({ c, i })));
    if (rowIssues.length) {
      console.log(`  ${t("cliWrite.build.rowChecks", { count: rowIssues.length })}`);
      for (const { c, i } of rowIssues) console.log(`   ${t("cliWrite.build.rowCheck", { row: c.sourceRow, rule: i.ruleId, message: i.message })}`);
    }
    const conflicts = matches.filter((m) => m.kind === "conflict");
    if (conflicts.length) {
      console.log(`  ${t("cliWrite.build.conflicts")}`);
      for (const m of conflicts) {
        const v = m.candidate.values as Record<string, unknown>;
        const label = m.candidate.table === "flights" ? `${v.flightNumber ?? "?"} ${v.scheduledDate ?? ""}` : `${v.registration ?? "?"} ${v.seenOn ?? ""}`;
        const diffs = m.conflicts.map((d) => (PRIVATE.has(d.field) ? t("cliWrite.build.privateDiffers", { field: d.field }) : `${d.field}: ${String(d.existing)} → ${String(d.incoming)}`));
        console.log(`   ${t("cliWrite.build.conflict", { row: m.candidate.sourceRow, label, differences: diffs.join("; ") })}`);
      }
    }
    commitImport(store, ref, parsed, matches);
  }

  if (trackDirs.length) importTracks(store, ref, trackDirs);

  let resolved = resolveAirframes(store, ref);
  let findings = checkAll(store, ref, { today, overlaps: resolved.overlaps });
  if (applyFixes) {
    // The corrected data: accept every fix that is the only one offered for an error or a model/type mismatch.
    // A type mismatch between records is left alone: which record is right is the user's call.
    const fixable = findings.filter((f) => f.fixes.length === 1 && f.ruleId !== "C-TYPE-MISMATCH" && (f.severity === "error" || f.ruleId === "V-MODEL-TYPE"));
    console.log(`\n== ${t("cliWrite.build.applying", { count: fixable.length })}`);
    for (const f of fixable) {
      const fix = f.fixes[0]!;
      const patch: Record<string, unknown> = { [fix.field]: fix.value };
      for (const a of fix.also ?? []) patch[a.field] = a.value;
      if (fix.field === "typeCode") patch.typeCodeRaw = fix.value;
      store.update(fix.table, fix.id, patch as never);
      console.log(`  ${f.ruleId}: ${fix.label}`);
    }
    resolved = resolveAirframes(store, ref);
    findings = checkAll(store, ref, { today, overlaps: resolved.overlaps });
  }
  if (lookup.enabled) {
    await runLookup(store, ref, lookup);
    findings = checkAll(store, ref, { today, overlaps: resolveAirframes(store, ref).overlaps });
  }
  printFindings(findings, allFindings);
  printStats(store, ref);
  writeOut(store, out);
}

/** `touchdown airframes <backup.zip>`: look up airframe facts for an existing backup. */
async function airframesCommand(args: string[], lookup: LookupArgs) {
  // A backup file given: it is filled, as in phase 1. Otherwise the log, through the inbox.
  if (!args.some((a, i) => a.endsWith(".zip") && args[i - 1] !== "--log" && args[i - 1] !== "--out")) return airframesIntoLog(args, lookup);
  let out: string | undefined;
  const files: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--out") out = userPath(args[++i]!);
    else files.push(userPath(args[i]!));
  }
  if (files.length !== 1 || !files[0]!.endsWith(".zip")) usage(airframesHelp());
  const ref = new RefIndex(refTables());
  const store = new Store({ deviceId: "cli" });
  const backup = readBackup(new Uint8Array(readFileSync(files[0]!)));
  if (backup.problems.length) {
    console.log(`${files[0]}: ${backup.problems.join("; ")}`);
    process.exit(1);
  }
  for (const [table, rows] of backup.tables) store.load(table, rows as never);
  for (const o of store.all("operator_overrides")) ref.addOperator(operatorFromOverride(o));
  await runLookup(store, ref, lookup);
  const findings = checkAll(store, ref, { overlaps: resolveAirframes(store, ref).overlaps }).filter((f) => f.ruleId === "V-BEFORE-FIRST-FLIGHT");
  if (findings.length) printFindings(findings, true);
  writeOut(store, out);
}

function writeOut(store: Store, out: string | undefined) {
  if (out?.endsWith(".zip")) {
    writeFileSync(out, backupZip(store));
    console.log(`\n${t("cliWrite.build.wroteBackup", { file: shownPath(out) })}`);
  } else if (out) {
    mkdirSync(out, { recursive: true });
    const n = writeJsonTables(store, out);
    console.log(`\n${t("cliWrite.build.wroteTables", { count: n, tables: join(out, "tables"), manifest: join(out, "manifest.json") })}`);
  }
}

const ATTRIBUTION = { fr24_csv: FR24_ATTRIBUTION, adsblol: ADSBLOL_ATTRIBUTION } as const;

/** Read every track CSV in the given folders, match each to a flight and keep the best track per flight. */
function importTracks(store: Store, ref: RefIndex, dirs: { path: string; provider: "fr24_csv" | "adsblol" }[]) {
  const flights = store.all("flights");
  const best = new Map<string, { points: TrackPointInput[]; coverage: "complete" | "partial"; provider: "fr24_csv" | "adsblol"; file: string }>();
  let unmatched = 0;
  let files = 0;
  for (const d of dirs) {
    const paths = statSync(d.path).isDirectory() ? readdirSync(d.path).filter((f) => f.toLowerCase().endsWith(".csv")).map((f) => join(d.path, f)) : [d.path];
    for (const path of paths) {
      files++;
      const points = parseTrackCsv(readFileSync(path, "utf8"));
      // A file that runs over more than one flight gives each flight only its leg.
      const found = points.length < 2 ? [] : matchTrackLegs(points, flights, ref, basename(path));
      if (!found.length) unmatched++;
      for (const m of found) {
        const cur = best.get(m.flight.id);
        if (!cur || betterTrack({ coverage: m.coverage, points: m.points.length }, { coverage: cur.coverage, points: cur.points.length })) {
          best.set(m.flight.id, { points: m.points, coverage: m.coverage, provider: d.provider, file: basename(path) });
        }
      }
    }
  }
  for (const [flightId, t] of best) attachTrack(store, flightId, t.points, { provider: t.provider, attribution: ATTRIBUTION[t.provider], coverage: t.coverage });
  const partial = [...best.values()].filter((t) => t.coverage === "partial").length;
  console.log(`\n== ${t("cliWrite.build.tracks", { files, flights: best.size, partial, unmatched })}`);
}

function printFindings(findings: Finding[], all: boolean) {
  const byRule = new Map<string, Finding[]>();
  for (const f of findings) byRule.set(f.ruleId, [...(byRule.get(f.ruleId) ?? []), f]);
  const rules = [...byRule].sort(
    (a, b) => SEVERITY_ORDER[a[1][0]!.severity] - SEVERITY_ORDER[b[1][0]!.severity] || a[0].localeCompare(b[0]),
  );
  const count = (s: string) => findings.filter((f) => f.severity === s).length;
  console.log(`\n== ${t("cliWrite.build.findings", { errors: count("error"), warnings: count("warning"), notes: count("info") })}`);
  for (const [rule, list] of rules) {
    console.log(`  ${rule} ${RULES[rule]?.title ?? ""} (${tDynamic(`cli.severity.${list[0]!.severity}`)}, ${list.length})`);
    const shown = all ? list : list.slice(0, 6);
    for (const f of shown) console.log(`    - ${f.message}`);
    if (shown.length < list.length) console.log(`    ${t("cliWrite.build.moreFindings", { count: list.length - shown.length })}`);
  }
}

const leftOut = (n: number) => t("cliWrite.build.leftOut", { count: n });

function printStats(store: Store, ref: RefIndex) {
  const airframes = new Map(store.all("airframes").map((a) => [a.id, a]));
  const ctx = { ref, airframes, phases: phaseIndex(store) };
  const flights = store.all("flights");
  const sightings = store.all("sightings");
  const opCode = (id: string) => {
    const o = ref.operator(id);
    return o ? (o.iata ?? o.icao ?? o.name) : id;
  };
  const opIcao = (id: string) => {
    const o = ref.operator(id);
    return o ? (o.icao ?? o.name) : id;
  };
  const apCode = (id: string) => ref.airport(id)?.iata ?? ref.airport(id)?.icao ?? id;
  const apIcao = (id: string) => ref.airport(id)?.icao ?? id;
  const line = (tally: Tally, label: (k: string) => string = (k) => k, n = 20) =>
    tally.items.slice(0, n).map((x) => `${label(x.key)} ${x.count}`).join(", ") + (tally.items.length > n ? `, ${t("cliWrite.build.groups", { count: tally.items.length })}` : "") + (tally.leftOut ? `  ${leftOut(tally.leftOut)}` : "");
  // " [3 left out]" after a figure some records could not count towards.
  const out = (n: number) => (n ? ` ${leftOut(n)}` : "");

  if (flights.length) {
    const s = flightStats(flights, ctx);
    console.log(`\n== ${t("cliWrite.build.flights.title")}`);
    console.log(`  ${t("cliWrite.build.flights.count", { count: s.flights })}`);
    console.log(`  ${t("cliWrite.build.flights.distance", { km: nf.format(Math.round(s.distanceKm.value)) })}${out(s.distanceKm.leftOut)}`);
    console.log(`  ${t("cliWrite.build.flights.time", { time: hm(s.minutes.value) })}${out(s.minutes.leftOut)}`);
    console.log(`  ${t("cliWrite.build.flights.counts", { airports: s.airports.value, countries: s.countries.value, airlines: s.airlines.value, routes: s.routes.value, types: s.types.value })}`);
    console.log(`  ${t("cliWrite.build.aircraft", { airframes: s.aircraft.value, provisional: s.aircraft.provisional })}${out(s.aircraft.leftOut)}`);
    console.log(`  ${t("cliWrite.build.flights.most", { airline: s.byAirline.top.map(opCode).join(" / "), route: s.byRoute.top.join(" / "), manufacturer: s.byManufacturer.top.join(" / "), family: s.byFamily.top.join(" / "), type: s.byType.top.join(" / ") })}`);
    console.log(`  ${t("cliWrite.build.flights.byAirline", { list: line(s.byAirline, opCode) })}`);
    console.log(`  ${t("cliWrite.build.flights.byManufacturer", { list: line(s.byManufacturer) })}`);
    console.log(`  ${t("cliWrite.build.flights.byFamily", { list: line(s.byFamily) })}`);
    console.log(`  ${t("cliWrite.build.flights.byType", { list: line(s.byType, undefined, 30) })}`);
    console.log(`  ${t("cliWrite.build.flights.byRoute", { list: line(s.byRoute, undefined, 6) })}`);
    console.log(`  ${t("cliWrite.build.flights.airports", { list: line(s.airportVisits, apCode, 8) })}`);
    const longest = s.longestByDistance && store.get("flights", s.longestByDistance.id);
    if (longest) console.log(`  ${t("cliWrite.build.flights.longest", { route: `${apCode(longest.fromAirportId!)}–${apCode(longest.toAirportId!)}`, km: nf.format(Math.round(s.longestByDistance!.value)) })}`);
    console.log(`  ${t("cliWrite.build.flights.perYear", { years: s.perYear.map((y) => t("cliWrite.build.flights.year", { year: y.year, flights: y.flights, km: nf.format(Math.round(y.distanceKm)) })).join("; ") })}`);
  }
  if (sightings.length) {
    const s = sightingStats(sightings, ctx);
    console.log(`\n== ${t("cliWrite.build.sightings.title")}`);
    console.log(`  ${t("cliWrite.build.sightings.count", { count: s.sightings })}`);
    console.log(`  ${t("cliWrite.build.aircraft", { airframes: s.aircraft.value, provisional: s.aircraft.provisional })}${out(s.aircraft.leftOut)}`);
    console.log(`  ${t("cliWrite.build.sightings.counts", { airlines: s.airlines.value, families: s.families.value, typeCodes: s.typeCodes.value, specialAircraft: s.specialLiveryAircraft.value, specialLiveries: s.specialLiveries.value })}`);
    console.log(`  ${t("cliWrite.build.sightings.most", { airline: s.byAirline.top.map(opIcao).join(" / "), family: s.byFamily.top.join(" / "), type: s.byType.top.join(" / ") })}`);
    console.log(`  ${t("cliWrite.build.sightings.byAirline", { list: line(s.byAirline, opIcao, 14) })}`);
    console.log(`  ${t("cliWrite.build.sightings.byFamily", { list: line(s.byFamily, undefined, 16) })}`);
    console.log(`  ${t("cliWrite.build.sightings.byType", { list: line(s.byType, undefined, 16) })}`);
    console.log(`  ${t("cliWrite.build.sightings.byLocation", { list: line(s.sightingsByLocation, apIcao, 14) })}`);
    console.log(`  ${t("cliWrite.build.sightings.byPhase", { list: line(s.byPhase) })}`);
    console.log(`  ${t("cliWrite.build.sightings.countries", { count: s.byRegistrationCountry.items.length, list: line(s.byRegistrationCountry, undefined, 4) })}`);
    const big = [...s.newPerDay].sort((a, b) => b.count - a.count)[0];
    if (big) console.log(`  ${t("cliWrite.build.sightings.mostNew", { count: big.count })}`);
    const perDay = new Map<string, number>();
    for (const x of sightings) if (x.seenOn) perDay.set(x.seenOn, (perDay.get(x.seenOn) ?? 0) + 1);
    const busiest = Math.max(0, ...perDay.values());
    if (busiest) console.log(`  ${t("cliWrite.build.sightings.busiest", { count: busiest })}`);
  }
  if (flights.length && sightings.length) {
    const c = combinedStats(flights, sightings, ctx);
    console.log(`\n== ${t("cliWrite.build.combined.title")}`);
    console.log(`  ${t("cliWrite.build.combined.both", { count: c.flownAndPhotographed.length })}`);
  }
}

main(process.argv.slice(2)).catch((e: Error) => {
  console.error(e.message);
  process.exit(1);
});
