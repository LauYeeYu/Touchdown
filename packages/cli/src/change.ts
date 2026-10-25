// The changing commands (docs/34, "Changing"): edit, delete, aircraft edit and merge, issues accept, reopen and fix,
// undo, families and settings. Each works out its changes against the log as it is now, reports what they would do
// and the findings they would bring, and writes them to the inbox as one file, for review in the web app: nothing
// reaches the log without that review. Ticket numbers and booking references are never printed (docs/34,
// "Private fields"); typed, they are asked for at a prompt that does not show them.

import { readFileSync } from "node:fs";
import {
  AIRFRAME_EDIT_FIELDS,
  airframeEdit,
  FLIGHT_EDIT_FIELDS,
  flightEdit,
  INBOX_SCHEMA,
  INBOX_VERSION,
  isEmptyChange,
  RULES,
  SIGHTING_EDIT_FIELDS,
  sightingEdit,
  type EditInput,
  type Finding,
  type InboxChange,
  type InboxFile,
  type LogSettings,
} from "@touchdown/core";
import { planChanges, typeName } from "@touchdown/core/view";
import { freeName, inboxPlace, stamp, writeInboxFile } from "./log.ts";
import { userPath } from "./paths.ts";
import { EXIT, fail, findAircraft, findFlight, findSighting, notFound, openOrFail, plain, printJson, readOptions, type Found, type OpenedLog } from "./read.ts";
import { findingJson, openFindings } from "./shape.ts";
import { askHidden, bold, dim, green, plural, red, yellow } from "./term.ts";

const PRIVATE = new Set(["ticketNumber", "bookingRef"]);

const changeOptions = (col: number) => `  ${"--dry-run".padEnd(col)}check only, write nothing
  ${"--keep-errors".padEnd(col)}write even when the changes bring errors; the review shows them again
${readOptions(col)}`;

const AFTER = `The changes go to the inbox as one file (the storage chosen with ./touchdown storage, else
data/private/inbox/), are read back, and wait there until you review and import them on the web app's Import
page. Importing them is one import: undo it there to put everything back.

Exit status: 0 written, or nothing to change; 1 no such record, or the changes bring errors and nothing was
written; 2 a wrong option, or the log or the storage could not be read.`;

export const EDIT_HELP = `Usage: ./touchdown edit REF [--set FIELD=VALUE]… [--set FIELD]… [--clear FIELD]… [options]
       ./touchdown edit - [options]          (a JSON list of edits on standard input)

Changes a flight or a sighting. Values are read as ./touchdown add reads them: codes resolved, clock times at
the airport they happen at, on the record's date.

  REF            a flight: its id, or XY123@2025-04-02; a sighting: its id, G-ABCD@EGLL@2025-03-15 or
                 G-ABCD@2025-03-15
  --set F=V      set a field
  --set F        for ticketNumber and bookingRef: type the value at a prompt that does not show it (never give
                 a private value on the command line, where the shell's history keeps it)
  --clear F      empty a field
${changeOptions(15)}

Flight fields:   ${FLIGHT_EDIT_FIELDS.join(", ")}
Sighting fields: ${SIGHTING_EDIT_FIELDS.join(", ")}
                 (tags: comma-separated, such as night,backlit; time: HH:MM at the airport)

The JSON list: [{ "ref": "XY123@2025-04-02", "set": { "seat": "14A" }, "clear": ["gate"] }]. Private values may
be given in "set" there; they are never printed.

${AFTER}`;

export const DELETE_HELP = `Usage: ./touchdown delete REF… [options]

Deletes flights or sightings, once you import the change: a deleted flight takes its ticket number and booking
reference with it, and undoing the import brings everything back.

  REF            as for ./touchdown edit
${changeOptions(15)}

${AFTER}`;

export const AIRCRAFT_CHANGE_HELP = `Usage: ./touchdown aircraft edit REF [--set FIELD=VALUE]… [--clear FIELD]… [options]
       ./touchdown aircraft merge INTO FROM [options]

edit changes what is known about an aircraft: a serial number makes it confirmed. merge moves every flight and
sighting of FROM to INTO and removes FROM: two entries for one physical aircraft, for example after a
registration change.

  REF, INTO, FROM  the aircraft's id, or a registration (G-ABCD), on a date when it was reused (G-ABCD@2019-05-01)
${changeOptions(17)}

Fields: ${AIRFRAME_EDIT_FIELDS.join(", ")} (dates YYYY-MM-DD; status: active, stored, retired, written_off)

${AFTER}`;

