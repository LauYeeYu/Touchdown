// Syncing the log through the user's storage in Private mode (docs/12, "Sync algorithm"), a local folder or Google
// Drive: when the app opens, a few seconds after an edit, when the tab comes back into view or the network returns,
// and every few minutes.

import type { Store } from "@touchdown/core";
import { GoogleDrive, JsonTablesBackend, SignInNeeded, SyncEngine, type FileAdapter, type SyncState, type SyncStateStore } from "@touchdown/storage";
import type { StorageKind, SyncedConnection } from "./connection.ts";
import { db } from "./db.ts";
import { folderAllowed, LocalFolder } from "./folder.ts";
import { GoogleSignIn, loadGoogle, SignInCancelled } from "./google.ts";
import { ServerDriveAuth, standard } from "./standard.ts";

export interface SyncInfo {
  /**
   * "permission": sync waits for the user's click, to use the folder again or to sign in to Google again (a
   * token lasts an hour).
   */
  state: "permission" | "syncing" | "synced" | "failed";
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
}

const AFTER_EDIT_MS = 3000;
const CONFIRM_MS = 1500;
const EVERY_MS = 5 * 60_000;

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

/** Sync starts over with another storage: rows are compared again, and what is still to send stays queued. */
export async function forgetSyncPosition(): Promise<void> {
  const state = (await db.meta.get("sync"))?.value as SyncState | undefined;
  if (state) await db.meta.put({ key: "sync", value: { ...state, cursor: {} } });
}

class StoredSyncState implements SyncStateStore {
  async load() {
    return ((await db.meta.get("sync"))?.value as SyncState | undefined) ?? null;
  }
  async save(state: SyncState) {
    await db.meta.put({ key: "sync", value: state });
  }
}

export class SyncController {
  info: SyncInfo;
  private engine: SyncEngine | null = null;
  private listeners = new Set<() => void>();
  private cleanups: (() => void)[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;
  private readonly storage: Storage;
  private markSynced!: () => void;
  /** Resolves once a sync has finished, so the storage's rows are here. */
  readonly synced = new Promise<void>((resolve) => (this.markSynced = resolve));

  constructor(
    private readonly store: Store,
    readonly connection: SyncedConnection,
  ) {
    this.storage = storageFor(connection);
    this.info = { state: "syncing", mode: connection.mode, adapter: connection.adapter, place: connection.name, lastAt: null, waiting: 0, problems: [], error: null };
  }

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  private set(patch: Partial<SyncInfo>) {
    this.info = { ...this.info, ...patch };
    for (const l of this.listeners) l();
  }

  /** Start syncing. Without the folder permission or a Google token, wait for `allow`. */
  async start(): Promise<void> {
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
    await this.begin();
  }

  /** Ask for the folder permission, or sign in to Google, again. Browsers only allow this inside a click. */
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
    if (e instanceof SignInNeeded) this.set({ state: "permission", error: this.connection.mode === "standard" ? e.message : null, waiting: this.engine?.waiting ?? 0 });
    else this.set({ state: "failed", error: (e as Error).message, waiting: this.engine?.waiting ?? 0 });
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
    const engine = new SyncEngine(this.store, backend, new StoredSyncState());
    await engine.start();
    this.engine = engine;

    const unsubscribe = this.store.subscribe((changes) => {
      if (changes.some((c) => c.origin !== "sync")) this.later(AFTER_EDIT_MS);
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
    // The first sync after opening reads every table, so an edit whose queue entry was lost is still sent.
    await this.run(true);
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
      const report = await this.engine.sync({ full });
      const waiting = this.engine.waiting;
      // Rows just written stay queued until the storage shows them back: look again shortly.
      if (report.sent > 0 && waiting > 0) {
        this.set({ waiting, problems: report.problems });
        this.later(CONFIRM_MS);
        return;
      }
      this.set({ state: "synced", lastAt: Date.now(), waiting, problems: report.problems, error: null });
      this.markSynced();
    } catch (e) {
      this.failed(e);
    }
  }

  stop() {
    this.stopped = true;
    for (const c of this.cleanups) c();
    this.cleanups = [];
    if (this.timer) clearTimeout(this.timer);
    this.engine?.stop();
    this.engine = null;
  }
}
