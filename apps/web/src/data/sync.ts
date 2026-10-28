// Syncing the log through the user's storage in Private and Standard mode (docs/12, "Sync algorithm"), a local folder
// or Google Drive: when the app opens, a few seconds after an edit, when the tab comes back into view or the network
// returns, and every few minutes. Only the tab that writes the browser's copy syncs (tabs.ts); the others show its
// sync and ask it to sync (TabSync).

import { FILE_TABLES, ulid, type Store } from "@touchdown/core";
import { GoogleDrive, JsonTablesBackend, SchemaTooNewError, SignInNeeded, SyncEngine, tablePath, type FileAdapter, type QueuedRow, type SyncState, type SyncStateStore } from "@touchdown/storage";
import type { StorageKind, SyncedConnection } from "./connection.ts";
import { db } from "./db.ts";
import { folderAllowed, LocalFolder } from "./folder.ts";
import { GoogleSignIn, loadGoogle, SignInCancelled } from "./google.ts";
import { ServerDriveAuth, standard } from "./standard.ts";
import type { TabMessage } from "./tabs.ts";

export interface SyncInfo {
  /**
   * "permission": sync waits for the user's click, to use the folder again or to sign in to Google again (a
   * token lasts an hour). "update": a newer version of the app has changed the log; sync waits for a reload.
   */
  state: "permission" | "syncing" | "synced" | "failed" | "update";
  mode: SyncedConnection["mode"];
  adapter: StorageKind;
  /** Where the log syncs to, as the user knows it. */
  place: string;
  /** When the last sync finished, in milliseconds. */
  lastAt: number | null;
  /** Rows changed here that the storage has not shown back yet. */
  waiting: number;
  /** Files in the storage that could not be read. */
  problems: string[];
  error: string | null;
  /** This browser's copy has every table from the storage (the first download got that far). */
  tables: boolean;
  /** Tracks being read now, while some are left. */
  tracks: { done: number; total: number } | null;
}

/** What the app uses of sync: in the tab that syncs, SyncController; in the others, TabSync. */
export interface SyncHandle {
  readonly info: SyncInfo;
  readonly connection: SyncedConnection;
  /** Resolves once a sync has finished, so the storage's rows are here. */
  readonly synced: Promise<void>;
  subscribe(fn: () => void): () => void;
  /** Start; resolves once this browser's copy has the storage's tables, or sync cannot go on without the user. */
  start(): Promise<void>;
  /** Ask for the folder permission, or sign in to Google, again. Browsers only allow this inside a click. */
  allow(): Promise<void>;
  /** Sync now. */
  run(): Promise<void>;
  /** The storage's inbox, while it may be used; null otherwise. */
  inbox(): StorageInbox | null;
  stop(): void;
}

const AFTER_EDIT_MS = 3000;
const CONFIRM_MS = 1500;
const EVERY_MS = 5 * 60_000;
/** Set once every table file has been compared with this browser's copy since edits were saved with their queue. */
export const SYNC_CHECKED = "syncCheckedAll";

/** The inbox in the user's storage (docs/21): files from `touchdown spot` and `touchdown add` waiting for review. */
export interface StorageInbox {
  list(): Promise<string[]>;
  read(name: string): Promise<Uint8Array | null>;
  /** An imported file is kept with its import (attachments/imports/<batchId>/) and leaves the inbox. */
  imported(name: string, batchId: string, data: Uint8Array): Promise<void>;
  remove(name: string): Promise<void>;
}

/** The storage's files, and whether this browser may use them now; with `ask`, inside a click, it may ask. */
interface Storage {
  files: FileAdapter;
  ready(ask: boolean): Promise<boolean>;
}

