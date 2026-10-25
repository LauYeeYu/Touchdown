#!/usr/bin/env -S npx tsx
// Touchdown companion CLI: the menu, the help and the commands' dispatch. Here too, from phase 1, `touchdown import
// <files…> --out FILE` builds a backup from files alone: imports them in the order given, merges them, resolves
// airframes, runs the checks and prints findings and summary statistics. Without --out, import puts each file in the
// inbox for review (importfile.ts). Private fields (ticket number, booking reference) are never printed.

import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import {
  attachTrack,
  backupZip,
  betterTrack,
  checkAll,
  matchTrack,
  parseTrackCsv,
  phaseIndex,
  type TrackPointInput,
  combinedStats,
  commitImport,
  DEFAULT_AGENT_RULES,
  flightStats,
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
import { loadRefTables } from "@touchdown/refdata";
import { writeJsonTables } from "./jsontables.ts";
import { readSheets } from "./sheets.ts";
import { CHECK_HELP, checkCommand } from "./check.ts";
import { readSheetFile } from "./columns.ts";
import { SPOT_HELP, spotCommand } from "./spot.ts";
import { STORAGE_HELP, storageCommand } from "./storage.ts";
import { LOGIN_HELP, loginCommand, logoutCommand } from "./site.ts";
import { ADD_HELP, addCommand } from "./add.ts";
import { INBOX_HELP, inboxCommand } from "./inbox.ts";
import { AIRCRAFT_HELP, aircraftCommand } from "./aircraft.ts";
import { AIRPORT_HELP, airportCommand } from "./airport.ts";
import { STATS_HELP, statsCommand } from "./stats.ts";
import { REVIEW_HELP, reviewCommand } from "./review.ts";
import { importCommand } from "./importfile.ts";
import { BACKUP_HELP, backupCommand, EXPORT_HELP, exportCommand } from "./backup.ts";
import { DELETE_HELP, deleteCommand, EDIT_HELP, editCommand, FAMILIES_HELP, familiesCommand, SETTINGS_HELP, settingsCommand, UNDO_HELP, undoCommand, VIEWS_HELP } from "./change.ts";
import { IMPORTS_HELP, importsCommand, ISSUES_HELP, issuesCommand } from "./issues.ts";
import { FLIGHT_HELP, FLIGHTS_HELP, flightCommand, flightsCommand, SESSIONS_HELP, sessionsCommand, SIGHTINGS_HELP, sightingsCommand } from "./records.ts";
import { privatePath, shownPath, userPath } from "./paths.ts";
import { AGENT_NAME, chooseAgent, installedVersion, saveAgent, savedAgent, savedRules, savedSendNotes, saveRules, saveSendNotes } from "./settings.ts";
import { bold, dim, red } from "./term.ts";
import { lookupAirframes, lookupAsChanges, type LookupReport } from "./airframes.ts";
import { changeOptions, parse as parseChange, writeChanges } from "./change.ts";
import { fail as failRead, openOrFail } from "./read.ts";
import { PROVIDER_IDS, providers as allProviders } from "./providers/index.ts";

const DEFAULT_CHROME_PORT = 9222;
const DEFAULT_FR24_DELAY_S = 10;
const DEFAULT_CACHE = privatePath("cache/airframes");
const CACHE_DAYS = 90;

const PRIVATE = new Set(PRIVATE_FIELDS.map((f) => f.split(".")[1]!));

const MENU = `${bold("Touchdown")}: tools for your aircraft log, run in the Touchdown folder:
  ./touchdown <command> [options]          (or: npm run touchdown -- <command> [options])

${bold("Log what you saw")}
  spot        Type the aircraft you saw, one per line. Each registration is looked up, empty fields are
              filled, an agent checks them and you are asked for what is missing. Saves a file for the
              Import page.
  add         Check flights and sightings given as JSON, by you or an agent, against your log, and put
              them in the inbox for review in the web app.
  inbox       List what waits in the inbox for review; show or remove a file; send files saved here.
  review      Review a file waiting in the inbox here in the terminal, and import it into your log.

${bold("Read your log")} (as the web app shows it; --json for agents and scripts)
  flights     Your flights, with the Flights page's filters.          flight REF   one flight
  sightings   The aircraft you photographed.                          sessions     your days out
  aircraft    The aircraft in your log, or one with its timeline.     airport CODE one airport
  stats       Home's sentence and the Statistics page; --by for a table as in its Custom view.
  issues      Open findings with their ids and fixes; --accepted for the ones marked right.
  imports     The imports into your log, for undoing one.

${bold("Change your log")} (checked, then put in the inbox: nothing changes until you review and import it, on the
Import page or with ./touchdown review)
  edit        Change a flight or a sighting: --set FIELD=VALUE, --clear FIELD.
  delete      Delete flights or sightings.
  aircraft    edit REF --set msn=… for an aircraft's facts; merge INTO FROM for two entries of one aircraft.
  airframes   Look up serial numbers and first flights for your aircraft (OpenSky; Flightradar24 with --fr24).
  issues      accept ID, reopen ID, or fix ID [N] with a suggested fix.
  undo        Undo an import (ids from ./touchdown imports).
  families    Count a type in another family in the statistics.
  settings    The codes, distance unit and model names your log shows.
  stats       views save NAME --by DIM, or views remove NAME: the Statistics page's saved views.
  import      A spreadsheet or your Flightradar24 export, checked against your log; --out builds a backup instead.

${bold("Files")}
  backup      Download a backup of your log, as the web app's Settings does.
  export      A table of your log (flights, sightings, aircraft) as CSV.
  check       Have Claude Code or Codex check a spreadsheet, or a check request saved from the Import page.

${bold("Settings")}
  agent       Show or choose the agent that checks your records: claude, codex or none.
  login       Sign the command line in to your Touchdown site, as a browser is signed in.
  logout      Sign the command line out.
  storage     Show or choose where your log is: Google Drive or a folder, as the web app syncs it.

  help        This list. "./touchdown help <command>" (or "<command> --help") shows a command's options.

Your files stay in data/private/, which is never committed. Setting up and using the web app: README.md.`;

const LOOKUP_HELP = `Lookup options: [--sources ID,ID] [--all] [--only REG,REG] [--limit N]
                [--refresh] [--offline] [--overwrite-imported] [--cache DIR]
                [--fr24] [--chrome-port N] [--fr24-delay SECONDS]

Looks up the serial number and first flight date of every aircraft that lacks one (--all: every aircraft),
checks each answer against your records and stores what fits. Sources: the OpenSky aircraft database
(downloaded once), and with --fr24 Flightradar24 aircraft pages, read through your own Chrome started with
--remote-debugging-port (default ${DEFAULT_CHROME_PORT}) and signed in, one page at a time, --fr24-delay seconds apart
(default ${DEFAULT_FR24_DELAY_S}). FR24 answers are cached in --cache (default data/private/cache/airframes) for ${CACHE_DAYS} days;
--refresh asks again, --offline uses the cache only. A value you typed in the app is never replaced; one
from an imported sheet is replaced only with --overwrite-imported. --sources picks from: ${PROVIDER_IDS.join(", ")}.`;

const IMPORT_HELP = `Usage: ./touchdown import FILE… [--map "Header=field"] [--dry-run] [--json] [--keep-errors] [--log FILE]
       ./touchdown import FILE… --out FILE.zip|DIR [--today YYYY-MM-DD] [--all-findings] [--apply-fixes]
                              [--tracks DIR] [--tracks-adsblol DIR] [--airframes] [lookup options]

Reads CSV or xlsx files: the my.flightradar24.com export, or any spreadsheet of flights or sightings. Its columns
are worked out from the headers and values; a layout you confirmed before is used again, --map "Header=field" (or
"3=field" for the third column) sets one, and at a terminal you are asked about unclear columns and to confirm a
new layout, which is then remembered on this computer.

Each file is checked as the Import page checks it, against your log as it is now (from the storage chosen with
./touchdown storage, else data/private/touchdown-backup.zip, or --log FILE): which rows are new, fill in a
record of your log or differ from one, the row checks, and the findings the rows would bring. It then goes to
the inbox as one file, for review on the Import page or with ./touchdown review, which read it as they read the
file itself. A file with an error is not written, unless --keep-errors; one whose rows are all in your log or
waiting in the inbox already is left out. Ticket numbers and booking references in a file are never printed.

  --map "H=FIELD"   set a column; may be given more than once
  --dry-run         check only, write nothing
  --json            print the report as JSON, for agents and scripts (no questions are asked)
  --keep-errors     write a file with errors as well; the review shows them again
  --log FILE        check against this backup instead of the storage

Exit status: 0 written, or nothing new; 1 errors found, a file not written; 2 a file, the log or the storage
could not be read.

With --out, it builds a backup from the files alone instead, imported in the order given, and prints findings
and summary statistics: --out FILE.zip writes a backup the web app can restore (Settings, Restore), --out DIR
JSON tables. --apply-fixes accepts every single suggested fix for errors and model/type mismatches. --tracks
reads Flightradar24 track CSVs (adsb.lol traces in the same layout with --tracks-adsblol) and keeps the best one
per flight. --airframes also looks up airframe facts, as the airframes command does. Restoring such a backup
replaces the log in the browser.

${LOOKUP_HELP}`;

const AIRFRAMES_HELP = `Usage: ./touchdown airframes [lookup options] [--dry-run] [--json] [--keep-errors] [--log FILE]
       ./touchdown airframes <backup.zip> [--out FILE.zip] [lookup options]

Looks up serial numbers and first flight dates for the aircraft in your log (from the storage chosen with
./touchdown storage, else data/private/touchdown-backup.zip, or --log FILE). Your log is not changed: what the
sources give goes to the inbox as one file of changes, for review on the Import page or with ./touchdown review,
where each answer is checked against your records again. With a backup file instead, it fills the backup and
writes it to --out.

${changeOptions(15)}

${LOOKUP_HELP}`;

const AGENT_HELP = `Usage: ./touchdown agent [claude | codex | none | --json]
       ./touchdown agent notes on | off
       ./touchdown agent rules [add "SENTENCE" | remove N]

Shows the agent that checks your records in \`spot\` and \`check\` (also for the website's Import page), and
lets you choose another. Claude Code and Codex run on this computer with your own subscription, locked down.

  claude, codex, none   the agent to use; --agent on a command overrides it for one run
  --json                print the agent, its version, whether notes are sent and the rules as JSON
  notes on | off        send records' notes to the agent (off at first); --notes turns it on for one run
  rules                 list your rules: plain sentences added to the agent's instructions
  rules add "SENTENCE"  add one, for example how you want types or liveries written
  rules remove N        remove rule N

These settings belong to this computer and are kept in data/private/touchdown-cli.json.`;

const HELP: Record<string, string> = {
  spot: SPOT_HELP,
  check: CHECK_HELP,
  import: IMPORT_HELP,
  airframes: AIRFRAMES_HELP,
  agent: AGENT_HELP,
  storage: STORAGE_HELP,
  add: ADD_HELP,
  inbox: INBOX_HELP,
  login: LOGIN_HELP,
  logout: LOGIN_HELP,
  flights: FLIGHTS_HELP,
  flight: FLIGHT_HELP,
  sightings: SIGHTINGS_HELP,
  sessions: SESSIONS_HELP,
  aircraft: AIRCRAFT_HELP,
  airport: AIRPORT_HELP,
  stats: STATS_HELP,
  issues: ISSUES_HELP,
  imports: IMPORTS_HELP,
  edit: EDIT_HELP,
  delete: DELETE_HELP,
  undo: UNDO_HELP,
  families: FAMILIES_HELP,
  settings: SETTINGS_HELP,
  review: REVIEW_HELP,
  backup: BACKUP_HELP,
  views: VIEWS_HELP,
  export: EXPORT_HELP,
};

function usage(text = MENU, code = 1): never {
  console.log(text);
  process.exit(code);
}

/** \`touchdown agent …\`: show or change the agent, whether notes are sent to it, and the user's rules. */
async function agentCommand(args: string[]) {
  const name = args[0];
  if (name === "--help" || name === "-h") usage(AGENT_HELP, 0);
  if (name === "--json") {
    if (args.length > 1) usage(AGENT_HELP);
    const saved = savedAgent();
    const own = savedRules();
    console.log(JSON.stringify({ ok: true, agent: saved ?? null, version: saved && saved !== "none" ? (installedVersion(saved) ?? null) : null, sendNotes: savedSendNotes(), rules: own.length ? own : DEFAULT_AGENT_RULES, ownRules: own.length > 0 }, null, 2));
    return;
  }
  if (name === "notes") {
    if (args[1] !== "on" && args[1] !== "off") usage(AGENT_HELP);
    saveSendNotes(args[1] === "on");
    console.log(args[1] === "on" ? "Notes are sent to the agent from now on." : "Notes are not sent to the agent.");
    return;
  }
  if (name === "rules") return rulesCommand(args.slice(1));
  if (name) {
    if (name !== "claude" && name !== "codex" && name !== "none") usage(AGENT_HELP);
    if (name !== "none" && !installedVersion(name)) console.log(dim(`${AGENT_NAME[name]} is not installed yet; install it and sign in before the next check.`));
    saveAgent(name);
    console.log(`Saved: ${AGENT_NAME[name]}.`);
    return;
  }
  const saved = savedAgent();
  console.log(saved ? `The agent is ${AGENT_NAME[saved]}${saved !== "none" ? ` (${installedVersion(saved) ? `version ${installedVersion(saved)}` : "not installed"})` : ""}.` : "No agent chosen yet.");
  console.log(savedSendNotes() ? "Notes are sent to it." : "Notes are not sent to it.");
  printRules();
  if (process.stdin.isTTY) await chooseAgent();
  else console.log(dim("Choose with ./touchdown agent claude, codex or none."));
}

function printRules() {
  const own = savedRules();
  if (!own.length) {
    console.log(`Rules: none of your own, so this one applies:\n  ${dim(DEFAULT_AGENT_RULES.join("\n  "))}`);
    return;
  }
  console.log("Your rules:");
  own.forEach((r, i) => console.log(`  ${i + 1}  ${r}`));
}

function rulesCommand(args: string[]) {
  const own = savedRules();
  if (args[0] === "add") {
    const text = args.slice(1).join(" ").trim();
    if (!text) usage(AGENT_HELP);
    if (text.length > 500) {
      console.error(red("Keep a rule under 500 characters."));
      process.exit(1);
    }
    saveRules([...own, text]);
    console.log(`Added rule ${own.length + 1}.`);
    return;
  }
  if (args[0] === "remove") {
    const n = Number(args[1]);
    if (!Number.isInteger(n) || n < 1 || n > own.length) {
      console.error(red(own.length ? `Give a rule number from 1 to ${own.length}.` : "There are no rules of your own to remove."));
      process.exit(1);
    }
    saveRules(own.filter((_, i) => i !== n - 1));
    console.log(`Removed rule ${n}.`);
    return;
  }
  if (args.length) usage(AGENT_HELP);
  printRules();
}

const fmt = new Intl.NumberFormat("en-GB");
const hm = (min: number) => `${Math.floor(min / 60)}h ${String(Math.round(min % 60)).padStart(2, "0")}m`;

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
    console.log(`\n== Airframe lookup: no sources (known: ${PROVIDER_IDS.join(", ")})`);
    return;
  }
  console.log(`\n== Airframe lookup`);
  const report = await lookupAirframes(store, ref, { providers, all: args.all, only: args.only, limit: args.limit, overwriteImported: args.overwriteImported, log: (l) => console.log(l) });
  for (const line of lookupSummary(report)) console.log(`  ${line}`);
}

