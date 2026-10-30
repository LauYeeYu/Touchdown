// Shared links (docs/32-modes-and-sharing.md, "Managing links"): every link the user made, named from their own log,
// with its address to copy, how often it was opened, and Stop sharing. The whole log is shared from here. In Private
// and Local there are no links: the page says they need Standard mode.

import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { recordTitle } from "@touchdown/core/view";
import { useApp } from "../data/context.tsx";
import { linkFor, loadShares, shares, useShares, type ShareLink } from "../data/shares.ts";
import { codeStyle } from "../lib/codes.ts";
import { dateOnly, plural, typeName } from "../lib/format.ts";
import { Icon } from "../lib/icons.tsx";
import { MenuButton } from "../components/Menu.tsx";
import { copyLink, openedText, ShareDialog } from "../components/ShareDialog.tsx";
import { toast } from "../components/overlay.tsx";
import type { AppData } from "../data/app.ts";

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

interface Named {
  title: string;
  /** The record's page in the app, or null when it is no longer in the log. */
  to: { to: string; params?: Record<string, string> } | null;
}

/** What a link shows, named from this browser's copy of the log. */
function named(app: AppData, l: ShareLink): Named {
  const { store, ref } = app;
  switch (l.kind) {
    case "log":
      return { title: "Your whole log", to: { to: "/" } };
    case "flight":
      return store.get("flights", l.subject)
        ? { title: `Flight ${recordTitle(store, ref, "flights", l.subject!, codeStyle())}`, to: { to: "/flights/$id", params: { id: l.subject! } } }
        : { title: "A flight no longer in your log", to: null };
    case "sighting":
      return store.get("sightings", l.subject)
        ? { title: `Sighting of ${recordTitle(store, ref, "sightings", l.subject!, codeStyle())}`, to: { to: "/spotting/$id/edit", params: { id: l.subject! } } }
        : { title: "A sighting no longer in your log", to: null };
    case "aircraft": {
      // An aircraft merged into another since: the link shows the one its anchor record belongs to now.
      let a = store.get("airframes", l.subject);
      if (!a && l.anchor) {
        const [table, id] = l.anchor.split("/") as ["flights" | "sightings", string];
        a = store.get("airframes", store.get(table, id)?.airframeId);
      }
      if (!a) return { title: "An aircraft no longer in your log", to: null };
      const reg = [...store.all("flights"), ...store.all("sightings")].find((r) => r.airframeId === a.id && r.registration)?.registration;
      return { title: ["Aircraft", reg, a.typeCode && typeName(a.typeCode, ref)].filter(Boolean).join(" · "), to: { to: "/aircraft/$id", params: { id: a.id } } };
    }
  }
}

export function SharedLinks() {
  const { app } = useApp();
  const on = app.connection?.mode === "standard";
  const list = useShares(on);
  const [sharingLog, setSharingLog] = useState(false);
  // The counts as they are now, each time the page opens.
  useEffect(() => {
    if (on) void loadShares().catch(() => {});
  }, [on]);

  if (!on) {
    return (
      <div className="page page--form">
        <div className="view-top" />
        <h1 className="form-title">Shared links</h1>
        <p className="form-sub">Share links need Standard mode, where Touchdown's server keeps a key to your Google Drive so a link works while you are offline.</p>
        <div className="button-row">
          <Link className="btn btn--quiet" to="/settings">
            <Icon name="settings" />
            Change in Settings
          </Link>
        </div>
      </div>
    );
  }

  const links = list?.links ?? [];
  const logLink = linkFor(list, "log", null);
  const stop = async (l: ShareLink, title: string) => {
    if (!window.confirm(`Stop sharing ${title === "Your whole log" ? "your whole log" : title}? The link stops working at once, for everyone who has it.`)) return;
    try {
      await shares.stop(l.id);
      toast("The link was stopped.");
    } catch (e) {
      toast(message(e));
    }
  };
  const stopAll = async () => {
    if (!window.confirm(`Stop all ${plural(links.length, "link")}? They stop working at once, for everyone who has them.`)) return;
    try {
      toast(`${plural(await shares.stopAll(), "link was", "links were")} stopped.`);
    } catch (e) {
      toast(message(e));
    }
  };

  return (
    <div className="page page--form">
      <div className="view-top" />
      <h1 className="form-title">Shared links</h1>
      <p className="form-sub">
        {links.length ? `You have ${plural(links.length, "shared link")}. ` : ""}Anyone with a link can open it, without signing in. A link shows your log as it is now and works until you stop it. Ticket numbers and booking references are never shared.
      </p>
      {list?.storage === "broken" && (
        <p className="status-line status-line--error" role="alert">
          <Icon name="cloud-off" />
          <span>
            Your links are not available right now: the key to your Google Drive no longer works. <Link to="/settings">Connect Google Drive again in Settings</Link>.
          </span>
        </p>
      )}
      {!logLink && (
        <div className="button-row">
          <button type="button" className="btn btn--quiet" onClick={() => setSharingLog(true)}>
            <Icon name="share-2" />
            Share your whole log
          </button>
        </div>
      )}
      {sharingLog && <ShareDialog kind="log" subject={null} onClose={() => setSharingLog(false)} />}

      {!list ? (
        <p className="form-sub">Reading your links…</p>
      ) : links.length === 0 ? (
        <p className="shares-empty">No shared links. Share a flight, a sighting or an aircraft from its page, or your whole log from here.</p>
      ) : (
        <ul className="account-card shares-list">
          {links.map((l) => {
            const n = named(app, l);
            return (
              <li key={l.id} className="account-item">
                <span className="account-item__text">
                  {n.to ? (
                    <Link className="shares-list__title" to={n.to.to} params={n.to.params as never}>
                      {n.title}
                    </Link>
                  ) : (
                    <span className="shares-list__title">{n.title}</span>
                  )}
                  <small>
                    Made {dateOnly(l.createdAt.slice(0, 10), { day: "numeric", month: "short", year: "numeric" })} · {openedText(l)}
                    {!n.to && " · the link says it is no longer shared"}
                  </small>
                </span>
                <span className="shares-list__actions">
                  <button type="button" className="btn btn--quiet btn--small" onClick={() => copyLink(l.url)}>
                    <Icon name="copy" />
                    Copy link
                  </button>
                  <MenuButton
                    className="icon-btn"
                    label={`More for ${n.title}`}
                    items={[
                      { label: "Open the link", icon: <Icon name="external-link" />, onSelect: () => window.open(l.url, "_blank", "noopener") },
                      { label: "Stop sharing", icon: <Icon name="x" />, onSelect: () => void stop(l, n.title) },
                    ]}
                  >
                    <Icon name="ellipsis" />
                  </MenuButton>
                </span>
              </li>
            );
          })}
        </ul>
      )}
      {links.length > 1 && (
        <div className="button-row">
          <button type="button" className="btn btn--danger btn--small" onClick={() => void stopAll()}>
            Stop all links
          </button>
        </div>
      )}
    </div>
  );
}
