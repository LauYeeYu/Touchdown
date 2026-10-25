// `touchdown review [NAME]` (docs/34, "The review"): a file waiting in the inbox reviewed in the terminal and imported
// into the log, as the Import page does it and with the same core code: records with what they add, fill in or
// change, changes before and after, and the findings they would bring. The user decides what the Import page lets
// them decide, one question at a time with the safe answer as the default. The import is one batch, sent to the
// log in the user's storage as the web app sends its own changes (write.ts); the file is then kept with the import.
// Private values (ticket numbers, booking references) are never printed.

import { createInterface } from "node:readline/promises";
import { applyChanges, commitImport, INBOX_PRIVATE_FIELDS, prepareImport, readInbox, settingsOf, type ChangeStatus, type CommitDecision, type FieldDiff, type Finding, type InboxChange, type Match, type ParsedSource, type PreparedImport } from "@touchdown/core";
import { airlineLabel, airportWithCode, CABIN_LABEL, dateTimeLabel, FIELD_LABEL, PHASE_LABEL, planChanges, takeByDefault, type ChangePlan } from "@touchdown/core/view";
import { fileLabel } from "./inbox.ts";
import { inboxPlace } from "./log.ts";
import { EXIT, fail, plain, printJson } from "./read.ts";
import { findingJson } from "./shape.ts";
import { bold, dim, green, plural, red, yellow } from "./term.ts";
import { openForWriting, sendChanges, type WritableLog } from "./write.ts";

export const REVIEW_HELP = `Usage: ./touchdown review [NAME] [--yes] [--json]

Reviews a file waiting in the inbox (the oldest, or NAME from ./touchdown inbox) and imports it into your log, as
the web app's Import page does. Records show as new, as filling in a record of your log, or as differing from one;
changes to records show before and after; then the findings they would bring. You are asked, with the safe answer
as the default:

  a value that differs from your log      take the file's value?        (no: your log's stays)
  a takeoff moved past midnight           keep the move?                (yes)
  a change to a record edited since       make the change anyway?       (no)
  and at the end                          import?                       (no)

The import is one batch: undo it on the Import page, or with ./touchdown undo. Your log is read from the storage
chosen with ./touchdown storage and the import sent to it as the web app sends its own changes; what could not be
sent (offline) is kept in data/private/cli-sync.json and sent by the next run. The file then leaves the inbox and is
kept with the import.

  --yes    import with every answer at its default, without asking
  --json   print the review as JSON without importing; with --yes, import and print the result

Ticket numbers and booking references are never printed, only whether a file gives them.

Exit status: 0 imported, or nothing to import; 1 not imported (you said no); 2 the storage or the file could not
be read.`;

const PRIVATE = new Set<string>(INBOX_PRIVATE_FIELDS);

/** A value of a stored field as the review shows it. */
function shown(w: WritableLog, field: string, v: unknown): string {
  if (v === null || v === undefined || v === "") return "empty";
  if (PRIVATE.has(field)) return "(private)";
  if (field === "airlineId" || field === "operatorId" || field === "operatingAirlineId") return airlineLabel(v as string, w.ref) || String(v);
  if (/AirportId$|^airportId$/.test(field)) return plain(airportWithCode(v as string, w.ref, null)) || String(v);
  if (field.endsWith("At")) return plain(dateTimeLabel(v as string)) || String(v);
  if (field === "phase") return PHASE_LABEL[v as string] ?? String(v);
  if (field === "cabinClass") return CABIN_LABEL[v as string] ?? String(v);
  return String(v);
}

const label = (field: string) => FIELD_LABEL[field] ?? field;

/** What a row is: "Flight BA117 on 2026-10-18, LHR → JFK", "Sighting G-ABCD at EGLL on 2026-10-20". */
function rowTitle(m: Match): string {
  const c = m.candidate;
  if (c.table === "flights") {
    const v = c.values;
    const head = [`Flight ${v.flightNumber ?? v.registration ?? ""}`.trim(), v.scheduledDate && `on ${v.scheduledDate}`].filter(Boolean).join(" ");
    return [head, (v.fromRaw || v.toRaw) && `${v.fromRaw ?? "?"} → ${v.toRaw ?? "?"}`].filter(Boolean).join(", ");
  }
  const v = c.values;
  return [`Sighting ${v.registration ?? v.registrationRaw ?? ""}`.trim(), v.airportRaw && `at ${v.airportRaw}`, v.seenOn && `on ${v.seenOn}`].filter(Boolean).join(" ");
}

