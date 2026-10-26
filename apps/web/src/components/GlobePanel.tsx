// The globe inside a page (docs/31-ui.md, "Globe"): a head row with the page's legend or switches, then the globe
// with Expand in its top corner, zoom buttons and a hint. The head row is the same as the flat map's, so switching
// between them moves nothing. Expand shows the whole panel full screen; Esc, Back on Android or Collapse return it
// to the page. Without the Fullscreen API it covers the window instead.

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Globe, type GlobeHandle } from "./Globe.tsx";
import type { MapFlight, MapSpot } from "./maps.tsx";
import { Icon } from "../lib/icons.tsx";

interface Props {
  flights: MapFlight[];
  spots: MapSpot[];
  label: string;
  /** The page's legend items or switches, before the Expand button. */
  head?: ReactNode;
  /** Said after the gestures, e.g. how many flights have recorded tracks. */
  note?: string;
  onFlightClick?: (f: MapFlight) => void;
  onAirportClick?: (airportId: string) => void;
  /** Dashed reference great circles (a flight's page draws its great circle beside the recorded track). */
  greatCircles?: [number, number][][];
  /** The stage's height in a page, to match the flat map it replaces; by default it follows the window. */
  height?: number;
  className?: string;
}

export function GlobePanel({ flights, spots, label, head, note, onFlightClick, onAirportClick, greatCircles, height, className = "" }: Props) {
  const panel = useRef<HTMLDivElement>(null);
  const globe = useRef<GlobeHandle>(null);
  const [full, setFull] = useState(false);

  useEffect(() => {
    const sync = () => setFull(!!panel.current && document.fullscreenElement === panel.current);
    document.addEventListener("fullscreenchange", sync);
    return () => document.removeEventListener("fullscreenchange", sync);
  }, []);

  // The window-covering fallback has no browser gesture to leave it: Esc does.
  useEffect(() => {
    if (!full || document.fullscreenElement) return;
    const key = (e: KeyboardEvent) => e.key === "Escape" && setFull(false);
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [full]);

  const toggle = () => {
    if (full) {
      if (document.fullscreenElement) void document.exitFullscreen().catch(() => setFull(false));
      else setFull(false);
    } else if (panel.current?.requestFullscreen) {
      panel.current.requestFullscreen().catch(() => setFull(true));
    } else setFull(true);
  };

  const opens = onFlightClick && onAirportClick ? " · click a route or an airport to open it" : onAirportClick ? " · click an airport to open it" : onFlightClick ? " · click a route to open it" : "";
  return (
    <div className={`map-wrap globe-panel${full ? " is-full" : ""}${className ? ` ${className}` : ""}`} ref={panel}>
      {head && <div className="legend globe-panel__head">{head}</div>}
      <div className="globe-stage" style={height && !full ? { height } : undefined}>
        <Globe ref={globe} flights={flights} spots={spots} greatCircles={greatCircles} contained={!full} onFlightClick={onFlightClick} onAirportClick={onAirportClick} label={`${label}. Drag or use the arrow keys to turn it; pinch, ${full ? "scroll" : "Ctrl-scroll"} or use plus and minus to zoom.`} />
        <button type="button" className="globe-expand" onClick={toggle} aria-label={full ? "Leave full screen" : "Show the globe full screen"}>
          <Icon name={full ? "minimize-2" : "maximize-2"} />
          {full ? "Collapse" : "Expand"}
        </button>
        <div className="globe-controls" aria-label="Globe controls">
          <button type="button" className="icon-btn globe-btn" onClick={() => globe.current?.zoomBy(1.4)} aria-label="Zoom in" title="Zoom in">
            <Icon name="plus" />
          </button>
          <button type="button" className="icon-btn globe-btn" onClick={() => globe.current?.zoomBy(1 / 1.4)} aria-label="Zoom out" title="Zoom out">
            <Icon name="minus" />
          </button>
          <button type="button" className="icon-btn globe-btn" onClick={() => globe.current?.reset()} aria-label="Turn back to show everything" title="Turn back to show everything">
            <Icon name="rotate-ccw" />
          </button>
        </div>
        <p className="globe-hint">
          Drag to turn · {full ? "scroll or pinch" : "pinch or Ctrl-scroll"} to zoom{opens}
          {note && ` · ${note}`}
        </p>
      </div>
    </div>
  );
}