export const ISSUES_CHANGE_HELP = `Usage: ./touchdown issues accept ID [--note TEXT] [options]
       ./touchdown issues reopen ID [options]
       ./touchdown issues fix ID [N] [options]

accept marks a warning as right: it comes back only if its values change. reopen takes that back (ID from
./touchdown issues --accepted). fix applies the finding's suggested fix N (1 when there is one).

  ID             the finding's id, from ./touchdown issues
${changeOptions(15)}

${AFTER}`;

export const UNDO_HELP = `Usage: ./touchdown undo BATCH [options]

Undoes an import: records it created are removed, and records it changed get their earlier values back.

  BATCH          the import's id, from ./touchdown imports
${changeOptions(15)}

${AFTER}`;

export const FAMILIES_HELP = `Usage: ./touchdown families [--log FILE] [--json]
       ./touchdown families set TYPE FAMILY [options]
       ./touchdown families remove TYPE [options]

Families group type codes in the statistics. Without arguments, the types you counted in another family; set
counts TYPE (an ICAO type code, such as E75L) in FAMILY (a family's id or name, such as E170); remove counts it
in its own family again.

${changeOptions(15)}

${AFTER}`;

export const SETTINGS_HELP = `Usage: ./touchdown settings [--log FILE] [--json]
       ./touchdown settings [codes iata|icao|both] [distance km|mi|nm] [models standard|compact] [options]

The settings your log keeps for every device: the airport codes shown, the distance unit and how models are
named. Without values, shows them.

${changeOptions(15)}

${AFTER}`;

interface Common {
  json: boolean;
  dryRun: boolean;
  keepErrors: boolean;
  log?: string;
  sets: [string, string | null][];
  clears: string[];
  note?: string;
  positional: string[];
}

/** The arguments of a changing command: --set and --clear may repeat; --set F alone asks for a private value. */
function parse(args: string[], help: string, opts: { sets?: boolean; note?: boolean } = {}): Common {
  const json = args.includes("--json");
  if (args.includes("--help") || args.includes("-h")) {
    console.log(help);
    process.exit(EXIT.ok);
  }
  const c: Common = { json, dryRun: false, keepErrors: false, sets: [], clears: [], positional: [] };
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
      return v === undefined || (v.startsWith("--") && v !== "-") ? bad(`${a} needs a value.`) : v;
    };
    if (a === "--json") continue;
    else if (a === "--dry-run") c.dryRun = true;
    else if (a === "--keep-errors") c.keepErrors = true;
    else if (a === "--log") c.log = value();
    else if (a === "--note" && opts.note) c.note = value();
    else if ((a === "--set" || a === "--clear") && opts.sets) {
      const v = value();
      if (a === "--clear") c.clears.push(v);
      else {
        const eq = v.indexOf("=");
        const field = eq < 0 ? v : v.slice(0, eq);
        if (PRIVATE.has(field) && eq >= 0) bad(`Never give a ${field === "ticketNumber" ? "ticket number" : "booking reference"} on the command line, where the shell's history keeps it. Use --set ${field} alone and type it at the prompt, or give it in JSON on standard input.`);
        c.sets.push([field, eq < 0 ? null : v.slice(eq + 1)]);
      }
    } else if (a.startsWith("--")) bad(`There is no option ${a}.`);
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
        input[field] = (await askHidden(`${field === "ticketNumber" ? "Ticket number" : "Booking reference"} (not shown): `)) || null;
      } catch (e) {
        return fail(c.json, (e as Error).message);
      }
    } else return fail(c.json, `--set ${field} needs a value: --set ${field}=VALUE.`);
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
  return { error: `No flight or sighting is ${text}. A flight is named XY123@YYYY-MM-DD, a sighting G-ABCD@EGLL@YYYY-MM-DD, or either by its id.`, candidates: [] };
}

const severityMark = (f: Finding) => (f.severity === "error" ? red("!") : f.severity === "warning" ? yellow("?") : dim("i"));

