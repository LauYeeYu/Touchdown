// `touchdown add` (docs/21, "Adding records from the command line"): flights and sightings given as JSON, by the user
// or by an agent working for them, checked as the Import page would check them against the log as it is now, then
// put in the inbox for review in the web app. Nothing reaches the log without that review. Ticket numbers and booking
// references are not taken: they are added in the web app (AGENTS.md, "Data and privacy").

import { readFileSync } from "node:fs";
import {
  checkAll,
  commitImport,
  INBOX_FLIGHT_FIELDS,
  INBOX_PRIVATE_FIELDS,
  INBOX_SCHEMA,
  INBOX_VERSION,
  isValidDate,
  matchCandidates,
  phaseOf,
  PHASES,
  readInbox,
  recordFields,
  resolveAirframes,
  Store,
  TABLES,
  todayIn,
  type Candidate,
  type Finding,
  type InboxFile,
  type InboxFlight,
  type InboxSighting,
  type MatchKind,
  type RefIndex,
  type SpotSource,
  type SpotValues,
  type TableName,
} from "@touchdown/core";
import { freeName, inboxPlace, loadLog, stamp, writeInboxFile, type InboxPlace } from "./log.ts";
import { userPath } from "./paths.ts";
import { chosenStorage } from "./storage.ts";
import { askHidden, bold, dim, green, plural, red, yellow } from "./term.ts";

export const ADD_HELP = `Usage: ./touchdown add [FILE.json | -] [--dry-run] [--json] [--keep-errors] [--log FILE]

Checks flights and sightings and puts them in the inbox, where the web app shows them for review and import.
They are JSON, from a file or from standard input ("-", or a pipe):

  {
    "flights":   [{ "date": "2026-10-18", "flightNumber": "XY123", "from": "EGLL", "to": "KJFK",
                    "takeoff": "11:40", "landing": "14:35", "seat": "31K" }],
    "sightings": [{ "date": "2026-10-20", "registration": "G-ABCD", "airport": "EGLL",
                    "airline": "BAW", "typeCode": "A21N", "phase": "landing" }]
  }

Flight fields:   ${INBOX_FLIGHT_FIELDS.join(", ")}
                 ticketNumber, bookingRef (private)
Sighting fields: date, registration, airport, airline, typeCode, model, phase, livery, specialLivery, notes

Dates are YYYY-MM-DD. Times (boarding, takeoff, landing) are local clock times, HH:MM, at the airport they
happen at; duration is H:MM. Airports and airlines are ICAO or IATA codes; an airline may be a company's
name. A record may say where values came from: "sources": { "typeCode": "claude" } (you, claude, codex,
opensky, adsbdb, fr24); values without one count as typed by you.

Ticket numbers and booking references are private: they go into the inbox file with the flight, and are never
printed, only reported as given. Give them in the JSON, or with --ticket and --booking type the first
flight's at a prompt that does not show them (a terminal and an input file are needed).

Each record is checked as the Import page checks it, against your log as it is now (from the storage chosen
with ./touchdown storage, else data/private/touchdown-backup.zip, or --log FILE): unknown codes, impossible
dates and times, records already in your log, overlapping flights and the other checks. If any record has an
error, nothing is written, unless --keep-errors. Records already in your log are left out. The inbox file is
then written, read back and read again as the web app will read it.

  --dry-run       check only, write nothing
  --json          print the report as JSON, for agents and scripts
  --keep-errors   write records with errors as well; the review shows the errors again
  --ticket        type the first flight's ticket number at a prompt that does not show it
  --booking       type the first flight's booking reference the same way
  --log FILE      check against this backup instead of the storage

Exit status: 0 written, or nothing new to write; 1 errors found, nothing written; 2 the input, the log or the
storage could not be read.`;

const SIGHTING_INPUT = ["date", "registration", "airport", "airline", "typeCode", "model", "phase", "livery", "specialLivery", "notes"] as const;
const FLIGHT_INPUT = [...INBOX_FLIGHT_FIELDS, ...INBOX_PRIVATE_FIELDS] as const;
const SOURCES = new Set<SpotSource>(["you", "claude", "codex", "opensky", "adsbdb", "fr24", "your_log", "derived"]);

interface ReadRecord {
  values: Record<string, string>;
  sources: Record<string, SpotSource>;
}