function lookupSummary(r: LookupReport): string[] {
  return [
    `${r.looked} aircraft looked up, ${r.filled} with facts stored, ${r.merged} merged with another entry, ${r.rejected.length} answers not used, ${r.notFound.length} not found.`,
    ...(r.differs.length ? [`${r.differs.length} values differ from yours (yours kept; --overwrite-imported replaces those from a sheet).`] : []),
    ...[...r.blocked].map(([source, why]) => `${source}: stopped: ${why}.`),
  ];
}

/** `touchdown airframes` without a backup: the answers for the log's aircraft go to the inbox as changes. */
async function airframesIntoLog(args: string[], lookup: LookupArgs) {
  const c = parseChange(args, AIRFRAMES_HELP);
  if (c.positional.length) usage(AIRFRAMES_HELP);
  const log = await openOrFail(c.json, c.log);
  const say = (line: string) => {
    if (!c.json) console.log(line);
  };
  const providers = providersFor(log.ref, lookup, say);
  if (!providers.length) return failRead(c.json, `No sources: --sources picks from ${PROVIDER_IDS.join(", ")}.`);
  const { report, changes } = await lookupAsChanges(log.store, log.ref, { providers, all: lookup.all, only: lookup.only, limit: lookup.limit, overwriteImported: lookup.overwriteImported, log: say });
  say("");
  return writeChanges(log, "airframes", changes, c, lookupSummary(report));
}

