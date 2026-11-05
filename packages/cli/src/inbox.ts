// `touchdown inbox` (docs/21, "Getting a session to the web app"): what spot and add saved, waiting for review in the
// web app. With storage chosen it is the inbox in the user's storage; without, data/private/inbox/.

import { t } from "@touchdown/i18n/cli";
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync } from "node:fs";
import { basename, join } from "node:path";
import { createInterface } from "node:readline/promises";
import { FIELD_DEFS, INBOX_PRIVATE_FIELDS, matchCandidates, readInbox, Store, type InboxFile, type RefIndex } from "@touchdown/core";
import { planChanges } from "@touchdown/core/view";
import { INBOX_DIR, inboxPlace, loadLog, writeInboxFile, type InboxPlace } from "./log.ts";
import { shownPath, userPath } from "./paths.ts";
import { chosenStorage } from "./storage.ts";
import { bold, dim, green, red, tc, units } from "./term.ts";

export const inboxHelp = () => t("cli.help.inbox");

/** The commands that write change files (docs/34), by the name they give them. */
export const CHANGE_COMMANDS = ["edit", "delete", "track", "tracks", "aircraft", "airframes", "issues", "undo", "families", "settings", "stats"] as const;

/** "Spotting session, 2026-10-22 23:37", "Changes from ./touchdown edit, …", from the names the commands give their files. */
export function fileLabel(name: string): string {
  const file = /^import-(\d{4}-\d{2}-\d{2})-(\d{2})(\d{2})\d{2}-(.+?)(?:-\d+)?\.json$/.exec(name);
  if (file) return t("cliWrite.inbox.label.import", { file: file[4]!, when: `${file[1]} ${file[2]}:${file[3]}` });
  const m = new RegExp(`^(spot|sheet|add|${CHANGE_COMMANDS.join("|")})-(\\d{4}-\\d{2}-\\d{2})-(\\d{2})(\\d{2})`).exec(name);
  if (!m) return name;
  const when = `${m[2]} ${m[3]}:${m[4]}`;
  return t("cliWrite.inbox.label.other", { command: m[1]!, when });
}

/** A record's values to show: a private one (by its field, or a spreadsheet column holding one) only as given. */
const shownValues = (raw: Record<string, string | null>, privateColumns: Set<string>) =>
  Object.fromEntries(Object.entries(raw).filter(([, v]) => v !== null).map(([k, v]) => [k, (INBOX_PRIVATE_FIELDS as readonly string[]).includes(k) || privateColumns.has(k) ? t("cliWrite.inbox.given") : v]));

const plainName = (name: string) => /^[A-Za-z0-9._-]+\.json$/.test(name);

async function readFile(place: InboxPlace, name: string, ref: RefIndex) {
  const data = await place.read(name);
  if (!data) return { error: t("cliWrite.inbox.notInInbox"), missing: true } as const;
  let json: unknown;
  try {
    json = JSON.parse(new TextDecoder().decode(data));
  } catch {
    return { error: t("cliWrite.inbox.notJson") } as const;
  }
  const r = readInbox(json, name, ref);
  if ("error" in r) return r;
  // A spreadsheet from ./touchdown import: its columns, and which of them hold private fields.
  const sheet = (json as InboxFile).sheet ?? null;
  const columns = sheet?.mapping ? sheet.mapping.fields.map((field, i) => ({ header: sheet.header[i]!, field })).filter((c) => c.field !== "ignore") : null;
  return { ...r, sheet, columns, privateColumns: new Set((columns ?? []).filter((c) => FIELD_DEFS[c.field].private).map((c) => c.header)) };
}

