// Tabs of one browser share its copy of the log (docs/12, "Tabs"). One tab writes the copy and syncs it: the first
// to hold the writer lock (Web Locks), until it closes and the next tab waiting takes over. The others read the copy
// when they open, send their edits to the writer through the outbox (db.ts), and hear every row the writer saves on
// a BroadcastChannel. Without Web Locks or BroadcastChannel (browsers from before 2022) every tab writes, as before.

import type { SyncInfo } from "./sync.ts";

export type Role = "writer" | "follower";

/** A row as saved; null when it was removed. */
export interface SavedRow {
  table: string;
  id: string;
  row: Record<string, unknown> | null;
}

export type TabMessage =
  /** The writer saved these rows and tracks, and took these outbox records. */
  | { type: "rows"; rows: SavedRow[]; tracks: string[]; took: { key: string; stamp: string }[] }
  /** A follower wrote to the outbox. */
  | { type: "outbox" }
  /** The writer's sync, for the other tabs to show. */
  | { type: "sync"; info: SyncInfo | null }
  /** A tab opened: the writer answers with its sync. */
  | { type: "hello" }
  /** Sync now, and say when it is done. */
  | { type: "run"; id: string }
  | { type: "ran"; id: string }
  /** A follower got the storage's permission (or a Google sign-in) in a click: the writer can sync again. */
  | { type: "allow" }
  /** A tab replaced or removed the browser's copy, or changed its storage: every other tab reloads. */
  | { type: "reload" };

const supported = () => typeof BroadcastChannel !== "undefined" && typeof navigator !== "undefined" && !!navigator.locks;

export class Tabs {
  role: Role = "writer";
  private channel: BroadcastChannel | null = null;
  private listeners = new Set<(m: TabMessage) => void>();
  /** Messages heard before anything listened, so a tab opening misses none of the writer's saves. */
  private early: TabMessage[] | null = [];
  private promoted: Promise<void> = new Promise(() => {});

  constructor(readonly name: string) {}

  /**
   * Take the writer's part if no other tab has it; otherwise queue for it. Listens from here on: what the writer
   * saves after this tab starts reading the copy reaches it.
   */
  async open(): Promise<Role> {
    if (!supported()) return (this.role = "writer");
    this.channel = new BroadcastChannel(`touchdown:${this.name}`);
    this.channel.onmessage = (e: MessageEvent<TabMessage>) => {
      if (this.early) this.early.push(e.data);
      else for (const l of this.listeners) l(e.data);
    };
    const lock = `touchdown-writer:${this.name}`;
    // The lock is held until the page goes; the callback's promise never settles.
    const claim = (opts: LockOptions) =>
      new Promise<boolean>((resolve) => {
        void navigator.locks.request(lock, opts, (held) => {
          resolve(!!held);
          return held ? new Promise<void>(() => {}) : undefined;
        });
      });
    if (await claim({ ifAvailable: true })) return (this.role = "writer");
    this.promoted = claim({}).then(() => {
      this.role = "writer";
    });
    return (this.role = "follower");
  }

  /** Resolves when this tab becomes the writer, after the one before it closed. */
  whenWriter(): Promise<void> {
    return this.role === "writer" ? Promise.resolve() : this.promoted;
  }

  post(m: TabMessage) {
    this.channel?.postMessage(m);
  }

  /** Hear messages from the other tabs, the early ones first. */
  listen(fn: (m: TabMessage) => void): () => void {
    this.listeners.add(fn);
    const early = this.early;
    this.early = null;
    for (const m of early ?? []) fn(m);
    return () => this.listeners.delete(fn);
  }
}

let current: Tabs | null = null;

/** This page's part among the tabs of one account's copy. */
export function tabsFor(name: string): Tabs {
  if (current?.name !== name) current = new Tabs(name);
  return current;
}
