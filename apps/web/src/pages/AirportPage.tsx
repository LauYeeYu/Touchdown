// One airport: how often the user left from it, landed at it and changed planes there, the flights, and the
// aircraft photographed there. Opened from an airport or a spotting location on any map.

import { Fragment, useMemo } from "react";
import { Link, useNavigate, useParams, useRouter } from "@tanstack/react-router";
import { airportVisits, arrivalAirportId, type Sighting } from "@touchdown/core";
import { useApp } from "../data/context.tsx";
import { inPeriod, usePeriod } from "../lib/period.ts";
import { sortedFlights } from "../lib/views.ts";
import { airportWithCode, primaryCode, secondaryCode } from "../lib/codes.ts";
import { mapFlights, mapSpots, trackInfo } from "../lib/mapdata.ts";
import { airlineLabel, countryName, dateOnly, distance, plural, shortAirport } from "../lib/format.ts";
import { Icon } from "../lib/icons.tsx";
import { PeriodControl } from "../components/PeriodControl.tsx";
import { WorldMap } from "../components/maps.tsx";
import { Fig } from "../components/Phrase.tsx";
import { FlightCols, FlightRow } from "../components/FlightRow.tsx";
import { Pager, usePaging } from "../components/Pager.tsx";
import { NotFound } from "./NotFound.tsx";
import { TypeCell } from "../components/TypeCell.tsx";
import { Fact } from "../components/Facts.tsx";

const FLIGHT_PAGE = 20;
const AIRCRAFT_PAGE = 30;

/** "once", "twice", "3 times". */
function times(n: number): string {
  return n === 1 ? "once" : n === 2 ? "twice" : `${n} times`;
}

interface Spotted {
  key: string;
  airframeId: string | null;
  sightingId: string;
  registration: string;
  operatorId: string | null;
  operatorRaw: string | null;
  typeCode: string | null;
  days: Set<string>;
  count: number;
  last: string | null;
}

