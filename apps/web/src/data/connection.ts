// How this browser keeps the log (docs/32-modes-and-sharing.md): Local keeps it here only; Private syncs it
// through the user's storage. Kept per browser in IndexedDB, since a folder handle belongs to this browser; the
// mode is also recorded in the synced settings (`dataMode`).

import { db } from "./db.ts";

export type Connection =
  | { mode: "local"; since: string }
  | { mode: "private"; adapter: "localfs"; folder: FileSystemDirectoryHandle; name: string; since: string };

export type PrivateConnection = Extract<Connection, { mode: "private" }>;

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
