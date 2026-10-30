// The Share button and its dialog (docs/32-modes-and-sharing.md, "Managing links"): on a flight's, a sighting's and an
// aircraft's page in Standard mode, and for the whole log on the Shared links page. The dialog makes the thing's link
// (one per thing) or shows the one it has, to copy, send or stop. A link is public: anyone with the address can open
// it, without signing in, until it is stopped.

import { useEffect, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import type { ShareKind } from "@touchdown/core/share";
import { useApp } from "../data/context.tsx";
import { linkFor, shares, TermsNeeded, useShares, type ShareLink } from "../data/shares.ts";
import { standard } from "../data/standard.ts";
import { momentLabel, plural } from "../lib/format.ts";
import { Icon } from "../lib/icons.tsx";
import { toast } from "./overlay.tsx";
import { StandardTerms, TERMS_VERSION } from "./StandardTerms.tsx";

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** What a link shows, for the dialog's words: "this flight", "your whole log". */
const THING: Record<ShareKind, string> = { flight: "this flight", sighting: "this sighting", aircraft: "this aircraft", log: "your whole log" };

/** How often a link was opened: "Opened 3 times, last 29 Oct 2026, 14:05 UTC+1", "Not opened yet". */
export function openedText(l: ShareLink): string {
  if (!l.timesOpened) return "Not opened yet";
  return `Opened ${plural(l.timesOpened, "time")}${l.lastOpenedAt ? `, last ${momentLabel(Date.parse(l.lastOpenedAt))}` : ""}`;
}

/** Copy a link's address, saying so. */
export function copyLink(url: string) {
  void navigator.clipboard?.writeText(url).then(
    () => toast("Link copied."),
    () => toast("Could not copy. Select the link instead."),
  );
}

/** Share on a record's page: in Standard mode only, and "Shared" once the thing has a link. */
export function ShareButton({ kind, subject, anchor = null }: { kind: Exclude<ShareKind, "log">; subject: string; anchor?: string | null }) {
  const { app } = useApp();
  const on = app.connection?.mode === "standard";
  const list = useShares(on);
  const [open, setOpen] = useState(false);
  if (!on) return null;
  const link = linkFor(list, kind, subject);
  return (
    <>
      <button type="button" className="btn btn--quiet btn--small" onClick={() => setOpen(true)} aria-haspopup="dialog">
        <Icon name={link ? "link" : "share-2"} />
        {link ? "Shared" : "Share"}
      </button>
      {open && <ShareDialog kind={kind} subject={subject} anchor={anchor} onClose={() => setOpen(false)} />}
    </>
  );
}

export function ShareDialog({ kind, subject, anchor = null, onClose }: { kind: ShareKind; subject: string | null; anchor?: string | null; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const list = useShares(true);
  const link = linkFor(list, kind, subject);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [terms, setTerms] = useState(false);
  const [termsProblem, setTermsProblem] = useState<string | null>(null);
  useEffect(() => {
    dialog.current?.showModal();
  }, []);

  const make = async () => {
    setBusy(true);
    setProblem(null);
    try {
      await shares.make(kind, subject, anchor);
    } catch (e) {
      if (e instanceof TermsNeeded) setTerms(true);
      else setProblem(message(e));
    }
    setBusy(false);
  };
  const stop = async (l: ShareLink) => {
    if (!window.confirm(`Stop sharing ${THING[kind]}? The link stops working at once, for everyone who has it.`)) return;
    setBusy(true);
    try {
      await shares.stop(l.id);
      toast("The link was stopped.");
      onClose();
    } catch (e) {
      setProblem(message(e));
      setBusy(false);
    }
  };
  const send = (l: ShareLink) => void navigator.share?.({ url: l.url }).catch(() => {});
  const title = kind === "log" ? "Share your whole log" : `Share ${THING[kind]}`;

  return (
    <dialog
      ref={dialog}
      className="share-dialog"
      aria-labelledby="share-title"
      // React passes the terms dialog's close up to this one: only this dialog's own closes it.
      onClose={(e) => e.target === e.currentTarget && onClose()}
      onCancel={(e) => e.target === e.currentTarget && onClose()}
    >
      <h2 id="share-title" className="share-dialog__title">
        {title}
      </h2>
      {link ? (
        <>
          <p className="share-dialog__text">Anyone with this link can open it, without signing in, until you stop sharing it. It shows your log as it is now.</p>
          <span className="link-box share-dialog__link">
            <code>{link.url}</code>
            <button type="button" className="icon-btn link-box__copy" aria-label="Copy the link" title="Copy the link" onClick={() => copyLink(link.url)}>
              <Icon name="copy" />
            </button>
          </span>
          <p className="share-dialog__meta">{openedText(link)}</p>
        </>
      ) : (
        <p className="share-dialog__text">
          Anyone with the link can see {THING[kind]}
          {kind === "aircraft" ? " and your flights and sightings of it" : ""}, notes and photo links included. Ticket numbers and booking references are never shared.
        </p>
      )}
      {problem && (
        <p className="status-line status-line--error" role="alert">
          <Icon name="circle-x" />
          <span>{problem}</span>
        </p>
      )}
      <div className="share-dialog__foot">
        {link ? (
          <>
            <button type="button" className="btn btn--primary btn--small" onClick={() => copyLink(link.url)}>
              <Icon name="copy" />
              Copy link
            </button>
            {"share" in navigator && (
              <button type="button" className="btn btn--quiet btn--small" onClick={() => send(link)}>
                <Icon name="share-2" />
                Send…
              </button>
            )}
            <button type="button" className="btn btn--quiet btn--small btn--danger" disabled={busy} onClick={() => void stop(link)}>
              Stop sharing
            </button>
          </>
        ) : (
          <button type="button" className="btn btn--primary btn--small" disabled={busy || !list} onClick={() => void make()}>
            <Icon name="link" />
            {busy ? "Making the link…" : "Create link"}
          </button>
        )}
        <button type="button" className="btn btn--ghost btn--small" onClick={onClose}>
          {link ? "Done" : "Cancel"}
        </button>
      </div>
      <Link className="share-dialog__all" to="/shares" onClick={onClose}>
        All shared links
      </Link>
      <StandardTerms
        open={terms}
        busy={busy}
        problem={termsProblem}
        acceptLabel="Accept"
        busyLabel="Making the link…"
        onAccept={() => {
          setBusy(true);
          setTermsProblem(null);
          void standard.accept(TERMS_VERSION).then(
            () => {
              setTerms(false);
              setBusy(false);
              void make();
            },
            (e: unknown) => {
              setTermsProblem(message(e));
              setBusy(false);
            },
          );
        }}
        onDecline={() => setTerms(false)}
      />
    </dialog>
  );
}
