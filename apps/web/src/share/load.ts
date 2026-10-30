// What a shared link shows, read from /p/<id>/content and turned into a read-only log the share page's views work on
// with the same core code as the app (docs/32-modes-and-sharing.md, "The public page").

import { refOverridesOf, RefIndex, Store, type Row, type TableName } from "@touchdown/core";
import type { ShareContent } from "@touchdown/core/share";

export type Loaded =
  | { state: "ok"; id: string; content: ShareContent; store: Store; ref: RefIndex }
  | { state: "not-found" }
  | { state: "not-available" }
  | { state: "busy" };

/** The link's id: the page is /p/<id>. */
export const shareId = () => location.pathname.split("/")[2] ?? "";

/** Rows as a link sends them carry no sync columns; the store wants them filled. */
const SYSTEM = { rev: 1, updatedAt: "1970-01-01T00:00:00Z", updatedBy: "share", basedOn: null, versionVector: null, deleted: false };

export async function loadShare(): Promise<Loaded> {
  const id = shareId();
  const res = await fetch(`/p/${encodeURIComponent(id)}/content`, { credentials: "omit" });
  if (res.status === 404) return { state: "not-found" };
  if (res.status === 429) return { state: "busy" };
  if (!res.ok) return { state: "not-available" };
  const content = (await res.json()) as ShareContent;
  if (content.format !== "touchdown-share" || content.version !== 1) return { state: "not-available" };
  const store = new Store({ deviceId: "share", validate: false });
  for (const [table, rows] of Object.entries(content.tables) as [TableName, Record<string, unknown>[]][]) {
    store.load(table, rows.map((r) => ({ ...SYSTEM, ...r }) as unknown as Row<TableName>));
  }
  const { loadRefTables } = await import("@touchdown/refdata");
  const ref = new RefIndex(loadRefTables(), refOverridesOf(store));
  return { state: "ok", id, content, store, ref };
}

/** A flight's recorded track in a link, added to the store: [] when it has none. */
export async function loadTrack(id: string, store: Store, flightId: string): Promise<number> {
  const res = await fetch(`/p/${encodeURIComponent(id)}/tracks/${encodeURIComponent(flightId)}`, { credentials: "omit" });
  if (!res.ok) return 0;
  const { points } = (await res.json()) as { points?: Row<"track_points">[] };
  if (points?.length) store.putRaw("track_points", points);
  return points?.length ?? 0;
}
