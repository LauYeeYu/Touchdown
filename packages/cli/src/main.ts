#!/usr/bin/env -S npx tsx
// Touchdown companion CLI. Phase 1: `touchdown import <files…>` imports files in the order given, merges
// them, resolves airframes, runs the checks and prints findings and summary statistics. Nothing is written
// unless --out is given. Private fields (ticket number, booking reference) are never printed.

import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, extname, join } from "node:path";
import {
  attachTrack,
  backupZip,
  betterTrack,
  checkAll,
  matchTrack,
  parseTrackCsv,
  type TrackPointInput,
  combinedStats,
  commitImport,
  flightStats,
  matchCandidates,
  parseSource,
  PRIVATE_FIELDS,
  readCsv,
  readXlsx,
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
  type SheetData,
  type Tally,
} from "@touchdown/core";
import { loadRefTables } from "@touchdown/refdata";
import { writeJsonTables } from "./jsontables.ts";
import { lookupAirframes, type LookupReport } from "./airframes.ts";
import { PROVIDER_IDS, providers as allProviders } from "./providers/index.ts";

const DEFAULT_CHROME_PORT = 9222;
const DEFAULT_FR24_DELAY_S = 10;
const DEFAULT_CACHE = "data/private/cache/airframes";
const CACHE_DAYS = 90;

const PRIVATE = new Set(PRIVATE_FIELDS.map((f) => f.split(".")[1]!));

function usage(): never {
  console.log(`Usage: touchdown import <file…> [--today YYYY-MM-DD] [--out DIR|FILE.zip] [--all-findings] [--apply-fixes]
                        [--tracks DIR] [--tracks-adsblol DIR] [--airframes] [lookup options]
       touchdown airframes <backup.zip> [--out FILE.zip] [lookup options]

Lookup options: [--sources ID,ID] [--all] [--only REG,REG] [--limit N]
                [--refresh] [--offline] [--overwrite-imported] [--cache DIR]
                [--fr24] [--chrome-port N] [--fr24-delay SECONDS]

Imports CSV or xlsx files (myFR24 export, flight log sheet, spotting sheet) in the order given,
then prints findings and summary statistics. --apply-fixes accepts every single suggested fix for
errors and model/type mismatches before the statistics. --out DIR writes the result as JSON tables;
--out FILE.zip writes a backup the web app can restore. --tracks reads Flightradar24 track CSVs
(adsb.lol traces in the same layout with --tracks-adsblol) and keeps the best one per flight.

airframes (or import --airframes) looks up the serial number and first flight date of every aircraft
that lacks one (--all: every aircraft), checks each answer against your records and stores what fits.
Sources: the OpenSky aircraft database (downloaded once), and with --fr24 Flightradar24 aircraft
pages, read through your own Chrome started with --remote-debugging-port (default ${DEFAULT_CHROME_PORT})
and signed in, one page at a time, --fr24-delay seconds apart (default ${DEFAULT_FR24_DELAY_S}).
FR24 answers are cached in --cache (default ${DEFAULT_CACHE}) for ${CACHE_DAYS} days;
--refresh asks again, --offline uses the cache only. A value you typed in the app is never
replaced; one from an imported sheet is replaced only with --overwrite-imported.
--sources picks from: ${PROVIDER_IDS.join(", ")}.`);
  process.exit(1);
}

function readSheets(path: string): SheetData[] {
  const ext = extname(path).toLowerCase();
  if (ext === ".xlsx") return readXlsx(new Uint8Array(readFileSync(path)));
  return [readCsv(readFileSync(path, "utf8"), basename(path))];
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
    else if (a === "--cache") lookup.cache = args[++i]!;
    else if (a === "--fr24") lookup.fr24 = true;
    else if (a === "--chrome-port") lookup.chromePort = Number(args[++i]);
    else if (a === "--fr24-delay") lookup.fr24DelayS = Number(args[++i]);
    else rest.push(a);
  }
  return { lookup, rest };
}

async function runLookup(store: Store, ref: RefIndex, args: LookupArgs): Promise<void> {
  const fr24 = args.fr24 || args.sources?.includes("fr24") ? { port: args.chromePort, delayMs: Math.max(5, args.fr24DelayS) * 1000, cacheDir: args.cache, maxAgeDays: CACHE_DAYS, refresh: args.refresh, offline: args.offline } : null;
  const known = allProviders(ref, (l) => console.log(l), fr24);
  const providers = args.sources ? known.filter((p) => args.sources!.includes(p.id)) : known;
  if (!providers.length) {
    console.log(`\n== Airframe lookup: no sources (known: ${PROVIDER_IDS.join(", ")})`);
    return;
  }
  console.log(`\n== Airframe lookup`);
  const report = await lookupAirframes(store, ref, { providers, all: args.all, only: args.only, limit: args.limit, overwriteImported: args.overwriteImported, log: (l) => console.log(l) });
  printLookup(report);
}

function printLookup(r: LookupReport) {
  console.log(`  ${r.looked} aircraft looked up, ${r.filled} with facts stored, ${r.merged} merged with another entry, ${r.rejected.length} answers not used, ${r.notFound.length} not found.`);
  if (r.differs.length) console.log(`  ${r.differs.length} values differ from yours (yours kept; --overwrite-imported replaces those from a sheet).`);
  for (const [source, why] of r.blocked) console.log(`  ${source}: stopped: ${why}.`);
}

async function main(argv: string[]) {
  const [cmd, ...all] = argv;
  const { lookup, rest } = lookupArgs(all);
  if (cmd === "airframes") return airframesCommand(rest, lookup);
  if (cmd !== "import") usage();
  const files: string[] = [];
  let today: string | undefined;
  let out: string | undefined;
  let allFindings = false;
  let applyFixes = false;
  const trackDirs: { path: string; provider: "fr24_csv" | "adsblol" }[] = [];
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i]!;
    if (a === "--today") today = rest[++i];
    else if (a === "--out") out = rest[++i];
    else if (a === "--all-findings") allFindings = true;
    else if (a === "--apply-fixes") applyFixes = true;
    else if (a === "--tracks") trackDirs.push({ path: rest[++i]!, provider: "fr24_csv" });
    else if (a === "--tracks-adsblol") trackDirs.push({ path: rest[++i]!, provider: "adsblol" });
    else files.push(a);
  }
  if (!files.length) usage();

  const ref = new RefIndex(loadRefTables());
  const store = new Store({ deviceId: "cli" });

  for (const file of files) {
    const sheets = readSheets(file);
    let parsed: ParsedSource | null = null;
    for (const sheet of sheets) {
      parsed = parseSource(sheet, basename(file), ref);
      if (parsed) {
        if (sheets.length > 1) console.log(`(${basename(file)}: using sheet "${sheet.name}")`);
        break;
      }
    }
    if (!parsed) {
      console.log(`\n${basename(file)}: format not recognised (header: ${sheets[0]?.header.join(", ")})`);
      continue;
    }
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
  let out: string | undefined;
  const files: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--out") out = args[++i];
    else files.push(args[i]!);
  }
  if (files.length !== 1 || !files[0]!.endsWith(".zip")) usage();
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
    console.log(`\nWrote a Touchdown backup to ${out}. Restore it in the web app under Settings, Data.`);
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
  const ctx = { ref, airframes };
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
