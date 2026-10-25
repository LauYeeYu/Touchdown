// What the reading commands share (docs/34, "Reading"): their options, the log opened read-only with its own
// settings (codes, distance unit, model names), records named by REF, private fields reported only as recorded or
// not, and output as a table or as JSON.

import {
  flightDay,
  normaliseFlightNumber,
  operatorFromOverride,
  RefIndex,
  registrationMatchForm,
  settingsOf,
  todayIn,
  type Airport,
  type Flight,
  type Sighting,
  type Store,
} from "@touchdown/core";
import { yearsIn, type CodeStyle } from "@touchdown/core/view";
import { loadRefTables } from "@touchdown/refdata";
import { loadLog } from "./log.ts";
import { userPath } from "./paths.ts";
import { chosenStorage } from "./storage.ts";
import { bold, dim, fit, red, width } from "./term.ts";

/** Exit statuses of the reading commands. */
export const EXIT = { ok: 0, notFound: 1, problem: 2 } as const;

/** The options every reading command takes, lined up at `col` with the command's own. */
export const readOptions = (col: number) => `  ${"--log FILE".padEnd(col)}read a backup instead of the log in your storage
  ${"--json".padEnd(col)}print JSON, for agents and scripts`;

export interface Args {
  values: Map<string, string>;
  flags: Set<string>;
  positional: string[];
}

/** Split arguments into options with a value (`values`), flags and the rest. An unknown option is an error. */
export function parseArgs(args: string[], spec: { values?: string[]; flags?: string[] }): Args | { error: string } {
  const takes = new Set(["--log", ...(spec.values ?? [])]);
  const flags = new Set(["--json", ...(spec.flags ?? [])]);
  const out: Args = { values: new Map(), flags: new Set(), positional: [] };
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (takes.has(a)) {
      const v = args[++i];
      if (v === undefined || v.startsWith("--")) return { error: `${a} needs a value.` };
      out.values.set(a, v);
    } else if (flags.has(a)) out.flags.add(a);
    else if (a.startsWith("--")) return { error: `There is no option ${a}.` };
    else out.positional.push(a);
  }
  return out;
}

/** Print the failure (as JSON with --json) and stop. */
export function fail(json: boolean, message: string, code: number = EXIT.problem, extra: Record<string, unknown> = {}): never {
  if (json) console.log(JSON.stringify({ ok: false, error: message, ...extra }, null, 2));
  else console.error(red(message));
  process.exit(code);
}

export function printJson(value: unknown) {
  console.log(JSON.stringify(value, null, 2));
}

export interface OpenedLog {
  store: Store;
  ref: RefIndex;
  /** For messages: "your log in Google Drive (address)", "data/private/touchdown-backup.zip". */
  from: string;
  codes: CodeStyle;
  unit: "km" | "mi" | "nm";
  models: "standard" | "compact";
}

/**
 * The log, read-only: from --log, else the chosen storage, else the default backup. The user's own operators and
 * family choices apply, and the log's settings say how codes, distances and models are shown, as in the web app.
 */
export async function openLog(file?: string): Promise<OpenedLog> {
  const ref = new RefIndex(loadRefTables());
  const storage = file ? null : await chosenStorage();
  const log = await loadLog(ref, { file: file ? userPath(file) : undefined, storage });
  if (!log.store) throw new Error("There is no log to read. Choose your storage with ./touchdown storage, or give a backup with --log FILE.");
  const store = log.store;
  ref.setUserOverrides({
    operators: store.all("operator_overrides").map((o) => operatorFromOverride(o)),
    familyOverrides: store
      .all("family_overrides")
      .filter((o) => o.designator && o.familyId)
      .map((o) => ({ designator: o.designator!, familyId: o.familyId! })),
  });
  const s = settingsOf(store);
  return { store, ref, from: log.from, codes: s.codeDisplay ?? "iata", unit: s.distanceUnit ?? "km", models: s.modelNaming ?? "standard" };
}

/** The log, or the reason it cannot be read, and stop. */
export async function openOrFail(json: boolean, file?: string): Promise<OpenedLog> {
  try {
    return await openLog(file);
  } catch (e) {
    return fail(json, (e as Error).message);
  }
}

