// The user's log as the commands read it, and the inbox they write to. With storage chosen
// (`./touchdown storage`), both are there; without, the log is a backup file and the inbox is data/private/inbox/.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { operatorFromOverride, readBackup, readInbox, Store, type InboxFile, type RefIndex } from "@touchdown/core";
import { NodeFolder } from "./folder.ts";
import { privatePath, shownPath } from "./paths.ts";
import { readLog, type OpenedStorage } from "./storage.ts";

export const DEFAULT_LOG = privatePath("touchdown-backup.zip");
export const INBOX_DIR = privatePath("inbox");

export interface LoadedLog {
  /** Null when there is no log to read: no storage and no backup. */
  store: Store | null;
  /** Where it came from, for messages: "your log in Google Drive (address)", "data/private/touchdown-backup.zip". */
  from: string;
  problems: string[];
}

/** A backup file's log, read-only. The user's own operators are added to `ref`. */
export function readBackupLog(file: string, ref: RefIndex): LoadedLog {
  if (!existsSync(file)) throw new Error(`${shownPath(file)}: no such file.`);
  const backup = readBackup(new Uint8Array(readFileSync(file)));
  if (backup.problems.length) throw new Error(`${shownPath(file)}: ${backup.problems.join("; ")}`);
  const store = new Store({ deviceId: "cli", validate: false });
  for (const [table, rows] of backup.tables) store.load(table, rows as never);
  for (const op of store.all("operator_overrides")) ref.addOperator(operatorFromOverride(op));
  return { store, from: shownPath(file), problems: [] };
}

/** The log: from `file` when given, else from the chosen storage, else from the default backup when there is one. */
export async function loadLog(ref: RefIndex, opts: { file?: string; storage: OpenedStorage | null }): Promise<LoadedLog> {
  if (opts.file) return readBackupLog(opts.file, ref);
  if (opts.storage) {
    const { store, problems } = await readLog(opts.storage, ref);
    return { store, from: `your log in ${opts.storage.name}`, problems };
  }
  if (existsSync(DEFAULT_LOG)) return readBackupLog(DEFAULT_LOG, ref);
  return { store: null, from: "no log (no storage chosen and no backup)", problems: [] };
}

/** Where inbox files go: the inbox of the chosen storage, or data/private/inbox/. */
export interface InboxPlace {
  /** For messages: "the inbox in Google Drive (address)", "data/private/inbox". */
  name: string;
  /** In the user's storage, so the web app finds it on any device; else only the dev server does. */
  shared: boolean;
  list(): Promise<string[]>;
  read(name: string): Promise<Uint8Array | null>;
  write(name: string, data: Uint8Array): Promise<void>;
  remove(name: string): Promise<void>;
  /** An imported file is kept with its import and leaves the inbox, as the web app keeps it. */
  imported(name: string, batchId: string, data: Uint8Array): Promise<void>;
}

export function inboxPlace(storage: OpenedStorage | null): InboxPlace {
  if (storage) {
    const b = storage.backend;
    return {
      name: `the inbox in ${storage.name}`,
      shared: true,
      list: async () => (await b.listFiles("inbox")).map((f) => f.name).filter((n) => n.endsWith(".json")).sort(),
      read: (name) => b.readFile("inbox", name),
      write: (name, data) => b.writeFile("inbox", name, data),
      remove: (name) => b.removeFile("inbox", name),
      imported: async (name, batchId, data) => {
        await b.writeFile("attachments", `imports/${batchId}/${name}`, data);
        await b.removeFile("inbox", name);
      },
    };
  }
  const folder = new NodeFolder(INBOX_DIR);
  return {
    name: shownPath(INBOX_DIR),
    shared: false,
    list: async () => (await folder.list("")).map((f) => f.name).filter((n) => n.endsWith(".json")).sort(),
    read: async (name) => (await folder.read(name))?.data ?? null,
    write: async (name, data) => void (await folder.write(name, data)),
    remove: (name) => folder.remove(name),
    // As the dev server keeps an imported file: in imported/.
    imported: async (name, _batchId, data) => {
      await new NodeFolder(join(INBOX_DIR, "imported")).write(name, data);
      await folder.remove(name);
    },
  };
}

const encoder = new TextEncoder();

/**
 * Write an inbox file, read it back and read it as the web app will. Throws when what came back differs or does
 * not read.
 */
export async function writeInboxFile(place: InboxPlace, name: string, file: InboxFile, ref: RefIndex): Promise<void> {
  const data = encoder.encode(JSON.stringify(file, null, 2) + "\n");
  await place.write(name, data);
  const back = await place.read(name);
  if (!back || back.length !== data.length || back.some((b, i) => b !== data[i])) throw new Error(`${name} did not read back as written from ${place.name}.`);
  const r = readInbox(JSON.parse(new TextDecoder().decode(back)), name, ref);
  if ("error" in r) throw new Error(`${name} was written but does not read: ${r.error}.`);
}

/** The time in a file's name: local, "2026-10-24-153012". */
export const stamp = (d = new Date()) => {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
};

/** A name not in the inbox yet. */
export async function freeName(place: InboxPlace, base: string): Promise<string> {
  const taken = new Set(await place.list());
  for (let i = 1; ; i++) {
    const name = i === 1 ? `${base}.json` : `${base}-${i}.json`;
    if (!taken.has(name)) return name;
  }
}
