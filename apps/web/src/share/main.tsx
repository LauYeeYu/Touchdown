// The share page (docs/32-modes-and-sharing.md, "The public page"): what one link shows, read-only, for anyone with
// its address, on the app's own pages. Built on its own (vite.share.config.ts) and served from /share-files/ without a
// session; the app and its data stay behind the sign-in.

import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "@tanstack/react-router";
import "../styles/app.css";
import { validateWithoutEval } from "@touchdown/core";
import { AppContext } from "../data/context.tsx";
import { setCodeStyle } from "../lib/codes.ts";
import { LinkScopeContext } from "../lib/link.tsx";
import { setSlugData } from "../lib/slugs.ts";
import { Frame, Message } from "./Frame.tsx";
import { loadShare, type Loaded } from "./data.ts";
import { scopeOf, shareRouter } from "./router.tsx";

// The same strict Content Security Policy as the app: no code from strings.
validateWithoutEval();

const TITLES: Record<string, string> = { flight: "A flight", sighting: "A sighting", aircraft: "An aircraft", log: "A log" };

function SharePage() {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  useEffect(() => {
    void loadShare().then(setLoaded, () => setLoaded({ state: "not-available" }));
  }, []);

  if (!loaded)
    return (
      <Frame>
        <p className="share-loading" aria-busy="true">
          Opening the link…
        </p>
      </Frame>
    );
  if (loaded.state === "not-found") return <Frame>{<Message title="This link does not open anything." text="It may have been stopped by the person who shared it, or the address may be incomplete." />}</Frame>;
  if (loaded.state === "busy") return <Frame>{<Message title="Too many requests just now." text="Wait a minute, then reload the page." />}</Frame>;
  if (loaded.state === "not-available") return <Frame>{<Message title="This link is not available right now." text="The log it shows cannot be reached at the moment. Try again later." />}</Frame>;
  return <Shared data={loaded.data} />;
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
    document.title = `${TITLES[content.kind] ?? "Shared"} · Touchdown`;
    void data.loadTracks();
  }, [data, content.kind]);

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
