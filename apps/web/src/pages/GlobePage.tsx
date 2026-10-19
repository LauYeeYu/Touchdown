// The interactive globe page: every flight of the period (recorded track where there is one) and every
// spotting location, on a globe you can turn and zoom.

import { useMemo, useRef } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useApp } from "../data/context.tsx";
import { inPeriod, usePeriod } from "../lib/period.ts";
import { sortedFlights } from "../lib/views.ts";
import { mapFlights, mapSpots } from "../lib/mapdata.ts";
import { plural } from "../lib/format.ts";
import { Icon } from "../lib/icons.tsx";
import { PeriodControl } from "../components/PeriodControl.tsx";
import { Globe, type GlobeHandle } from "../components/Globe.tsx";
import { useViewState } from "../lib/viewState.ts";

export function GlobePage() {
  const { app, version } = useApp();
  const { store, ref } = app;
  const navigate = useNavigate();
  const { year, setYear, years } = usePeriod(store, version);
  const unit = app.settings().distanceUnit ?? "km";
  // Kept for Back (lib/viewState.ts).
  const [showFlights, setShowFlights] = useViewState("showFlights", true);
  const [showSpots, setShowSpots] = useViewState("showSpots", true);
  const globe = useRef<GlobeHandle>(null);

  const data = useMemo(() => {
    const views = sortedFlights(store, ref).filter((v) => inPeriod(v.day, year));
    const sightings = store.all("sightings").filter((s) => inPeriod(s.seenOn, year));
    return { flights: mapFlights(views, ref, unit, new Set(), store), spots: mapSpots(sightings, ref) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store, ref, version, year, unit]);

  const flights = showFlights ? data.flights : [];
  const spots = showSpots ? data.spots : [];
  const recorded = data.flights.filter((f) => f.track).length;

  return (
    <div className="globe-page">
      <div className="page globe-page__top">
        <PeriodControl year={year} years={years} onChange={setYear} />
        <div className="chips" role="group" aria-label="Show">
          <button type="button" className="chip" aria-pressed={showFlights} onClick={() => setShowFlights((v) => !v)}>
            <span className="swatch-line" />
            Flights ({data.flights.length})
          </button>
          <button type="button" className="chip" aria-pressed={showSpots} onClick={() => setShowSpots((v) => !v)}>
            <span className="swatch-dot" />
            Spotting ({data.spots.length})
          </button>
        </div>
      </div>
      <div className="globe-stage">
        <Globe
          ref={globe}
          flights={flights}
          spots={spots}
          onFlightClick={(f) => navigate({ to: "/flights/$id", params: { id: f.id } })}
          onAirportClick={(id) => navigate({ to: "/airports/$id", params: { id } })}
          label={`Globe with ${plural(flights.length, "flight")} and ${plural(spots.length, "spotting location")}. Drag or use the arrow keys to turn it; scroll, pinch or use plus and minus to zoom.`}
        />
        <div className="globe-controls" aria-label="Globe controls">
          <button type="button" className="icon-btn globe-btn" onClick={() => globe.current?.zoomBy(1.4)} aria-label="Zoom in" title="Zoom in">
            <Icon name="plus" />
          </button>
          <button type="button" className="icon-btn globe-btn" onClick={() => globe.current?.zoomBy(1 / 1.4)} aria-label="Zoom out" title="Zoom out">
            <Icon name="minus" />
          </button>
          <button type="button" className="icon-btn globe-btn" onClick={() => globe.current?.reset()} aria-label="Back to the whole period" title="Back to the whole period">
            <Icon name="rotate-ccw" />
          </button>
        </div>
        <p className="globe-hint">
          Drag to turn · scroll or pinch to zoom · click a route or an airport to open it
          {recorded > 0 && ` · ${recorded} of ${plural(data.flights.length, "flight")} recorded`}
        </p>
        <Link className="btn btn--quiet btn--small globe-flat" to="/map">
          <Icon name="map" />
          Flat map
        </Link>
      </div>
    </div>
  );
}
