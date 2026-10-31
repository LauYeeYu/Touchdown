// A link's content as the app's pages read it (docs/32-modes-and-sharing.md, "The public page"): the rows the server
// sent, in a store of their own, behind the part of the app's data the pages read. Nothing here writes: the pages
// leave out what changes the log when `readOnly` is set, and the store is never saved or synced.

import { phasesOf, refOverridesOf, RefIndex, settingsOf, Store, tagsOf, type Finding, type Row, type Settings, type TableName } from "@touchdown/core";
import type { ShareContent } from "@touchdown/core/share";
import type { AppData } from "../data/app.ts";

/** The link's id: the page is /p/<id>. */
export const shareId = () => location.pathname.split("/")[2] ?? "";

/** Rows as a link sends them carry no sync columns; the store wants them filled. */
const SYSTEM = { rev: 1, updatedAt: "1970-01-01T00:00:00Z", updatedBy: "share", basedOn: null, versionVector: null, deleted: false };

/**
 * Flights whose tracks one request asks for, and requests at once: the server reads each request's files at once too,
 * and takes at most 15 a request.
 */
const TRACKS_PER_REQUEST = 10;
const REQUESTS_AT_ONCE = 6;

/** How long a request may take before it is given up as failed: a hung one would hold the page or the tracks forever. */
const CONTENT_WAIT_MS = 45_000;
const TRACKS_WAIT_MS = 60_000;
/** The content asked for again after a failure, after these pauses: a server or network error is often brief. */
const CONTENT_RETRIES_MS = [1_000, 3_000];

/** A request without the browser's cookies, given up after `ms`. */
async function fetchWithin(url: string, ms: number): Promise<Response> {
  const stop = new AbortController();
  const timer = setTimeout(() => stop.abort(), ms);
  try {
    return await fetch(url, { credentials: "omit", signal: stop.signal });
  } finally {
    clearTimeout(timer);
  }
}

export interface TrackProgress {
  done: number;
  total: number;
}

export class ShareData {
  readonly readOnly = true;
  readonly connection = null;
  readonly sync = null;
  version = 0;
  /** Recorded tracks being read, for the masthead; null once all are in. */
  tracks: TrackProgress | null = null;
  private listeners = new Set<() => void>();
  private reading: Promise<void> | null = null;

  /** The owner's name, sent with a whole log only: a link to one record names nobody. */
  get sharedBy(): string | null {
    return this.content.kind === "log" ? (this.content.owner ?? null) : null;
  }

  constructor(
    readonly id: string,
    readonly content: ShareContent,
    readonly store: Store,
    readonly ref: RefIndex,
  ) {
    store.subscribe(() => this.notify());
  }