function storageFor(c: SyncedConnection): Storage {
  if (c.mode === "standard") {
    // The server keeps the key; when it has none that works, connecting again goes through Google's page.
    const auth = new ServerDriveAuth();
    return {
      files: new GoogleDrive(auth),
      ready: async (ask) => {
        if (await auth.ready()) return true;
        if (ask) location.assign(standard.connectUrl(location.pathname));
        return false;
      },
    };
  }
  if (c.adapter === "localfs") return { files: new LocalFolder(c.folder), ready: (ask) => folderAllowed(c.folder, ask) };
  const google = new GoogleSignIn(c.account);
  // Ready before the user clicks Sign in, so Google's window opens at once.
  void loadGoogle().catch(() => undefined);
  return {
    files: new GoogleDrive(google),
    ready: async (ask) => (await google.ready()) || (ask && !!(await google.signIn())),
  };
}

/** Whether a saved position covers every table: the first download had its tables in. */
export function hasTables(state: SyncState | null): boolean {
  return !!state && FILE_TABLES.every((t) => state.cursor[tablePath(t)] !== undefined);
}

export async function savedSyncState(): Promise<SyncState | null> {
  return ((await db.meta.get("sync"))?.value as SyncState | undefined) ?? null;
}

/** Sync's state, saved by the app with the rows it covers, in one transaction (app.ts). */
class StoredSyncState implements SyncStateStore {
  constructor(private readonly persist: (state: SyncState) => Promise<void>) {}
  load() {
    return savedSyncState();
  }
  save(state: SyncState) {
    return this.persist(state);
  }
}

function inboxOf(b: JsonTablesBackend): StorageInbox {
  return {
    list: async () => (await b.listFiles("inbox")).map((f) => f.name).filter((n) => n.endsWith(".json")),
    read: (name) => b.readFile("inbox", name),
    imported: async (name, batchId, data) => {
      await b.writeFile("attachments", `imports/${batchId}/${name}`, data);
      await b.removeFile("inbox", name);
    },
    remove: (name) => b.removeFile("inbox", name),
  };
}

/** What the tab that syncs needs from the app around it. */
export interface SyncHooks {
  /** Save sync's state, with the rows it covers. */
  persist(state: SyncState): Promise<void>;
  /** Once the engine notes edits: hand it the edits it did not see being made (the outbox). */
  started(): Promise<void>;
}

/** Tell listeners; one that throws (a page failing to render) stops neither the others nor the write that told them. */
function tell(listeners: Set<() => void>) {
  for (const l of listeners) {
    try {
      l();
    } catch (e) {
      console.error(e);
    }
  }
}

/** A promise and its resolve, for a moment awaited from several places. */
function moment() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
}

