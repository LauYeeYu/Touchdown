// The changing commands (docs/34, "Changing"): edit, delete, aircraft edit and merge, issues accept, reopen and fix,
// undo, families, settings, saved Statistics views and a flight's recorded track. Each works out its changes against the log as it is now, reports what they would do
// and the findings they would bring, and writes them to the inbox as one file, for review in the web app: nothing
// reaches the log without that review. Ticket numbers and booking references are never printed (docs/34,
// "Private fields"); typed, they are asked for at a prompt that does not show them.

import { t } from "@touchdown/i18n/cli";
import { readFileSync } from "node:fs";
import { basename } from "node:path";
import {
  AIRFRAME_EDIT_FIELDS,
  airframeEdit,
  fitTrackFile,
  FLIGHT_EDIT_FIELDS,
  flightEdit,
  INBOX_SCHEMA,
  INBOX_VERSION,
  isEmptyChange,
  MAX_TRACK_POINTS,
  readTrackFile,
  RULES,
  SIGHTING_EDIT_FIELDS,
  sightingEdit,
  toUtcIso,
  trackChangeFor,
  type EditInput,
  type Finding,
  type InboxChange,
  type InboxFile,
  type LogSettings,
  type SavedView,
  type Store,
  viewProblem,
  pastedFactsFor,
  phaseIndex,
  viewFilters,
} from "@touchdown/core";
import { aircraftViews, filtersText, planChanges, typeName } from "@touchdown/core/view";
import { freeName, inboxPlace, stamp, writeInboxFile } from "./log.ts";
import { userPath } from "./paths.ts";
import { EXIT, fail, findAircraft, findFlight, findSighting, notFound, openOrFail, plain, printJson, readOptions, type Found, type OpenedLog } from "./read.ts";
import { findingJson, openFindings } from "./shape.ts";
import { whereFilters } from "./where.ts";
import { askHidden, bold, dim, green, red, tc, yellow } from "./term.ts";

const PRIVATE = new Set(["ticketNumber", "bookingRef"]);

export const changeOptions = (col: number) => `  ${"--dry-run".padEnd(col)}${t("cli.help.changeOptions.dryRun")}
  ${"--keep-errors".padEnd(col)}${t("cli.help.changeOptions.keepErrors")}
${readOptions(col)}`;

/** What happens to the changes, the end of each changing command's help. */
export const changesAfter = () => t("cli.help.changesAfter");

export const editHelp = () => t("cli.help.edit", { options: changeOptions(15), after: changesAfter(), flightFields: FLIGHT_EDIT_FIELDS.join(", "), sightingFields: SIGHTING_EDIT_FIELDS.join(", ") });

export const trackHelp = () => t("cli.help.track", { options: changeOptions(15), after: changesAfter() });

export const deleteHelp = () => t("cli.help.delete", { options: changeOptions(15), after: changesAfter() });

export const aircraftChangeHelp = () => t("cli.help.aircraftChange", { options: changeOptions(17), after: changesAfter(), fields: AIRFRAME_EDIT_FIELDS.join(", ") });

export const issuesChangeHelp = () => t("cli.help.issuesChange", { options: changeOptions(15), after: changesAfter() });

export const undoHelp = () => t("cli.help.undo", { options: changeOptions(15), after: changesAfter() });

export const familiesHelp = () => t("cli.help.families", { options: changeOptions(15), after: changesAfter() });

export const settingsHelp = () => t("cli.help.settings", { options: changeOptions(15), after: changesAfter() });

export const viewsHelp = () => t("cli.help.views", { options: changeOptions(15), after: changesAfter() });

export interface Common {
  json: boolean;
  dryRun: boolean;
  force: boolean;
  keepErrors: boolean;
  log?: string;
  sets: [string, string | null][];
  clears: string[];
  note?: string;
  /** Options that take a value, of the command's own. */
  values: Map<string, string>;
  /** Options that may repeat, each value in order. */
  lists: Map<string, string[]>;
  /** Options without a value, of the command's own. */
  switches: Set<string>;
  positional: string[];
}

