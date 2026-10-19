// Map: every flight of the period as a great circle (or its recorded track) and every spotting location.

import { useMemo } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useApp } from "../data/context.tsx";
import { inPeriod, usePeriod } from "../lib/period.ts";
import { sortedFlights } from "../lib/views.ts";
import { mapFlights, mapSpots } from "../lib/mapdata.ts";
import { airlineLabel, plural } from "../lib/format.ts";
import { Icon } from "../lib/icons.tsx";
import { PeriodControl } from "../components/PeriodControl.tsx";
import { WorldMap } from "../components/maps.tsx";
import { useViewState } from "../lib/viewState.ts";

export function MapPage() {
  const { app, version } = useApp();
  const { store, ref } = app;
  const navigate = useNavigate();
  const { year, setYear, years } = usePeriod(store, version);
  const unit = app.settings().distanceUnit ?? "km";
  // Kept for Back (lib/viewState.ts).
  const [showFlights, setShowFlights] = useViewState("showFlights", true);
  const [showSpots, setShowSpots] = useViewState("showSpots", true);
  const [airline, setAirline] = useViewState("airline", "");
  const data = useMemo(() => {
    const views = sortedFlights(store, ref).filter((v) => inPeriod(v.day, year));
    const sightings = store.all("sightings").filter((s) => inPeriod(s.seenOn, year));
    return { views, sightings };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store, ref, version, year]);
  const airlines = [...new Set(data.views.map((v) => v.f.airlineId).filter((x): x is string => !!x))].sort((a, b) => airlineLabel(a, ref).localeCompare(airlineLabel(b, ref)));
  const views = data.views.filter((v) => !airline || v.f.airlineId === airline);
  const viewKey = views.map((v) => v.f.id).join(",");
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const allMarks = useMemo(() => mapFlights(views, ref, unit, new Set(), store), [viewKey, version, unit]);
  const flights = showFlights ? allMarks : [];
  const spots = showSpots ? mapSpots(data.sightings, ref) : [];
  return (
    <div className="page page--wide">
      <div className="view-top">
        <PeriodControl year={year} years={years} onChange={setYear} />
      </div>
      <div className="filters">
        <label className="check">
          <input type="checkbox" checked={showFlights} onChange={(e) => setShowFlights(e.target.checked)} />
          Flights ({views.length})
        </label>
        <label className="check">
          <input type="checkbox" checked={showSpots} onChange={(e) => setShowSpots(e.target.checked)} />
          Spotting locations ({new Set(data.sightings.map((s) => s.airportId).filter(Boolean)).size})
        </label>
        <label>
          <span className="visually-hidden">Airline</span>
          <select className="select" value={airline} onChange={(e) => setAirline(e.target.value)}>
            <option value="">All airlines</option>
            {airlines.map((id) => (
              <option key={id} value={id}>
                {airlineLabel(id, ref)}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="map-wrap">
        <div className="legend">
          <span className="legend__item">
            <span className="swatch-line" />
            Flights: recorded track where there is one, great circle otherwise
          </span>
          <span className="legend__item">
            <span className="swatch-dot" />
            Spotting locations, sized by aircraft seen
          </span>
                  <Link className="legend__action" to="/globe">
            <Icon name="globe" />
            Explore on a globe
          </Link>
        </div>
        <WorldMap flights={flights} spots={spots} mode="auto" onArcClick={(f) => navigate({ to: "/flights/$id", params: { id: f.id } })} onAirportClick={(id) => navigate({ to: "/airports/$id", params: { id } })} label={`Map of ${plural(flights.length, "flight")} and ${plural(spots.length, "spotting location")}`} />
      </div>
      <p className="section__aside stats-note">Figure and video export of maps comes in a later version.</p>
    </div>
  );
}
