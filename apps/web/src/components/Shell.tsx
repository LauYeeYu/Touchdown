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
import { download } from "../lib/download.ts";
import { momentLabel, nf, plural } from "../lib/format.ts";
import { useSyncInfo } from "./ModeChoice.tsx";
import { Overlays, hideTip, toast } from "./overlay.tsx";
import { StableLabel } from "./StableLabel.tsx";
import { Wordmark } from "./Wordmark.tsx";

const NAV: { to: string; label: string; icon: IconName; match: (p: string) => boolean }[] = [
  { to: "/", label: "Home", icon: "house", match: (p) => p === "/" },
  { to: "/flights", label: "Flights", icon: "tickets-plane", match: (p) => p.startsWith("/flights") },
  { to: "/spotting", label: "Spotting", icon: "camera", match: (p) => p.startsWith("/spotting") },
  { to: "/aircraft", label: "Aircraft", icon: "plane", match: (p) => p.startsWith("/aircraft") },
  { to: "/stats", label: "Statistics", icon: "chart-column", match: (p) => p.startsWith("/stats") },
];

/** Local mode: remind the user to export a backup when the last one is older than this and the log changed since. */
const BACKUP_DUE_DAYS = 30;

/** An error message as a clause in a sentence: without its own full stop. */
export const clause = (message: string | null) => (message ?? "").replace(/\.+$/, "");

/** Recorded tracks the browser's copy does not have yet, as a sentence; "" when there are none. */
export const tracksToComeText = (n: number, place: string) =>
  n > 0 ? `${plural(n, "recorded track is", "recorded tracks are")} not in this browser yet. ${n === 1 ? "It is" : "They are"} read from ${place} at the next sync, and until then ${n === 1 ? "its flight shows" : "their flights show"} the great circle.` : "";