async function main(argv: string[]) {
  const [cmd, ...all] = argv;
  if (!cmd || cmd === "help" || cmd === "--help" || cmd === "-h") {
    const topic = all[0];
    if (topic && !HELP[topic]) console.log(`There is no command "${topic}".\n`);
    usage(topic && HELP[topic] ? HELP[topic] : MENU, topic && !HELP[topic] ? 1 : 0);
  }
  if (!HELP[cmd]) {
    console.log(`There is no command "${cmd}".\n`);
    usage();
  }
  if (cmd === "check") return checkCommand(all);
  if (cmd === "spot") return spotCommand(all);
  if (cmd === "agent") return agentCommand(all);
  if (cmd === "login") return loginCommand(all, (l) => console.log(dim(l)));
  if (cmd === "logout") return logoutCommand();
  if (cmd === "storage") return storageCommand(all, new RefIndex(loadRefTables()));
  if (cmd === "add") return addCommand(all, new RefIndex(loadRefTables()));
  if (cmd === "inbox") return inboxCommand(all, new RefIndex(loadRefTables()));
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
  if (cmd === "undo") return undoCommand(all);
  if (cmd === "families") return familiesCommand(all);
  if (cmd === "settings") return settingsCommand(all);
  if (cmd === "review") return reviewCommand(all);
  if (cmd === "backup") return backupCommand(all);
  if (cmd === "export") return exportCommand(all);
  if (all.includes("--help") || all.includes("-h")) usage(HELP[cmd], 0);
  // Without --out, import puts the files in the inbox for review (docs/34); with it, it builds a backup.
  if (cmd === "import" && !all.includes("--out")) return importCommand(all, new RefIndex(loadRefTables()), IMPORT_HELP);
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
  if (!files.length) usage(IMPORT_HELP);

  const ref = new RefIndex(loadRefTables());
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
    console.log(`\n== ${basename(file)} (${parsed.format}): ${parsed.rowsRead} rows: ${kinds.new} new, ${kinds.update} fill gaps, ${kinds.identical} identical, ${kinds.conflict} with conflicts${kinds.duplicate ? `, ${kinds.duplicate} repeats merged into an earlier row (same aircraft, place and day)` : ""}`);
    const corrected = matches.filter((m) => m.corrections.length);
    if (corrected.length) {
      console.log(`  Corrections taken from the file:`);
      for (const m of corrected) {
        const v = m.candidate.values as Record<string, unknown>;
        console.log(`   row ${m.candidate.sourceRow} ${v.flightNumber ?? ""} ${v.scheduledDate ?? ""}: ${m.corrections.map((x) => `${x.field} ${String(x.existing)} → ${String(x.incoming)}`).join("; ")}. ${m.corrections[0]!.reason}`);
      }
    }

    const rowIssues = parsed.candidates.flatMap((c) => c.issues.map((i) => ({ c, i })));
    if (rowIssues.length) {
      console.log(`  Row checks (${rowIssues.length}):`);
      for (const { c, i } of rowIssues) console.log(`   row ${c.sourceRow} [${i.ruleId}] ${i.message}`);
    }
    const conflicts = matches.filter((m) => m.kind === "conflict");
    if (conflicts.length) {
      console.log(`  Conflicts with records already imported (existing value kept):`);
      for (const m of conflicts) {
        const v = m.candidate.values as Record<string, unknown>;
        const label = m.candidate.table === "flights" ? `${v.flightNumber ?? "?"} ${v.scheduledDate ?? ""}` : `${v.registration ?? "?"} ${v.seenOn ?? ""}`;
        const diffs = m.conflicts.map((d) => (PRIVATE.has(d.field) ? `${d.field}: (private values differ)` : `${d.field}: ${String(d.existing)} → ${String(d.incoming)}`));
        console.log(`   row ${m.candidate.sourceRow} ${label}: ${diffs.join("; ")}`);
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
    console.log(`\n== Applying ${fixable.length} suggested fixes (--apply-fixes)`);
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
  if (files.length !== 1 || !files[0]!.endsWith(".zip")) usage(AIRFRAMES_HELP);
  const ref = new RefIndex(loadRefTables());
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
    console.log(`\nWrote a Touchdown backup to ${shownPath(out)}. Restore it in the web app under Settings, Data.`);
  } else if (out) {
    mkdirSync(out, { recursive: true });
    const n = writeJsonTables(store, out);
    console.log(`\nWrote ${n} table files to ${join(out, "tables")} and ${join(out, "manifest.json")}.`);
  }
}

const ATTRIBUTION = { fr24_csv: "Track data: Flightradar24, downloaded by the user", adsblol: "Track data: adsb.lol (ODbL)" } as const;

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
      const m = matchTrack(points, flights, ref, basename(path));
      if (!m || points.length < 2) {
        unmatched++;
        continue;
      }
      const cur = best.get(m.flight.id);
      if (!cur || betterTrack({ coverage: m.coverage, points: points.length }, { coverage: cur.coverage, points: cur.points.length })) {
        best.set(m.flight.id, { points, coverage: m.coverage, provider: d.provider, file: basename(path) });
      }
    }
  }
  for (const [flightId, t] of best) attachTrack(store, flightId, t.points, { provider: t.provider, attribution: ATTRIBUTION[t.provider], coverage: t.coverage });
  const partial = [...best.values()].filter((t) => t.coverage === "partial").length;
  console.log(`\n== Tracks: ${files} files, ${best.size} flights with a recorded track (${partial} partial), ${unmatched} files matched no flight`);
}

