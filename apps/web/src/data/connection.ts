// How this browser keeps the log (docs/32-modes-and-sharing.md): Local keeps it here only; Private syncs it
// through the user's storage. Kept per browser in IndexedDB, since a folder handle belongs to this browser; the
// mode is also recorded in the synced settings (`dataMode`).

import { toUtcIso } from "@touchdown/core";
import { GoogleDrive } from "@touchdown/storage";
import { db } from "./db.ts";
import { holdsLog, pickFolder } from "./folder.ts";
import { GoogleSignIn, SignInCancelled } from "./google.ts";

export type Connection =
  | { mode: "local"; since: string }
  | { mode: "private"; adapter: "localfs"; folder: FileSystemDirectoryHandle; name: string; since: string }
  | { mode: "private"; adapter: "gdrive"; account: string; name: string; since: string };

export type PrivateConnection = Extract<Connection, { mode: "private" }>;
export type StorageKind = PrivateConnection["adapter"];

/**
 * Ask the user for Private mode's storage: Google's sign-in or the folder picker, so call it from a click. Says
 * whether the storage holds a log already; null when the user cancelled.
 */
export async function chooseStorage(kind: StorageKind): Promise<{ connection: PrivateConnection; holdsLog: boolean } | null> {
  const since = toUtcIso(Date.now());
  if (kind === "localfs") {
    const picked = await pickFolder();
    if (!picked) return null;
    return { connection: { mode: "private", adapter: "localfs", folder: picked.folder, name: picked.name, since }, holdsLog: await holdsLog(picked.folder) };
  }
  let account: string;
  try {
    account = await new GoogleSignIn(null).signIn();
  } catch (e) {
    if (e instanceof SignInCancelled) return null;
    throw e;
  }
  const files = await new GoogleDrive(new GoogleSignIn(account)).list("");
  return {
    connection: { mode: "private", adapter: "gdrive", account, name: `Google Drive (${account})`, since },
    holdsLog: files.some((f) => f.name === "manifest.json"),
  };
}

const KEY = "connection";

export async function readConnection(): Promise<Connection | null> {
  return ((await db.meta.get(KEY))?.value as Connection | undefined) ?? null;
}

export async function saveConnection(c: Connection): Promise<void> {
  await db.meta.put({ key: KEY, value: c });
}

/** Meta keys for the Local mode's backup reminder. */
export const LAST_BACKUP = "lastBackupAt";
export const LAST_CHANGE = "lastChangeAt";

export async function metaNumber(key: string): Promise<number | null> {
  const v = (await db.meta.get(key))?.value;
  return typeof v === "number" ? v : null;
}

export async function setMeta(key: string, value: unknown): Promise<void> {
  await db.meta.put({ key, value });
}