/** The masthead's save and sync state: its words, its tooltip, its icon. */
function saveState(saving: "saved" | "saving" | "error", sync: SyncInfo | null, notHere: number): { text: string; title: string; icon: IconName; bad: boolean } {
  if (saving === "error") return { text: "Could not save in this browser", title: "Could not save in this browser", icon: "hard-drive", bad: true };
  if (!sync) return { text: saving === "saving" ? "Saving…" : "Saved in this browser", title: "Your log is kept in this browser only (Local).", icon: "hard-drive", bad: false };
  // The tooltip says when the copy is not whole yet: the tables not read, or tracks still to come.
  const toCome = !sync.tables ? ` Your log has not been read from ${sync.place} yet.` : notHere > 0 && !sync.tracks ? ` ${tracksToComeText(notHere, sync.place)}` : "";
  const last = `${sync.lastAt ? ` Last synced ${momentLabel(sync.lastAt)}.` : ""}${toCome}`;
  // Each state has its own icon: below 1180px wide the icon is all the header shows.
  const drive = sync.adapter === "gdrive";
  switch (sync.state) {
    case "permission":
      if (sync.mode === "standard") return { text: "Reconnect Google Drive", title: `${sync.error ?? `Touchdown cannot reach ${sync.place}.`}${last}`, icon: "cloud-off", bad: true };
      return drive
        ? { text: "Sign in to sync", title: `Sign in to Google again to sync with ${sync.place}.${last}`, icon: "cloud-off", bad: true }
        : { text: "Folder needs permission", title: `Touchdown needs your permission to use ${sync.place} again.${last}`, icon: "folder", bad: true };
    case "failed":
      return { text: "Not synced", title: `Could not sync with ${sync.place}: ${clause(sync.error)}.${last}`, icon: drive ? "cloud-alert" : "folder-x", bad: true };
    case "update":
      return { text: "Reload to update", title: `A newer version of Touchdown has changed your log in ${sync.place}. Reload to update the app.${last}`, icon: "rotate-cw", bad: true };
    case "syncing":
      // Tracks come after the rest of the log: the flights without theirs yet show great circles meanwhile.
      if (sync.tracks) {
        const of = `${nf.format(sync.tracks.done)} of ${nf.format(sync.tracks.total)}`;
        return { text: `Tracks ${of}`, title: `Reading recorded tracks from ${sync.place}: ${of}. Until a flight's track is here, its map shows the great circle.${last}`, icon: "refresh-cw", bad: false };
      }
      return { text: "Syncing…", title: `Syncing with ${sync.place}.${last}`, icon: "refresh-cw", bad: false };
    default:
      return sync.waiting > 0 || saving === "saving"
        ? { text: "Saved, not synced yet", title: `Saved in this browser and sent to ${sync.place} in a moment.${last}`, icon: drive ? "cloud-upload" : "folder-up", bad: false }
        : { text: "Synced", title: `Synced with ${sync.place}.${last}`, icon: drive ? "cloud-check" : "folder-check", bad: false };
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
const THEME_LABEL = { system: "Theme: follows your device", light: "Theme: light", dark: "Theme: dark" };
const THEME_ICON: Record<(typeof THEMES)[number], IconName> = { system: "monitor", light: "sun", dark: "moon" };

function applyTheme(theme: (typeof THEMES)[number]) {
  const root = document.documentElement;
  if (theme === "system") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", theme);
  const dark = theme === "dark" || (theme === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", dark ? "#212019" : "#f2ede2");
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
  const backupDue = useBackupDue(local, app.connection?.since ?? null, version);
  const [backupLater, setBackupLater] = useState(false);
  const notHere = sync ? app.tracksNotHere() : 0;
  const state = saveState(app.saveState, sync, notHere);

  const cycleTheme = () => {
    const next = THEMES[(THEMES.indexOf(theme) + 1) % THEMES.length]!;
    app.updateSettings({ theme: next });
    toast(THEME_LABEL[next]);
  };

  return (
    <>
      <a className="skip" href="#view">
        Skip to content
      </a>
      <header className="masthead">
        <div className="page masthead__bar">
          <Link className="wordmark" to="/">
            <Wordmark />
          </Link>
          <nav className="nav" aria-label="Main">
            {NAV.map((n) => (
              <Link key={n.to} className="nav__link" to={n.to} aria-current={n.match(path) ? "page" : undefined}>
                <Icon name={n.icon} />
                <StableLabel text={n.label} />
              </Link>
            ))}
          </nav>
          <div className="masthead__tools">
            <Link className={`sync${state.bad ? " sync--error" : ""}`} to="/settings" title={state.title}>
              <Icon name={state.icon} />
              <span className="sync__text">{state.text}</span>
            </Link>
            <Link className="icon-btn issues-btn" to="/issues" aria-label={openIssues ? `Issues: ${openIssues} entries to review` : "Issues"} title={openIssues ? `${openIssues} entries to review` : "No open issues"}>
              <Icon name="list-checks" />
              {openIssues > 0 && <span className="badge">{openIssues > 99 ? "99+" : openIssues}</span>}
            </Link>
            <button type="button" className="icon-btn theme-btn" onClick={cycleTheme} aria-label={`${THEME_LABEL[theme]}. Change theme`} title={THEME_LABEL[theme]}>
              <Icon name={THEME_ICON[theme]} />
            </button>
            <MenuButton
              className="icon-btn"
              label="Add"
              items={[
                { label: "Flight", icon: <Icon name="tickets-plane" />, onSelect: () => navigate({ to: "/flights/new" }) },
                { label: "Sighting", icon: <Icon name="camera" />, onSelect: () => navigate({ to: "/spotting/new" }) },
                { label: "Spotting session", icon: <Icon name="notebook-pen" />, onSelect: () => navigate({ to: "/spotting/session" }) },
              ]}
            >
              <Icon name="plus" />
            </MenuButton>
            <MenuButton
              className="icon-btn"
              label="More"
              items={[
                { label: "Import", icon: <Icon name="upload" />, onSelect: () => navigate({ to: "/import" }) },
                { label: "Issues", icon: <Icon name="list-checks" />, onSelect: () => navigate({ to: "/issues" }) },
                { label: "Settings", icon: <Icon name="settings" />, onSelect: () => navigate({ to: "/settings" }) },
              ]}
            >
              <Icon name="ellipsis" />
            </MenuButton>
          </div>
        </div>
      </header>
      {sync && !sync.tables && sync.state === "syncing" && (
        <NoteBar icon="refresh-cw" actions={null}>
          Reading your log from {sync.place}. It shows here once it is read.
        </NoteBar>
      )}
      {sync && !sync.tables && sync.state === "failed" && (
        <NoteBar
          icon={sync.adapter === "gdrive" ? "cloud-alert" : "folder-x"}
          actions={
            <button type="button" className="btn btn--quiet btn--small" onClick={() => void app.sync?.run()}>
              Try again
            </button>
          }
        >
          Your log could not be read from {sync.place}: {clause(sync.error)}. Touchdown tries again when the connection returns, and every few minutes.
        </NoteBar>
      )}
      {sync?.state === "permission" && (
        <NoteBar
          icon={sync.adapter === "gdrive" ? "cloud-off" : "folder"}
          actions={
            <button type="button" className="btn btn--quiet btn--small" onClick={() => void app.sync?.allow()}>
              {sync.mode === "standard" ? "Connect again" : sync.adapter === "gdrive" ? "Sign in" : "Allow"}
            </button>
          }
        >
          {!sync.tables && `Your log has not been read from ${sync.place} yet. `}
          {sync.mode === "standard" ? (sync.error ?? `Touchdown cannot reach ${sync.place}.`) : sync.adapter === "gdrive" ? `Sign in to Google again to sync with ${sync.place}.` : `Touchdown needs your permission to use ${sync.place} again.`}
          {sync.tables && " Until then, changes are kept in this browser."}
          {sync.tables && notHere > 0 && ` ${plural(notHere, "recorded track is", "recorded tracks are")} not in this browser yet.`}
          {sync.mode !== "standard" && sync.error && ` ${sync.error}`}
        </NoteBar>
      )}
      {sync?.state === "update" && (
        <NoteBar
          icon="rotate-cw"
          actions={
            <button type="button" className="btn btn--quiet btn--small" onClick={() => location.reload()}>
              Reload
            </button>
          }
        >
          A newer version of Touchdown has changed your log in {sync.place}. Reload to update the app. Until then, changes are kept in this browser.
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
                Export a backup
              </button>
              <button type="button" className="btn btn--ghost btn--small" onClick={() => setBackupLater(true)}>
                Not now
              </button>
            </>
          }
        >
          Your log is kept only in this browser{backupDue.last ? `, and your last backup is from ${new Date(backupDue.last).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}` : ", and you have not exported a backup yet"}.
        </NoteBar>
      )}
      {shown.length > 0 && path !== "/import" && (
        <NoteBar
          icon="inbox"
          actions={
            <>
              <Link to="/import" search={{ inbox: shown[0]!.name }} className="btn btn--quiet btn--small">
                Review and import
              </Link>
              <button type="button" className="btn btn--ghost btn--small" onClick={() => setLater((s) => new Set([...s, ...shown.map((w) => `${w.name}@${w.modified}`)]))}>
                Not now
              </button>
            </>
          }
        >
          {recordsText(
            shown.reduce((n, w) => n + w.flights, 0),
            shown.reduce((n, w) => n + w.sightings, 0),
            shown.reduce((n, w) => n + w.changing, 0),
          )}{" "}
          from {shown.length === 1 ? sessionPhrase(shown[0]!.name) : `${shown.length} files in the inbox`} {shownCount === 1 ? "is" : "are"} waiting. Nothing reaches your log until you import {shownCount === 1 ? "it" : "them"}.
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
                Load it
              </button>
              <button type="button" className="btn btn--ghost btn--small" onClick={() => setNewerBackup(null)}>
                Not now
              </button>
            </>
          }
        >
          Your local backup was rebuilt {new Date(newerBackup).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}. Loading it replaces the copy in this browser.
        </NoteBar>
      )}
      <main id="view" tabIndex={-1}>
        <Outlet />
      </main>
      <footer className="site-foot">
        <div className="page">
          <p>{sync ? `Your log syncs through ${sync.place}, and this browser holds a copy.` : "Your log is stored in this browser. Export a backup from Settings."}</p>
          <p>
            Airports: OurAirports (public domain) and airportsdata (MIT). Airlines: Wikidata (CC0) and the Mictronics aircraft database (ODC-By). Aircraft facts: the OpenSky Network aircraft database and adsbdb (data from PlaneBase). Map: Natural Earth (public domain) via world-atlas. Aircraft photos from{" "}
            <a href="https://www.planespotters.net/" rel="noopener" target="_blank">
              planespotters.net
            </a>
            , credited on each photo. Icons: Lucide (ISC). Typeface: Source Sans 3 (SIL Open Font License).
          </p>
          <p>
            <a href="/privacy">Privacy policy</a> · <a href="/terms">Terms of service</a>
          </p>
        </div>
      </footer>
      <Overlays />
    </>
  );
}
