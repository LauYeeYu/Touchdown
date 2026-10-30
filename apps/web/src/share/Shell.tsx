// The share page's frame around the app's own pages (docs/32-modes-and-sharing.md, "The public page"): the app's
// masthead with its main navigation for a whole log (a bottom bar on phones), nothing that edits or opens the app, and
// a footer that says where the page comes from.

import { Outlet, useRouterState } from "@tanstack/react-router";
import { useApp } from "../data/context.tsx";
import { Link } from "../lib/link.tsx";
import { Icon, type IconName } from "../lib/icons.tsx";
import { nf } from "../lib/format.ts";
import { Overlays } from "../components/overlay.tsx";
import { StableLabel } from "../components/StableLabel.tsx";
import { Wordmark } from "../components/Wordmark.tsx";
import type { ShareData } from "./data.ts";

const NAV: { to: string; label: string; icon: IconName; match: (p: string) => boolean }[] = [
  { to: "/", label: "Home", icon: "house", match: (p) => p === "/" },
  { to: "/flights", label: "Flights", icon: "tickets-plane", match: (p) => p.startsWith("/flights") },
  { to: "/spotting", label: "Spotting", icon: "camera", match: (p) => p.startsWith("/spotting") },
  { to: "/aircraft", label: "Aircraft", icon: "plane", match: (p) => p.startsWith("/aircraft") },
  { to: "/stats", label: "Statistics", icon: "chart-column", match: (p) => p.startsWith("/stats") },
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
        Skip to content
      </a>
      <header className="masthead">
        <div className="page masthead__bar">
          <Link className="wordmark" to="/">
            <Wordmark />
          </Link>
          {log && (
            <nav className="nav" aria-label="Main">
              {NAV.map((n) => (
                <Link key={n.to} className="nav__link" to={n.to} aria-current={n.match(path) ? "page" : undefined}>
                  <Icon name={n.icon} />
                  <StableLabel text={n.label} />
                </Link>
              ))}
            </nav>
          )}
          <div className="masthead__tools">
            {tracks && (
              <span className="sync" title="Recorded tracks are read after the rest of the log. Until a flight's is in, its map shows the great circle.">
                <Icon name="route" />
                <span className="sync__text">
                  Tracks {nf.format(tracks.done)} of {nf.format(tracks.total)}
                </span>
              </span>
            )}
          </div>
        </div>
      </header>
      <main id="view" tabIndex={-1}>
        <Outlet />
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
        <p>Shared from Touchdown, a log of flights and aircraft. Read only, and as it is now in its owner's log.</p>
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
  );
}
