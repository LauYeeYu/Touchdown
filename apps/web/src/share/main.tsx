// The share page (docs/32-modes-and-sharing.md, "The public page"): what one link shows, read-only, for anyone with
// its address, on the app's own pages. Built on its own (vite.share.config.ts) and served from /share-files/ without a
// session; the app and its data stay behind the sign-in.

import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "@tanstack/react-router";
import { t } from "@touchdown/i18n";
import "../styles/app.css";
import { validateWithoutEval } from "@touchdown/core";
import type { ShareContent } from "@touchdown/core/share";
import { AppContext } from "../data/context.tsx";
import { setCodeStyle } from "../lib/codes.ts";
import { LinkScopeContext } from "../lib/link.tsx";
import { setSlugData } from "../lib/slugs.ts";
import { Boot, waitingProgress } from "../components/Boot.tsx";
import { startLanguage } from "../lib/i18n.tsx";
import { Frame, Message } from "./Frame.tsx";
import { loadShare, type Loaded } from "./data.ts";
import { scopeOf, shareRouter } from "./router.tsx";

// The same strict Content Security Policy as the app: no code from strings.
validateWithoutEval();

/**
 * The tab's title. A whole log's names its owner by their account's name, whole and unchanged in any script, and
 * isolated so that a name written right to left stays before "'s log".
 */
function titleOf(content: ShareContent): string {
  if (content.kind === "log") return content.owner ? t("share.title.log", { owner: content.owner }) : t("share.title.logUnnamed");
  return t("share.title.record", { kind: content.kind });
}

// The app's loading screen (components/Boot.tsx): the page's own bar creeps towards 30% while the code loads, the
// link's content and the reference data move it on, and it lands and fades out over the first page.
const START = Math.max(0.3, waitingProgress());
const FINISH_MS = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 300;

function SharePage() {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [progress, setProgress] = useState(() => ({ at: START, text: t("share.opening") }));
  const [finished, setFinished] = useState(false);
  // Each try opens the link afresh, without reloading the page.
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    // A try that has been replaced (or, in development, run twice) does not set the page.
    let current = true;
    void loadShare((at, text) => current && setProgress({ at, text })).then(
      (l) => current && setLoaded(l),
      () => current && setLoaded({ state: "not-available" }),
    );
    return () => {
      current = false;
    };
  }, [attempt]);
  useEffect(() => {
    if (!loaded) return;
    const t = setTimeout(() => setFinished(true), FINISH_MS);
    return () => clearTimeout(t);
  }, [loaded]);
  const retry = () => {
    setLoaded(null);
    setFinished(false);
    setProgress({ at: 0.3, text: t("share.opening") });
    setAttempt((n) => n + 1);
  };

  // The page renders under the loading screen while the bar lands and the screen fades.
  const page = !loaded ? null : loaded.state === "not-found" ? (
    <Frame>{<Message title={t("share.notFound.title")} text={t("share.notFound.text")} />}</Frame>
  ) : loaded.state === "busy" ? (
    <Frame>{<Message title={t("share.busy.title")} text={t("share.busy.text")} onRetry={retry} />}</Frame>
  ) : loaded.state === "not-available" ? (
    <Frame>{<Message title={t("share.notAvailable.title")} text={t("share.notAvailable.text")} onRetry={retry} />}</Frame>
  ) : (
    <Shared data={loaded.data} />
  );
  return (
    <>
      {page}
      {!finished && <Boot label={t("share.opening.label")} progress={loaded ? 1 : progress.at} text={loaded?.state === "ok" ? t("share.ready") : progress.text} done={!!loaded} />}
    </>
  );
}

function Shared({ data }: { data: Extract<Loaded, { state: "ok" }>["data"] }) {
  const { content } = data;
  // Set up once, as the app does when its log opens: readable addresses, and codes as the owner shows them.
  const [router] = useState(() => {
    setSlugData(data.asApp);
    setCodeStyle(data.settings().codeDisplay);
    return shareRouter(data);
  });
  useEffect(() => {
    document.title = titleOf(content);
    void data.loadTracks();
  }, [data, content]);

  if (content.gone) {
    return <Frame>{<Message title={t("share.gone.title", { kind: content.kind })} text={t("share.gone.text")} />}</Frame>;
  }
  return (
    <AppContext.Provider value={data.asApp}>
      <LinkScopeContext.Provider value={scopeOf(data)}>
        <RouterProvider router={router} />
      </LinkScopeContext.Provider>
    </AppContext.Provider>
  );
}

void startLanguage().then(() =>
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <SharePage />
    </StrictMode>,
  ),
);