/** The arguments, or the command's help when they do not fit. */
export function argsOrHelp(args: string[], spec: { values?: string[]; flags?: string[] }, help: string, positional: [number, number] = [0, 0]): Args {
  const json = args.includes("--json");
  if (args.includes("--help") || args.includes("-h")) {
    console.log(help);
    process.exit(EXIT.ok);
  }
  const a = parseArgs(args, spec);
  const problem = "error" in a ? a.error : a.positional.length < positional[0] ? "An argument is missing." : a.positional.length > positional[1] ? `Too many arguments: ${a.positional.join(" ")}.` : null;
  if (problem) {
    if (json) return fail(json, problem);
    console.error(red(problem));
    console.log(`\n${help}`);
    process.exit(EXIT.problem);
  }
  return a as Args;
}

/** The period: `--year Y` or `all`; without it, `fallback` ("all", or "default": this year when it has records, else the latest year, as the web app opens). */
export function periodOf(store: Store, given: string | undefined, fallback: "all" | "default"): string | { error: string } {
  const years = yearsIn(store);
  if (given !== undefined) {
    if (given === "all" || /^\d{4}$/.test(given)) return given;
    return { error: `--year takes a year (2025) or "all".` };
  }
  if (fallback === "all") return "all";
  const thisYear = todayIn().slice(0, 4);
  return years.includes(thisYear) ? thisYear : (years[years.length - 1] ?? "all");
}

export const periodLabel = (year: string) => (year === "all" ? "all years" : year);

// ---------- records named by REF ----------

export type Found<T> = { row: T } | { error: string; candidates: { id: string; label: string }[] };

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function pick<T extends { id: string }>(rows: T[], what: string, label: (r: T) => string): Found<T> {
  if (rows.length === 1) return { row: rows[0]! };
  if (!rows.length) return { error: `No ${what}.`, candidates: [] };
  return { error: `${rows.length} records fit ${what}; name one by its id.`, candidates: rows.map((r) => ({ id: r.id, label: label(r) })) };
}

export const flightRefLabel = (f: Flight) => [f.flightNumber, flightDay(f) ?? f.scheduledDate].filter(Boolean).join(" on ") || f.id;
export function sightingRefLabel(s: Sighting, ref: RefIndex): string {
  const at = ref.airport(s.airportId)?.icao ?? s.airportRaw;
  return [s.registration ?? "Sighting", at && `at ${at}`, s.seenOn && `on ${s.seenOn}`].filter(Boolean).join(" ");
}

/** A flight by its id, or `XY123@2025-04-02` (flight number and day). */
export function findFlight(store: Store, text: string): Found<Flight> {
  const byId = store.get("flights", text);
  if (byId) return { row: byId };
  const [number, day] = text.split("@");
  if (!number || !day || !DATE_RE.test(day)) return { error: `"${text}" is not a flight's id or XY123@YYYY-MM-DD.`, candidates: [] };
  const n = normaliseFlightNumber(number);
  return pick(
    store.all("flights").filter((f) => f.flightNumber === n && (flightDay(f) === day || f.scheduledDate === day)),
    `flight ${n} on ${day}`,
    flightRefLabel,
  );
}

/** A sighting by its id, or `G-ABCD@EGLL@2025-03-15` (registration, airport, day), or `G-ABCD@2025-03-15`. */
export function findSighting(store: Store, ref: RefIndex, text: string): Found<Sighting> {
  const byId = store.get("sightings", text);
  if (byId) return { row: byId };
  const parts = text.split("@");
  const day = parts[parts.length - 1]!;
  if (parts.length < 2 || parts.length > 3 || !DATE_RE.test(day)) return { error: `"${text}" is not a sighting's id or REG@AIRPORT@YYYY-MM-DD.`, candidates: [] };
  const reg = registrationMatchForm(parts[0]!);
  const place = parts.length === 3 ? parts[1]! : null;
  const airport = place ? ref.airportByCode(place) : null;
  return pick(
    store.all("sightings").filter((s) => s.seenOn === day && registrationMatchForm(s.registration ?? s.registrationRaw ?? "") === reg && (!place || (airport ? s.airportId === airport.id : (s.airportRaw ?? "").toUpperCase() === place.toUpperCase()))),
    `a sighting of ${parts[0]} ${place ? `at ${place} ` : ""}on ${day}`,
    (s) => sightingRefLabel(s, ref),
  );
}