/**
 * Check the changes against the log, report them, and write those with something to do to the inbox as one file
 * named after the command. Never returns.
 */
async function writeChanges(log: OpenedLog, command: string, changes: InboxChange[], c: Common, notes: string[] = []): Promise<never> {
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
    console.log(`Checked against ${log.from}.`);
    for (const p of plan.changes) {
      const mark = p.status === "pending" ? green("✓") : dim("–");
      console.log(`${mark} ${bold(p.action)}  ${plain(p.title)}${p.status === "pending" ? "" : dim(`  ${p.note ?? p.status}`)}`);
      const w = Math.max(0, ...p.lines.map((l) => l.label.length));
      for (const l of p.lines) console.log(`    ${dim(l.label.padEnd(w))}  ${plain(l.before) || dim("-")} → ${plain(l.after) || dim("-")}`);
    }
    for (const n of notes) console.log(yellow(`  ${n}`));
    if (plan.findings.length) {
      console.log(`\n${bold("Findings these changes bring")}`);
      for (const f of plan.findings) console.log(`  ${severityMark(f)} ${f.message} ${dim(f.ruleId)}`);
    }
    if (written) {
      console.log(`\n${green("Written")} ${plural(written.changes, "change")} to ${written.place}: ${written.file}. Read back and checked.`);
      console.log(`${yellow("Not in your log yet:")} ${place.shared ? "open Touchdown on any device and use “Review and import” at the top, or the list on the Import page." : "start the web app (npm run dev -w @touchdown/web) and use “Review and import” at the top."}`);
    } else if (notWritten === "errors") console.log(`\n${red("Nothing written:")} the changes bring ${plural(errors.length, "error")}. Fix them, or write the changes anyway with --keep-errors.`);
    else if (notWritten === "dry-run") console.log(dim("\nDry run: nothing written."));
    else console.log("\nNothing written: there is nothing to change.");
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
  const c = parse(args, EDIT_HELP, { sets: true });
  if (c.positional.length !== 1) return fail(c.json, c.positional.length ? "Give one REF, or - for a JSON list of edits." : "Which record? Give its REF, or - for a JSON list of edits.");
  const log = await openOrFail(c.json, c.log);
  const changes: InboxChange[] = [];
  const notes: string[] = [];
  if (c.positional[0] === "-" || c.positional[0]!.endsWith(".json")) {
    if (c.sets.length || c.clears.length) return fail(c.json, "Give the edits in the JSON, or with --set and --clear, not both.");
    let list: unknown;
    try {
      list = JSON.parse(c.positional[0] === "-" ? await readStdin() : readFileSync(userPath(c.positional[0]!), "utf8"));
    } catch (e) {
      return fail(c.json, `The edits are not JSON: ${(e as Error).message}`);
    }
    if (!Array.isArray(list) || !list.length) return fail(c.json, 'Give a JSON list of edits: [{ "ref": "XY123@2025-04-02", "set": { "seat": "14A" } }].');
    for (const [i, item] of list.entries()) {
      const e = item as { ref?: unknown; set?: unknown; clear?: unknown };
      const where = `edit ${i + 1}`;
      if (!e || typeof e !== "object" || typeof e.ref !== "string") return fail(c.json, `${where}: give "ref", the record's REF.`);
      const extra = Object.keys(e).filter((k) => !["ref", "set", "clear"].includes(k));
      if (extra.length) return fail(c.json, `${where}: unexpected keys ${extra.join(", ")}.`);
      const input: EditInput = {};
      for (const [k, v] of Object.entries((e.set ?? {}) as Record<string, unknown>)) {
        if (!(typeof v === "string" || typeof v === "number" || v === null)) return fail(c.json, `${where}: ${k} must be text or a number.`);
        input[k] = v === null ? null : String(v);
      }
      if (e.clear !== undefined && (!Array.isArray(e.clear) || e.clear.some((k) => typeof k !== "string"))) return fail(c.json, `${where}: "clear" is a list of field names.`);
      for (const k of (e.clear ?? []) as string[]) input[k] = null;
      const built = editOf(log, c.json, e.ref, input);
      changes.push(built.change);
      notes.push(...built.notes.map((n) => `${e.ref}: ${n}`));
    }
  } else {
    const input = await inputOf(c);
    if (!Object.keys(input).length) return fail(c.json, "Nothing to change: give --set FIELD=VALUE or --clear FIELD.");
    const built = editOf(log, c.json, c.positional[0]!, input);
    changes.push(built.change);
    notes.push(...built.notes);
  }
  return writeChanges(log, "edit", changes.filter((x) => !isEmptyChange(x)), c, notes);
}