/** A value as text: strings trimmed, numbers written out; undefined for anything else. */
function textOf(v: unknown): string | null | undefined {
  if (v === null || v === undefined) return null;
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  if (typeof v === "string") return v.trim() || null;
  return undefined;
}

function readRecord(rec: unknown, where: string, allowed: readonly string[]): ReadRecord | { error: string } {
  if (!rec || typeof rec !== "object" || Array.isArray(rec)) return { error: `${where} is not an object.` };
  const out: ReadRecord = { values: {}, sources: {} };
  for (const [k, v] of Object.entries(rec)) {
    if (k === "sources") {
      if (!v || typeof v !== "object" || Array.isArray(v)) return { error: `${where}: "sources" must be an object of field: source.` };
      for (const [f, s] of Object.entries(v)) {
        if (!allowed.includes(f)) return { error: `${where}: "sources" names an unknown field "${f}".` };
        if (!SOURCES.has(s as SpotSource)) return { error: `${where}: the source of ${f} must be one of ${[...SOURCES].join(", ")}.` };
        out.sources[f] = s as SpotSource;
      }
    } else if (!allowed.includes(k)) {
      return { error: `${where}: unknown field "${k}". The fields are: ${allowed.join(", ")}.` };
    } else {
      const t = textOf(v);
      if (t === undefined) return { error: `${where}: ${k} must be text or a number.` };
      if (t && t.length > (k === "notes" ? 500 : 200)) return { error: `${where}: ${k} is too long.` };
      if (t) out.values[k] = t;
    }
  }
  for (const k of ["date", "firstFlight"]) if (out.values[k] && !isValidDate(out.values[k]!)) return { error: `${where}: ${k} ${out.values[k]} is not a date written YYYY-MM-DD.` };
  return out;
}

/** The input as an inbox file, or what is wrong with it. */
export function addFile(json: unknown, createdAt: string): { file: InboxFile } | { error: string } {
  if (!json || typeof json !== "object" || Array.isArray(json)) return { error: 'Give a JSON object with a "flights" list, a "sightings" list, or both.' };
  const o = json as Record<string, unknown>;
  const extra = Object.keys(o).filter((k) => k !== "flights" && k !== "sightings");
  if (extra.length) return { error: `Unexpected keys: ${extra.join(", ")}. Give "flights" and "sightings" lists.` };
  for (const k of ["flights", "sightings"]) if (o[k] !== undefined && !Array.isArray(o[k])) return { error: `"${k}" must be a list.` };
  const flights: InboxFlight[] = [];
  const sightings: InboxSighting[] = [];
  for (const [i, rec] of ((o.flights as unknown[]) ?? []).entries()) {
    const r = readRecord(rec, `flight ${i + 1}`, FLIGHT_INPUT);
    if ("error" in r) return r;
    if (!r.values.flightNumber && !(r.values.from && r.values.to) && !r.values.registration) return { error: `flight ${i + 1}: give a flight number, a route (from and to) or a registration.` };
    flights.push({ values: r.values, ...(Object.keys(r.sources).length ? { sources: r.sources } : {}), open: [] });
  }
  for (const [i, rec] of ((o.sightings as unknown[]) ?? []).entries()) {
    const r = readRecord(rec, `sighting ${i + 1}`, SIGHTING_INPUT);
    if ("error" in r) return r;
    if (!r.values.registration) return { error: `sighting ${i + 1}: give the registration.` };
    const { airline, phase, ...rest } = r.values;
    const values: SpotValues = { ...rest, ...(airline ? { operator: airline } : {}) };
    if (phase) {
      const named = phase.toLowerCase().replace(/[\s-]+/g, "_");
      const p = (PHASES as readonly string[]).includes(named) ? named : phaseOf(phase);
      if (!p) return { error: `sighting ${i + 1}: phase "${phase}" is not one of ${PHASES.join(", ")}.` };
      values.phase = p;
    }
    const sources = Object.fromEntries(Object.entries(r.sources).map(([f, s]) => [f === "airline" ? "operator" : f, s]));
    sightings.push({ values, sources, open: [], missing: [], aircraft: null });
  }
  if (!flights.length && !sightings.length) return { error: "There are no flights or sightings in the input." };
  return { file: { schema: INBOX_SCHEMA, version: INBOX_VERSION, createdAt, checker: null, sightings, flights } };
}