/** An airframe by its id, or a registration (`G-ABCD`), on a date when it was reused (`G-ABCD@2019-05-01`). */
export function findAircraft(store: Store, text: string): Found<{ id: string }> {
  const byId = store.get("airframes", text);
  if (byId) return { row: byId };
  const [regText, day] = text.split("@");
  if (!regText || (day !== undefined && !DATE_RE.test(day))) return { error: `"${text}" is not an aircraft's id, registration or REG@YYYY-MM-DD.`, candidates: [] };
  const reg = registrationMatchForm(regText);
  const ids = new Set<string>();
  for (const p of store.all("registration_periods")) {
    if (registrationMatchForm(p.registration ?? "") !== reg) continue;
    if (day && ((p.validFrom && day < p.validFrom) || (p.validTo && day > p.validTo))) continue;
    if (store.get("airframes", p.airframeId)) ids.add(p.airframeId);
  }
  // Records name the aircraft too, also where no registration period was stored.
  const dated: [string | null, string | null, string | null][] = [
    ...store.all("flights").map((f) => [f.registration, flightDay(f), f.airframeId] as [string | null, string | null, string | null]),
    ...store.all("sightings").map((s) => [s.registration, s.seenOn, s.airframeId] as [string | null, string | null, string | null]),
  ];
  for (const [r, d, id] of dated) if (id && r && registrationMatchForm(r) === reg && (!day || d === day) && store.get("airframes", id)) ids.add(id);
  const rows = [...ids].map((id) => store.get("airframes", id)!);
  return pick(rows, `aircraft ${regText}${day ? ` on ${day}` : ""}`, (a) => `${a.typeCode ?? "unknown type"}${a.msn ? `, serial ${a.msn}` : ""}`);
}

/** An airport by IATA or ICAO code, or its id. */
export function findAirport(ref: RefIndex, text: string): Airport | null {
  return ref.airportByCode(text) ?? ref.airport(text);
}

/** Print a REF that matched nothing or several records, and stop. */
export function notFound(json: boolean, f: Exclude<Found<unknown>, { row: unknown }>): never {
  if (!json && f.candidates.length) {
    console.error(red(f.error));
    for (const c of f.candidates) console.error(`  ${c.id}  ${c.label}`);
    process.exit(EXIT.notFound);
  }
  return fail(json, f.error, EXIT.notFound, f.candidates.length ? { candidates: f.candidates } : {});
}

// ---------- private fields ----------

/** Ticket numbers and booking references are never shown (docs/34, "Private fields"): only whether one is recorded. */
export function privateFields(f: Flight): { ticketNumber: boolean; bookingRef: boolean } {
  return { ticketNumber: !!f.ticketNumber, bookingRef: !!f.bookingRef };
}

// ---------- tables ----------

export interface Column {
  head: string;
  align?: "left" | "right";
  /** Takes what is left of the width, cut with an ellipsis; one column per table. */
  flex?: boolean;
}

/** A table that fits the terminal: fixed columns as wide as their widest cell, the flexible one takes the rest. */
export function table(columns: Column[], rows: string[][]): string[] {
  const gap = 2;
  const widths = columns.map((c, i) => Math.max(c.head.length, ...rows.map((r) => (r[i] ?? "").length)));
  // Cut to the terminal's width; piped into a file or another program, every cell is printed whole.
  const flex = process.stdout.isTTY ? columns.findIndex((c) => c.flex) : -1;
  if (flex >= 0) {
    const fixed = widths.reduce((n, w, i) => (i === flex ? n : n + w), 0) + gap * (columns.length - 1);
    widths[flex] = Math.max(columns[flex]!.head.length, Math.min(widths[flex]!, width() - fixed));
  }
  const cell = (s: string, i: number) => {
    s = plain(s);
    const w = widths[i]!;
    const t = s.length > w ? fit(s, w) : s;
    return columns[i]!.align === "right" ? t.padStart(w) : t.padEnd(w);
  };
  const line = (cells: string[]) => cells.map(cell).join(" ".repeat(gap)).trimEnd();
  return [bold(line(columns.map((c) => c.head))), ...rows.map(line)];
}

/** A heading line and the lines under it, indented. */
export function section(title: string, lines: string[]): string[] {
  return ["", bold(title), ...lines.map((l) => `  ${l}`)];
}

export const note = (s: string) => dim(s);

/** The shared labels keep words together with non-breaking spaces; a terminal gets plain ones. */
export const plain = (s: string) => s.replace(/\u00a0/g, " ");

/** Label: value lines, the labels padded to line up. Empty values are left out. */
export function fields(pairs: [string, string | null | undefined][]): string[] {
  const shown = pairs.filter((p): p is [string, string] => !!p[1]);
  const w = Math.max(0, ...shown.map(([k]) => k.length));
  return shown.map(([k, v]) => `${dim(k.padEnd(w))}  ${plain(v)}`);
}