export async function deleteCommand(args: string[]) {
  const c = parse(args, DELETE_HELP);
  if (!c.positional.length) return fail(c.json, "Which records? Give their REFs.");
  const log = await openOrFail(c.json, c.log);
  const changes: InboxChange[] = c.positional.map((text) => {
    const found = findRecord(log, text);
    if (!("row" in found)) return notFound(c.json, found);
    const row = log.store.get(found.row.table, found.row.id)!;
    return { op: "delete", table: found.row.table, id: row.id, rev: row.rev };
  });
  return writeChanges(log, "delete", changes, c);
}

/** `aircraft edit` and `aircraft merge`. */
export async function aircraftChangeCommand(args: string[]) {
  const [what, ...rest] = args;
  const c = parse(rest, AIRCRAFT_CHANGE_HELP, { sets: what === "edit" });
  const log = await openOrFail(c.json, c.log);
  const aircraft = (text: string) => {
    const found = findAircraft(log.store, text);
    return "row" in found ? log.store.get("airframes", found.row.id)! : notFound(c.json, found);
  };
  if (what === "merge") {
    if (c.positional.length !== 2) return fail(c.json, "Give the aircraft to keep (INTO) and the one to merge into it (FROM).");
    const into = aircraft(c.positional[0]!);
    const from = aircraft(c.positional[1]!);
    if (into.id === from.id) return fail(c.json, "Those are the same aircraft.");
    return writeChanges(log, "aircraft", [{ op: "merge", into: into.id, from: from.id }], c);
  }
  if (c.positional.length !== 1) return fail(c.json, "Which aircraft? Give its REF.");
  const input = await inputOf(c);
  if (!Object.keys(input).length) return fail(c.json, "Nothing to change: give --set FIELD=VALUE or --clear FIELD.");
  const built = airframeEdit(aircraft(c.positional[0]!), input);
  if ("error" in built) return fail(c.json, built.error);
  return writeChanges(log, "aircraft", isEmptyChange(built.change) ? [] : [built.change], c);
}

/** `issues accept`, `reopen` and `fix`. */
export async function issuesChangeCommand(args: string[]) {
  const [what, ...rest] = args;
  const c = parse(rest, ISSUES_CHANGE_HELP, { note: what === "accept" });
  const id = c.positional[0];
  if (!id || c.positional.length > (what === "fix" ? 2 : 1)) return fail(c.json, "Give the finding's id, from ./touchdown issues.");
  const log = await openOrFail(c.json, c.log);
  if (what === "reopen") {
    const acks = log.store.all("issue_acks").filter((a) => a.id === id || a.fingerprint === id);
    if (acks.length !== 1) return fail(c.json, acks.length ? `${acks.length} accepted findings fit ${id}; give the id from ./touchdown issues --accepted.` : `No accepted finding is ${id}. See ./touchdown issues --accepted.`, EXIT.notFound);
    return writeChanges(log, "issues", [{ op: "reopen", ackId: acks[0]!.id }], c);
  }
  const [rule, fp] = id.includes(":") ? id.split(":") : [null, id];
  const found = openFindings(log).filter((f) => f.fingerprint === fp && (!rule || f.ruleId === rule));
  if (found.length !== 1) return fail(c.json, found.length ? `${found.length} findings have the id ${id}; give it as RULE:${id}.` : `No open finding is ${id}. See ./touchdown issues (--severity all for notes).`, EXIT.notFound);
  const f = found[0]!;
  if (what === "accept") {
    if (f.severity === "error") return fail(c.json, `${RULES[f.ruleId]?.title ?? f.ruleId} is an error, which cannot be marked as right: fix the record instead.`);
    return writeChanges(log, "issues", [{ op: "accept", ruleId: f.ruleId, fingerprint: f.fingerprint, note: c.note?.trim() || null }], c);
  }
  const n = c.positional[1] === undefined ? 1 : Number(c.positional[1]);
  if (!f.fixes.length) return fail(c.json, "That finding has no suggested fix.", EXIT.notFound);
  if (!Number.isInteger(n) || n < 1 || n > f.fixes.length) return fail(c.json, `Choose a fix from 1 to ${f.fixes.length}.`);
  return writeChanges(log, "issues", [{ op: "fix", ruleId: f.ruleId, fingerprint: f.fingerprint, fix: n - 1 }], c);
}