export async function inboxCommand(args: string[], ref: RefIndex): Promise<void> {
  const json = args.includes("--json");
  const yes = args.includes("--yes");
  const [what, ...rest] = args.filter((a) => a !== "--json" && a !== "--yes");
  const fail = (message: string, code = 2): never => {
    if (json) console.log(JSON.stringify({ ok: false, error: message }, null, 2));
    else console.error(red(message));
    process.exit(code);
  };
  if (what === "--help" || what === "-h" || (what && !["show", "remove", "send"].includes(what)) || ((what === "show" || what === "remove") && rest.length !== 1) || (!what && rest.length)) {
    console.log(inboxHelp());
    process.exit(what === "--help" || what === "-h" ? 0 : 2);
  }

  let storage;
  try {
    storage = await chosenStorage();
  } catch (e) {
    return fail((e as Error).message);
  }
  const place = inboxPlace(storage);

  if (what === "send") {
    if (!storage) return fail(t("cliWrite.inbox.noStorage"));
    const files = rest.length ? rest.map(userPath) : existsSync(INBOX_DIR) ? readdirSync(INBOX_DIR).filter((n) => n.endsWith(".json")).map((n) => join(INBOX_DIR, n)) : [];
    if (!files.length) return void (json ? console.log(JSON.stringify({ ok: true, sent: [] })) : console.log(t("cliWrite.inbox.nothingToSend")));
    const sent: string[] = [];
    for (const path of files) {
      const name = basename(path);
      let file: InboxFile;
      try {
        file = JSON.parse(readFileSync(path, "utf8")) as InboxFile;
        const r = readInbox(file, name, ref);
        if ("error" in r) throw new Error(r.error);
        await writeInboxFile(place, name, file, ref);
      } catch (e) {
        return fail(`${shownPath(path)}: ${(e as Error).message}`);
      }
      if (path.startsWith(INBOX_DIR)) {
        mkdirSync(join(INBOX_DIR, "sent"), { recursive: true });
        renameSync(path, join(INBOX_DIR, "sent", name));
      }
      sent.push(name);
      if (!json) console.log(tc("cliWrite.inbox.sent", { name, place: place.name }, { green }));
    }
    if (json) console.log(JSON.stringify({ ok: true, sent, place: place.name }, null, 2));
    return;
  }

  if (what === "show" || what === "remove") {
    const name = rest[0]!;
    if (!plainName(name)) return fail(t("cliWrite.inbox.plainName", { name }));
    const r = await readFile(place, name, ref);
    if ("missing" in r) return fail(t("cliWrite.inbox.notIn", { name, place: place.name }));
    if (what === "show") {
      if ("error" in r) return fail(t("cliWrite.inbox.unreadable", { name, error: String(r.error) }));
      const records = r.source.candidates.map((c) => ({ kind: c.table === "flights" ? "flight" : "sighting", values: shownValues(c.raw, r.privateColumns), open: c.issues.map((i) => i.message) }));
      const sheet = r.sheet ? { file: r.sheet.fileName, sheet: r.sheet.name, rows: r.sheet.rows.length, columns: r.columns } : null;
      // Changes are shown as the review shows them, against the log as it is now; private values only as changed.
      let changes: ReturnType<typeof planChanges>["changes"] = [];
      if (r.changes.length) {
        let log;
        try {
          log = await loadLog(ref, { storage });
        } catch (e) {
          return fail((e as Error).message);
        }
        changes = planChanges(log.store ?? new Store({ deviceId: "cli", validate: false }), ref, r.changes).changes;
      }
      if (json) console.log(JSON.stringify({ ok: true, name, place: place.name, ...(sheet ? { sheet } : {}), records, changes: changes.map((c) => ({ action: c.action, title: c.title, status: c.status, note: c.note, lines: c.lines.map(({ label, before, after }) => ({ label, before, after })) })) }, null, 2));
      else {
        console.log(tc("cliWrite.inbox.show.title", { label: fileLabel(name), name, place: place.name }, { bold, dim }));
        if (sheet) {
          console.log(`  ${t("cliWrite.inbox.show.sheet", { file: sheet.file, tabbed: sheet.sheet !== sheet.file ? "yes" : "no", sheet: sheet.sheet, rows: sheet.rows })}`);
          console.log(dim(`  ${sheet.columns ? t("cliWrite.inbox.show.columns", { columns: sheet.columns.map((c) => `${c.header} → ${c.field}`).join(", ") }) : t("cliWrite.inbox.show.myFr24")}`));
        }
        for (const rec of records) {
          console.log(`  ${t("cliWrite.inbox.show.record", { kind: rec.kind, values: Object.entries(rec.values).map(([k, v]) => `${k} ${v}`).join(", ") })}`);
          for (const o of rec.open) console.log(dim(`    ${t("cliWrite.inbox.show.open", { problem: o })}`));
        }
        for (const c of changes) {
          console.log(`  ${c.action}: ${c.title}${c.status === "pending" ? "" : dim(` (${c.note ?? c.status})`)}`);
          for (const l of c.lines) console.log(`    ${dim(l.label)}  ${l.before || "-"} → ${l.after || "-"}`);
        }
      }
      return;
    }
    if (!yes) {
      if (!process.stdin.isTTY) return fail(t("cliWrite.inbox.removeNeedsYes", { name }));
      const rl = createInterface({ input: process.stdin, output: process.stdout });
      const a = (await rl.question(t("cliWrite.inbox.removeAsk", { name, place: place.name }))).trim().toLowerCase();
      rl.close();
      if (a !== "y" && a !== "yes") return void console.log(t("cliWrite.inbox.kept"));
    }
    await place.remove(name);
    if ((await place.list()).includes(name)) return fail(t("cliWrite.inbox.stillThere", { name, place: place.name }));
    if (json) console.log(JSON.stringify({ ok: true, removed: name, place: place.name }, null, 2));
    else console.log(t("cliWrite.inbox.deleted", { name, place: place.name }));
    return;
  }

  // The list: each file, and how many of its records are not in the log yet.
  let log;
  try {
    log = await loadLog(ref, { storage });
  } catch (e) {
    return fail((e as Error).message);
  }
  const store = log.store ?? new Store({ deviceId: "cli", validate: false });
  const files = [];
  for (const name of await place.list()) {
    const r = await readFile(place, name, ref);
    if ("error" in r) {
      files.push({ name, label: fileLabel(name), error: r.error });
      continue;
    }
    const cs = r.source.candidates;
    const waiting = matchCandidates(store, cs).filter((m) => m.kind === "new" || m.kind === "update" || m.kind === "conflict").length;
    const changes = r.changes.length ? planChanges(store, ref, r.changes).open : 0;
    files.push({ name, label: fileLabel(name), flights: cs.filter((c) => c.table === "flights").length, sightings: cs.filter((c) => c.table === "sightings").length, changes: r.changes.length, waiting: waiting + changes });
  }
  if (json) {
    console.log(JSON.stringify({ ok: true, place: place.name, shared: place.shared, checkedAgainst: log.from, files }, null, 2));
    return;
  }
  console.log(tc("cliWrite.inbox.list.title", { place: place.name, shared: place.shared ? "yes" : "no" }, { bold, dim }));
  if (!files.length) console.log(`  ${t("cliWrite.inbox.list.empty")}`);
  for (const f of files) {
    if ("error" in f) console.log(`  ${f.name}  ${red(t("cliWrite.inbox.list.unreadable", { error: String(f.error) }))}`);
    else {
      const counts = units([f.flights ? t("cli.count.flights", { count: f.flights }) : null, f.sightings ? t("cli.count.sightings", { count: f.sightings }) : null, f.changes ? t("cli.count.changes", { count: f.changes }) : null].filter((x): x is string => !!x));
      console.log(`  ${f.name}  ${t("cliWrite.inbox.list.file", { label: f.label, counts, waiting: f.waiting })}`);
    }
  }
}