function printFindings(findings: Finding[], all: boolean) {
  const byRule = new Map<string, Finding[]>();
  for (const f of findings) byRule.set(f.ruleId, [...(byRule.get(f.ruleId) ?? []), f]);
  const rules = [...byRule].sort(
    (a, b) => SEVERITY_ORDER[a[1][0]!.severity] - SEVERITY_ORDER[b[1][0]!.severity] || a[0].localeCompare(b[0]),
  );
  const count = (s: string) => findings.filter((f) => f.severity === s).length;
  console.log(`\n== Findings: ${count("error")} errors, ${count("warning")} warnings, ${count("info")} notes`);
  for (const [rule, list] of rules) {
    console.log(`  ${rule} ${RULES[rule]?.title ?? ""} (${list[0]!.severity}, ${list.length})`);
    const shown = all ? list : list.slice(0, 6);
    for (const f of shown) console.log(`    - ${f.message}`);
    if (shown.length < list.length) console.log(`    … ${list.length - shown.length} more (--all-findings)`);
  }
}

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
  const line = (t: Tally, label: (k: string) => string = (k) => k, n = 20) =>
    t.items.slice(0, n).map((x) => `${label(x.key)} ${x.count}`).join(", ") + (t.items.length > n ? `, … (${t.items.length} groups)` : "") + (t.leftOut ? `  [${t.leftOut} left out]` : "");

  if (flights.length) {
    const s = flightStats(flights, ctx);
    console.log(`\n== Flights summary`);
    console.log(`  Flights: ${s.flights}`);
    console.log(`  Distance: ${fmt.format(Math.round(s.distanceKm.value))} km (great circle)${s.distanceKm.leftOut ? ` [${s.distanceKm.leftOut} left out]` : ""}`);
    console.log(`  Time (takeoff to landing): ${hm(s.minutes.value)}${s.minutes.leftOut ? ` [${s.minutes.leftOut} left out]` : ""}`);
    console.log(`  Airports ${s.airports.value}, countries ${s.countries.value}, airlines ${s.airlines.value}, routes ${s.routes.value}, types ${s.types.value}`);
    console.log(`  Aircraft: ${s.aircraft.value} airframes (${s.aircraft.provisional} provisional)${s.aircraft.leftOut ? ` [${s.aircraft.leftOut} left out]` : ""}`);
    console.log(`  Most flown: airline ${s.byAirline.top.map(opCode).join(" / ")}, route ${s.byRoute.top.join(" / ")}, manufacturer ${s.byManufacturer.top.join(" / ")}, family ${s.byFamily.top.join(" / ")}, type ${s.byType.top.join(" / ")}`);
    console.log(`  By airline: ${line(s.byAirline, opCode)}`);
    console.log(`  By manufacturer: ${line(s.byManufacturer)}`);
    console.log(`  By family: ${line(s.byFamily)}`);
    console.log(`  By type: ${line(s.byType, undefined, 30)}`);
    console.log(`  By route: ${line(s.byRoute, undefined, 6)}`);
    console.log(`  Top airports (visits): ${line(s.airportVisits, apCode, 8)}`);
    const longest = s.longestByDistance && store.get("flights", s.longestByDistance.id);
    if (longest) console.log(`  Longest flight: ${apCode(longest.fromAirportId!)}–${apCode(longest.toAirportId!)} ${fmt.format(Math.round(s.longestByDistance!.value))} km`);
    console.log(`  Per year: ${s.perYear.map((y) => `${y.year}: ${y.flights} flights, ${fmt.format(Math.round(y.distanceKm))} km`).join("; ")}`);
  }
  if (sightings.length) {
    const s = sightingStats(sightings, ctx);
    console.log(`\n== Sightings summary`);
    console.log(`  Sightings: ${s.sightings}`);
    console.log(`  Aircraft: ${s.aircraft.value} airframes (${s.aircraft.provisional} provisional)${s.aircraft.leftOut ? ` [${s.aircraft.leftOut} left out]` : ""}`);
    console.log(`  Airlines ${s.airlines.value}, families ${s.families.value}, type codes ${s.typeCodes.value}, special-livery aircraft ${s.specialLiveryAircraft.value}, special liveries ${s.specialLiveries.value}`);
    console.log(`  Most frequent: airline ${s.byAirline.top.map(opIcao).join(" / ")}, family ${s.byFamily.top.join(" / ")}, type ${s.byType.top.join(" / ")}`);
    console.log(`  By airline (aircraft): ${line(s.byAirline, opIcao, 14)}`);
    console.log(`  By family (aircraft): ${line(s.byFamily, undefined, 16)}`);
    console.log(`  By type (aircraft): ${line(s.byType, undefined, 16)}`);
    console.log(`  By location (sightings): ${line(s.sightingsByLocation, apIcao, 14)}`);
    console.log(`  By phase (sightings): ${line(s.byPhase)}`);
    console.log(`  Registration countries: ${s.byRegistrationCountry.items.length}; ${line(s.byRegistrationCountry, undefined, 4)}`);
    const big = [...s.newPerDay].sort((a, b) => b.count - a.count)[0];
    if (big) console.log(`  Most new aircraft in one day: ${big.count}`);
    const perDay = new Map<string, number>();
    for (const x of sightings) if (x.seenOn) perDay.set(x.seenOn, (perDay.get(x.seenOn) ?? 0) + 1);
    const busiest = Math.max(0, ...perDay.values());
    if (busiest) console.log(`  Most sightings in one day: ${busiest}`);
  }
  if (flights.length && sightings.length) {
    const c = combinedStats(flights, sightings, ctx);
    console.log(`\n== Combined`);
    console.log(`  Aircraft both flown on and photographed: ${c.flownAndPhotographed.length}`);
  }
}

main(process.argv.slice(2)).catch((e: Error) => {
  console.error(e.message);
  process.exit(1);
});
