// The app frame: masthead with the main navigation (a bottom bar on phones), tools, and the footer.

import { useEffect, useState } from "react";
import { Link, Outlet, useNavigate, useRouterState } from "@tanstack/react-router";
import { useApp } from "../data/context.tsx";
import { Icon, type IconName } from "../lib/icons.tsx";
import { MenuButton } from "./Menu.tsx";
import { NoteBar } from "./NoteBar.tsx";
import { recordsText, sessionPhrase, useInboxWatcher, useWaitingSessions } from "../data/inbox.ts";
import { LAST_BACKUP, LAST_CHANGE, metaNumber } from "../data/connection.ts";
import type { SyncInfo } from "../data/sync.ts";
import { backupZip, todayIn } from "@touchdown/core";
import { sentenceGap, t } from "@touchdown/i18n";
import { download } from "../lib/download.ts";
import { dayMonthYear, momentLabel, momentShort, nf } from "../lib/format.ts";
import { tx } from "../lib/i18n.tsx";
import { useSyncInfo } from "./ModeChoice.tsx";
import { refreshPreviews } from "../lib/preview.ts";
import { TrackLoading } from "../lib/trackLoading.tsx";
import { Overlays, hideTip, toast } from "./overlay.tsx";
import { StableLabel } from "./StableLabel.tsx";
import { Wordmark } from "./Wordmark.tsx";
import { FootCredits } from "./FootCredits.tsx";

const NAV: { to: string; label: () => string; icon: IconName; match: (p: string) => boolean }[] = [
  { to: "/", label: () => t("shell.nav.home"), icon: "house", match: (p) => p === "/" },
  { to: "/flights", label: () => t("shell.nav.flights"), icon: "tickets-plane", match: (p) => p.startsWith("/flights") },
  { to: "/spotting", label: () => t("shell.nav.spotting"), icon: "camera", match: (p) => p.startsWith("/spotting") },
  { to: "/aircraft", label: () => t("shell.nav.aircraft"), icon: "plane", match: (p) => p.startsWith("/aircraft") },
  { to: "/stats", label: () => t("shell.nav.stats"), icon: "chart-column", match: (p) => p.startsWith("/stats") },
];

/** Local mode: remind the user to export a backup when the last one is older than this and the log changed since. */
const BACKUP_DUE_DAYS = 30;

/** An error message as a clause in a sentence: without its own full stop. */
export const clause = (message: string | null) => (message ?? "").replace(/\.+$/, "");

/** Recorded tracks the browser's copy does not have yet, as a sentence; "" when there are none. */
export const tracksToComeText = (n: number, place: string) => (n > 0 ? t("shell.tracksToCome", { count: n, place }) : "");