export function AirportPage() {
  const { id } = useParams({ from: "/airports/$id" });
  const { app, version } = useApp();
  const { store, ref } = app;
  const navigate = useNavigate();
  const router = useRouter();
  const { year, setYear, years, thisYear } = usePeriod(store, version);
  const unit = app.settings().distanceUnit ?? "km";
  const ap = ref.airport(id);

  const data = useMemo(() => {
    const all = sortedFlights(store, ref);
    const touches = (f: (typeof all)[number]["f"]) => f.fromAirportId === id || arrivalAirportId(f) === id;
    const everFlown = all.some((v) => touches(v.f));
    const allSightings = store.all("sightings").filter((s) => s.airportId === id);
    const inYear = all.filter((v) => inPeriod(v.day, year));
    const here = inYear.filter((v) => touches(v.f));
    // A transit needs the user's very next flight, so the visits are worked out over all the period's flights.
    const visits = airportVisits(
      inYear.map((v) => v.f),
      id,
    );
    const transitIds = new Set(visits.transits.flatMap((t) => [t.arrive.id, t.depart.id]));
    const sightings = allSightings.filter((s) => inPeriod(s.seenOn, year));
    const flownOn = new Map<string, number>();
    for (const f of store.all("flights")) if (f.airframeId) flownOn.set(f.airframeId, (flownOn.get(f.airframeId) ?? 0) + 1);
    const byAirframe = new Map<string, Spotted>();
    for (const s of sightings) {
      const key = s.airframeId ?? `s:${s.id}`;
      const e = byAirframe.get(key) ?? newSpotted(key, s);
      e.count++;
      if (s.seenOn) {
        e.days.add(s.seenOn);
        if (!e.last || s.seenOn > e.last) e.last = s.seenOn;
      }
      // The registration and operator as last seen here.
      if (s.seenOn && s.seenOn === e.last) {
        e.registration = s.registration ?? s.registrationRaw ?? e.registration;
        e.operatorId = s.operatorId ?? e.operatorId;
      }
      byAirframe.set(key, e);
    }
    const spotted = [...byAirframe.values()].sort((a, b) => (b.last ?? "").localeCompare(a.last ?? "") || a.registration.localeCompare(b.registration));
    const days = new Set(sightings.map((s) => s.seenOn).filter(Boolean));
    // Where the user flew to and from here, most often first.
    const others = new Map<string, number>();
    for (const v of here) {
      const other = v.f.fromAirportId === id ? arrivalAirportId(v.f) : v.f.fromAirportId;
      if (other && other !== id) others.set(other, (others.get(other) ?? 0) + 1);
    }
    const topOther = [...others].sort((a, b) => b[1] - a[1])[0] ?? null;
    const firstDay = [...here.map((v) => v.day), ...sightings.map((s) => s.seenOn)].filter((d): d is string => !!d).sort()[0] ?? null;
    const review = new Set(app.findings().filter((f) => f.severity !== "info").flatMap((f) => f.records.filter((r) => r.table === "flights").map((r) => r.id)));
    return { here, visits, transitIds, sightings, spotted, days, flownOn, topOther, firstDay, everFlown, everSpotted: allSightings.length > 0, trackMeta: trackInfo(store), review };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store, ref, version, year, id]);

  const { here, visits, transitIds, sightings, spotted, days, flownOn, topOther, firstDay, review, trackMeta } = data;
  const newestFirst = useMemo(() => [...here].reverse(), [here]);
  const flightPages = usePaging(newestFirst, FLIGHT_PAGE, `${id}|${year}`);
  const aircraftPages = usePaging(spotted, AIRCRAFT_PAGE, `${id}|${year}`);
  const hereKey = here.map((v) => v.f.id).join(",");
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const marks = useMemo(() => mapFlights(here, ref, unit, new Set(), store), [hereKey, version, unit]);
  const spots = useMemo(() => mapSpots(sightings, ref), [sightings, ref]);

  if (!ap || (!data.everFlown && !data.everSpotted)) {
    return <NotFound what={ap ? `${shortAirport(id, ref)} is not in your log.` : "That airport is not in the reference data."} back={{ to: "/map", label: "Map" }} />;
  }

  const name = shortAirport(id, ref);
  const code = primaryCode(ap);
  const other = secondaryCode(ap);
  const dep = visits.departures.length;
  const land = visits.landings.length;
  const trans = visits.transits.length;
  const nothing = !here.length && !sightings.length;
  const opening = year === "all" ? "" : year === thisYear ? `So far in ${year} ` : `In ${year} `;
  const flownParts: { lead: string; n: number }[] = [];
  if (dep) flownParts.push({ lead: `left from ${name}`, n: dep });
  if (land) flownParts.push({ lead: `landed ${dep ? "there" : `at ${name}`}`, n: land });
  if (trans) flownParts.push({ lead: `changed planes ${dep || land ? "there" : `at ${name}`}`, n: trans });
  const flownText = flownParts.length > 0;
  const goBack = () => (window.history.length > 1 ? router.history.back() : navigate({ to: "/map" }));

  return (
    <div className="page">
      <nav className="crumbs" aria-label="Back">
        <button type="button" className="crumbs__back" onClick={goBack}>
          <Icon name="arrow-left" /> Back
        </button>
      </nav>
      <div className="airport-hero">
        <h1 className="route-hero__code">{code}</h1>
        <p className="route-hero__place">
          <span className="route-hero__city">{ap.city ?? ap.name}</span>
          <span className="route-hero__name">
            {ap.name}
            {ap.country ? ` · ${countryName(ap.country)}` : ""}
          </span>
          {other && <span className="route-hero__icao"> · {other}</span>}
        </p>
      </div>
      <div className="view-top view-top--airport">
        <PeriodControl year={year} years={years} onChange={setYear} />
      </div>
      <h2 className="lead lead--airport">
        {nothing ? (
          <>Nothing logged at {name} in {year}.</>
        ) : (
          <>
            {flownText && (
              <>
                {opening ? opening + "you" : "You"}{" "}
                {flownParts.map((p, i) => (
                  <Fragment key={p.lead}>
                    {i > 0 && (i === flownParts.length - 1 ? " and " : ", ")}
                    {p.lead} <Fig>{times(p.n)}</Fig>
                  </Fragment>
                ))}
                .{" "}
              </>
            )}
            {sightings.length > 0 && (
              <>
                {flownText ? "You photographed" : `${opening ? opening + "you" : "You"} photographed`} <Fig>{plural(spotted.length, "aircraft", "aircraft")}</Fig> {flownText ? "there" : `at ${name}`} on{" "}
                <Fig>{plural(days.size, "day")}</Fig>.
              </>
            )}
          </>
        )}
      </h2>
      {nothing && year !== "all" && (
        <p>
          <button type="button" className="btn btn--quiet" onClick={() => setYear("all")}>
            Show all years
          </button>
        </p>
      )}

      {!nothing && (
        <dl className="facts">
          {here.length > 0 && (
            <>
              <Fact label="Departures" value={dep} detail={dep ? "flights that started here" : "none"} />
              <Fact label="Transits" value={trans} detail="landed, then left within 24 hours" />
              <Fact label="Landings" value={land} detail={land ? "flights that ended here" : "none"} />
            </>
          )}
          {topOther && (
            <Fact
              label="Most flown with"
              value={
                <Link className="facts__link" to="/airports/$id" params={{ id: topOther[0] }}>
                  {airportWithCode(topOther[0], ref)}
                </Link>
              }
              detail={plural(topOther[1], "flight")}
            />
          )}
          {sightings.length > 0 && (
            <Fact
              label="Aircraft photographed"
              value={plural(spotted.length, "aircraft", "aircraft")}
              detail={
                <>
                  {plural(sightings.length, "sighting")} on {plural(days.size, "day")}
                </>
              }
            />
          )}
          {firstDay && (
            <Fact label={year === "all" ? "First time here" : `First time in ${year}`} value={dateOnly(firstDay, { day: "numeric", month: "short", year: "numeric" })} />
          )}
        </dl>
      )}

      {!nothing && (
        <div className="map-wrap">
          <div className="legend">
            {here.length > 0 && (
              <span className="legend__item">
                <span className="swatch-line" />
                Flights to and from {code}
              </span>
            )}
            {sightings.length > 0 && (
              <span className="legend__item">
                <span className="swatch-dot" />
                Where you photographed aircraft
              </span>
            )}
            <span className="legend__item">Click another airport to open its page</span>
          </div>
          <WorldMap
            flights={marks}
            spots={spots}
            mode="fit"
            onArcClick={(f) => navigate({ to: "/flights/$id", params: { id: f.id } })}
            onAirportClick={(other) => other !== id && navigate({ to: "/airports/$id", params: { id: other } })}
            label={`Map of ${plural(here.length, "flight")} to and from ${name}`}
          />
        </div>
      )}

      {here.length > 0 && (
        <section className="section" aria-labelledby="airport-flights">
          <div className="section__head">
            <h2 className="section__title" id="airport-flights">
              Flights
            </h2>
            <span className="section__aside">
              {plural(here.length, "flight")} · {distance(here.reduce((s, v) => s + (v.km ?? 0), 0), unit)}
            </span>
          </div>
          <FlightCols />
          <div ref={flightPages.top} className="list-top" />
          <ul className="rows">
            {flightPages.slice.map((v) => (
              <FlightRow key={v.f.id} v={v} track={trackMeta.get(v.f.id) ?? null} review={review.has(v.f.id)} badge={transitIds.has(v.f.id) ? <span className="pill">Transit</span> : null} />
            ))}
          </ul>
          <Pager paging={flightPages} noun={["flight", "flights"]} />
        </section>
      )}

      {spotted.length > 0 && (
        <section className="section" aria-labelledby="airport-spotted">
          <div className="section__head">
            <h2 className="section__title" id="airport-spotted">
              Aircraft photographed here
            </h2>
            <span className="section__aside">{plural(sightings.length, "sighting")}</span>
          </div>
          <div className="cols cols--aircraft" aria-hidden="true">
            <span>Registration</span>
            <span>Type</span>
            <span>Airline</span>
            <span className="num">Here</span>
            <span className="num">Flights</span>
            <span className="num">Last here</span>
          </div>
          <div ref={aircraftPages.top} className="list-top" />
          <ul className="rows">
            {aircraftPages.slice.map((e) => {
              const flown = e.airframeId ? (flownOn.get(e.airframeId) ?? 0) : 0;
              const body = (
                <>
                  <span className="row__route-wrap">
                    <span className="row__route">{e.registration || "No registration"}</span>
                    <span className="row__cities">{airlineLabel(e.operatorId, ref) || e.operatorRaw || "Unknown operator"}</span>
                  </span>
                  <TypeCell code={e.typeCode} />
                  <span className="row__cell row__airline">{airlineLabel(e.operatorId, ref) || e.operatorRaw || "—"}</span>
                  <span className="row__num tabular" title={`Seen here on ${plural(e.days.size || 1, "day")}`}>
                    <span className="dot dot--spotted" />
                    {e.count}
                  </span>
                  <span className="row__num tabular" title={flown ? "Flights you took on this aircraft" : ""}>
                    {flown > 0 && <span className="dot dot--flown" />}
                    {flown || "—"}
                  </span>
                  <span className="row__num row__num--date tabular">{e.last ? dateOnly(e.last, { day: "numeric", month: "short", year: "numeric" }) : "—"}</span>
                </>
              );
              return (
                <li key={e.key}>
                  {e.airframeId ? (
                    <Link className="row row--aircraft" to="/aircraft/$id" params={{ id: e.airframeId }}>
                      {body}
                    </Link>
                  ) : (
                    <Link className="row row--aircraft" to="/spotting/$id/edit" params={{ id: e.sightingId }}>
                      {body}
                    </Link>
                  )}
                </li>
              );
            })}
          </ul>
          <Pager paging={aircraftPages} noun={["aircraft", "aircraft"]} />
        </section>
      )}
    </div>
  );
}

function newSpotted(key: string, s: Sighting): Spotted {
  return {
    key,
    airframeId: s.airframeId,
    sightingId: s.id,
    registration: s.registration ?? s.registrationRaw ?? "",
    operatorId: s.operatorId,
    operatorRaw: s.operatorRaw,
    typeCode: s.typeCode,
    days: new Set(),
    count: 0,
    last: null,
  };
}
