// Share links in the browser (docs/32-modes-and-sharing.md, "Sharing"): the owner's links as the server keeps them,
// loaded once a session and kept here, so every Share button and the Shared links page show the same list.

import { useEffect, useSyncExternalStore } from "react";
import type { ShareKind } from "@touchdown/core/share";

export interface ShareLink {
  id: string;
  /** The address to send: https://<site>/p/<id>. */
  url: string;
  kind: ShareKind;
  /** The record it shows; null for the whole log. */
  subject: string | null;
  anchor: string | null;
  createdAt: string;
  timesOpened: number;
  lastOpenedAt: string | null;
}

export interface SharesState {
  links: ShareLink[];
  /** The Standard connection: "broken" when Google Drive needs connecting again. */
  storage: "ok" | "broken" | null;
}

/** Making a link needs the terms that cover links accepted first. */
export class TermsNeeded extends Error {
  readonly version: number;
  constructor(version: number, message: string) {
    super(message);
    this.version = version;
  }
}

async function request<T>(method: "GET" | "POST" | "DELETE", path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, { method, headers: body ? { "Content-Type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined, credentials: "same-origin" });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string; terms?: number };
  if (res.status === 409 && typeof data.terms === "number") throw new TermsNeeded(data.terms, data.error ?? "Accept the updated terms first.");
  if (!res.ok) throw new Error(data.error ?? `Something went wrong (${res.status}).`);
  return data;
}

let state: SharesState | null = null;
let loading: Promise<void> | null = null;
const listeners = new Set<() => void>();
const changed = () => {
  for (const l of listeners) l();
};

/** Read the links from the server again. */
export function loadShares(): Promise<void> {
  loading ??= request<{ shares: ShareLink[]; storage: SharesState["storage"] }>("GET", "/api/shares")
    .then((r) => {
      state = { links: r.shares, storage: r.storage };
      changed();
    })
    .finally(() => {
      loading = null;
    });
  return loading;
}

/** The owner's links, loaded when first asked for in Standard mode; null until then, or in other modes. */
export function useShares(standard: boolean): SharesState | null {
  const s = useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state,
  );
  useEffect(() => {
    if (standard && !state) void loadShares().catch(() => {});
  }, [standard]);
  return standard ? s : null;
}

/** The link that shows a thing, if it has one. */
export function linkFor(s: SharesState | null, kind: ShareKind, subject: string | null): ShareLink | null {
  return s?.links.find((l) => l.kind === kind && (l.subject ?? null) === subject) ?? null;
}

export const shares = {
  /** Make a link, or get the one the thing has. */
  async make(kind: ShareKind, subject: string | null, anchor: string | null = null): Promise<ShareLink> {
    const link = await request<ShareLink>("POST", "/api/shares", { kind, subject, anchor });
    state = { links: [link, ...(state?.links ?? []).filter((l) => l.id !== link.id)], storage: state?.storage ?? "ok" };
    changed();
    return link;
  },
  async stop(id: string): Promise<void> {
    await request("DELETE", `/api/shares/${encodeURIComponent(id)}`);
    if (state) state = { ...state, links: state.links.filter((l) => l.id !== id) };
    changed();
  },
  async stopAll(): Promise<number> {
    const r = await request<{ stopped: number }>("DELETE", "/api/shares");
    if (state) state = { ...state, links: [] };
    changed();
    return r.stopped;
  },
};