/** The masthead's save and sync state: its words, its tooltip, its icon. */
function saveState(saving: "saved" | "saving" | "error", sync: SyncInfo | null, notHere: number): { text: string; title: string; icon: IconName; bad: boolean } {
  if (saving === "error") return { text: t("shell.sync.notSaved"), title: t("shell.sync.notSaved"), icon: "hard-drive", bad: true };
  if (!sync) return { text: saving === "saving" ? t("shell.sync.saving") : t("shell.sync.savedHere"), title: t("shell.sync.localTitle"), icon: "hard-drive", bad: false };
  const place = sync.place;
  // The tooltip says when the copy is not whole yet: the tables not read, or tracks still to come.
  const toCome = !sync.tables ? `${sentenceGap()}${t("shell.sync.notRead", { place })}` : notHere > 0 && !sync.tracks ? `${sentenceGap()}${tracksToComeText(notHere, place)}` : "";
  const last = `${sync.lastAt ? `${sentenceGap()}${t("shell.sync.lastSynced", { moment: momentLabel(sync.lastAt) })}` : ""}${toCome}`;
  // Each state has its own icon: below 1180px wide the icon is all the header shows.
  const drive = sync.adapter === "gdrive";
  switch (sync.state) {
    case "permission":
      if (sync.mode === "standard") return { text: t("shell.sync.reconnect"), title: `${sync.error ?? t("shell.sync.cannotReach", { place })}${last}`, icon: "cloud-off", bad: true };
      return drive
        ? { text: t("shell.sync.signIn"), title: `${t("shell.sync.signInTitle", { place })}${last}`, icon: "cloud-off", bad: true }
        : { text: t("shell.sync.permission"), title: `${t("shell.sync.permissionTitle", { place })}${last}`, icon: "folder", bad: true };
    case "failed":
      return { text: t("shell.sync.failed"), title: `${t("shell.sync.failedTitle", { place, error: clause(sync.error) })}${last}`, icon: drive ? "cloud-alert" : "folder-x", bad: true };
    case "offline":
      // Not a fault: edits are kept here, and sync carries on by itself when the network returns.
      return {
        text: t("shell.sync.offline"),
        title: `${t("shell.sync.offlineTitle", { place, waiting: sync.waiting })}${last}`,
        icon: "wifi-off",
        bad: false,
      };
    case "update":
      return { text: t("shell.sync.update"), title: `${t("shell.sync.updateTitle", { place })}${last}`, icon: "rotate-cw", bad: true };
    case "syncing":
      // Tracks come after the rest of the log: the flights without theirs yet show great circles meanwhile.
      if (sync.tracks) {
        const of = { done: nf.format(sync.tracks.done), total: nf.format(sync.tracks.total) };
        return { text: t("shell.sync.tracks", of), title: `${t("shell.sync.tracksTitle", { place, ...of })}${last}`, icon: "refresh-cw", bad: false };
      }
      return { text: t("shell.sync.syncing"), title: `${t("shell.sync.syncingTitle", { place })}${last}`, icon: "refresh-cw", bad: false };
    default:
      return sync.waiting > 0 || saving === "saving"
        ? { text: t("shell.sync.waiting"), title: `${t("shell.sync.waitingTitle", { place })}${last}`, icon: drive ? "cloud-upload" : "folder-up", bad: false }
        : { text: t("shell.sync.synced"), title: `${t("shell.sync.syncedTitle", { place })}${last}`, icon: drive ? "cloud-check" : "folder-check", bad: false };
  }
}

/** Local mode's reminder, when a backup is due: when the last one was made, or null for never (docs/32). */
function useBackupDue(local: boolean, since: string | null, version: number): { last: number | null } | null {
  const [due, setDue] = useState<{ last: number | null } | null>(null);
  useEffect(() => {
    if (!local) {
      setDue(null);
      return;
    }
    let live = true;
    void Promise.all([metaNumber(LAST_BACKUP), metaNumber(LAST_CHANGE)]).then(([last, changed]) => {
      if (!live) return;
      const from = last ?? (since ? Date.parse(since) : Date.now());
      const old = Date.now() - from > BACKUP_DUE_DAYS * 86_400_000;
      setDue(old && changed !== null && changed > (last ?? 0) ? { last } : null);
    });
    return () => {
      live = false;
    };
  }, [local, since, version]);
  return due;
}

const THEMES = ["system", "light", "dark"] as const;
const THEME_ICON: Record<(typeof THEMES)[number], IconName> = { system: "monitor", light: "sun", dark: "moon" };

const deviceDark = () => window.matchMedia("(prefers-color-scheme: dark)").matches;
/** The look applied, or being cross-faded to: a second call during the fade compares with where it is going. */
let lookDark: boolean | null = null;

/**
 * Apply the theme, and remember it in this browser for the next first paint (index.html reads it before the app
 * loads), wherever the setting came from: one chosen on another device arrives with the log. When the page turns
 * from light to dark or back, the old look cross-fades into the new one instead of switching at once.
 */
function applyTheme(theme: (typeof THEMES)[number]) {
  const root = document.documentElement;
  try {
    localStorage.setItem("td-theme", theme);
  } catch {
    /* storage unavailable: the theme still applies, from the log, once the app has loaded */
  }
  const dark = theme === "dark" || (theme === "system" && deviceDark());
  const wasDark = lookDark ?? (root.hasAttribute("data-theme") ? root.getAttribute("data-theme") === "dark" : deviceDark());
  lookDark = dark;
  const set = () => {
    if (theme === "system") root.removeAttribute("data-theme");
    else root.setAttribute("data-theme", theme);
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", dark ? "#212019" : "#f2ede2");
  };
  const fade = dark !== wasDark && "startViewTransition" in document && document.visibilityState === "visible" && !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  // A fade cut short by the next change (a quick second press) is skipped, and the new look still applies.
  if (fade) document.startViewTransition(set).ready.catch(() => undefined);
  else set();
}

