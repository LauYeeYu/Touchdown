// Development only: the owner's local backup (data/private/touchdown-backup.zip), served by the dev server
// (vite.config.ts). The production build never calls this.

import { readBackup } from "@touchdown/core";
import { nf } from "../lib/format.ts";
import type { AppData } from "./app.ts";

export const LOCAL_BACKUP_KEY = "td-dev-local-backup"; // modification time of the backup last loaded
const HARD_RELOAD_KEY = "td-dev-hard-reload"; // the hard refresh last acted on, per tab

interface BackupInfo {
  modified?: number;
  hardReloadAt?: number;
}

async function backupInfo(): Promise<BackupInfo> {
  const res = await fetch("/__local/backup-info", { cache: "no-store" }).catch(() => null);
  return res?.ok ? ((await res.json()) as BackupInfo) : {};
}

/** Time the local backup file was last written, or null when there is none. */
export async function localBackupModified(): Promise<number | null> {
  return (await backupInfo()).modified ?? null;
}

export function loadedBackupModified(): number {
  try {
    return Number(localStorage.getItem(LOCAL_BACKUP_KEY)) || 0;
  } catch {
    return 0;
  }
}

/**
 * Replace everything in this browser with the local backup. Returns false when there is none. The open
 * AppData does not see the new rows: open the log again, or reload. `step` hears what is being done, for the
 * loading bar.
 */
export async function replaceWithLocalBackup(app: AppData, step?: (text: string) => void): Promise<boolean> {
  const modified = await localBackupModified();
  if (modified === null) return false;
  step?.("Downloading the local backup…");
  const res = await fetch("/__local/backup.zip", { cache: "no-store" }).catch(() => null);
  if (!res?.ok) return false;
  step?.("Reading the backup…");
  const back = readBackup(new Uint8Array(await res.arrayBuffer()));
  if (back.problems.length) {
    console.warn("Local backup not loaded:", back.problems);
    return false;
  }
  const records = [...back.tables.values()].reduce((n, rows) => n + rows.length, 0);
  step?.(`Saving ${nf.format(records)} records in this browser…`);
  await app.replaceAll(back.tables);
  try {
    localStorage.setItem(LOCAL_BACKUP_KEY, String(modified));
  } catch {
    /* storage unavailable */
  }
  return true;
}

/** Replace everything in this browser with the local backup, then reload. Returns false when there is none. */
export async function loadLocalBackup(app: AppData): Promise<boolean> {
  if (!(await replaceWithLocalBackup(app))) return false;
  location.reload();
  return true;
}

/**
 * The first time an empty browser opens the dev server, load the local backup so the owner's log shows
 * without a manual restore. Returns true when this browser now holds the backup; open the log again.
 */
export async function loadLocalBackupOnce(app: AppData, step: (text: string) => void): Promise<boolean> {
  try {
    if (localStorage.getItem(LOCAL_BACKUP_KEY) || app.store.count("flights") || app.store.count("sightings")) return false;
  } catch {
    return false;
  }
  return replaceWithLocalBackup(app, step);
}

/**
 * True when the browser sends "no-cache" with every request, as Chrome does while DevTools' "Disable cache" is
 * on; every reload then looks like a hard refresh to the dev server. A hard refresh sends it only while the
 * page loads: a request made after the load event goes out without it.
 */
async function cacheDisabled(): Promise<boolean> {
  if (document.readyState !== "complete") await new Promise((r) => addEventListener("load", r, { once: true }));
  await new Promise((r) => setTimeout(r, 0));
  const res = await fetch("/__local/cache-probe").catch(() => null);
  return res?.ok ? ((await res.json()) as { noCache: boolean }).noCache : true;
}

/**
 * A hard refresh (Shift-reload) of this page loads the local backup again, like the button in Settings.
 * The dev server notes when it last served a page for a hard refresh; this page was one if that request came
 * after the page started loading. Returns true when this browser now holds the backup; open the log again.
 */
export async function loadLocalBackupOnHardReload(app: AppData, step: (text: string) => void): Promise<boolean> {
  const nav = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
  if (nav?.type !== "reload") return false;
  const { modified, hardReloadAt } = await backupInfo();
  if (!modified || !hardReloadAt || hardReloadAt < performance.timeOrigin) return false;
  if (await cacheDisabled()) return false;
  try {
    // Guard against loading twice for one hard refresh.
    if (sessionStorage.getItem(HARD_RELOAD_KEY) === String(hardReloadAt)) return false;
    sessionStorage.setItem(HARD_RELOAD_KEY, String(hardReloadAt));
  } catch {
    return false;
  }
  return replaceWithLocalBackup(app, step);
}
