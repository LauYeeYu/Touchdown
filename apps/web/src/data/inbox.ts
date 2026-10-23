// Sightings from spotting sessions (`touchdown spot`, docs/21) waiting to be added to the log. In development the
// dev server reads data/private/inbox/ (vite.config.ts); on the hosted site this will be the inbox folder in the
// user's Google Drive, read during sync. Each file is one session. The user reviews it on the Import page; once
// imported it leaves the inbox, and so does a file whose sightings are all in the log already.

import { useEffect, useSyncExternalStore } from "react";
import { matchCandidates, readInbox, type ParsedSource } from "@touchdown/core";
import { dayMonthYear } from "../lib/format.ts";
import type { AppData } from "./app.ts";

export interface WaitingSession {
  name: string;
  modified: number;
  source: ParsedSource;
  /** Sightings that are not in the log yet, or that would fill in or change a record there. */
  waiting: number;
}

let current: WaitingSession[] = [];
const listeners = new Set<() => void>();
let running: Promise<void> | null = null;

// The dev server answers only requests that carry this header (vite.config.ts).
const HEADERS = { "X-Touchdown": "1" };

async function post(action: "imported" | "discard", name: string): Promise<void> {
  await fetch(`/__local/inbox/${action}?name=${encodeURIComponent(name)}`, { method: "POST", headers: HEADERS }).catch(() => null);
}

async function read(app: AppData): Promise<void> {
  const res = await fetch("/__local/inbox", { cache: "no-store", headers: HEADERS }).catch(() => null);
  if (!res?.ok) return;
  const files = (await res.json()) as { name: string; modified: number; file: unknown }[];
  const next: WaitingSession[] = [];
  for (const f of files) {
    // A file that does not read (being written, or from another version) is left for next time.
    const r = readInbox(f.file, f.name, app.ref);
    if ("error" in r) continue;
    const waiting = matchCandidates(app.store, r.source.candidates).filter((m) => m.kind === "new" || m.kind === "update" || m.kind === "conflict").length;
    if (waiting) next.push({ name: f.name, modified: f.modified, source: r.source, waiting });
    else await post("imported", f.name);
  }
  current = next.sort((a, b) => a.modified - b.modified);
  for (const l of listeners) l();
}

/** Looks at the inbox again (development only). */
export function refreshInbox(app: AppData): Promise<void> {
  if (!import.meta.env.DEV) return Promise.resolve();
  running ??= read(app).finally(() => (running = null));
  return running;
}

/** The session was imported: it leaves the inbox. */
export async function markImported(app: AppData, name: string): Promise<void> {
  await post("imported", name);
  await refreshInbox(app);
}

/** The user does not want the session: its file is deleted. */
export async function discardSession(app: AppData, name: string): Promise<void> {
  await post("discard", name);
  await refreshInbox(app);
}

/** The sessions waiting, oldest first. */
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
 * Keeps the list up to date while the app is open: on opening, when the tab comes back into view (the user has
 * been typing in the terminal), every 30 seconds, and when the log changes. Used once, in the shell.
 */
export function useInboxWatcher(app: AppData, version: number): void {
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const look = () => {
      if (document.visibilityState === "visible") void refreshInbox(app);
    };
    look();
    const timer = setInterval(look, 30_000);
    window.addEventListener("focus", look);
    document.addEventListener("visibilitychange", look);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", look);
      document.removeEventListener("visibilitychange", look);
    };
  }, [app, version]);
}

/**
 * "Spotting session, 22 Oct 2026 at 23:37", or "spotting.xlsx, read on 22 Oct 2026 at 23:37" for a spreadsheet,
 * from the file name `spot` gives it; the name itself otherwise.
 */
export function sessionLabel(name: string): string {
  const typed = /^spot-(\d{4}-\d{2}-\d{2})-(\d{2})(\d{2})/.exec(name);
  if (typed) return `Spotting session, ${dayMonthYear(typed[1]!)} at ${typed[2]}:${typed[3]}`;
  const sheet = /^sheet-(\d{4}-\d{2}-\d{2})-(\d{2})(\d{2})-(.+)\.json$/.exec(name);
  if (sheet) return `Spreadsheet ${sheet[4]}, read on ${dayMonthYear(sheet[1]!)} at ${sheet[2]}:${sheet[3]}`;
  return name;
}

/** The session in a sentence: "your spotting session of 22 Oct 2026 at 23:37", "the spreadsheet spotting.xlsx (…)". */
export function sessionPhrase(name: string): string {
  const label = sessionLabel(name);
  if (label.startsWith("Spotting session, ")) return label.replace(/^Spotting session, /, "your spotting session of ");
  if (label.startsWith("Spreadsheet ")) return label.replace(/^Spreadsheet (.+), read on (.+)$/, "the spreadsheet $1 (read on $2)");
  return label;
}