export interface Problem {
  severity: "error" | "warning" | "info";
  rule: string;
  message: string;
}

export interface RecordReport {
  kind: "flight" | "sighting";
  /** Its place in its list in the input, from 1. */
  n: number;
  label: string;
  /** "waiting": the same record is in the inbox already, waiting for review. */
  status: MatchKind | "waiting";
  /** The status in words: "new", "already in your log, left out", … */
  statusText: string;
  /** The values as Touchdown read them: codes resolved, times with their UTC offsets. */
  read: Record<string, string>;
  /** Private fields given (ticket number, booking reference); their values are never reported. */
  private: string[];
  problems: Problem[];
}

function copyStore(from: Store | null): Store {
  const to = new Store({ deviceId: "cli", validate: false });
  if (from) for (const t of Object.keys(TABLES) as TableName[]) to.load(t, from.all(t) as never);
  return to;
}

function labelOf(c: Candidate): string {
  if (c.table === "flights") {
    const v = c.values;
    const route = v.fromRaw || v.toRaw ? `${v.fromRaw ?? "?"}–${v.toRaw ?? "?"}` : null;
    return [v.flightNumber ?? v.registration ?? "flight", v.scheduledDate ? `on ${v.scheduledDate}` : null, route].filter(Boolean).join(" ");
  }
  const v = c.values;
  return [v.registration ?? v.registrationRaw, v.seenOn ? `on ${v.seenOn}` : null, v.airportRaw ? `at ${v.airportRaw}` : null].filter(Boolean).join(" ");
}

function readValues(c: Candidate, ref: RefIndex): Record<string, string> {
  const out: Record<string, string> = { ...(recordFields(c, ref) as Record<string, string>) };
  if (c.table === "flights") {
    const v = c.values;
    for (const [k, x] of [["boarding", v.boardingAt], ["takeoff", v.takeoffAt], ["landing", v.landingAt], ["seat", v.seat], ["cabinClass", v.cabinClass], ["bookingClass", v.bookingClass], ["gate", v.departureGate], ["notes", v.notes]] as const) if (x) out[k] = String(x);
    // An airline written by name is linked when the record is written; the index has it by then.
    const a = ref.operator(v.airlineId) ?? ref.operatorByCode(v.airlineRaw);
    if (a) out.airlineName = a.name;
  } else {
    if (c.values.notes) out.notes = c.values.notes;
    const a = ref.operator(c.values.operatorId) ?? ref.operatorByCode(c.values.operatorRaw);
    if (a) out.operatorName = a.name;
  }
  return out;
}

function statusText(kind: MatchKind, fills: string[], conflicts: { field: string; existing: unknown; incoming: unknown }[]): string {
  switch (kind) {
    case "new":
      return "new";
    case "identical":
      return "already in your log, left out";
    case "update":
      return `fills ${fills.join(", ")} in a record already in your log`;
    case "conflict":
      return `differs from a record in your log: ${conflicts.map((d) => `${d.field} ${String(d.existing)} → ${String(d.incoming)}`).join("; ")}`;
    case "duplicate":
      return "repeats an earlier sighting in this input (same aircraft, place and day); the import merges them";
  }
}

/** What the inbox holds already, as records, with the file each came from. */
export interface Waiting {
  store: Store;
  fileOf: Map<string, string>;
}

export async function waitingIn(place: InboxPlace, ref: RefIndex): Promise<Waiting> {
  const store = copyStore(null);
  const fileOf = new Map<string, string>();
  for (const name of await place.list()) {
    const data = await place.read(name);
    if (!data) continue;
    let r;
    try {
      r = readInbox(JSON.parse(new TextDecoder().decode(data)), name, ref);
    } catch {
      continue;
    }
    if ("error" in r) continue;
    fileOf.set(commitImport(store, ref, r.source, matchCandidates(store, r.source.candidates)).batchId, name);
  }
  return { store, fileOf };
}

/**
 * Check the records as the Import page would: the row checks, matching against the log, and every rule over the
 * log with the records added. Only findings the records bring are reported, not those the log has already. A
 * record the inbox holds already is "waiting".
 */
