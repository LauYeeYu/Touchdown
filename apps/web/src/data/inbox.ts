// Records waiting to be added to the log (docs/21, "Getting a session to the web app"): sessions from
// `touchdown spot`, additions from `touchdown add` and changes from `touchdown edit` and the other changing commands
// (docs/34), one file each, in the inbox of the user's storage, read after each sync. In development the dev
// server's data/private/inbox/ is read as well (vite.config.ts). The user reviews a file on the Import page; once
// imported it leaves the inbox, and so does a file whose records are all in the log and whose changes are all done.

import { useEffect, useSyncExternalStore } from "react";
import { changeStatus, matchCandidates, readInbox, type InboxChange, type ParsedSource } from "@touchdown/core";
import { dayMonthYear, plural } from "../lib/format.ts";
import type { AppData } from "./app.ts";

export interface WaitingSession {
  name: string;
  /** In the user's storage, or in data/private/inbox/ through the dev server. */
  where: "storage" | "dev";
  /** When the file was last saved, in milliseconds. */
  modified: number;
  source: ParsedSource;
  /** Changes to records in the log (docs/34, "Change files"). */
  changes: InboxChange[];
  /** Records that are not in the log yet, or that would fill in or change a record there, and changes still to do. */
  waiting: number;
  flights: number;
  sightings: number;
  /** Changes still to do. */
  changing: number;
  /** The file as read, so a file saved again since is not removed with the import. */
  data: Uint8Array | null;
}

let current: WaitingSession[] = [];
const listeners = new Set<() => void>();
let running: Promise<void> | null = null;
const decoder = new TextDecoder();

/** The files as last read, by name; counted again against the log whenever it changes, without reading them again. */
interface InboxFile {
  json: unknown;
  where: WaitingSession["where"];
  modified: number;
  data: Uint8Array | null;
}
let files = new Map<string, InboxFile>();

// The dev server answers only requests that carry this header (vite.config.ts).
const HEADERS = { "X-Touchdown": "1" };

async function post(action: "imported" | "discard", name: string): Promise<void> {
  await fetch(`/__local/inbox/${action}?name=${encodeURIComponent(name)}`, { method: "POST", headers: HEADERS }).catch(() => null);
}

async function readFiles(app: AppData): Promise<Map<string, InboxFile>> {
  const out = new Map<string, InboxFile>();
  const inbox = app.sync?.inbox();
  if (inbox) {
    try {
      for (const name of await inbox.list()) {
        const data = await inbox.read(name);
        if (!data) continue;
        try {
          out.set(name, { json: JSON.parse(decoder.decode(data)), where: "storage", modified: 0, data });
        } catch {
          // Being written, or not JSON: read again next time.
        }
      }
    } catch {
      // The storage could not be read now; the sync state says why, and the next sync tries again.
    }
  }
  if (import.meta.env.DEV) {
    const res = await fetch("/__local/inbox", { cache: "no-store", headers: HEADERS }).catch(() => null);
    if (res?.ok) {
      for (const f of (await res.json()) as { name: string; modified: number; file: unknown }[]) {
        if (!out.has(f.name)) out.set(f.name, { json: f.file, where: "dev", modified: f.modified, data: null });
      }
    }
  }
  return out;
}

/** The files against the log as it is now. A file whose records are all in the log leaves the inbox. */
async function count(app: AppData): Promise<void> {
  const next: WaitingSession[] = [];
  for (const [name, f] of files) {
    // A file that does not read (from another version of Touchdown) is left for next time.
    const r = readInbox(f.json, name, app.ref);
    if ("error" in r) continue;
    const open = matchCandidates(app.store, r.source.candidates).filter((m) => m.kind === "new" || m.kind === "update" || m.kind === "conflict");
    // A change still to do, or one whose record was changed since (the user decides): without copying the log.
    const changing = r.changes.filter((c) => {
      const s = changeStatus(app.store, c, () => app.allFindings()).status;
      return s === "pending" || s === "changed";
    }).length;
    if (!open.length && !changing) {
      files.delete(name);
      if (f.where === "storage") await app.sync?.inbox()?.remove(name).catch(() => undefined);
      else await post("imported", name);
      continue;
    }
    const flights = open.filter((m) => m.candidate.table === "flights").length;
    const createdAt = Date.parse((f.json as { createdAt?: string }).createdAt ?? "");
    next.push({ name, where: f.where, modified: Number.isFinite(createdAt) ? createdAt : f.modified, source: r.source, changes: r.changes, waiting: open.length + changing, flights, sightings: open.length - flights, changing, data: f.data });
  }
  current = next.sort((a, b) => a.modified - b.modified);
  for (const l of listeners) l();
}

/** Reads the inbox again. */
export function refreshInbox(app: AppData): Promise<void> {
  running ??= readFiles(app)
    .then((f) => {
      files = f;
      return count(app);
    })
    .finally(() => (running = null));
  return running;
}

/**
 * The file was imported: it leaves the inbox, kept with the import in the storage. A file saved again since it was
 * read stays, for the records added to it.
 */
export async function markImported(app: AppData, name: string, batchId: string): Promise<void> {
  const w = current.find((x) => x.name === name);
  if (w?.where === "storage" && w.data) {
    const inbox = app.sync?.inbox();
    try {
      const now = await inbox?.read(name);
      if (inbox && now && now.length === w.data.length && now.every((b, i) => b === w.data![i])) await inbox.imported(name, batchId, w.data);
    } catch {
      // Left in the inbox; it holds nothing new now, so the next look removes it.
    }
  } else if (w?.where === "dev") await post("imported", name);
  await refreshInbox(app);
}

