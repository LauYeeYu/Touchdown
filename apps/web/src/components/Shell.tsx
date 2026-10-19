// The app frame: masthead with the main navigation (a bottom bar on phones), tools, and the footer.

import { useEffect, useState } from "react";
import { Link, Outlet, useNavigate, useRouterState } from "@tanstack/react-router";
import { useApp } from "../data/context.tsx";
import { Icon, type IconName } from "../lib/icons.tsx";
import { MenuButton } from "./Menu.tsx";
import { Overlays, hideTip, toast } from "./overlay.tsx";
import { StableLabel } from "./StableLabel.tsx";

const NAV: { to: string; label: string; icon: IconName; match: (p: string) => boolean }[] = [
  { to: "/", label: "Home", icon: "house", match: (p) => p === "/" },
  { to: "/flights", label: "Flights", icon: "plane", match: (p) => p.startsWith("/flights") },
  { to: "/spotting", label: "Spotting", icon: "camera", match: (p) => p.startsWith("/spotting") },
  { to: "/aircraft", label: "Aircraft", icon: "id-card", match: (p) => p.startsWith("/aircraft") },
  { to: "/stats", label: "Statistics", icon: "chart-column", match: (p) => p.startsWith("/stats") || p.startsWith("/map") || p.startsWith("/globe") },
];

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
  const { app } = useApp();
  const navigate = useNavigate();
  const path = useRouterState({ select: (s) => s.location.pathname });
  const theme = (app.settings().theme ?? "system") as (typeof THEMES)[number];
  const openIssues = app.findings().filter((f) => f.severity !== "info").length;
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

  // Re-render the save state once it settles.
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 30_000);
    return () => clearInterval(t);
  }, []);

  const cycleTheme = () => {
    const next = THEMES[(THEMES.indexOf(theme) + 1) % THEMES.length]!;
    app.updateSettings({ theme: next });
    toast(THEME_LABEL[next]);
  };

  const saveText = app.saveState === "error" ? "Could not save in this browser" : app.saveState === "saving" ? "Saving…" : "Saved in this browser";

  return (
    <>
      <a className="skip" href="#view">
        Skip to content
      </a>
      <header className="masthead">
        <div className="page masthead__bar">
          <Link className="wordmark" to="/">
            TOUCHDOWN
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
            <span className={`sync${app.saveState === "error" ? " sync--error" : ""}`} title="Your data is kept in this browser. Sync to Google Drive comes later.">
              <Icon name="hard-drive" />
              <span className="sync__text">{saveText}</span>
            </span>
            <Link className="icon-btn issues-btn" to="/issues" aria-label={openIssues ? `Issues: ${openIssues} entries to review` : "Issues"} title={openIssues ? `${openIssues} entries to review` : "No open issues"}>
              <Icon name="list-checks" />
              {openIssues > 0 && <span className="badge">{openIssues > 99 ? "99+" : openIssues}</span>}
            </Link>
            <button type="button" className="icon-btn" onClick={cycleTheme} aria-label={`${THEME_LABEL[theme]}. Change theme`} title={THEME_LABEL[theme]}>
              <Icon name={THEME_ICON[theme]} />
            </button>
            <MenuButton
              className="icon-btn"
              label="More"
              items={[
                { label: "Map", icon: <Icon name="map" />, onSelect: () => navigate({ to: "/map" }) },
                { label: "Globe", icon: <Icon name="globe" />, onSelect: () => navigate({ to: "/globe" }) },
                { label: "Import", icon: <Icon name="upload" />, onSelect: () => navigate({ to: "/import" }) },
                { label: "Issues", icon: <Icon name="list-checks" />, onSelect: () => navigate({ to: "/issues" }) },
                { label: "Settings", icon: <Icon name="settings" />, onSelect: () => navigate({ to: "/settings" }) },
              ]}
            >
              <Icon name="ellipsis" />
            </MenuButton>
            <MenuButton
              className="btn btn--primary"
              anchorClassName="add-menu"
              label="Add"
              items={[
                { label: "Flight", icon: <Icon name="plane" />, onSelect: () => navigate({ to: "/flights/new" }) },
                { label: "Sighting", icon: <Icon name="camera" />, onSelect: () => navigate({ to: "/spotting/new" }) },
                { label: "Spotting session", icon: <Icon name="list-checks" />, onSelect: () => navigate({ to: "/spotting/session" }) },
              ]}
            >
              <Icon name="plus" />
              <span>Add</span>
            </MenuButton>
          </div>
        </div>
      </header>
      {import.meta.env.DEV && newerBackup && (
        <div className="dev-note" role="status">
          <div className="page dev-note__bar">
            <Icon name="hard-drive" />
            <span>Your local backup was rebuilt {new Date(newerBackup).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}. Loading it replaces what is in this browser.</span>
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
          </div>
        </div>
      )}
      <main id="view" tabIndex={-1}>
        <Outlet />
      </main>
      {!path.startsWith("/globe") && (
      <div className="fab-wrap">
        <MenuButton
          className="fab"
          label="Add"
          items={[
            { label: "Flight", icon: <Icon name="plane" />, onSelect: () => navigate({ to: "/flights/new" }) },
            { label: "Sighting", icon: <Icon name="camera" />, onSelect: () => navigate({ to: "/spotting/new" }) },
            { label: "Spotting session", icon: <Icon name="list-checks" />, onSelect: () => navigate({ to: "/spotting/session" }) },
          ]}
        >
          <Icon name="plus" />
        </MenuButton>
      </div>
      )}
      <footer className="site-foot">
        <div className="page">
          <p>Your log is stored in this browser. Export a backup from Settings.</p>
          <p>
            Airports: OurAirports (public domain) and airportsdata (MIT). Airlines: Wikidata (CC0) and the Mictronics aircraft database (ODC-By). Map: Natural Earth (public domain) via world-atlas. Aircraft photos from{" "}
            <a href="https://www.planespotters.net/" rel="noopener" target="_blank">
              planespotters.net
            </a>
            , credited on each photo. Icons: Lucide (ISC).
          </p>
        </div>
      </footer>
      <Overlays />
    </>
  );
}
