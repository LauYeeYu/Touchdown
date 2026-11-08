// What the reading commands share (docs/34, "Reading"): their options, the log opened read-only with its own
// settings (codes, distance unit, model names), records named by REF, private fields reported only as recorded or
// not, and output as a table or as JSON.

import {
  flightDay,
  normaliseFlightNumber,
  privateOf,
  reconcile,
  RefIndex,
  refOverridesOf,
  registrationMatchForm,
  settingsOf,
  todayIn,
  type Airport,
  type Flight,
  type Sighting,
  type Store,
} from "@touchdown/core";
import { yearsIn, type CodeStyle } from "@touchdown/core/view";
import { t } from "@touchdown/i18n/cli";
import { refTables } from "./reftables.ts";
import { loadLog } from "./log.ts";
import { userPath } from "./paths.ts";
import { chosenStorage, type OpenedStorage } from "./storage.ts";
import { bold, dim, fit, red, width } from "./term.ts";

/** Exit statuses of the reading commands. */
export const EXIT = { ok: 0, notFound: 1, problem: 2 } as const;

/** "Usage: ./touchdown …": a command's synopsis, as typed. */
export const usage = (synopsis: string) => t("cliRead.help.usage", { synopsis });

/** Options as a command's help lists them: each one padded to `col`, then what it does, its further lines under the first. */
export function optionLines(col: number, options: [string, string][]): string {
  return options.map(([option, text]) => `  ${option.padEnd(col)}${text.replace(/\n/g, `\n${" ".repeat(col + 2)}`)}`).join("\n");
}

/** The options every reading command takes, lined up at `col` with the command's own. */
export const readOptions = (col: number) =>
  optionLines(col, [
    ["--log FILE", t("cliRead.option.log")],
    ["--json", t("cliRead.option.json")],
  ]);

/** "Read from your log in Google Drive (address).", after each command's output. */
export const readFrom = (log: { from: string }) => t("cliRead.readFrom", { from: log.from });

export interface Args {
  values: Map<string, string>;
  /** Options that may repeat, each value in order. */
  lists: Map<string, string[]>;
  flags: Set<string>;
  positional: string[];
}

/** Split arguments into options with a value (`values`, or `lists` for those that repeat), flags and the rest. An unknown option is an error. */
export function parseArgs(args: string[], spec: { values?: string[]; lists?: string[]; flags?: string[] }): Args | { error: string } {
  const takes = new Set(["--log", ...(spec.values ?? []), ...(spec.lists ?? [])]);
  const flags = new Set(["--json", ...(spec.flags ?? [])]);
  const out: Args = { values: new Map(), lists: new Map(), flags: new Set(), positional: [] };
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (takes.has(a)) {
      const v = args[++i];
      if (v === undefined || v.startsWith("--")) return { error: t("cliRead.args.needsValue", { option: a }) };
      if (spec.lists?.includes(a)) out.lists.set(a, [...(out.lists.get(a) ?? []), v]);
      else out.values.set(a, v);
    } else if (flags.has(a)) out.flags.add(a);
    else if (a.startsWith("--")) return { error: t("cliRead.args.unknown", { option: a }) };
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
  /** The storage the log was read from; null for a backup file. */
  storage: OpenedStorage | null;
  codes: CodeStyle;
  unit: "km" | "mi" | "nm";
  models: "standard" | "compact";
}

/**
 * The log, read-only: from --log, else the chosen storage, else the default backup. The user's own operators and
 * family choices apply, and the log's settings say how codes, distances and models are shown, as in the web app.
 * `tracks`: read the recorded tracks' positions from the storage too, for the distances flown (a backup holds them).
 */
export async function openLog(file?: string, opts: { tracks?: boolean } = {}): Promise<OpenedLog> {
  const ref = new RefIndex(refTables());
  const storage = file ? null : await chosenStorage();
  const log = await loadLog(ref, { file: file ? userPath(file) : undefined, storage, tracks: opts.tracks });
  if (!log.store) throw new Error(t("cliRead.log.none"));
  const store = log.store;
  ref.setUserOverrides(refOverridesOf(store));
  // Shown as the web app shows it: what two devices made side by side settled, in this copy only (core reconcile.ts).
  reconcile(store, ref);
  const s = settingsOf(store);
  return { store, ref, from: log.from, storage, codes: s.codeDisplay ?? "iata", unit: s.distanceUnit ?? "km", models: s.modelNaming ?? "standard" };
}

/** The log, or the reason it cannot be read, and stop. */
export async function openOrFail(json: boolean, file?: string, opts: { tracks?: boolean } = {}): Promise<OpenedLog> {
  try {
    return await openLog(file, opts);
  } catch (e) {
    return fail(json, (e as Error).message);
  }
}

/** The arguments, or the command's help when they do not fit. */
export function argsOrHelp(args: string[], spec: { values?: string[]; lists?: string[]; flags?: string[] }, help: string, positional: [number, number] = [0, 0]): Args {
  const json = args.includes("--json");
  if (args.includes("--help") || args.includes("-h")) {
    console.log(help);
    process.exit(EXIT.ok);
  }
  const a = parseArgs(args, spec);
  const problem = "error" in a ? a.error : a.positional.length < positional[0] ? t("cliRead.args.missing") : a.positional.length > positional[1] ? t("cliRead.args.tooMany", { args: a.positional.join(" ") }) : null;
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
    return { error: t("cliRead.year.invalid") };
  }
  if (fallback === "all") return "all";
  const thisYear = todayIn().slice(0, 4);
  return years.includes(thisYear) ? thisYear : (years[years.length - 1] ?? "all");
}

