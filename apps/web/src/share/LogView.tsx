// A whole log on a shared link (docs/32-modes-and-sharing.md, "What a link shows"): the period's sentence and map, then
// Flights, Spotting, Aircraft and Statistics, read-only. Its own pages follow a "#" (/p/<id>#/flights/<flight id>), so
// the server sees only /p/<id>. A shared page names nobody: it says "flights", not "your flights".

import { useEffect, useMemo, useState } from "react";
import { EARTH_CIRCUMFERENCE_KM, flightDay, flightStats, phaseIndex, sightingStats, type RefIndex, type Sighting, type StatsContext, type Store } from "@touchdown/core";
import { inPeriod, yearsIn } from "@touchdown/core/view";
import { aircraftViews, sortedFlights } from "../lib/views.ts";
import { airportWithCode, routeCodes } from "../lib/codes.ts";
import { mapFlights, mapSpots } from "../lib/mapdata.ts";
import { airlineLabel, CABIN_LABEL, dayMonthYear, distance, nf, plural, typeName } from "../lib/format.ts";
import { WorldMap } from "../components/maps.tsx";
import { PeriodControl } from "../components/PeriodControl.tsx";
import { Tabs } from "../components/Tabs.tsx";
import { Fact } from "../components/Facts.tsx";
import { Ranked } from "../components/Ranked.tsx";
import { Duration } from "../components/Duration.tsx";
import { Fig } from "../components/Phrase.tsx";
import { FlightView } from "./FlightView.tsx";
import { AircraftView } from "./AircraftView.tsx";

type Tab = "flights" | "spotting" | "aircraft" | "stats";
const TABS: [Tab, string][] = [
  ["flights", "Flights"],
  ["spotting", "Spotting"],
  ["aircraft", "Aircraft"],
  ["stats", "Statistics"],
];
/** Rows a list shows before "Show all". */
const FIRST = 50;