/** The user does not want the file: it is deleted. */
export async function discardSession(app: AppData, name: string): Promise<void> {
  const w = current.find((x) => x.name === name);
  if (w?.where === "storage") await app.sync?.inbox()?.remove(name).catch(() => undefined);
  else if (w?.where === "dev") await post("discard", name);
  await refreshInbox(app);
}

/** The files waiting, oldest first, as last read. */
export const waitingNow = (): WaitingSession[] => current;

/** The files waiting, oldest first. */
export function useWaitingSessions(): WaitingSession[] {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => current,
  );
}

/**
 * Keeps the list up to date while the app is open: the files are read after every sync (when the app opens, after
 * edits, when the tab comes back into view, every few minutes) and counted again when the log changes. In
 * development the local inbox is also read when the tab comes back into view and every 30 seconds. Used once, in
 * the shell.
 */
export function useInboxWatcher(app: AppData, version: number): void {
  // An edit or an import may put the records of a file in the log: counted again without reading the files.
  useEffect(() => {
    if (files.size) void count(app);
  }, [app, version]);

  useEffect(() => {
    let synced = app.getSyncInfo()?.lastAt ?? null;
    const unsubscribe = app.subscribeSync(() => {
      const at = app.getSyncInfo()?.lastAt ?? null;
      if (at !== synced) {
        synced = at;
        void refreshInbox(app);
      }
    });
    void refreshInbox(app);
    if (!import.meta.env.DEV) return unsubscribe;
    const look = () => {
      if (document.visibilityState === "visible") void refreshInbox(app);
    };
    const timer = setInterval(look, 30_000);
    window.addEventListener("focus", look);
    document.addEventListener("visibilitychange", look);
    return () => {
      unsubscribe();
      clearInterval(timer);
      window.removeEventListener("focus", look);
      document.removeEventListener("visibilitychange", look);
    };
  }, [app]);
}

/** "2 flights and 1 sighting", "3 changes". */
export function recordsText(flights: number, sightings: number, changes = 0): string {
  const parts = [flights ? plural(flights, "flight") : null, sightings ? plural(sightings, "sighting") : null, changes ? plural(changes, "change") : null].filter(Boolean) as string[];
  return parts.length > 1 ? `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}` : (parts[0] ?? "nothing");
}

/** The commands that write change files (docs/34), by the name they give them. */
const CHANGE_FILE = /^(edit|delete|aircraft|issues|undo|families|settings|stats)-(\d{4}-\d{2}-\d{2})-(\d{2})(\d{2})/;

/** Which command made the file, from the name it gave it. */
export const madeBy = (name: string) =>
  name.startsWith("add-") ? "./touchdown add" : name.startsWith("import-") ? "./touchdown import" : CHANGE_FILE.test(name) ? `./touchdown ${CHANGE_FILE.exec(name)![1]}` : "./touchdown spot";

/**
 * "Spotting session, 22 Oct 2026 at 23:37", "Spreadsheet spotting, read on …", "File flights.xlsx, read on …" or
 * "Added from the command line, 24 Oct 2026 at 10:15", from the name the command gives the file; the name itself
 * otherwise.
 */
export function sessionLabel(name: string): string {
  const typed = /^spot-(\d{4}-\d{2}-\d{2})-(\d{2})(\d{2})/.exec(name);
  if (typed) return `Spotting session, ${dayMonthYear(typed[1]!)} at ${typed[2]}:${typed[3]}`;
  const sheet = /^sheet-(\d{4}-\d{2}-\d{2})-(\d{2})(\d{2})\d{2}-(.+)\.json$/.exec(name);
  if (sheet) return `Spreadsheet ${sheet[4]}, read on ${dayMonthYear(sheet[1]!)} at ${sheet[2]}:${sheet[3]}`;
  const file = /^import-(\d{4}-\d{2}-\d{2})-(\d{2})(\d{2})\d{2}-(.+?)(?:-\d+)?\.json$/.exec(name);
  if (file) return `File ${file[4]}, read on ${dayMonthYear(file[1]!)} at ${file[2]}:${file[3]}`;
  const added = /^add-(\d{4}-\d{2}-\d{2})-(\d{2})(\d{2})/.exec(name);
  if (added) return `Added from the command line, ${dayMonthYear(added[1]!)} at ${added[2]}:${added[3]}`;
  const changed = CHANGE_FILE.exec(name);
  if (changed) return `Changes from the command line, ${dayMonthYear(changed[2]!)} at ${changed[3]}:${changed[4]}`;
  return name;
}

/**
 * Where the records came from, in a sentence: "your spotting session of 22 Oct 2026 at 23:37", "the spreadsheet
 * spotting.xlsx (…)", "the command line on 24 Oct 2026 at 10:15".
 */
export function sessionPhrase(name: string): string {
  const label = sessionLabel(name);
  if (label.startsWith("Spotting session, ")) return label.replace(/^Spotting session, /, "your spotting session of ");
  if (label.startsWith("Spreadsheet ")) return label.replace(/^Spreadsheet (.+), read on (.+)$/, "the spreadsheet $1 (read on $2)");
  if (label.startsWith("File ")) return label.replace(/^File (.+), read on (.+)$/, "the file $1 (read on $2)");
  if (label.startsWith("Added from the command line, ")) return label.replace(/^Added from the command line, /, "the command line on ");
  if (label.startsWith("Changes from the command line, ")) return label.replace(/^Changes from the command line, /, "the command line on ");
  return label;
}