// ---------- records named by REF ----------

export type Found<T> = { row: T } | { error: string; candidates: { id: string; label: string }[] };

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** The one row, or what is wrong: `none` when no row fits, `several` (with the count) when more than one does. */
function pick<T extends { id: string }>(rows: T[], none: () => string, several: (count: number) => string, label: (r: T) => string): Found<T> {
  if (rows.length === 1) return { row: rows[0]! };
  if (!rows.length) return { error: none(), candidates: [] };
  return { error: several(rows.length), candidates: rows.map((r) => ({ id: r.id, label: label(r) })) };
}

export function flightRefLabel(f: Flight): string {
  const number = f.flightNumber;
  const day = flightDay(f) ?? f.scheduledDate;
  return number && day ? t("cliRead.ref.flight", { number, day }) : number || day || f.id;
}
export function sightingRefLabel(s: Sighting, ref: RefIndex): string {
  const airport = ref.airport(s.airportId)?.icao ?? s.airportRaw;
  const registration = s.registration ?? t("cliRead.ref.sighting");
  const day = s.seenOn;
  if (airport && day) return t("cliRead.ref.sightingAtOn", { registration, airport, day });
  if (airport) return t("cliRead.ref.sightingAt", { registration, airport });
  if (day) return t("cliRead.ref.sightingOn", { registration, day });
  return registration;
}

/** A flight by its id, or `XY123@2025-04-02` (flight number and day). */
export function findFlight(store: Store, text: string): Found<Flight> {
  const byId = store.get("flights", text);
  if (byId) return { row: byId };
  const [number, day] = text.split("@");
  if (!number || !day || !DATE_RE.test(day)) return { error: t("cliRead.find.flight.notRef", { text }), candidates: [] };
  const n = normaliseFlightNumber(number);
  return pick(
    store.all("flights").filter((f) => f.flightNumber === n && (flightDay(f) === day || f.scheduledDate === day)),
    () => t("cliRead.find.flight.none", { number: `${n}`, day }),
    (count) => t("cliRead.find.flight.several", { count, number: `${n}`, day }),
    flightRefLabel,
  );
}

/** A sighting by its id, or `G-ABCD@EGLL@2025-03-15` (registration, airport, day), or `G-ABCD@2025-03-15`. */
export function findSighting(store: Store, ref: RefIndex, text: string): Found<Sighting> {
  const byId = store.get("sightings", text);
  if (byId) return { row: byId };
  const parts = text.split("@");
  const day = parts[parts.length - 1]!;
  if (parts.length < 2 || parts.length > 3 || !DATE_RE.test(day)) return { error: t("cliRead.find.sighting.notRef", { text }), candidates: [] };
  const reg = registrationMatchForm(parts[0]!);
  const place = parts.length === 3 ? parts[1]! : null;
  const airport = place ? ref.airportByCode(place) : null;
  return pick(
    store.all("sightings").filter((s) => s.seenOn === day && registrationMatchForm(s.registration ?? s.registrationRaw ?? "") === reg && (!place || (airport ? s.airportId === airport.id : (s.airportRaw ?? "").toUpperCase() === place.toUpperCase()))),
    () => (place ? t("cliRead.find.sighting.noneAt", { registration: parts[0]!, airport: place, day }) : t("cliRead.find.sighting.none", { registration: parts[0]!, day })),
    (count) => (place ? t("cliRead.find.sighting.severalAt", { count, registration: parts[0]!, airport: place, day }) : t("cliRead.find.sighting.several", { count, registration: parts[0]!, day })),
    (s) => sightingRefLabel(s, ref),
  );
}

/** An airframe by its id, or a registration (`G-ABCD`), on a date when it was reused (`G-ABCD@2019-05-01`). */
export function findAircraft(store: Store, text: string): Found<{ id: string }> {
  const byId = store.get("airframes", text);
  if (byId) return { row: byId };
  const [regText, day] = text.split("@");
  if (!regText || (day !== undefined && !DATE_RE.test(day))) return { error: t("cliRead.find.aircraft.notRef", { text }), candidates: [] };
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
  return pick(
    rows,
    () => (day ? t("cliRead.find.aircraft.noneOn", { registration: regText, day }) : t("cliRead.find.aircraft.none", { registration: regText })),
    (count) => (day ? t("cliRead.find.aircraft.severalOn", { count, registration: regText, day }) : t("cliRead.find.aircraft.several", { count, registration: regText })),
    (a) => {
      const type = a.typeCode ?? t("cliRead.find.aircraft.unknownType");
      return a.msn ? t("cliRead.find.aircraft.serial", { type, msn: a.msn }) : type;
    },
  );
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

/**
 * Ticket numbers and booking references are never shown (docs/34, "Private fields"): only whether one is recorded.
 * They are in the flight's private row (docs/32, "Private data").
 */
export function privateFields(log: OpenedLog, f: Flight): { ticketNumber: boolean; bookingRef: boolean } {
  const p = privateOf(log.store, f.id);
  return { ticketNumber: !!p.ticketNumber, bookingRef: !!p.bookingRef };
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
