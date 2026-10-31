// The share page (docs/32-modes-and-sharing.md, "The public page"): what one link shows, read-only, for anyone with
// its address, on the app's own pages. Built on its own (vite.share.config.ts) and served from /share-files/ without a
// session; the app and its data stay behind the sign-in.

import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "@tanstack/react-router";
import "../styles/app.css";
import { validateWithoutEval } from "@touchdown/core";
import type { ShareContent } from "@touchdown/core/share";
import { AppContext } from "../data/context.tsx";
import { setCodeStyle } from "../lib/codes.ts";
import { LinkScopeContext } from "../lib/link.tsx";
import { setSlugData } from "../lib/slugs.ts";
import { Boot, waitingProgress } from "../components/Boot.tsx";
import { Frame, Message } from "./Frame.tsx";
import { loadShare, type Loaded } from "./data.ts";
import { scopeOf, shareRouter } from "./router.tsx";

// The same strict Content Security Policy as the app: no code from strings.
validateWithoutEval();

const TITLES: Record<string, string> = { flight: "A flight", sighting: "A sighting", aircraft: "An aircraft" };

/**
 * The tab's title. A whole log's names its owner by their account's name, whole and unchanged in any script, and
 * isolated so that a name written right to left stays before "'s log".
 */
function titleOf(content: ShareContent): string {
  if (content.kind === "log") return content.owner ? `\u2068${content.owner}\u2069's log` : "A shared log";
  return TITLES[content.kind] ?? "Shared";
}

// The app's loading screen (components/Boot.tsx): the page's own bar creeps towards 30% while the code loads, the
// link's content and the reference data move it on, and it lands and fades out over the first page.
const START = Math.max(0.3, waitingProgress());
const FINISH_MS = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 300;

function SharePage() {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [progress, setProgress] = useState({ at: START, text: "Opening the link…" });
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
    setProgress({ at: 0.3, text: "Opening the link…" });
    setAttempt((n) => n + 1);
  };

  // The page renders under the loading screen while the bar lands and the screen fades.
  const page = !loaded ? null : loaded.state === "not-found" ? (
    <Frame>{<Message title="This link does not open anything." text="It may have been stopped by the person who shared it, or the address may be incomplete." />}</Frame>
  ) : loaded.state === "busy" ? (
    <Frame>{<Message title="Too many requests just now." text="Wait a minute, then try again." onRetry={retry} />}</Frame>
  ) : loaded.state === "not-available" ? (
    <Frame>{<Message title="This link is not available right now." text="The log it shows cannot be reached at the moment." onRetry={retry} />}</Frame>
  ) : (
    <Shared data={loaded.data} />
  );
  return (
    <>
      {page}
      {!finished && <Boot label="Opening the link" progress={loaded ? 1 : progress.at} text={loaded?.state === "ok" ? "Ready" : progress.text} done={!!loaded} />}
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
    document.title = `${titleOf(content)} · Touchdown`;
    void data.loadTracks();
  }, [data, content]);

  if (content.gone) {
    const what = content.kind === "flight" ? "This flight" : content.kind === "sighting" ? "This sighting" : "This aircraft";
    return <Frame>{<Message title={`${what} is no longer shared.`} text="It was taken out of the log it was shared from." />}</Frame>;
  }
  return (
    <AppContext.Provider value={data.asApp}>
      <LinkScopeContext.Provider value={scopeOf(data)}>
        <RouterProvider router={router} />
      </LinkScopeContext.Provider>
    </AppContext.Provider>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <SharePage />
  </StrictMode>,
);