export function Shell() {
  const { app, version } = useApp();
  const navigate = useNavigate();
  const path = useRouterState({ select: (s) => s.location.pathname });
  const theme = (app.settings().theme ?? "system") as (typeof THEMES)[number];
  const openIssues = app.findings().filter((f) => f.severity !== "info").length + app.conflicts().length;
  const [, tick] = useState(0);

  useEffect(() => {
    applyTheme(theme);
    const q = window.matchMedia("(prefers-color-scheme: dark)");
    const on = () => applyTheme(theme);
    q.addEventListener("change", on);
    return () => q.removeEventListener("change", on);
  }, [theme]);

  useEffect(() => {
    hideTip();
  }, [path]);

  // Development only: offer the local backup when it was rebuilt after the one in this browser.
  const [newerBackup, setNewerBackup] = useState<number | null>(null);
  useEffect(() => {
    if (import.meta.env.DEV) {
      void import("../data/localBackup.ts").then(async (m) => {
        const modified = await m.localBackupModified();
        if (modified && modified > m.loadedBackupModified() + 1000) setNewerBackup(modified);
      });
    }
  }, []);

  // Records from the inbox (spotting sessions, ./touchdown add) waiting to be reviewed and imported. "Not now" hides
  // a file in this tab until it changes (more sightings saved to it).
  useInboxWatcher(app, version);
  const waiting = useWaitingSessions();
  const [later, setLater] = useState<Set<string>>(() => new Set());
  const shown = waiting.filter((w) => !later.has(`${w.name}@${w.modified}`));
  const shownCount = shown.reduce((n, w) => n + w.waiting, 0);

  // Re-render the save state once it settles.
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 30_000);
    return () => clearInterval(t);
  }, []);

  const sync = useSyncInfo(app);
  const local = app.connection?.mode === "local";
  // Once a day after sync in Standard mode, the previews of links that show something else now (lib/preview.ts).
  const notHereYet = sync ? app.tracksNotHere() : 0;
  useEffect(() => {
    if (app.connection?.mode !== "standard" || sync?.state !== "synced" || notHereYet || app.readOnly) return;
    const today = todayIn();
    try {
      if (localStorage.getItem("td-previews") === today) return;
      localStorage.setItem("td-previews", today);
    } catch {
      return;
    }
    void refreshPreviews(app).catch((e: unknown) => console.warn("Link previews were not refreshed:", e));
  }, [app, sync?.state, notHereYet]);
  const backupDue = useBackupDue(local, app.connection?.since ?? null, version);
  const [backupLater, setBackupLater] = useState(false);
  const notHere = sync ? app.tracksNotHere() : 0;
  const state = saveState(app.saveState, sync, notHere);

  const cycleTheme = () => {
    const next = THEMES[(THEMES.indexOf(theme) + 1) % THEMES.length]!;
    app.updateSettings({ theme: next });
    toast(t("shell.theme.label", { theme: next }));
  };

  return (
    <>
      <a className="skip" href="#view">
        {t("shell.skip")}
      </a>
      <header className="masthead">
        <div className="page masthead__bar">
          <Link className="wordmark" to="/">
            <Wordmark />
          </Link>
          <nav className="nav" aria-label={t("shell.nav.label")}>
            {NAV.map((n) => (
              <Link key={n.to} className="nav__link" to={n.to} aria-current={n.match(path) ? "page" : undefined}>
                <Icon name={n.icon} />
                <StableLabel text={n.label()} />
              </Link>
            ))}
          </nav>
          <div className="masthead__tools">
            <Link className={`sync${state.bad ? " sync--error" : ""}`} to="/settings" title={state.title}>
              <Icon name={state.icon} />
              <span className="sync__text">{state.text}</span>
            </Link>
            <Link className="icon-btn issues-btn" to="/issues" aria-label={t("shell.issues.label", { count: openIssues })} title={t("shell.issues.title", { count: openIssues })}>
              <Icon name="list-checks" />
              {openIssues > 0 && <span className="badge">{openIssues > 99 ? "99+" : openIssues}</span>}
            </Link>
            <button type="button" className="icon-btn theme-btn" onClick={cycleTheme} aria-label={t("shell.theme.button", { theme })} title={t("shell.theme.label", { theme })}>
              <Icon name={THEME_ICON[theme]} />
            </button>
            <MenuButton
              className="icon-btn"
              label={t("common.add")}
              items={[
                { label: t("shell.add.flight"), icon: <Icon name="tickets-plane" />, onSelect: () => navigate({ to: "/flights/new" }) },
                { label: t("shell.add.sighting"), icon: <Icon name="camera" />, onSelect: () => navigate({ to: "/spotting/new" }) },
                { label: t("shell.add.session"), icon: <Icon name="notebook-pen" />, onSelect: () => navigate({ to: "/spotting/session" }) },
              ]}
            >
              <Icon name="plus" />
            </MenuButton>
            <MenuButton
              className="icon-btn"
              label={t("common.more")}
              items={[
                { label: t("shell.more.import"), icon: <Icon name="upload" />, onSelect: () => navigate({ to: "/import" }) },
                { label: t("shell.more.issues"), icon: <Icon name="list-checks" />, onSelect: () => navigate({ to: "/issues" }) },
                // Share links are a Standard-mode feature (docs/32).
                ...(app.connection?.mode === "standard" ? [{ label: t("shell.more.shares"), icon: <Icon name="link" />, onSelect: () => navigate({ to: "/shares" }) }] : []),
                { label: t("shell.more.settings"), icon: <Icon name="settings" />, onSelect: () => navigate({ to: "/settings" }) },
                { label: t("shell.more.guide"), icon: <Icon name="circle-help" />, onSelect: () => navigate({ to: "/guide" }) },
              ]}
            >
              <Icon name="ellipsis" />
            </MenuButton>
          </div>
        </div>
      </header>
      {sync && !sync.tables && sync.state === "syncing" && (
        <NoteBar icon="refresh-cw" actions={null}>
          {t("shell.note.reading", { place: sync.place })}
        </NoteBar>
      )}
      {sync && !sync.tables && sync.state === "failed" && (
        <NoteBar
          icon={sync.adapter === "gdrive" ? "cloud-alert" : "folder-x"}
          actions={
            <button type="button" className="btn btn--quiet btn--small" onClick={() => void app.sync?.run()}>
              {t("shell.note.tryAgain")}
            </button>
          }
        >
          {t("shell.note.readFailed", { place: sync.place, error: clause(sync.error) })}
        </NoteBar>
      )}
      {sync && !sync.tables && sync.state === "offline" && (
        <NoteBar icon="wifi-off" actions={null}>
          {t("shell.note.readOffline", { place: sync.place })}
        </NoteBar>
      )}
      {sync?.state === "permission" && (
        <NoteBar
          icon={sync.adapter === "gdrive" ? "cloud-off" : "folder"}
          actions={
            <button type="button" className="btn btn--quiet btn--small" onClick={() => void app.sync?.allow()}>
              {sync.mode === "standard" ? t("shell.note.connectAgain") : sync.adapter === "gdrive" ? t("shell.note.signIn") : t("shell.note.allow")}
            </button>
          }
        >
          {!sync.tables && `${t("shell.sync.notRead", { place: sync.place })}${sentenceGap()}`}
          {sync.mode === "standard" ? (sync.error ?? t("shell.sync.cannotReach", { place: sync.place })) : sync.adapter === "gdrive" ? t("shell.sync.signInTitle", { place: sync.place }) : t("shell.sync.permissionTitle", { place: sync.place })}
          {sync.tables && `${sentenceGap()}${t("shell.note.untilThen")}`}
          {sync.tables && notHere > 0 && `${sentenceGap()}${t("shell.note.tracksNotHere", { count: notHere })}`}
          {sync.mode !== "standard" && sync.error && ` ${sync.error}`}
        </NoteBar>
      )}
      {sync?.state === "update" && (
        <NoteBar
          icon="rotate-cw"
          actions={
            <button type="button" className="btn btn--quiet btn--small" onClick={() => location.reload()}>
              {t("shell.note.reload")}
            </button>
          }
        >
          {t("shell.note.update", { place: sync.place })}
        </NoteBar>
      )}
      {backupDue && !backupLater && (
        <NoteBar
          icon="hard-drive"
          actions={
            <>
              <button
                type="button"
                className="btn btn--quiet btn--small"
                onClick={() => {
                  download(`touchdown-backup-${todayIn()}.zip`, backupZip(app.store) as BlobPart, "application/zip");
                  app.markBackup();
                  setBackupLater(true);
                }}
              >
                {t("shell.note.exportBackup")}
              </button>
              <button type="button" className="btn btn--ghost btn--small" onClick={() => setBackupLater(true)}>
                {t("shell.note.notNow")}
              </button>
            </>
          }
        >
          {backupDue.last ? t("shell.note.backupLast", { date: dayMonthYear(todayIn(undefined, backupDue.last)) }) : t("shell.note.backupNever")}
        </NoteBar>
      )}
      {shown.length > 0 && path !== "/import" && (
        <NoteBar
          icon="inbox"
          actions={
            <>
              <Link to="/import" search={{ inbox: shown[0]!.name }} className="btn btn--quiet btn--small">
                {t("shell.note.review")}
              </Link>
              <button type="button" className="btn btn--ghost btn--small" onClick={() => setLater((s) => new Set([...s, ...shown.map((w) => `${w.name}@${w.modified}`)]))}>
                {t("shell.note.notNow")}
              </button>
            </>
          }
        >
          {t("shell.note.inbox", {
            records: recordsText(
              shown.reduce((n, w) => n + w.flights, 0),
              shown.reduce((n, w) => n + w.sightings, 0),
              shown.reduce((n, w) => n + w.changing, 0),
            ),
            files: shown.length,
            source: shown.length === 1 ? sessionPhrase(shown[0]!.name) : "",
            count: shownCount,
          })}
        </NoteBar>
      )}
      {import.meta.env.DEV && newerBackup && (
        <NoteBar
          icon="hard-drive"
          actions={
            <>
              <button
                type="button"
                className="btn btn--quiet btn--small"
                onClick={() => {
                  if (import.meta.env.DEV) void import("../data/localBackup.ts").then((m) => m.loadLocalBackup(app));
                }}
              >
                {t("shell.note.loadIt")}
              </button>
              <button type="button" className="btn btn--ghost btn--small" onClick={() => setNewerBackup(null)}>
                {t("shell.note.notNow")}
              </button>
            </>
          }
        >
          {t("shell.note.newerBackup", { when: momentShort(new Date(newerBackup).getTime()) })}
        </NoteBar>
      )}
      <main id="view" tabIndex={-1}>
        {/* Tracks still to come while sync runs: the maps say so (lib/trackLoading.tsx). */}
        <TrackLoading.Provider value={sync?.state === "syncing" && notHere > 0}>
          <Outlet />
        </TrackLoading.Provider>
      </main>
      <footer className="site-foot">
        <div className="page">
          <p>{sync ? t("shell.foot.synced", { place: sync.place }) : t("shell.foot.local")}</p>
          <FootCredits
            links={
              <>
                <a href="/privacy">{t("shell.foot.privacy")}</a> · <a href="/terms">{t("shell.foot.terms")}</a>
              </>
            }
            label={t("shell.foot.creditsShow")}
            credits={tx(
              "shell.foot.credits",
              {},
              {
                link: (text) => (
                  <a href="https://www.planespotters.net/" rel="noopener" target="_blank">
                    {text}
                  </a>
                ),
              },
            )}
          />
        </div>
      </footer>
      <Overlays />
    </>
  );
}