const KIND: Record<Match["kind"], string> = { new: "new", update: "fills in", conflict: "differs", identical: "in your log", duplicate: "repeats" };

/** A raw value and the field resolved from it: one question between them. */
const RESOLVED: Record<string, string> = {
  airlineRaw: "airlineId",
  fromRaw: "fromAirportId",
  toRaw: "toAirportId",
  operatorRaw: "operatorId",
  airportRaw: "airportId",
  registrationRaw: "registration",
  typeCodeRaw: "typeCode",
  modelRaw: "model",
};
const RAW_OF = Object.fromEntries(Object.entries(RESOLVED).map(([raw, field]) => [field, raw]));

/** A conflict's fields as the user decides them: a raw value and its resolved form are one question. */
function questions(m: Match): FieldDiff[] {
  const fields = new Set(m.conflicts.map((d) => d.field));
  return m.conflicts.filter((d) => !(RESOLVED[d.field] && fields.has(RESOLVED[d.field]!)));
}

interface Ask {
  (question: string, yes: boolean): Promise<boolean>;
}

function asker(interactive: boolean): { ask: Ask; close: () => void } {
  if (!interactive) return { ask: async (_q, yes) => yes, close: () => {} };
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return {
    ask: async (q, yes) => {
      const a = (await rl.question(`${q} ${dim(yes ? "[Y/n]" : "[y/N]")} `)).trim().toLowerCase();
      return a ? a === "y" || a === "yes" : yes;
    },
    close: () => rl.close(),
  };
}

const findingLine = (f: Finding) => `${f.severity === "error" ? red("!") : yellow("?")} ${f.message} ${dim(f.ruleId)}`;