export async function undoCommand(args: string[]) {
  const c = parse(args, UNDO_HELP);
  if (c.positional.length !== 1) return fail(c.json, "Give the import's id, from ./touchdown imports.");
  const log = await openOrFail(c.json, c.log);
  const batch = log.store.get("import_batches", c.positional[0]!);
  if (!batch) return fail(c.json, `No import is ${c.positional[0]}. See ./touchdown imports.`, EXIT.notFound);
  return writeChanges(log, "undo", [{ op: "undo", batchId: batch.id }], c);
}

export async function familiesCommand(args: string[]) {
  const c = parse(args, FAMILIES_HELP);
  const log = await openOrFail(c.json, c.log);
  const [what, type, family] = c.positional;
  if (!what) {
    const list = log.store.all("family_overrides").map((o) => ({ type: o.designator, typeName: typeName(o.designator, log.ref), family: o.familyId, familyName: log.ref.family(o.familyId)?.name ?? o.familyId }));
    if (c.json) return printJson({ ok: true, from: log.from, families: list });
    console.log(list.length ? `${bold(plural(list.length, "type"))} counted in another family than its own:` : "Every type is counted in its own family.");
    for (const x of list) console.log(`  ${x.type}  ${x.typeName}  in ${x.familyName}`);
    return;
  }
  const designator = type?.toUpperCase();
  if ((what !== "set" && what !== "remove") || !designator || (what === "set" ? !family : family !== undefined)) return fail(c.json, FAMILIES_HELP);
  if (!log.ref.type(designator)) return fail(c.json, `${type} is not an ICAO type code.`);
  if (what === "remove") return writeChanges(log, "families", [{ op: "family", designator, familyId: null }], c);
  const fam = log.ref.family(family) ?? log.ref.family(family!.toUpperCase()) ?? [...log.ref.families.values()].find((x) => x.name.toLowerCase() === family!.toLowerCase());
  if (!fam) return fail(c.json, `${family} is not a family. Families: ${[...log.ref.families.values()].map((x) => x.id).join(", ")}.`);
  return writeChanges(log, "families", [{ op: "family", designator, familyId: fam.id }], c);
}

const SETTINGS: Record<string, [keyof LogSettings, readonly string[]]> = {
  codes: ["codeDisplay", ["iata", "icao", "both"]],
  distance: ["distanceUnit", ["km", "mi", "nm"]],
  models: ["modelNaming", ["standard", "compact"]],
};

export async function settingsCommand(args: string[]) {
  const c = parse(args, SETTINGS_HELP);
  const log = await openOrFail(c.json, c.log);
  if (!c.positional.length) {
    const now = { codes: log.codes, distance: log.unit, models: log.models };
    if (c.json) return printJson({ ok: true, from: log.from, settings: now });
    for (const [k, v] of Object.entries(now)) console.log(`${dim(k.padEnd(8))}  ${v}`);
    return;
  }
  if (c.positional.length % 2) return fail(c.json, SETTINGS_HELP);
  const set: LogSettings = {};
  for (let i = 0; i < c.positional.length; i += 2) {
    const [name, value] = [c.positional[i]!, c.positional[i + 1]!.toLowerCase()];
    const s = SETTINGS[name];
    if (!s) return fail(c.json, `There is no setting ${name}. Settings: ${Object.keys(SETTINGS).join(", ")}.`);
    if (!s[1].includes(value)) return fail(c.json, `${name} is one of ${s[1].join(", ")}.`);
    (set as Record<string, string>)[s[0]] = value;
  }
  return writeChanges(log, "settings", [{ op: "settings", set }], c);
}