export function checkRecords(file: InboxFile, log: Store | null, ref: RefIndex, today: string, waiting?: Waiting): RecordReport[] | { error: string } {
  const r = readInbox(file, "add", ref);
  if ("error" in r) return r;
  const candidates = r.source.candidates;
  const base = copyStore(log);
  const matches = matchCandidates(base, candidates);
  const before = copyStore(log);
  const known = new Set(checkAll(before, ref, { today, overlaps: resolveAirframes(before, ref).overlaps }).map((f) => f.fingerprint));
  const after = copyStore(log);
  const res = commitImport(after, ref, r.source, matches);
  const findings = checkAll(after, ref, { today, overlaps: resolveAirframes(after, ref).overlaps }).filter((f) => !known.has(f.fingerprint));
  const sightingCount = file.sightings.length;
  return matches.map((m, i): RecordReport => {
    const c = m.candidate;
    const id =
      m.kind === "new" || m.kind === "duplicate"
        ? after.all(c.table as TableName).find((x) => (x as { sourceBatchId?: string }).sourceBatchId === res.batchId && (x as { sourceRow?: number }).sourceRow === c.sourceRow)?.id
        : (m.existingId ?? undefined);
    const own: Finding[] = id ? findings.filter((f) => f.records.some((x) => x.table === c.table && x.id === id)) : [];
    const pending = waiting && m.kind !== "identical" ? matchCandidates(waiting.store, [c])[0] : undefined;
    const inFile = pending?.kind === "identical" && pending.existingId ? waiting!.fileOf.get(String((waiting!.store.get(c.table as TableName, pending.existingId) as { sourceBatchId?: string } | null)?.sourceBatchId)) : undefined;
    return {
      kind: c.table === "flights" ? "flight" : "sighting",
      n: c.table === "flights" ? c.sourceRow - sightingCount : c.sourceRow,
      label: labelOf(c),
      status: inFile ? "waiting" : m.kind,
      statusText: inFile ? `already waiting in the inbox (${inFile}), left out` : statusText(m.kind, m.fills, m.conflicts),
      read: readValues(c, ref),
      private: c.table === "flights" ? INBOX_PRIVATE_FIELDS.filter((f) => !!(c.values as Record<string, unknown>)[f]) : [],
      problems: [...c.issues.map((x) => ({ severity: x.severity, rule: x.ruleId, message: x.message })), ...own.map((f) => ({ severity: f.severity, rule: f.ruleId, message: f.message }))],
    };
  });
}

interface Options {
  input?: string;
  dryRun: boolean;
  json: boolean;
  keepErrors: boolean;
  ticket: boolean;
  booking: boolean;
  log?: string;
}

function options(args: string[]): Options | null {
  const o: Options = { dryRun: false, json: false, keepErrors: false, ticket: false, booking: false };
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a === "--dry-run") o.dryRun = true;
    else if (a === "--json") o.json = true;
    else if (a === "--keep-errors") o.keepErrors = true;
    else if (a === "--ticket") o.ticket = true;
    else if (a === "--booking") o.booking = true;
    else if (a === "--log" && args[i + 1]) o.log = userPath(args[++i]!);
    else if (!a.startsWith("--") && !o.input) o.input = a;
    else return null;
  }
  return o;
}

