// The share page (docs/32-modes-and-sharing.md, "The public page"): what one link shows, read-only, for anyone with
// its address. Built on its own (vite.share.config.ts) and served from /share-files/ without a session; the app and
// its data stay behind the sign-in.

import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import "../styles/app.css";
import { validateWithoutEval } from "@touchdown/core";
import { Frame, Message } from "./Frame.tsx";
import { loadShare, type Loaded } from "./load.ts";
import { FlightView } from "./FlightView.tsx";
import { SightingView } from "./SightingView.tsx";
import { AircraftView } from "./AircraftView.tsx";
import { LogView } from "./LogView.tsx";

// The same strict Content Security Policy as the app: no code from strings.
validateWithoutEval();

const TITLES: Record<string, string> = { flight: "A flight", sighting: "A sighting", aircraft: "An aircraft", log: "A log" };

function SharePage() {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  useEffect(() => {
    void loadShare().then(setLoaded, () => setLoaded({ state: "not-available" }));
  }, []);

  useEffect(() => {
    if (loaded?.state === "ok") document.title = `${TITLES[loaded.content.kind] ?? "Shared"} · Touchdown`;
  }, [loaded]);

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

  const { content, store, ref, id } = loaded;
  const gone = content.gone;
  return (
    <Frame>
      {content.kind === "flight" && (gone ? <Message title="This flight is no longer shared." text="It was taken out of the log it was shared from." /> : <FlightView linkId={id} store={store} ref={ref} flightId={content.subject!} />)}
      {content.kind === "sighting" && (gone ? <Message title="This sighting is no longer shared." text="It was taken out of the log it was shared from." /> : <SightingView store={store} ref={ref} sightingId={content.subject!} />)}
      {content.kind === "aircraft" && (gone ? <Message title="This aircraft is no longer shared." text="It was taken out of the log it was shared from." /> : <AircraftView store={store} ref={ref} airframeId={content.subject!} inLog={false} />)}
      {content.kind === "log" && <LogView linkId={id} store={store} ref={ref} />}
    </Frame>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <SharePage />
  </StrictMode>,
);
