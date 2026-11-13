// Share and its dialog (docs/32-modes-and-sharing.md, "Managing links"; docs/31-ui.md, "Share"): the one way to send
// something, on a flight's, a sighting's and an aircraft's page, on Flights and on Home, in every mode but on a share
// link's pages. The dialog makes the thing's link in Standard mode (one per thing) or shows the one it has, to copy,
// send or stop, and opens the image and the video of it (components/FigureDialog.tsx, VideoDialog.tsx). A link is
// public: anyone with the address can open it, without signing in, until it is stopped.

import { useEffect, useId, useState } from "react";
import { Link } from "@tanstack/react-router";
import type { ShareKind } from "@touchdown/core/share";
import { sentenceGap, t } from "@touchdown/i18n";
import { account } from "../data/account.ts";
import { useApp } from "../data/context.tsx";
import { linkFor, shares, TermsNeeded, useShares, type ShareLink } from "../data/shares.ts";
import { standard as standardMode } from "../data/standard.ts";
import { momentLabel } from "../lib/format.ts";
import { tx } from "../lib/i18n.tsx";
import { Icon } from "../lib/icons.tsx";
import { toast } from "./overlay.tsx";
import { sendPreview, shareFigure } from "../lib/preview.ts";
import type { FigureContent } from "../lib/figure.ts";
import type { VideoContent } from "../lib/video.ts";
import { FigureDialog } from "./FigureDialog.tsx";
import { VideoDialog } from "./VideoDialogLazy.tsx";
import { StandardTerms, TERMS_VERSION } from "./StandardTerms.tsx";
import { useModal } from "../lib/dialog.ts";

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** What Share shares: a record or the whole log, which have links, or the flights Flights shows, which have none. */
export type ShareWhat = ShareKind | "flights";

/**
 * The image Share offers: the page's own, with its statistics, where it has one (a flight's, Home's, Flights'), else
 * what the link shows (lib/preview.ts, shareFigure).
 */
export interface ShareImage {
  content: () => FigureContent;
  name: (ext: string) => string;
}

/** The video Share offers, where there is something to set in motion: a flight, an aircraft's flights, a period. */
export interface ShareVideo {
  content: () => VideoContent;
  name: string;
}

interface ShareProps {
  kind: ShareWhat;
  subject?: string | null;
  anchor?: string | null;
  image?: ShareImage;
  video?: ShareVideo;
  /** The year the image and the video show, where it is not what the link shows: Home's period, beside the whole log's link. */
  year?: string | null;
}

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

/**
 * Share: a small quiet button on a record's page ("Shared" once the thing has a link), or with `icon` the round button
 * at the end of Home's and Flights' period control (a link icon once the log has a link). Not on a share link's pages.
 */
export function ShareButton({ icon = false, ...props }: ShareProps & { icon?: boolean }) {
  const { app } = useApp();
  const list = useShares(app.connection?.mode === "standard" && !app.readOnly);
  const [open, setOpen] = useState(false);
  if (app.readOnly) return null;
  const link = props.kind === "flights" ? null : linkFor(list, props.kind, props.subject ?? null);
  const dialog = open && <ShareDialog {...props} onClose={() => setOpen(false)} />;
  if (icon) {
    const label = props.kind === "flights" ? t("sharing.flights.share") : link ? t("sharing.log.shared") : t("sharing.log.share");
    return (
      <>
        <button type="button" className="icon-btn share-log" aria-label={label} title={label} aria-haspopup="dialog" onClick={() => setOpen(true)}>
          <Icon name={link ? "link" : "share-2"} />
        </button>
        {dialog}
      </>
    );
  }
  return (
    <>
      <button type="button" className="btn btn--quiet btn--small" onClick={() => setOpen(true)} aria-haspopup="dialog">
        <Icon name={link ? "link" : "share-2"} />
        {link ? t("sharing.button.shared") : t("sharing.button.share")}
      </button>
      {dialog}
    </>
  );
}

/**
 * The Share dialog: the link, in Standard mode, with "All shared links" beside its buttons (elsewhere a line saying links
 * need it, with the way to Settings, after the image and the video), and the image and the video, each opening its own
 * dialog over this one. A file shared or downloaded closes both.
 */
