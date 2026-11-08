// Daily copies of the log in the user's storage (docs/12, "Daily copies"): a backup file made after the first sync of
// a day, unless the log has not changed since the newest copy, and the copies no longer kept removed. The same zip as
// the backup a user downloads, so it is restored the same way.

import { backupZip, dailyCopiesToKeep, dailyCopyName, logFingerprint, parseDailyCopyName, type Store } from "@touchdown/core";
import type { Backend } from "./types.ts";

export interface DailyCopyResult {
  /** The copy made, or null when today has one or the log is as the newest copy holds it. */
  made: string | null;
  /** Copies no longer kept, removed. */
  removed: string[];
}

/** The daily copies in the storage, newest first. */
export async function listDailyCopies(backend: Backend): Promise<{ name: string; day: string }[]> {
  return (await backend.listFiles("backups"))
    .map((f) => ({ name: f.name, day: parseDailyCopyName(f.name)?.day }))
    .filter((c): c is { name: string; day: string } => !!c.day)
    .sort((a, b) => b.day.localeCompare(a.day) || b.name.localeCompare(a.name));
}

/**
 * Make today's copy of the log and remove the copies no longer kept (core dailyCopiesToKeep). `store` must hold the
 * whole log as the storage has it, recorded tracks included: the caller makes the copy right after a sync. An empty
 * log gets no copy.
 */
export async function makeDailyCopy(backend: Backend, store: Store, today: string): Promise<DailyCopyResult> {
  const names = (await backend.listFiles("backups")).map((f) => f.name);
  const copies = names.map((n) => parseDailyCopyName(n)).filter((c) => c !== null);
  const newest = [...copies].sort((a, b) => a.day.localeCompare(b.day)).pop();
  let made: string | null = null;
  if (!copies.some((c) => c.day === today) && store.count("flights") + store.count("sightings") > 0) {
    const fingerprint = logFingerprint(store);
    if (newest?.fingerprint !== fingerprint) {
      made = dailyCopyName(today, fingerprint);
      await backend.writeFile("backups", made, backupZip(store));
      names.push(made);
    }
  }
  const keep = dailyCopiesToKeep(names, today);
  const removed = names.filter((n) => parseDailyCopyName(n) && !keep.has(n));
  for (const n of removed) await backend.removeFile("backups", n);
  return { made, removed };
}