export async function reviewCommand(args: string[]) {
  if (args.includes("--help") || args.includes("-h")) {
    console.log(REVIEW_HELP);
    process.exit(EXIT.ok);
  }
  const json = args.includes("--json");
  const yes = args.includes("--yes");
  const rest = args.filter((a) => a !== "--json" && a !== "--yes");
  const unknown = rest.filter((a) => a.startsWith("--"));
  if (unknown.length || rest.length > 1) return fail(json, `${unknown.length ? `There is no option ${unknown[0]}.` : "Give one file name."}\n\n${REVIEW_HELP}`);
  const interactive = !yes && !json;
  if (interactive && !process.stdin.isTTY) return fail(json, "review asks its questions at a terminal. Give --yes to import with the default answers, or --json to print the review.");
  const say = (line: string) => {
    if (!json) console.error(dim(line));
  };

  let w: WritableLog;
  try {
    w = await openForWriting(say);
  } catch (e) {
    return fail(json, (e as Error).message);
  }
  if (w.resent) say(`Sent ${plural(w.resent, "row")} an earlier run had not finished sending.`);
  for (const p of w.problems) say(`Could not read ${p}.`);

  // The file: the one named, or the oldest waiting.
  const place = inboxPlace(w.storage);
  const names = await place.list();
  const given = rest[0];
  if (given && !names.includes(given)) return fail(json, `${given} is not in ${place.name}. See ./touchdown inbox.`, EXIT.problem);
  const files: { name: string; data: Uint8Array; json: unknown; createdAt: string }[] = [];
  for (const name of given ? [given] : names) {
    const data = await place.read(name);
    if (!data) continue;
    try {
      const parsed = JSON.parse(new TextDecoder().decode(data)) as { createdAt?: string };
      files.push({ name, data, json: parsed, createdAt: parsed.createdAt ?? name });
    } catch {
      if (given) return fail(json, `${given} is not valid JSON.`);
    }
  }
  files.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const file = files[0];
  if (!file) {
    if (json) printJson({ ok: true, file: null, imported: null });
    else console.log(`Nothing is waiting in ${place.name}.`);
    process.exit(EXIT.ok);
  }
  const read = readInbox(file.json, file.name, w.ref);
  if ("error" in read) return fail(json, `${file.name} does not read: ${read.error}.`);

  const settings = settingsOf(w.store);
  const prepared: PreparedImport | null = read.source.candidates.length ? prepareImport(w.store, w.ref, read.source) : null;
  const plan: ChangePlan | null = read.changes.length ? planChanges(w.store, w.ref, read.changes, { codes: settings.codeDisplay ?? "iata", unit: settings.distanceUnit, models: settings.modelNaming }) : null;
  const { ask, close } = asker(interactive);

  try {
    if (!json) console.log(`${bold(fileLabel(file.name))} ${dim(`(${file.name}, ${place.name})`)}${files.length > 1 ? dim(`; ${files.length - 1} more waiting`) : ""}`);

    // Records: what each row does; questions where the Import page lets the user decide.
    const decisions = new Map<number, CommitDecision>();
    if (prepared) {
      if (!json) console.log("");
      for (const [i, m] of prepared.matches.entries()) {
        if (m.kind === "identical") continue;
        const c = m.candidate;
        const given = c.table === "flights" ? INBOX_PRIVATE_FIELDS.filter((f) => !!(c.values as Record<string, unknown>)[f]) : [];
        if (!json) {
          const mark = m.kind === "conflict" ? yellow("≠") : m.kind === "update" ? green("+") : green("✓");
          console.log(`${mark} ${bold(rowTitle(m))}  ${dim(KIND[m.kind])}${given.length ? dim(` · ${given.map((f) => label(f).toLowerCase()).join(" and ")} given`) : ""}`);
          if (m.kind === "update" && m.fills.length) console.log(`    ${dim("fills")} ${m.fills.filter((x) => !x.endsWith("Raw")).map(label).join(", ")}`);
          for (const issue of c.issues.filter((x) => x.severity !== "info")) console.log(`    ${yellow("?")} ${issue.message}`);
          for (const f of prepared.findings.get(i) ?? []) console.log(`    ${findingLine(f)}`);
        }
        const d: CommitDecision = {};
        for (const q of questions(m)) {
          if (!json) console.log(`    ${label(q.field)}: your log ${shown(w, q.field, q.existing)}, the file ${shown(w, q.field, q.incoming)}`);
          const pair = [q.field, RAW_OF[q.field], RESOLVED[q.field]].filter((f): f is string => !!f && f in c.values);
          if (await ask(`    Take the file's ${label(q.field).toLowerCase()}?`, false)) d.takeIncoming = [...(d.takeIncoming ?? []), ...new Set(pair)];
        }
        if (m.corrections.length) {
          if (!json) console.log(`    ${m.corrections[0]!.reason} ${m.corrections.map((x) => `${label(x.field)} ${shown(w, x.field, x.existing)} → ${shown(w, x.field, x.incoming)}`).join(", ")}`);
          if (!(await ask("    Keep the move to the next day?", true))) d.rejectCorrections = m.corrections.map((x) => x.field);
        }
        if (Object.keys(d).length) decisions.set(i, d);
      }
    }

    // Changes: the plan; a change to a record edited since is asked about.
    const chosen = new Map<number, boolean>();
    if (plan) {
      if (!json) console.log("");
      for (const p of plan.changes) {
        if (!json) {
          const mark = p.status === "pending" ? green("✓") : p.status === "changed" ? yellow("?") : dim("–");
          console.log(`${mark} ${bold(p.action)}  ${plain(p.title)}${p.status === "pending" ? "" : dim(`  ${p.note ?? p.status}`)}`);
          if (p.status === "pending" && p.note) console.log(`    ${yellow(p.note)}`);
          const width = Math.max(0, ...p.lines.map((l) => l.label.length));
          for (const l of p.lines) console.log(`    ${dim(l.label.padEnd(width))}  ${plain(l.before) || dim("-")} → ${plain(l.after) || dim("-")}`);
        }
        if (p.status === "changed") chosen.set(p.index, await ask("    Make this change anyway?", false));
      }
      if (!json && plan.findings.length) {
        console.log(`\n${bold("Findings these changes bring")}`);
        for (const f of plan.findings) console.log(`  ${findingLine(f)}`);
      }
    }
    const take = (i: number, status: ChangeStatus) => chosen.get(i) ?? takeByDefault(i, status);

    const rows = prepared ? prepared.matches.filter((m) => m.kind !== "identical").length : 0;
    const changes = plan ? plan.changes.filter((p) => (p.status === "pending" || p.status === "changed") && take(p.index, p.status)).length : 0;
    const what = [rows ? plural(rows, "row") : null, changes ? plural(changes, "change") : null].filter(Boolean).join(" and ");

    if (json && !yes) {
      printJson({
        ok: true,
        file: file.name,
        place: place.name,
        rows: (prepared?.matches ?? []).map((m, i) => ({
          kind: m.kind,
          title: rowTitle(m),
          fills: m.fills,
          differs: questions(m).map((q) => ({ field: q.field, label: label(q.field), yours: shown(w, q.field, q.existing), file: shown(w, q.field, q.incoming) })),
          corrections: m.corrections.map((x) => ({ field: x.field, from: shown(w, x.field, x.existing), to: shown(w, x.field, x.incoming), reason: x.reason })),
          findings: (prepared!.findings.get(i) ?? []).map(findingJson),
        })),
        changes: (plan?.changes ?? []).map((p) => ({ action: p.action, title: p.title, status: p.status, note: p.note, lines: p.lines.map(({ label: l, before, after }) => ({ label: l, before, after })) })),
        findings: (plan?.findings ?? []).map(findingJson),
        wouldImport: { rows, changes },
      });
      process.exit(EXIT.ok);
    }

    if (!rows && !changes) {
      // As the web app does: a file with nothing left to do leaves the inbox.
      await place.remove(file.name);
      if (json) printJson({ ok: true, file: file.name, imported: null, note: "nothing to import; the file was removed from the inbox" });
      else console.log(`\nNothing to import: everything in it is in your log already. ${file.name} is removed from the inbox.`);
      process.exit(EXIT.ok);
    }
    if (interactive && !(await ask(`\nImport ${what} into your log in ${w.storage.name}?`, false))) {
      console.log("Not imported. The file stays in the inbox.");
      process.exit(EXIT.notFound);
    }

    // The import: one batch for the rows, one for the changes, then sent.
    const batches: string[] = [];
    const messages: string[] = [];
    if (prepared && rows) batches.push(commitImport(w.store, w.ref, prepared.source as ParsedSource, prepared.matches, decisions).batchId);
    if (plan && changes) {
      const r = applyChanges(w.store, w.ref, read.changes as InboxChange[], take, { fileName: file.name });
      batches.push(r.batchId);
      messages.push(...r.messages);
    }
    say(`Sending to ${w.storage.name}…`);
    let sent: { sent: number; waiting: number };
    try {
      sent = await sendChanges(w);
    } catch (e) {
      return fail(json, `The import was made but could not all be sent: ${(e as Error).message}. It is kept in data/private/cli-sync.json and sent by the next run of review; the file stays in the inbox.`);
    }
    // The file leaves the inbox with the import, unless it was saved again since it was read.
    const now = await place.read(file.name);
    const unchanged = !!now && now.length === file.data.length && now.every((b, i) => b === file.data[i]);
    if (unchanged) await place.imported(file.name, batches[0]!, file.data);

    if (json) printJson({ ok: true, file: file.name, imported: { rows, changes, batches }, messages, waiting: sent.waiting, fileKept: unchanged ? "with the import" : "in the inbox (saved again since it was read)" });
    else {
      console.log(`\n${green("Imported")} ${what} into your log in ${w.storage.name}.${messages.length ? ` ${messages.join(" ")}` : ""}`);
      if (sent.waiting) console.log(yellow(`${plural(sent.waiting, "row")} not confirmed by the storage yet: sent again by the next run.`));
      console.log(dim(unchanged ? "The file is kept with the import. Undo it on the Import page or with ./touchdown undo." : "The file was saved again since it was read, so it stays in the inbox."));
      if (files.length > 1) console.log(dim(`${plural(files.length - 1, "more file")} waiting: ./touchdown review.`));
    }
  } finally {
    close();
  }
}