export function ShareDialog({ kind, subject = null, anchor = null, image, video, year = null, onClose }: ShareProps & { onClose: () => void }) {
  const { app } = useApp();
  const standard = app.connection?.mode === "standard";
  const linkKind = kind === "flights" ? null : kind;
  // The terms and the image and video dialogs open over this one: their Escape and their closing are theirs (`useModal`).
  const { ref: dialog, close, props: dialogProps } = useModal(onClose);
  const list = useShares(standard && linkKind !== null);
  const link = linkKind ? linkFor(list, linkKind, subject) : null;
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [terms, setTerms] = useState(false);
  const [termsProblem, setTermsProblem] = useState<string | null>(null);
  const linkTitle = useId();
  const filesTitle = useId();
  // A whole log's pages name the account's owner, so the dialog says so: left out if the name cannot be read.
  const [owner, setOwner] = useState<string | null>(null);
  // The image or the video dialog over this one; this dialog stays under it until a file is sent.
  const [figure, setFigure] = useState<{ content: FigureContent; name: (ext: string) => string } | null>(null);
  const [film, setFilm] = useState<{ content: VideoContent; name: string } | null>(null);
  const openImage = async () => {
    if (image) return setFigure({ content: image.content(), name: image.name });
    if (!linkKind) return;
    const made = await shareFigure(app, { kind: linkKind, subject }).catch(() => null);
    if (made) setFigure(made);
    else toast(t("flights.figure.failed"));
  };
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  useEffect(() => {
    if (kind === "log" && standard) void account.me().then((me) => setOwner(me.name), () => {});
  }, [kind, standard]);
  const titled = kind === "log" && owner && (
    <>
      {sentenceGap()}
      {tx("sharing.dialog.owner", { owner: <bdi>{owner}</bdi> })}
    </>
  );

  const make = async () => {
    if (!linkKind) return;
    setBusy(true);
    setProblem(null);
    try {
      const link = await shares.make(linkKind, subject, anchor);
      // Its preview for chat apps, drawn here (lib/preview.ts). The link works without one.
      if (!link.previewFingerprint) void sendPreview(app, link).catch((e: unknown) => console.warn("The link's preview was not made:", e));
    } catch (e) {
      if (e instanceof TermsNeeded) setTerms(true);
      else setProblem(message(e));
    }
    setBusy(false);
  };
  const stop = async (l: ShareLink) => {
    if (!window.confirm(t("sharing.stop.confirm", { kind: linkKind ?? "log" }))) return;
    setBusy(true);
    try {
      await shares.stop(l.id);
      toast(t("sharing.stop.done"));
      close();
    } catch (e) {
      setProblem(message(e));
      setBusy(false);
    }
  };
  const send = (l: ShareLink) => void navigator.share?.({ url: l.url }).catch(() => {});
  const period = { period: year ? "year" : "all", year: year ?? "" };

  // The link first where one can be made (Standard mode). Elsewhere the image and the video come first, and the line
  // on links after them.
  const filesFirst = !linkKind || !standard;
  const linkSection = linkKind && (
    <section className="share-section" aria-labelledby={linkTitle}>
      <h3 className="share-section__title" id={linkTitle}>
        {t("sharing.section.link")}
      </h3>
      {!standard ? (
        <>
          <p className="share-dialog__text">{t("sharing.needStandard")}</p>
          <Link className="share-dialog__all" to="/settings" onClick={close}>
            {t("sharing.changeInSettings")}
          </Link>
        </>
      ) : (
        <>
          {link ? (
            <>
              <p className="share-dialog__text">
                {t("sharing.dialog.shared")}
                {titled}
              </p>
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
              {t("sharing.dialog.new", { kind: linkKind })}
              {titled}
            </p>
          )}
          {problem && (
            <p className="status-line status-line--error" role="alert">
              <Icon name="circle-x" />
              <span>{problem}</span>
            </p>
          )}
          {/* "All shared links" beside the link's buttons where the row has room, else under them. */}
          <div className="share-section__actions share-section__actions--link">
            <div className="share-section__buttons">
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
            </div>
            <Link className="share-dialog__all" to="/shares" onClick={close}>
              {t("sharing.all")}
            </Link>
          </div>
        </>
      )}
    </section>
  );
  const filesSection = (
    <section className="share-section" aria-labelledby={filesTitle}>
      <h3 className="share-section__title" id={filesTitle}>
        {t("sharing.section.files", { video: video ? "yes" : "no" })}
      </h3>
      <div className="share-section__actions">
        <button type="button" className={`btn ${filesFirst ? "btn--primary" : "btn--quiet"} btn--small`} aria-haspopup="dialog" onClick={() => void openImage()}>
          <Icon name="image" />
          {t("sharing.file.image", period)}
        </button>
        {video && (
          <button type="button" className="btn btn--quiet btn--small" aria-haspopup="dialog" onClick={() => setFilm({ content: video.content(), name: video.name })}>
            <Icon name="film" />
            {t("sharing.file.video", period)}
          </button>
        )}
      </div>
    </section>
  );

  return (
    <dialog ref={dialog} className="share-dialog" aria-labelledby="share-title" {...dialogProps}>
      <h2 id="share-title" className="share-dialog__title">
        {t("sharing.dialog.title", { kind })}
      </h2>
      {filesFirst ? filesSection : linkSection}
      {filesFirst ? linkSection : filesSection}
      <div className="share-dialog__foot">
        <button type="button" className="btn btn--ghost btn--small" onClick={close}>
          {link ? t("common.done") : t("common.cancel")}
        </button>
      </div>
      {figure && <FigureDialog content={figure.content} fileName={figure.name} onClose={() => setFigure(null)} onSent={close} />}
      {film && <VideoDialog content={film.content} fileName={film.name} onClose={() => setFilm(null)} onSent={close} />}
      <StandardTerms
        open={terms}
        busy={busy}
        problem={termsProblem}
        acceptLabel={t("sharing.terms.accept")}
        busyLabel={t("sharing.making")}
        onAccept={() => {
          setBusy(true);
          setTermsProblem(null);
          void standardMode.accept(TERMS_VERSION).then(
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