export class SyncController implements SyncHandle {
  info: SyncInfo;
  private engine: SyncEngine | null = null;
  private backend: JsonTablesBackend | null = null;
  private listeners = new Set<() => void>();
  private cleanups: (() => void)[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;
  private readonly storage: Storage;
  private readonly isSynced = moment();
  private readonly tablesIn = moment();
  readonly synced = this.isSynced.promise;

  constructor(
    private readonly store: Store,
    readonly connection: SyncedConnection,
    private readonly hooks: SyncHooks,
  ) {
    this.storage = storageFor(connection);
    this.info = { state: "syncing", mode: connection.mode, adapter: connection.adapter, place: connection.name, lastAt: null, waiting: 0, problems: [], error: null, tables: false, tracks: null };
  }

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  /** The engine notes this tab's edits: they need not go through the outbox. */
  get noting(): boolean {
    return !!this.engine && !this.stopped;
  }

  /** Queue edits the engine did not see being made; resolves once the queue is saved. */
  async enqueue(rows: QueuedRow[], tracks: string[]): Promise<void> {
    await this.engine?.enqueue(rows, tracks);
  }

  private set(patch: Partial<SyncInfo>) {
    this.info = { ...this.info, ...patch };
    // The first download stops waiting for the tables when sync cannot go on by itself.
    if (this.info.tables || this.info.state === "permission" || this.info.state === "failed" || this.info.state === "update") this.tablesIn.resolve();
    tell(this.listeners);
  }

  /** Start syncing; resolves once the tables are in, or sync waits for the user. Without the folder permission or a Google token, wait for `allow`. */
  async start(): Promise<void> {
    this.set({ tables: hasTables(await savedSyncState()) });
    // In Standard the first sync asks the server for access itself, so its reason shows when there is none.
    try {
      if (this.connection.mode !== "standard" && !(await this.storage.ready(false))) {
        this.set({ state: "permission" });
        return;
      }
    } catch (e) {
      this.failed(e);
      return;
    }
    void this.begin();
    await this.tablesIn.promise;
  }

  async allow(): Promise<void> {
    try {
      if (!(await this.storage.ready(true))) return;
    } catch (e) {
      if (!(e instanceof SignInCancelled)) this.set({ error: (e as Error).message });
      return;
    }
    this.set({ error: null });
    if (this.engine) await this.run();
    else await this.begin();
  }

  private failed(e: unknown) {
    // In Standard the server says why its key does not work; in Private the bar's own words say it.
    const waiting = this.engine?.waiting ?? 0;
    if (e instanceof SignInNeeded) this.set({ state: "permission", error: this.connection.mode === "standard" ? e.message : null, waiting, tracks: null });
    else if (e instanceof SchemaTooNewError) this.set({ state: "update", error: null, waiting, tracks: null });
    else this.set({ state: "failed", error: (e as Error).message, waiting, tracks: null });
  }

  private async begin() {
    if (this.engine || this.stopped) return;
    this.set({ state: "syncing" });
    const backend = new JsonTablesBackend(this.storage.files, this.store.deviceId);
    try {
      await backend.open();
    } catch (e) {
      this.failed(e);
      return;
    }
    const engine = new SyncEngine(this.store, backend, new StoredSyncState(this.hooks.persist));
    await engine.start();
    if (this.stopped) {
      engine.stop();
      return;
    }
    this.engine = engine;
    this.backend = backend;
    try {
      await this.hooks.started();
    } catch (e) {
      this.failed(e);
      return;
    }

    const unsubscribe = this.store.subscribe((changes) => {
      if (changes.some((c) => !c.origin)) this.later(AFTER_EDIT_MS);
    });
    const onShow = () => document.visibilityState === "visible" && void this.run();
    const onOnline = () => void this.run();
    document.addEventListener("visibilitychange", onShow);
    window.addEventListener("online", onOnline);
    const every = setInterval(() => void this.run(), EVERY_MS);
    this.cleanups.push(
      unsubscribe,
      () => document.removeEventListener("visibilitychange", onShow),
      () => window.removeEventListener("online", onOnline),
      () => clearInterval(every),
    );
    // Once, every table file is compared with this copy, so an edit saved before edits and their queue were saved
    // together is still found and sent. After that, only files that changed are read.
    await this.run(!(await db.meta.get(SYNC_CHECKED)));
  }

  private later(ms: number) {
    this.set({ waiting: this.engine?.waiting ?? 0 });
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.run();
    }, ms);
  }

  /** Sync now. `full` reads every table file again. */
  async run(full = false): Promise<void> {
    if (!this.engine || this.stopped) return;
    // Without a token, wait for the user to sign in; edits stay queued meanwhile.
    if (this.info.state === "permission" && !(await this.storage.ready(false))) {
      this.set({ waiting: this.engine.waiting });
      return;
    }
    this.set({ state: "syncing" });
    try {
      const report = await this.engine.sync({
        full,
        tablesIn: () => this.set({ tables: true }),
        progress: (p) => this.set({ tracks: p.tracksDone < p.tracksTotal ? { done: p.tracksDone, total: p.tracksTotal } : null }),
      });
      if (full) await db.meta.put({ key: SYNC_CHECKED, value: true });
      const waiting = this.engine.waiting;
      // Rows just written stay queued until the storage shows them back: look again shortly.
      if (report.sent > 0 && waiting > 0) {
        this.set({ waiting, problems: report.problems, tracks: null });
        this.later(CONFIRM_MS);
        return;
      }
      this.set({ state: "synced", lastAt: Date.now(), waiting, problems: report.problems, error: null, tracks: null });
      this.isSynced.resolve();
    } catch (e) {
      this.failed(e);
    }
  }

  inbox(): StorageInbox | null {
    const b = this.backend;
    if (!b || this.stopped || this.info.state === "permission") return null;
    return inboxOf(b);
  }

  stop() {
    this.stopped = true;
    for (const c of this.cleanups) c();
    this.cleanups = [];
    if (this.timer) clearTimeout(this.timer);
    this.engine?.stop();
    this.engine = null;
    this.tablesIn.resolve();
  }
}