  /** As the app's data, for its pages: they read only what this class has. */
  get asApp(): AppData {
    return this as unknown as AppData;
  }

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };

  getVersion = () => this.version;

  private notify() {
    this.version++;
    for (const l of [...this.listeners]) l();
  }

  settings(): Settings {
    return settingsOf(this.store);
  }

  // The owner's checks stay with the owner: a link shows the log, not what is left to review in it.
  findings(): Finding[] {
    return [];
  }

  allFindings(): Finding[] {
    return [];
  }

  acceptedFindings(): { finding: Finding; ackId: string }[] {
    return [];
  }

  findingsFor(): Finding[] {
    return [];
  }

  phasesOf(sightingId: string): string[] {
    return phasesOf(this.store, sightingId);
  }

  tagsOf(sightingId: string): string[] {
    return tagsOf(this.store, sightingId);
  }

  /**
   * Read the link's recorded tracks into its store, as the app's sync reads tracks: newest flights first, several
   * requests at a time, each request's tracks shown as soon as they arrive. A request the server could not answer is
   * asked again once, in two halves. A track that still cannot be read stays a great circle. Read once, however often
   * it is asked.
   */
  loadTracks(): Promise<void> {
    this.reading ??= this.readTracks();
    return this.reading;
  }

  private async readTracks(): Promise<void> {
    const when = new Map(this.store.all("flights").map((f) => [f.id, f.takeoffAt ?? f.scheduledDate ?? ""]));
    const flights = [...new Set(this.store.all("tracks").map((t) => t.flightId))].filter((id) => when.has(id)).sort((a, b) => when.get(b)!.localeCompare(when.get(a)!));
    if (!flights.length) return;
    const queue: { flights: string[]; again: boolean }[] = [];
    for (let i = 0; i < flights.length; i += TRACKS_PER_REQUEST) queue.push({ flights: flights.slice(i, i + TRACKS_PER_REQUEST), again: false });
    let done = 0;
    this.tracks = { done, total: flights.length };
    this.notify();
    const worker = async () => {
      while (queue.length) {
        const batch = queue.shift()!;
        if ((await this.readBatch(batch.flights)) === "failed" && !batch.again && batch.flights.length > 1) {
          const half = Math.ceil(batch.flights.length / 2);
          queue.push({ flights: batch.flights.slice(0, half), again: true }, { flights: batch.flights.slice(half), again: true });
          continue;
        }
        done += batch.flights.length;
        this.tracks = done < flights.length ? { done, total: flights.length } : null;
        this.notify();
      }
    };
    await Promise.all(Array.from({ length: Math.min(REQUESTS_AT_ONCE, queue.length) }, worker));
  }

  /** One request's tracks into the store. "failed" when the server could not answer it, or did not answer in time. */
  private async readBatch(flights: string[]): Promise<"read" | "failed" | "refused"> {
    try {
      const res = await fetchWithin(`/p/${encodeURIComponent(this.id)}/tracks?flights=${flights.map(encodeURIComponent).join(",")}`, TRACKS_WAIT_MS);
      // A stopped link, or too many requests: asking again would not help.
      if (!res.ok) return res.status >= 500 ? "failed" : "refused";
      const { tracks } = (await res.json()) as { tracks?: Record<string, Row<"track_points">[]> };
      const points = Object.values(tracks ?? {}).flat();
      if (points.length) this.store.putRaw("track_points", points);
      return "read";
    } catch {
      return "failed";
    }
  }
}

export type Loaded = { state: "ok"; data: ShareData } | { state: "not-found" } | { state: "not-available" } | { state: "busy" };

/**
 * The link's content. A server or network error, or no answer in time, is asked again twice before the page says the
 * link is not available, and the page offers to try again from there without a reload.
 */
export async function loadShare(report: (at: number, text: string) => void = () => {}): Promise<Loaded> {
  const id = shareId();
  let content: ShareContent | null = null;
  for (let attempt = 0; !content; attempt++) {
    try {
      const res = await fetchWithin(`/p/${encodeURIComponent(id)}/content`, CONTENT_WAIT_MS);
      if (res.status === 404) return { state: "not-found" };
      if (res.status === 429) return { state: "busy" };
      if (res.ok) content = (await res.json()) as ShareContent;
    } catch {
      // No answer, or not JSON: as a server error.
    }
    if (content) break;
    if (attempt >= CONTENT_RETRIES_MS.length) return { state: "not-available" };
    await new Promise((r) => setTimeout(r, CONTENT_RETRIES_MS[attempt]));
  }
  if (content.format !== "touchdown-share" || content.version !== 1) return { state: "not-available" };
  report(0.65, "Loading airports, airlines and aircraft types…");
  const store = new Store({ deviceId: "share", validate: false });
  for (const [table, rows] of Object.entries(content.tables) as [TableName, Record<string, unknown>[]][]) {
    store.load(table, rows.map((r) => ({ ...SYSTEM, ...r }) as unknown as Row<TableName>));
  }
  const { loadRefTables } = await import("@touchdown/refdata");
  const ref = new RefIndex(loadRefTables(), refOverridesOf(store));
  report(0.9, "Preparing the pages…");
  return { state: "ok", data: new ShareData(id, content, store, ref) };
}