/** The part of the address after "#", which the share page's own pages use. */
function useHash(): string[] {
  const [hash, setHash] = useState(location.hash);
  useEffect(() => {
    const on = () => {
      setHash(location.hash);
      window.scrollTo(0, 0);
    };
    addEventListener("hashchange", on);
    return () => removeEventListener("hashchange", on);
  }, []);
  return hash.replace(/^#\/?/, "").split("/");
}

export function LogView({ linkId, store, ref }: { linkId: string; store: Store; ref: RefIndex }) {
  const [page, id] = useHash();
  if (page === "flights" && id) return <FlightView linkId={linkId} store={store} ref={ref} flightId={id} back={{ href: "#/flights", label: "All flights" }} />;
  if (page === "aircraft" && id) return <AircraftView store={store} ref={ref} airframeId={id} inLog back={{ href: "#/aircraft", label: "All aircraft" }} />;
  const tab = TABS.some(([k]) => k === page) ? (page as Tab) : "flights";
  return <Overview store={store} ref={ref} tab={tab} />;
}

function Overview({ store, ref, tab }: { store: Store; ref: RefIndex; tab: Tab }) {
  const years = useMemo(() => yearsIn(store), [store]);
  const [year, setYear] = useState("all");
  const [all, setAll] = useState(false);
  const data = useMemo(() => {
    const airframes = new Map(store.all("airframes").map((a) => [a.id, a]));
    const ctx: StatsContext = { ref, airframes, phases: phaseIndex(store) };
    const views = sortedFlights(store, ref).filter((v) => inPeriod(v.day, year));
    const sightings = store.all("sightings").filter((s) => inPeriod(s.seenOn, year));
    const before: Sighting[] = year === "all" ? [] : store.all("sightings").filter((s) => s.seenOn && s.seenOn < `${year}-01-01`);
    const flights = views.map((v) => v.f);
    return {
      views,
      sightings,
      fs: flightStats(flights, ctx),
      ss: sightingStats(sightings, ctx, before),
      marks: mapFlights(views, ref, "km", new Set(), store),
      spots: mapSpots(sightings, ref),
      aircraft: aircraftViews(store).filter((a) => a.flights.some((f) => inPeriod(flightDay(f), year)) || a.sightings.some((s) => inPeriod(s.seenOn, year))),
    };
  }, [store, ref, year]);
  const { views, sightings, fs, ss, marks, spots, aircraft } = data;
  const when = year === "all" ? "Across every year" : `In ${year}`;
  const spottedAircraft = new Set(sightings.map((s) => s.airframeId).filter(Boolean)).size;
  const op = (k: string) => airlineLabel(k, ref) || k;
  const ap = (k: string) => airportWithCode(k, ref) || k;
  const ty = (k: string) => `${typeName(k, ref)} (${k})`;
  const shown = <T,>(list: T[]) => (all ? list : list.slice(0, FIRST));
  const more = (n: number) =>
    n > FIRST &&
    !all && (
      <button type="button" className="link-btn show-all" onClick={() => setAll(true)}>
        Show all {nf.format(n)}
      </button>
    );

  return (
    <>
      <div className="view-top">{years.length > 1 && <PeriodControl year={year} years={years} onChange={setYear} />}</div>
      <h1 className="lead">
        {when}, <Fig>{plural(views.length, "flight")}</Fig>
        {fs.distanceKm.value > 0 && (
          <>
            {" "}
            covering <Fig>{distance(fs.distanceKm.value, "km")}</Fig>
          </>
        )}
        {spottedAircraft > 0 && (
          <>
            , and <Fig>{plural(spottedAircraft, "aircraft", "aircraft")}</Fig> photographed
          </>
        )}
        .
      </h1>
      <div className="map-wrap">
        <WorldMap flights={marks} spots={spots} onArcClick={(f) => (location.hash = `#/flights/${f.id}`)} label={`Map of ${plural(marks.length, "flight")}${spots.length ? " and spotting locations" : ""}`} />
      </div>

      <Tabs label="The log" value={tab} onChange={(k) => (location.hash = `#/${k}`)} items={TABS} />
      <div role="tabpanel">
        {tab === "flights" &&
          (views.length ? (
            <>
              <ul className="share-rows">
                {shown([...views].reverse()).map((v) => (
                  <li key={v.f.id}>
                    <a className="share-row" href={`#/flights/${v.f.id}`}>
                      <span className="share-row__date">{v.day ? dayMonthYear(v.day) : "No date"}</span>
                      <span className="share-row__main">
                        <b>
                          {v.fromCode} → {v.toCode}
                        </b>
                        <small>{[v.f.flightNumber, v.f.airlineId && airlineLabel(v.f.airlineId, ref)].filter(Boolean).join(" · ")}</small>
                      </span>
                      <span className="share-row__side">{[v.f.registration, v.f.typeCode].filter(Boolean).join(" · ")}</span>
                    </a>
                  </li>
                ))}
              </ul>
              {more(views.length)}
            </>
          ) : (
            <p className="shares-empty">No flights in this period.</p>
          ))}
        {tab === "spotting" &&
          (sightings.length ? (
            <>
              <ul className="share-rows">
                {shown([...sightings].sort((a, b) => (b.seenOn ?? "").localeCompare(a.seenOn ?? ""))).map((s) => {
                  const body = (
                    <>
                      <span className="share-row__date">{s.seenOn ? dayMonthYear(s.seenOn) : "No date"}</span>
                      <span className="share-row__main">
                        <b>{s.registration ?? s.registrationRaw ?? "No registration"}</b>
                        <small>{[typeName(s.typeCode, ref), s.operatorId && airlineLabel(s.operatorId, ref)].filter(Boolean).join(" · ")}</small>
                      </span>
                      <span className="share-row__side">{s.spotName ?? airportWithCode(s.airportId, ref, s.airportRaw)}</span>
                    </>
                  );
                  return (
                    <li key={s.id}>
                      {s.airframeId ? (
                        <a className="share-row share-row--spotted" href={`#/aircraft/${s.airframeId}`}>
                          {body}
                        </a>
                      ) : (
                        <div className="share-row share-row--spotted">{body}</div>
                      )}
                    </li>
                  );
                })}
              </ul>
              {more(sightings.length)}
            </>
          ) : (
            <p className="shares-empty">No sightings in this period.</p>
          ))}
        {tab === "aircraft" &&
          (aircraft.length ? (
            <>
              <ul className="share-rows">
                {shown([...aircraft].sort((a, b) => (b.last ?? "").localeCompare(a.last ?? ""))).map((a) => (
                  <li key={a.airframe.id}>
                    <a className="share-row" href={`#/aircraft/${a.airframe.id}`}>
                      <span className="share-row__date">{a.last ? dayMonthYear(a.last.slice(0, 10)) : ""}</span>
                      <span className="share-row__main">
                        <b>{a.registration ?? "No registration"}</b>
                        <small>{[typeName(a.airframe.typeCode, ref), a.operatorId && airlineLabel(a.operatorId, ref)].filter(Boolean).join(" · ")}</small>
                      </span>
                      <span className="share-row__side">{[a.flights.length && plural(a.flights.length, "flight"), a.sightings.length && plural(a.sightings.length, "sighting")].filter(Boolean).join(" · ")}</span>
                    </a>
                  </li>
                ))}
              </ul>
              {more(aircraft.length)}
            </>
          ) : (
            <p className="shares-empty">No aircraft in this period.</p>
          ))}
        {tab === "stats" && (
          <>
            <dl className="facts facts--stats">
              <Fact label="Flights" value={nf.format(fs.flights)} />
              <Fact label="Distance" value={distance(fs.distanceKm.value, "km")} detail={`${(fs.distanceKm.value / EARTH_CIRCUMFERENCE_KM).toFixed(1)} times around the Earth`} />
              <Fact label="Time in the air" value={<Duration min={fs.minutes.value} pad={false} />} />
              <Fact label="Airports" value={nf.format(fs.airports.value)} detail={plural(fs.countries.value, "country", "countries")} />
              <Fact label="Airlines" value={nf.format(fs.airlines.value)} />
              <Fact label="Aircraft types" value={nf.format(fs.types.value)} />
              {sightings.length > 0 && <Fact label="Aircraft photographed" value={nf.format(spottedAircraft)} detail={plural(sightings.length, "sighting")} />}
            </dl>
            <div className="ranked-grid">
              <Ranked title="Airlines" t={fs.byAirline} label={op} unit={["flight", "flights"]} missing="airline" />
              <Ranked title="Routes" t={fs.byRoute} label={(k) => routeCodes(k, ref)} unit={["flight", "flights"]} missing="airports" />
              <Ranked title="Airports" t={fs.airportVisits} label={ap} unit={["visit", "visits"]} missing="airport" />
              <Ranked title="Aircraft types" t={fs.byType} label={ty} unit={["flight", "flights"]} missing="type" />
              <Ranked title="Cabin" t={fs.cabinClasses} label={(k) => CABIN_LABEL[k] ?? k} unit={["flight", "flights"]} missing="cabin" />
              {sightings.length > 0 && (
                <>
                  <Ranked title="Aircraft photographed, by airline" t={ss.byAirline} label={op} unit={["aircraft", "aircraft"]} color="var(--spotted)" missing="airline" />
                  <Ranked title="Aircraft photographed, by type" t={ss.byType} label={ty} unit={["aircraft", "aircraft"]} color="var(--spotted)" missing="type" />
                  <Ranked title="Spotting places" t={ss.byLocation} label={ap} unit={["aircraft", "aircraft"]} color="var(--spotted)" missing="place" />
                </>
              )}
            </div>
          </>
        )}
      </div>
    </>
  );
}