/** The arguments of a changing command: --set and --clear may repeat; --set F alone asks for a private value. */
export function parse(args: string[], help: string, opts: { sets?: boolean; note?: boolean; force?: boolean; values?: string[]; lists?: string[]; switches?: string[] } = {}): Common {
  const json = args.includes("--json");
  if (args.includes("--help") || args.includes("-h")) {
    console.log(help);
    process.exit(EXIT.ok);
  }
  const c: Common = { json, dryRun: false, force: false, keepErrors: false, sets: [], clears: [], values: new Map(), lists: new Map(), switches: new Set(), positional: [] };
  const bad = (problem: string): never => {
    if (json) return fail(json, problem);
    console.error(red(problem));
    console.log(`\n${help}`);
    process.exit(EXIT.problem);
  };
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    const value = () => {
      const v = args[++i];
      return v === undefined || (v.startsWith("--") && v !== "-") ? bad(t("cli.args.needsValue", { option: a })) : v;
    };
    if (a === "--json") continue;
    else if (a === "--dry-run") c.dryRun = true;
    else if (a === "--keep-errors") c.keepErrors = true;
    else if (a === "--force" && opts.force) c.force = true;
    else if (a === "--log") c.log = value();
    else if (a === "--note" && opts.note) c.note = value();
    else if (opts.values?.includes(a)) c.values.set(a, value());
    else if (opts.lists?.includes(a)) c.lists.set(a, [...(c.lists.get(a) ?? []), value()]);
    else if (opts.switches?.includes(a)) c.switches.add(a);
    else if ((a === "--set" || a === "--clear") && opts.sets) {
      const v = value();
      if (a === "--clear") c.clears.push(v);
      else {
        const eq = v.indexOf("=");
        const field = eq < 0 ? v : v.slice(0, eq);
        if (PRIVATE.has(field) && eq >= 0) bad(t("cliWrite.change.privateOnCommandLine", { field }));
        c.sets.push([field, eq < 0 ? null : v.slice(eq + 1)]);
      }
    } else if (a.startsWith("--")) bad(t("cli.args.noOption", { option: a }));
    else c.positional.push(a);
  }
  return c;
}

/** The fields to set from --set and --clear, private values asked for at the prompt. */
async function inputOf(c: Common): Promise<EditInput> {
  const input: EditInput = {};
  for (const [field, value] of c.sets) {
    if (value !== null) input[field] = value;
    else if (PRIVATE.has(field)) {
      try {
        input[field] = (await askHidden(`${t("cliWrite.change.askPrivate", { field })} `)) || null;
      } catch (e) {
        return fail(c.json, (e as Error).message);
      }
    } else return fail(c.json, t("cliWrite.change.setNeedsValue", { field }));
  }
  for (const field of c.clears) input[field] = null;
  return input;
}

/** A flight or a sighting, by id or by the forms REF takes. */
function findRecord(log: OpenedLog, text: string): Found<{ table: "flights" | "sightings"; id: string }> {
  const byFlightId = log.store.get("flights", text);
  if (byFlightId) return { row: { table: "flights", id: text } };
  const bySightingId = log.store.get("sightings", text);
  if (bySightingId) return { row: { table: "sightings", id: text } };
  const f = findFlight(log.store, text);
  if ("row" in f) return { row: { table: "flights", id: f.row.id } };
  if (f.candidates.length) return f;
  const s = findSighting(log.store, log.ref, text);
  if ("row" in s) return { row: { table: "sightings", id: s.row.id } };
  if (s.candidates.length) return s;
  return { error: t("cliWrite.change.noRecord", { ref: text }), candidates: [] };
}

const severityMark = (f: Finding) => (f.severity === "error" ? red("!") : f.severity === "warning" ? yellow("?") : dim("i"));

/**
 * Check the changes against the log, report them, and write those with something to do to the inbox as one file
 * named after the command. Never returns.
 */
