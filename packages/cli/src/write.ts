// Writing the log from the command line (docs/34, "Writing the log from the command line"). Only `touchdown review`
// does, after the user has reviewed a file, and it writes as the web app does: the whole log is read from the storage
// into memory, the import is applied with the same code, and the rows it changed are sent with the sync engine
// (packages/storage), so a change made at the same time in the web app is merged row by row. The CLI keeps no copy
// of the log: rows the storage has not shown back yet are kept, with their values, in data/private/cli-sync.json and
// sent again by the next run.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { reconcile, RefIndex, refOverridesOf, SCHEMA_VERSION, Store, type TableName } from "@touchdown/core";
import { SyncEngine, type SyncState, type SyncStateStore } from "@touchdown/storage";
import { loadRefTables } from "@touchdown/refdata";
import { privatePath } from "./paths.ts";
import { cliDeviceId } from "./settings.ts";
import { chosenStorage, type OpenedStorage } from "./storage.ts";

export const SYNC_FILE = privatePath("cli-sync.json");

interface Saved {
  state: SyncState;
  /** The rows the queue names, as they are here: the storage has not shown them back yet. */
  rows: { table: TableName; row: Record<string, unknown> }[];
}

/** One storage's place in the sync file: the Google account or the folder. */
const keyOf = (s: OpenedStorage) => (s.choice.kind === "gdrive" ? `gdrive:${s.choice.account}` : `folder:${resolve(s.choice.path)}`);

function readAll(): Record<string, Saved> {
  try {
    return JSON.parse(readFileSync(SYNC_FILE, "utf8")) as Record<string, Saved>;
  } catch {
    return {};
  }
}

/** The sync engine's state for one storage, with the rows still to send. */
class FileSyncState implements SyncStateStore {
  constructor(
    private readonly key: string,
    private readonly store: Store,
  ) {}

  async load(): Promise<SyncState | null> {
    const saved = readAll()[this.key];
    if (!saved) return null;
    // The rows still to send go back into the copy before it is merged with the storage.
    for (const r of saved.rows) this.store.load(r.table, [r.row as never]);
    return saved.state;
  }

  async save(state: SyncState): Promise<void> {
    const rows = state.queue.flatMap((q) => {
      const row = this.store.peek(q.table, q.key);
      return row ? [{ table: q.table, row: row as unknown as Record<string, unknown> }] : [];
    });
    const all = readAll();
    all[this.key] = { state, rows };
    mkdirSync(dirname(SYNC_FILE), { recursive: true });
    // Rows may hold private fields, as the log does: only this user may read the file.
    writeFileSync(SYNC_FILE, JSON.stringify(all) + "\n", { mode: 0o600 });
  }
}

export interface WritableLog {
  store: Store;
  ref: RefIndex;
  storage: OpenedStorage;
  engine: SyncEngine;
  /** Rows an earlier run had not sent, sent now. */
  resent: number;
  /** Files of the log that could not be read. */
  problems: string[];
}

/**
 * The log, read from the chosen storage to be changed. Refused without storage (Local mode has none the CLI can
 * reach) and for a log at another schema version: the CLI never creates or upgrades a log.
 */
export async function openForWriting(say: (line: string) => void = () => {}, storage?: OpenedStorage | null): Promise<WritableLog> {
  const s = storage === undefined ? await chosenStorage() : storage;
  if (!s) throw new Error("No storage chosen. review writes to your log where the web app syncs it: choose it with ./touchdown storage drive (or folder PATH). In Local mode, review the files on the web app's Import page.");
  if (s.schemaVersion < SCHEMA_VERSION) throw new Error(`Your log uses schema version ${s.schemaVersion}, older than this copy of Touchdown (${SCHEMA_VERSION}). Open the web app once, which brings the log up to date, then review again.`);
  const store = new Store({ deviceId: cliDeviceId() });
  const engine = new SyncEngine(store, s.backend, new FileSyncState(keyOf(s), store));
  await engine.start();
  const before = engine.waiting;
  say(`Reading your log from ${s.name}…`);
  const report = await engine.sync({ full: true });
  const ref = new RefIndex(loadRefTables());
  ref.setUserOverrides(refOverridesOf(store));
  // What two devices made side by side is settled here as in the web app, and sent with the review.
  reconcile(store, ref);
  // Rows sent by this pull and push were left waiting by an earlier run.
  return { store, ref, storage: s, engine, resent: before ? report.sent : 0, problems: report.problems };
}

/** Send what changed, then read it back: rows the storage shows are confirmed; the others wait for the next run. */
export async function sendChanges(w: WritableLog): Promise<{ sent: number; waiting: number }> {
  const out = await w.engine.sync();
  await w.engine.sync();
  return { sent: out.sent, waiting: w.engine.waiting };
}