async function readInput(input: string | undefined): Promise<string> {
  if (input && input !== "-") return readFileSync(userPath(input), "utf8");
  const chunks: Buffer[] = [];
  for await (const c of process.stdin) chunks.push(c as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

/** `./touchdown add …` */
export async function addCommand(args: string[], ref: RefIndex): Promise<void> {
  const o = options(args);
  if (!o || args.includes("--help") || args.includes("-h") || (!o.input && process.stdin.isTTY)) {
    console.log(ADD_HELP);
    process.exit(args.includes("--help") || args.includes("-h") ? 0 : 2);
  }
  const fail = (message: string): never => {
    if (o.json) console.log(JSON.stringify({ ok: false, error: message }, null, 2));
    else console.error(red(message));
    process.exit(2);
  };

  let json: unknown;
  try {
    json = JSON.parse(await readInput(o.input));
  } catch (e) {
    fail(`The input is not JSON: ${(e as Error).message}`);
  }
  const made = addFile(json, new Date().toISOString().replace(/\.\d{3}Z$/, "Z"));
  if ("error" in made) return fail(made.error);
  if (o.ticket || o.booking) {
    const first = made.file.flights?.[0];
    if (!first) return fail("--ticket and --booking are for a flight, and the input has none.");
    try {
      if (o.ticket) first.values.ticketNumber = (await askHidden("Ticket number of the first flight (not shown): ")).replace(/\s+/g, "") || undefined;
      if (o.booking) first.values.bookingRef = (await askHidden("Booking reference of the first flight (not shown): ")) || undefined;
    } catch (e) {
      return fail((e as Error).message);
    }
  }

  let storage;
  let log;
  try {
    storage = o.log ? null : await chosenStorage();
    log = await loadLog(ref, { file: o.log, storage });
  } catch (e) {
    return fail((e as Error).message);
  }
  const place = inboxPlace(storage ?? null);
  let records;
  try {
    records = checkRecords(made.file, log.store, ref, todayIn(), await waitingIn(place, ref));
  } catch (e) {
    return fail((e as Error).message);
  }
  if ("error" in records) return fail(records.error);

  const keep = records.map((r) => r.status !== "identical" && r.status !== "waiting");
  const errors = records.filter((r, i) => keep[i] && r.problems.some((p) => p.severity === "error"));
  let written: { file: string; place: string; flights: number; sightings: number } | null = null;
  let reason: "dry-run" | "errors" | "nothing new" | null = null;
  if (o.dryRun) reason = "dry-run";
  else if (errors.length && !o.keepErrors) reason = "errors";
  else if (!keep.some(Boolean)) reason = "nothing new";
  else {
    const sightingCount = made.file.sightings.length;
    const file: InboxFile = {
      ...made.file,
      sightings: made.file.sightings.filter((_, i) => keep[i]),
      flights: (made.file.flights ?? []).filter((_, i) => keep[sightingCount + i]),
    };
    try {
      const name = await freeName(place, `add-${stamp()}`);
      await writeInboxFile(place, name, file, ref);
      written = { file: name, place: place.name, flights: file.flights!.length, sightings: file.sightings.length };
    } catch (e) {
      return fail((e as Error).message);
    }
  }

  if (o.json) {
    console.log(JSON.stringify({ ok: !errors.length, checkedAgainst: log.from, logProblems: log.problems, records, written, notWritten: reason, sharedInbox: place.shared }, null, 2));
  } else {
    printReport(records, log.from, log.problems);
    if (written) {
      const what = [written.flights ? plural(written.flights, "flight") : null, written.sightings ? plural(written.sightings, "sighting") : null].filter(Boolean).join(" and ");
      console.log(`\n${green("Written")} ${what} to ${written.place}: ${written.file}. Read back and checked.`);
      console.log(`${yellow("Not in your log yet:")} ${place.shared ? "run ./touchdown review, or open Touchdown on any device and use “Review and import” at the top." : "start the web app (npm run dev -w @touchdown/web) and use “Review and import” at the top."}`);
    } else if (reason === "errors") console.log(`\n${red("Nothing written:")} ${plural(errors.length, "record has", "records have")} errors. Fix them, or write them anyway with --keep-errors.`);
    else if (reason === "dry-run") console.log(dim("\nDry run: nothing written."));
    else if (reason === "nothing new") console.log("\nNothing written: everything is in your log or waiting in the inbox already.");
  }
  process.exit(reason === "errors" ? 1 : 0);
}

function printReport(records: RecordReport[], from: string, problems: string[]) {
  console.log(`Checked against ${from}.`);
  for (const p of problems) console.log(red(`  ${p}`));
  for (const r of records) {
    const errors = r.problems.filter((p) => p.severity === "error").length;
    const mark = errors ? red("✗") : r.status === "identical" || r.status === "waiting" ? dim("–") : green("✓");
    console.log(`${mark} ${bold(`${r.kind} ${r.n}`)}  ${r.label}  ${dim(r.statusText)}${r.private.length ? dim(` · ${r.private.map((f) => (f === "ticketNumber" ? "ticket number" : "booking reference")).join(" and ")} given`) : ""}`);
    for (const p of r.problems) console.log(`    ${p.severity === "error" ? red("error") : p.severity === "warning" ? yellow("warning") : dim("note")} ${dim(p.rule)} ${p.message}`);
  }
}