/** How long a tab opening waits for the writing tab to say how its sync is, before showing what it has. */
const HELLO_MS = 3000;

/**
 * Sync as another tab sees it: the writing tab's state, heard on the channel, and requests to it. The storage's
 * inbox is read from here directly.
 */
export class TabSync implements SyncHandle {
  info: SyncInfo;
  private listeners = new Set<() => void>();
  private readonly storage: Storage;
  private backend: JsonTablesBackend | null = null;
  private readonly runs = new Map<string, () => void>();
  private readonly isSynced = moment();
  private readonly tablesIn = moment();
  private stopped = false;
  readonly synced = this.isSynced.promise;

  constructor(
    readonly connection: SyncedConnection,
    private readonly post: (m: TabMessage) => void,
    /** Saves this tab's edits to the outbox, so the writing tab has them before it syncs. */
    private readonly flush: () => Promise<void>,
  ) {
    this.storage = storageFor(connection);
    this.info = { state: "syncing", mode: connection.mode, adapter: connection.adapter, place: connection.name, lastAt: null, waiting: 0, problems: [], error: null, tables: true, tracks: null };
    // Coming back into view syncs, as it does in the writing tab.
    const onShow = () => document.visibilityState === "visible" && this.post({ type: "run", id: "" });
    document.addEventListener("visibilitychange", onShow);
    this.cleanup = () => document.removeEventListener("visibilitychange", onShow);
  }

  private readonly cleanup: () => void;

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  /** The writing tab's sync, as it last said. */
  heard(info: SyncInfo | null) {
    if (!info || this.stopped) return;
    this.info = info;
    if (info.state === "synced") this.isSynced.resolve();
    if (info.tables || info.state === "permission" || info.state === "failed" || info.state === "update") this.tablesIn.resolve();
    tell(this.listeners);
  }

  ran(id: string) {
    this.runs.get(id)?.();
    this.runs.delete(id);
  }

  start(): Promise<void> {
    this.post({ type: "hello" });
    setTimeout(() => this.tablesIn.resolve(), HELLO_MS);
    return this.tablesIn.promise;
  }

  async allow(): Promise<void> {
    try {
      if (!(await this.storage.ready(true))) return;
    } catch (e) {
      if (!(e instanceof SignInCancelled)) this.heard({ ...this.info, error: (e as Error).message });
      return;
    }
    this.post({ type: "allow" });
  }

  async run(): Promise<void> {
    await this.flush();
    const id = ulid();
    const done = new Promise<void>((resolve) => this.runs.set(id, resolve));
    this.post({ type: "run", id });
    await done;
  }

  inbox(): StorageInbox | null {
    if (this.stopped || this.info.state === "permission") return null;
    this.backend ??= new JsonTablesBackend(this.storage.files, "tab");
    return inboxOf(this.backend);
  }

  /** This tab now writes the copy, or the page goes: requests still waiting end. */
  stop() {
    this.stopped = true;
    this.cleanup();
    for (const done of this.runs.values()) done();
    this.runs.clear();
    this.tablesIn.resolve();
  }
}
