// The public aircraft types pages' frame (docs/31-ui.md, "Aircraft types"): the app's masthead with the wordmark,
// which leads to the list of types, and a way to sign in that comes back to the page; a footer that says where the
// pages come from.

import { Outlet, useRouterState } from "@tanstack/react-router";
import { t } from "@touchdown/i18n";
import { Link } from "../lib/link.tsx";
import { Icon } from "../lib/icons.tsx";
import { Overlays } from "../components/overlay.tsx";
import { Wordmark } from "../components/Wordmark.tsx";

export function TypesShell() {
  const location = useRouterState({ select: (s) => s.location });
  // Signing in comes back to this page, which then opens in the app with the log.
  const next = location.pathname + (location.searchStr ?? "");
  return (
    <>
      <a className="skip" href="#view">
        {t("aircraft.types.public.skip")}
      </a>
      <header className="masthead">
        <div className="page masthead__bar">
          <Link className="wordmark" to="/types">
            <Wordmark />
          </Link>
          <div className="masthead__tools">
            <a className="btn btn--quiet btn--small" href={`/signin?next=${encodeURIComponent(next)}`}>
              <Icon name="log-in" />
              {t("aircraft.types.public.signIn")}
            </a>
          </div>
        </div>
      </header>
      <main id="view" tabIndex={-1}>
        <Outlet />
      </main>
      <footer className="site-foot">
        <div className="page">
          <p>{t("aircraft.types.public.about")}</p>
          <p>
            <a href="/privacy">{t("aircraft.types.public.privacy")}</a> · <a href="/terms">{t("aircraft.types.public.terms")}</a>
          </p>
        </div>
      </footer>
      <Overlays />
    </>
  );
}