export async function writeChanges(log: OpenedLog, command: string, changes: InboxChange[], c: Common, notes: string[] = []): Promise<never> {
  const plan = planChanges(log.store, log.ref, changes, { codes: log.codes, unit: log.unit, models: log.models });
  const open = plan.changes.filter((p) => p.status === "pending");
  const errors = plan.findings.filter((f) => f.severity === "error");
  const place = inboxPlace(log.storage);
  let written: { file: string; place: string; changes: number } | null = null;
  let notWritten: "dry-run" | "errors" | "nothing to change" | null = null;
  if (!open.length) notWritten = "nothing to change";
  else if (errors.length && !c.keepErrors) notWritten = "errors";
  else if (c.dryRun) notWritten = "dry-run";
  else {
    const file: InboxFile = { schema: INBOX_SCHEMA, version: INBOX_VERSION, createdAt: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"), checker: null, sightings: [], flights: [], changes: open.map((p) => changes[p.index]!) };
    try {
      const name = await freeName(place, `${command}-${stamp()}`);
      await writeInboxFile(place, name, file, log.ref);
      written = { file: name, place: place.name, changes: open.length };
    } catch (e) {
      return fail(c.json, (e as Error).message);
    }
  }

  if (c.json) {
    printJson({
      ok: !(errors.length && !c.keepErrors),
      checkedAgainst: log.from,
      changes: plan.changes.map((p) => ({ action: p.action, title: p.title, status: p.status, note: p.note, lines: p.lines.map(({ label, before, after }) => ({ label, before, after })) })),
      findings: plan.findings.map(findingJson),
      notes,
      written,
      notWritten,
      sharedInbox: place.shared,
    });
  } else {
    console.log(t("cli.checkedAgainst", { from: log.from }));
    for (const p of plan.changes) {
      const mark = p.status === "pending" ? green("✓") : dim("–");
      console.log(`${mark} ${bold(p.action)}  ${plain(p.title)}${p.status === "pending" ? "" : dim(`  ${p.note ?? p.status}`)}`);
      if (p.status === "pending" && p.note) console.log(`    ${yellow(p.note)}`);
      const w = Math.max(0, ...p.lines.map((l) => l.label.length));
      for (const l of p.lines) console.log(`    ${dim(l.label.padEnd(w))}  ${plain(l.before) || dim("-")} → ${plain(l.after) || dim("-")}`);
    }
    for (const n of notes) console.log(yellow(`  ${n}`));
    if (plan.findings.length) {
      console.log(`\n${bold(t("cliWrite.change.findingsTitle"))}`);
      for (const f of plan.findings) console.log(`  ${severityMark(f)} ${f.message} ${dim(f.ruleId)}`);
    }
    if (written) {
      console.log(`\n${tc("cliWrite.change.written", { count: written.changes, place: written.place, file: written.file }, { green })}`);
      console.log(tc("cliWrite.change.notInLogYet", { shared: place.shared ? "yes" : "no" }, { yellow }));
    } else if (notWritten === "errors") console.log(`\n${tc("cliWrite.change.notWrittenErrors", { count: errors.length }, { red })}`);
    else if (notWritten === "dry-run") console.log(dim(`\n${t("cli.dryRun")}`));
    else console.log(`\n${t("cliWrite.change.nothingToChange")}`);
  }
  process.exit(notWritten === "errors" ? EXIT.notFound : EXIT.ok);
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

/** One edit: the change, or what is wrong with it. */
function editOf(log: OpenedLog, json: boolean, ref: string, input: EditInput): { change: InboxChange; notes: string[] } {
  const found = findRecord(log, ref);
  if (!("row" in found)) return notFound(json, found);
  const built = found.row.table === "flights" ? flightEdit(log.store, log.ref, log.store.get("flights", found.row.id)!, input) : sightingEdit(log.store, log.ref, log.store.get("sightings", found.row.id)!, input);
  if ("error" in built) return fail(json, `${ref}: ${built.error}`);
  return built;
}

export async function editCommand(args: string[]) {
  const c = parse(args, editHelp(), { sets: true });
  if (c.positional.length !== 1) return fail(c.json, c.positional.length ? t("cliWrite.change.edit.oneRef") : t("cliWrite.change.edit.whichRecord"));
  const log = await openOrFail(c.json, c.log);
  const changes: InboxChange[] = [];
  const notes: string[] = [];
  if (c.positional[0] === "-" || c.positional[0]!.endsWith(".json")) {
    if (c.sets.length || c.clears.length) return fail(c.json, t("cliWrite.change.edit.notBoth"));
    let list: unknown;
    try {
      list = JSON.parse(c.positional[0] === "-" ? await readStdin() : readFileSync(userPath(c.positional[0]!), "utf8"));
    } catch (e) {
      return fail(c.json, t("cliWrite.change.edit.notJson", { error: (e as Error).message }));
    }
    if (!Array.isArray(list) || !list.length) return fail(c.json, t("cliWrite.change.edit.giveList"));
    for (const [i, item] of list.entries()) {
      const e = item as { ref?: unknown; set?: unknown; clear?: unknown };
      const where = t("cliWrite.change.edit.where", { n: i + 1 });
      if (!e || typeof e !== "object" || typeof e.ref !== "string") return fail(c.json, t("cliWrite.change.edit.giveRef", { where }));
      const extra = Object.keys(e).filter((k) => !["ref", "set", "clear"].includes(k));
      if (extra.length) return fail(c.json, t("cliWrite.change.edit.unexpectedKeys", { where, keys: extra.join(", ") }));
      const input: EditInput = {};
      for (const [k, v] of Object.entries((e.set ?? {}) as Record<string, unknown>)) {
        if (!(typeof v === "string" || typeof v === "number" || v === null)) return fail(c.json, t("cliWrite.change.edit.textOrNumber", { where, field: k }));
        input[k] = v === null ? null : String(v);
      }
      if (e.clear !== undefined && (!Array.isArray(e.clear) || e.clear.some((k) => typeof k !== "string"))) return fail(c.json, t("cliWrite.change.edit.clearList", { where }));
      for (const k of (e.clear ?? []) as string[]) input[k] = null;
      const built = editOf(log, c.json, e.ref, input);
      changes.push(built.change);
      notes.push(...built.notes.map((n) => `${e.ref}: ${n}`));
    }
  } else {
    const input = await inputOf(c);
    if (!Object.keys(input).length) return fail(c.json, t("cliWrite.change.edit.nothing"));
    const built = editOf(log, c.json, c.positional[0]!, input);
    changes.push(built.change);
    notes.push(...built.notes);
  }
  return writeChanges(log, "edit", changes.filter((x) => !isEmptyChange(x)), c, notes);
}

export async function deleteCommand(args: string[]) {
  const c = parse(args, deleteHelp());
  if (!c.positional.length) return fail(c.json, t("cliWrite.change.delete.which"));
  const log = await openOrFail(c.json, c.log);
  const changes: InboxChange[] = c.positional.map((text) => {
    const found = findRecord(log, text);
    if (!("row" in found)) return notFound(c.json, found);
    const row = log.store.get(found.row.table, found.row.id)!;
    return { op: "delete", table: found.row.table, id: row.id, rev: row.rev };
  });
  return writeChanges(log, "delete", changes, c);
}

/** `track`: a flight's recorded track from a file, or --remove. */
export async function trackCommand(args: string[]) {
  const c = parse(args, trackHelp(), { switches: ["--remove"] });
  const remove = c.switches.has("--remove");
  if (c.positional.length !== (remove ? 1 : 2)) return fail(c.json, remove ? t("cliWrite.change.track.giveFlight") : t("cliWrite.change.track.giveFlightAndFile"));
  const log = await openOrFail(c.json, c.log);
  const found = findFlight(log.store, c.positional[0]!);
  if (!("row" in found)) return notFound(c.json, found);
  if (remove) return writeChanges(log, "track", [{ op: "removeTrack", flightId: found.row.id }], c);
  const name = basename(c.positional[1]!);
  let text: string;
  try {
    text = readFileSync(userPath(c.positional[1]!), "utf8");
  } catch {
    return fail(c.json, t("cliWrite.change.track.cannotRead", { file: c.positional[1]! }));
  }
  const read = readTrackFile(name, text);
  if ("error" in read) return fail(c.json, `${name}: ${read.error}`);
  const fit = fitTrackFile(read.points, found.row, log.ref);
  if ("problem" in fit) return fail(c.json, `${name}: ${fit.problem}`);
  const notes: string[] = [];
  if (fit.legs) {
    const at = (t: number) => toUtcIso(t * 1000).slice(11, 16);
    notes.push(t("cliWrite.change.track.legs", { legs: fit.legs, from: at(fit.points[0]!.t), to: at(fit.points[fit.points.length - 1]!.t) }));
  }
  if (fit.points.length > MAX_TRACK_POINTS) notes.push(t("cliWrite.change.track.thinned", { points: fit.points.length, max: MAX_TRACK_POINTS }));
  return writeChanges(log, "track", [trackChangeFor(found.row.id, { ...read, points: fit.points }, fit.coverage)], c, notes);
}

/** `aircraft edit` and `aircraft merge`. */
export async function aircraftChangeCommand(args: string[]) {
  const [what, ...rest] = args;
  const c = parse(rest, aircraftChangeHelp(), { sets: what === "edit", values: what === "edit" ? ["--paste"] : [] });
  const log = await openOrFail(c.json, c.log);
  const aircraft = (text: string) => {
    const found = findAircraft(log.store, text);
    return "row" in found ? log.store.get("airframes", found.row.id)! : notFound(c.json, found);
  };
  if (what === "merge") {
    if (c.positional.length !== 2) return fail(c.json, t("cliWrite.change.aircraft.giveTwo"));
    const into = aircraft(c.positional[0]!);
    const from = aircraft(c.positional[1]!);
    if (into.id === from.id) return fail(c.json, t("cliWrite.change.aircraft.same"));
    return writeChanges(log, "aircraft", [{ op: "merge", into: into.id, from: from.id }], c);
  }
  if (c.positional.length !== 1) return fail(c.json, t("cliWrite.change.aircraft.which"));
  const a = aircraft(c.positional[0]!);
  const input: EditInput = {};
  const notes: string[] = [];
  const pasteFrom = c.values.get("--paste");
  if (pasteFrom !== undefined) {
    let text: string;
    try {
      text = pasteFrom === "-" ? await readStdin() : readFileSync(userPath(pasteFrom), "utf8");
    } catch (e) {
      return fail(c.json, t("cliWrite.change.aircraft.pasteUnreadable", { file: pasteFrom, error: (e as Error).message }));
    }
    const reg = aircraftViews(log.store).find((v) => v.airframe.id === a.id)?.registration ?? c.positional[0]!.split("@")[0]!;
    const { pasted, patch, problem } = pastedFactsFor(log.store, log.ref, a, reg, text);
    if (!pasted.msn && !pasted.lineNumber && !pasted.firstFlightDate && !pasted.deliveryDate) return fail(c.json, t("cliWrite.change.aircraft.nothingPasted", { hasMonth: pasted.firstFlightMonth ? "yes" : "no", month: pasted.firstFlightMonth ?? "" }), EXIT.notFound);
    const named: Record<string, string> = { msn: "msn", lineNumber: "lineNumber", firstFlightDate: "firstFlight", deliveryDate: "delivered", manufacturer: "manufacturer" };
    for (const [field, value] of Object.entries(patch)) if (value) input[named[field]!] = value;
    if (pasted.site) notes.push(t("cliWrite.change.aircraft.readFrom", { site: pasted.site }));
    if (pasted.firstFlightMonth && !pasted.firstFlightDate) notes.push(t("cliWrite.change.aircraft.monthOnly", { month: pasted.firstFlightMonth }));
    if (problem) notes.push(t("cliWrite.change.aircraft.maybeAnother", { problem }));
  }
  // What --set and --clear give wins over the pasted text.
  Object.assign(input, await inputOf(c));
  if (!Object.keys(input).length) return fail(c.json, pasteFrom !== undefined ? t("cliWrite.change.aircraft.nothingNew") : t("cliWrite.change.aircraft.nothing"));
  const built = airframeEdit(a, input);
  if ("error" in built) return fail(c.json, built.error);
  return writeChanges(log, "aircraft", isEmptyChange(built.change) ? [] : [built.change], c, notes);
}

/** `issues accept`, `reopen` and `fix`. */
export async function issuesChangeCommand(args: string[]) {
  const [what, ...rest] = args;
  const c = parse(rest, issuesChangeHelp(), { note: what === "accept" });
  const id = c.positional[0];
  if (!id || c.positional.length > (what === "fix" ? 2 : 1)) return fail(c.json, t("cliWrite.change.issues.giveId"));
  const log = await openOrFail(c.json, c.log);
  if (what === "reopen") {
    const acks = log.store.all("issue_acks").filter((a) => a.id === id || a.fingerprint === id);
    if (acks.length !== 1) return fail(c.json, acks.length ? t("cliWrite.change.issues.severalAccepted", { count: acks.length, id }) : t("cliWrite.change.issues.noAccepted", { id }), EXIT.notFound);
    return writeChanges(log, "issues", [{ op: "reopen", ackId: acks[0]!.id }], c);
  }
  const [rule, fp] = id.includes(":") ? id.split(":") : [null, id];
  const found = openFindings(log).filter((f) => f.fingerprint === fp && (!rule || f.ruleId === rule));
  if (found.length !== 1) return fail(c.json, found.length ? t("cliWrite.change.issues.severalOpen", { count: found.length, id }) : t("cliWrite.change.issues.noOpen", { id }), EXIT.notFound);
  const f = found[0]!;
  if (what === "accept") {
    if (f.severity === "error") return fail(c.json, t("cliWrite.change.issues.errorCannotBeAccepted", { rule: RULES[f.ruleId]?.title ?? f.ruleId }));
    return writeChanges(log, "issues", [{ op: "accept", ruleId: f.ruleId, fingerprint: f.fingerprint, note: c.note?.trim() || null }], c);
  }
  const n = c.positional[1] === undefined ? 1 : Number(c.positional[1]);
  if (!f.fixes.length) return fail(c.json, t("cliWrite.change.issues.noFix"), EXIT.notFound);
  if (!Number.isInteger(n) || n < 1 || n > f.fixes.length) return fail(c.json, t("cliWrite.change.issues.chooseFix", { count: f.fixes.length }));
  return writeChanges(log, "issues", [{ op: "fix", ruleId: f.ruleId, fingerprint: f.fingerprint, fix: n - 1 }], c);
}

export async function undoCommand(args: string[]) {
  const c = parse(args, undoHelp(), { force: true });
  if (c.positional.length !== 1) return fail(c.json, t("cliWrite.change.undo.giveId"));
  const log = await openOrFail(c.json, c.log);
  const batch = log.store.get("import_batches", c.positional[0]!);
  if (!batch) return fail(c.json, t("cliWrite.change.undo.noImport", { id: c.positional[0]! }), EXIT.notFound);
  return writeChanges(log, "undo", [{ op: "undo", batchId: batch.id, ...(c.force && { force: true }) }], c);
}

export async function familiesCommand(args: string[]) {
  const c = parse(args, familiesHelp());
  const log = await openOrFail(c.json, c.log);
  const [what, type, family] = c.positional;
  if (!what) {
    const list = log.store.all("family_overrides").map((o) => ({ type: o.designator, typeName: typeName(o.designator, log.ref), family: o.familyId, familyName: log.ref.family(o.familyId)?.name ?? o.familyId }));
    if (c.json) return printJson({ ok: true, from: log.from, families: list });
    console.log(list.length ? tc("cliWrite.change.families.list", { count: list.length }, { bold }) : t("cliWrite.change.families.none"));
    for (const x of list) console.log(`  ${x.type}  ${x.typeName}  ${t("cliWrite.change.families.in", { family: String(x.familyName) })}`);
    return;
  }
  const designator = type?.toUpperCase();
  if ((what !== "set" && what !== "remove") || !designator || (what === "set" ? !family : family !== undefined)) return fail(c.json, familiesHelp());
  if (!log.ref.type(designator)) return fail(c.json, t("cliWrite.change.families.notType", { type: type! }));
  if (what === "remove") return writeChanges(log, "families", [{ op: "family", designator, familyId: null }], c);
  const fam = log.ref.family(family) ?? log.ref.family(family!.toUpperCase()) ?? [...log.ref.families.values()].find((x) => x.name.toLowerCase() === family!.toLowerCase());
  if (!fam) return fail(c.json, t("cliWrite.change.families.notFamily", { family: family!, families: [...log.ref.families.values()].map((x) => x.id).join(", ") }));
  return writeChanges(log, "families", [{ op: "family", designator, familyId: fam.id }], c);
}

const SETTINGS: Record<string, [keyof LogSettings, readonly string[]]> = {
  codes: ["codeDisplay", ["iata", "icao", "both"]],
  distance: ["distanceUnit", ["km", "mi", "nm"]],
  models: ["modelNaming", ["standard", "compact"]],
};

export async function settingsCommand(args: string[]) {
  const c = parse(args, settingsHelp());
  const log = await openOrFail(c.json, c.log);
  if (!c.positional.length) {
    const now = { codes: log.codes, distance: log.unit, models: log.models };
    if (c.json) return printJson({ ok: true, from: log.from, settings: now });
    for (const [k, v] of Object.entries(now)) console.log(`${dim(k.padEnd(8))}  ${v}`);
    return;
  }
  if (c.positional.length % 2) return fail(c.json, settingsHelp());
  const set: LogSettings = {};
  for (let i = 0; i < c.positional.length; i += 2) {
    const [name, value] = [c.positional[i]!, c.positional[i + 1]!.toLowerCase()];
    const s = SETTINGS[name];
    if (!s) return fail(c.json, t("cliWrite.change.settings.noSetting", { name, settings: Object.keys(SETTINGS).join(", ") }));
    if (!s[1].includes(value)) return fail(c.json, t("cliWrite.change.settings.oneOf", { name, values: s[1].join(", ") }));
    (set as Record<string, string>)[s[0]] = value;
  }
  return writeChanges(log, "settings", [{ op: "settings", set }], c);
}

/** A saved view by its name, as typed (case aside). */
export function savedViewNamed(store: Store, name: string) {
  const views = store.all("saved_views");
  return views.find((v) => v.name === name) ?? views.find((v) => v.name?.toLowerCase() === name.toLowerCase()) ?? null;
}

/** `./touchdown stats views …` */
export async function viewsCommand(args: string[]) {
  const c = parse(args, viewsHelp(), { values: ["--by", "--cols", "--of", "--measure"], lists: ["--where"] });
  const log = await openOrFail(c.json, c.log);
  const [what, name, ...more] = c.positional;
  if (!what) {
    if (c.values.size || c.lists.size) return fail(c.json, viewsHelp());
    const list = log.store.all("saved_views").map((v) => ({ id: v.id, name: v.name, of: v.dataset, by: v.rowDimension, cols: v.columnDimension ?? null, measure: v.measure, filters: viewFilters(log.store, v.id) }));
    if (c.json) return printJson({ ok: true, from: log.from, views: list });
    if (!list.length) console.log(t("cliWrite.change.views.none"));
    for (const v of list) console.log(`  ${bold(v.name ?? "")}  ${dim(t("cliWrite.change.views.line", { of: String(v.of), by: String(v.by), hasCols: v.cols ? "yes" : "no", cols: v.cols ?? "", measure: String(v.measure), hasFilters: v.filters.length ? "yes" : "no", filters: v.filters.length ? plain(filtersText(v.filters, log.ref, log.codes)) : "" }))}`);
    return;
  }
  if ((what !== "save" && what !== "remove") || !name || more.length) return fail(c.json, viewsHelp());
  if (what === "remove") {
    if (c.values.size || c.lists.size) return fail(c.json, viewsHelp());
    const v = savedViewNamed(log.store, name);
    if (!v) return fail(c.json, t("cliWrite.change.views.notSaved", { name }), EXIT.notFound);
    return writeChanges(log, "stats", [{ op: "removeView", id: v.id }], c);
  }
  if (!c.values.has("--by")) return fail(c.json, `${t("cliWrite.change.views.needsBy")}\n\n${viewsHelp()}`);
  if (name.length > 80) return fail(c.json, t("cliWrite.change.views.nameTooLong"));
  if (savedViewNamed(log.store, name)) return fail(c.json, t("cliWrite.change.views.exists", { name }));
  const view: SavedView = {
    name,
    dataset: (c.values.get("--of") ?? "flights") as SavedView["dataset"],
    rowDimension: c.values.get("--by")!,
    columnDimension: c.values.get("--cols") ?? null,
    measure: (c.values.get("--measure") ?? "records") as SavedView["measure"],
  };
  if (view.dataset === "flights" || view.dataset === "sightings") {
    const ctx = { ref: log.ref, airframes: new Map(log.store.all("airframes").map((x) => [x.id, x])), phases: phaseIndex(log.store) };
    const filters = whereFilters(log, ctx, view.dataset, c.lists.get("--where") ?? []);
    if ("error" in filters) return fail(c.json, filters.error);
    if (filters.length) view.filters = filters;
  }
  const problem = viewProblem(view);
  if (problem) return fail(c.json, `${problem[0]!.toUpperCase()}${problem.slice(1)}.`);
  return writeChanges(log, "stats", [{ op: "view", ...view }], c);
}
