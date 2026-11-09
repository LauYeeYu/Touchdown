// The share page's frame around the app's own pages (docs/32-modes-and-sharing.md, "The public page"): the app's
// masthead with its main navigation for a whole log (a bottom bar on phones), nothing that edits or opens the app, and
// a footer that says where the page comes from.

import { Outlet, useRouterState } from "@tanstack/react-router";
import { t } from "@touchdown/i18n";
import { useApp } from "../data/context.tsx";
import { Link } from "../lib/link.tsx";
import { Icon, type IconName } from "../lib/icons.tsx";
import { Overlays } from "../components/overlay.tsx";
import { StableLabel } from "../components/StableLabel.tsx";
import { Wordmark } from "../components/Wordmark.tsx";
import { FootCredits } from "../components/FootCredits.tsx";
import type { ShareData } from "./data.ts";
import { TrackLoading } from "../lib/trackLoading.tsx";
import { tx } from "../lib/i18n.tsx";

const nav = (): { to: string; label: string; icon: IconName; match: (p: string) => boolean }[] => [
  { to: "/", label: t("share.nav.home"), icon: "house", match: (p) => p === "/" },
  { to: "/flights", label: t("share.nav.flights"), icon: "tickets-plane", match: (p) => p.startsWith("/flights") },
  { to: "/spotting", label: t("share.nav.spotting"), icon: "camera", match: (p) => p.startsWith("/spotting") },
  { to: "/aircraft", label: t("share.nav.aircraft"), icon: "plane", match: (p) => p.startsWith("/aircraft") },
  { to: "/stats", label: t("share.nav.stats"), icon: "chart-column", match: (p) => p.startsWith("/stats") },
];

export function ShareShell() {
  const { app } = useApp();
  const data = app as unknown as ShareData;
  const path = useRouterState({ select: (s) => s.location.pathname });
  const log = data.content.kind === "log";
  const tracks = data.tracks;
  return (
    <>
      <a className="skip" href="#view">
        {t("share.skip")}
      </a>
      <header className="masthead">
        <div className="page masthead__bar">
          <Link className="wordmark" to="/">
            <Wordmark />
          </Link>
          {log && (
            <nav className="nav" aria-label={t("share.nav.label")}>
              {nav().map((n) => (
                <Link key={n.to} className="nav__link" to={n.to} aria-current={n.match(path) ? "page" : undefined}>
                  <Icon name={n.icon} />
                  <StableLabel text={n.label} />
                </Link>
              ))}
            </nav>
          )}
          <div className="masthead__tools">
            {tracks && (
              <span className="sync" title={t("share.tracks.about")}>
                <Icon name="route" />
                <span className="sync__text">{t("share.tracks.progress", { done: tracks.done, total: tracks.total })}</span>
              </span>
            )}
          </div>
        </div>
      </header>
      <main id="view" tabIndex={-1}>
        <TrackLoading.Provider value={!!tracks}>
          <Outlet />
        </TrackLoading.Provider>
      </main>
      <SiteFoot />
      <Overlays />
    </>
  );
}

export function SiteFoot() {
  return (
    <footer className="site-foot">
      <div className="page">
        <p>{t("share.foot.about")}</p>
        <FootCredits
          links={
            <>
              <a href="/privacy">{t("share.foot.privacy")}</a> · <a href="/terms">{t("share.foot.terms")}</a>
            </>
          }
          label={t("share.foot.creditsShow")}
          credits={tx("share.foot.credits", {}, {
            link: (text) => (
              <a href="https://www.planespotters.net/" rel="noopener" target="_blank">
                {text}
              </a>
            ),
          })}
        />
      </div>
    </footer>
  );
}
