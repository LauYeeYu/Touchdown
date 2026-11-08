// The Share button and its dialog (docs/32-modes-and-sharing.md, "Managing links"): on a flight's, a sighting's and an
// aircraft's page in Standard mode, and for the whole log on Home and the Shared links page. The dialog makes the
// thing's link (one per thing) or shows the one it has, to copy, send or stop. A link is public: anyone with the
// address can open it, without signing in, until it is stopped.

import { useEffect, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import type { ShareKind } from "@touchdown/core/share";
import { sentenceGap, t } from "@touchdown/i18n";
import { account } from "../data/account.ts";
import { useApp } from "../data/context.tsx";
import { linkFor, shares, TermsNeeded, useShares, type ShareLink } from "../data/shares.ts";
import { standard } from "../data/standard.ts";
import { momentLabel } from "../lib/format.ts";
import { tx } from "../lib/i18n.tsx";
import { Icon } from "../lib/icons.tsx";
import { toast } from "./overlay.tsx";
import { sendPreview } from "../lib/preview.ts";
import { StandardTerms, TERMS_VERSION } from "./StandardTerms.tsx";
import { useBackdropClose } from "../lib/dialog.ts";

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));


/** How often a link was opened: "Opened 3 times, last 29 Oct 2026, 14:05 UTC+1", "Not opened yet". */
export function openedText(l: ShareLink): string {
  if (!l.timesOpened) return t("sharing.opened.never");
  return l.lastOpenedAt ? t("sharing.opened.last", { count: l.timesOpened, last: momentLabel(Date.parse(l.lastOpenedAt)) }) : t("sharing.opened.times", { count: l.timesOpened });
}

/** Copy a link's address, saying so. */
export function copyLink(url: string) {
  void navigator.clipboard?.writeText(url).then(
    () => toast(t("sharing.copy.done")),
    () => toast(t("sharing.copy.failed")),
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
        {link ? t("sharing.button.shared") : t("sharing.button.share")}
      </button>
      {open && <ShareDialog kind={kind} subject={subject} anchor={anchor} onClose={() => setOpen(false)} />}
    </>
  );
}

/**
 * Home's share icon for the whole log, at the end of the period control's row (docs/32, "Managing links"): in Standard
 * mode only, a link icon once the log is shared.
 */
export function ShareLogButton() {
  const { app } = useApp();
  const on = app.connection?.mode === "standard";
  const list = useShares(on);
  const [open, setOpen] = useState(false);
  if (!on) return null;
  const label = linkFor(list, "log", null) ? t("sharing.log.shared") : t("sharing.log.share");
  return (
    <>
      <button type="button" className="icon-btn share-log" aria-label={label} title={label} aria-haspopup="dialog" onClick={() => setOpen(true)}>
        <Icon name={linkFor(list, "log", null) ? "link" : "share-2"} />
      </button>
      {open && <ShareDialog kind="log" subject={null} onClose={() => setOpen(false)} />}
    </>
  );
}

export function ShareDialog({ kind, subject, anchor = null, onClose }: { kind: ShareKind; subject: string | null; anchor?: string | null; onClose: () => void }) {
  const { app } = useApp();
  const dialog = useRef<HTMLDialogElement>(null);
  const backdrop = useBackdropClose(() => dialog.current?.close());
  const list = useShares(true);
  const link = linkFor(list, kind, subject);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [terms, setTerms] = useState(false);
  const [termsProblem, setTermsProblem] = useState<string | null>(null);
  // A whole log's pages name the account's owner, so the dialog says so: left out if the name cannot be read.
  const [owner, setOwner] = useState<string | null>(null);
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  useEffect(() => {
    if (kind === "log") void account.me().then((me) => setOwner(me.name), () => {});
  }, [kind]);
  const titled = kind === "log" && owner && (
    <>
      {sentenceGap()}
      {tx("sharing.dialog.owner", { owner: <bdi>{owner}</bdi> })}
    </>
  );

  const make = async () => {
    setBusy(true);
    setProblem(null);
    try {
      const link = await shares.make(kind, subject, anchor);
      // Its preview for chat apps, drawn here (lib/preview.ts). The link works without one.
      if (!link.previewFingerprint) void sendPreview(app, link).catch((e: unknown) => console.warn("The link's preview was not made:", e));
    } catch (e) {
      if (e instanceof TermsNeeded) setTerms(true);
      else setProblem(message(e));
    }
    setBusy(false);
  };
  const stop = async (l: ShareLink) => {
    if (!window.confirm(t("sharing.stop.confirm", { kind }))) return;
    setBusy(true);
    try {
      await shares.stop(l.id);
      toast(t("sharing.stop.done"));
      onClose();
    } catch (e) {
      setProblem(message(e));
      setBusy(false);
    }
  };
  const send = (l: ShareLink) => void navigator.share?.({ url: l.url }).catch(() => {});
  const title = t("sharing.dialog.title", { kind });

  return (
    <dialog
      ref={dialog}
      className="share-dialog"
      aria-labelledby="share-title"
      {...backdrop}
      // React passes the terms dialog's close up to this one: only this dialog's own closes it.
      onClose={(e) => e.target === e.currentTarget && onClose()}
      onCancel={(e) => e.target === e.currentTarget && onClose()}
    >
      <h2 id="share-title" className="share-dialog__title">
        {title}
      </h2>
      {link ? (
        <>
          <p className="share-dialog__text">{t("sharing.dialog.shared")}{titled}</p>
          <span className="link-box share-dialog__link">
            <code>{link.url}</code>
            <button type="button" className="icon-btn link-box__copy" aria-label={t("sharing.copy.label")} title={t("sharing.copy.label")} onClick={() => copyLink(link.url)}>
              <Icon name="copy" />
            </button>
          </span>
          <p className="share-dialog__meta">{openedText(link)}</p>
        </>
      ) : (
        <p className="share-dialog__text">
          {t("sharing.dialog.new", { kind })}
          {titled}
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
              {t("sharing.copy.button")}
            </button>
            {"share" in navigator && (
              <button type="button" className="btn btn--quiet btn--small" onClick={() => send(link)}>
                <Icon name="share-2" />
                {t("sharing.send")}
              </button>
            )}
            <button type="button" className="btn btn--quiet btn--small btn--danger" disabled={busy} onClick={() => void stop(link)}>
              {t("sharing.stop.button")}
            </button>
          </>
        ) : (
          <button type="button" className="btn btn--primary btn--small" disabled={busy || !list} onClick={() => void make()}>
            <Icon name="link" />
            {busy ? t("sharing.making") : t("sharing.create")}
          </button>
        )}
        <button type="button" className="btn btn--ghost btn--small" onClick={onClose}>
          {link ? t("common.done") : t("common.cancel")}
        </button>
      </div>
      <Link className="share-dialog__all" to="/shares" onClick={onClose}>
        {t("sharing.all")}
      </Link>
      <StandardTerms
        open={terms}
        busy={busy}
        problem={termsProblem}
        acceptLabel={t("sharing.terms.accept")}
        busyLabel={t("sharing.making")}
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
