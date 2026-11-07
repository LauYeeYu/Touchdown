// One airport: how often the user left from it, landed at it and changed planes there, the flights, and the
// aircraft photographed there. Opened from an airport or a spotting location on any map.

import { useMemo, type ReactNode } from "react";
import { useNavigate, useParams, useRouter } from "@tanstack/react-router";
import { sentenceGap, t } from "@touchdown/i18n";
import { Link } from "../lib/link.tsx";
import { airportName, cityName } from "@touchdown/core";
import { airportSummary } from "@touchdown/core/view";
import { useApp } from "../data/context.tsx";
import { usePeriod } from "../lib/period.ts";
import { airportWithCode, codeStyle, primaryCode, secondaryCode } from "../lib/codes.ts";
import { mapFlights, mapSpots, trackInfo } from "../lib/mapdata.ts";
import { airlineLabel, countryName, dateOnly, distance, shortAirport } from "../lib/format.ts";
import { Icon } from "../lib/icons.tsx";
import { PeriodControl } from "../components/PeriodControl.tsx";
import { WorldMap } from "../components/maps.tsx";
import { GlobePanel } from "../components/GlobePanel.tsx";
import { MapStyleSwitch, useMapStyle } from "../components/MapStyle.tsx";
import { Fig } from "../components/Phrase.tsx";
import { FlightRow } from "../components/FlightRow.tsx";
import { Pager, usePaging } from "../components/Pager.tsx";
import { NotFound } from "./NotFound.tsx";
import { TypeCell } from "../components/TypeCell.tsx";
import { Fact } from "../components/Facts.tsx";
import { Name, voiceOf } from "../lib/voice.tsx";
import { headline, tx } from "../lib/i18n.tsx";

const FLIGHT_PAGE = 20;
const AIRCRAFT_PAGE = 30;


export function AirportPage() {
  const { id } = useParams({ from: "/airports/$id" });
  const { app, version } = useApp();
  const { store, ref } = app;
  const navigate = useNavigate();
  const router = useRouter();
  const { year, setYear, years, thisYear } = usePeriod(store, version);
  const unit = app.settings().distanceUnit ?? "km";
  const ap = ref.airport(id);
  const mapStyle = useMapStyle();

  const data = useMemo(() => {
    const review = new Set(app.findings().filter((f) => f.severity !== "info").flatMap((f) => f.records.filter((r) => r.table === "flights").map((r) => r.id)));
    return { ...airportSummary(store, ref, id, year, codeStyle()), trackMeta: trackInfo(store), review };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store, ref, version, year, id]);

  const { here, visits, transitIds, sightings, spotted, days, flownOn, topOther, firstDay, review, trackMeta } = data;
  const newestFirst = useMemo(() => [...here].reverse(), [here]);
  const flightPages = usePaging(newestFirst, FLIGHT_PAGE, `${id}|${year}`, "flightsPage");
  const aircraftPages = usePaging(spotted, AIRCRAFT_PAGE, `${id}|${year}`, "aircraftPage");
  const hereKey = here.map((v) => v.f.id).join(",");
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const marks = useMemo(() => mapFlights(here, ref, unit, new Set(), store), [hereKey, version, unit]);
  const spots = useMemo(() => mapSpots(sightings, ref), [sightings, ref]);

  // About "you", a shared whole log's owner by name, or nobody on a link to one record: "Left from LHR 3 times"
  // (lib/voice.tsx).
  const shared = app.readOnly;
  const voice = voiceOf(app);
  const who = voice.kind === "named" ? <Name name={voice.name} /> : null;
  if (!ap || (!data.everFlown && !data.everSpotted)) {
    return <NotFound what={ap ? t("airport.notFound", { airport: shortAirport(id, ref), where: shared ? "link" : "log" }) : t("airport.notFound.reference")} back={{ to: "/stats", label: t("airport.notFound.back") }} />;
  }

  const name = shortAirport(id, ref);
  const code = primaryCode(ap);
  const other = secondaryCode(ap);
  const dep = visits.departures.length;
  const land = visits.landings.length;
  const trans = visits.transits.length;
  const nothing = !here.length && !sightings.length;
  const mapHead = (
    <>
      {here.length > 0 && (
        <span className="legend__item">
          <span className="swatch-line" />
          {t("airport.legend.flights", { code })}
        </span>
      )}
      {sightings.length > 0 && (
        <span className="legend__item">
          <span className="swatch-dot" />
          {t("airport.legend.spots")}
        </span>
      )}
      <span className="legend__item">{t("airport.legend.click")}</span>
      <MapStyleSwitch value={mapStyle.style} onChange={mapStyle.set} />
    </>
  );
  // The sentence opens with the period, if one is chosen: "So far in 2026", "In 2025".
  const period = year === "all" ? "all" : year === thisYear ? "current" : "past";
  const parts = `${dep ? "d" : ""}${land ? "l" : ""}${trans ? "t" : ""}`;
  const flownText = parts.length > 0;
  const fig = (text: ReactNode) => <Fig>{text}</Fig>;
  const goBack = () => (window.history.length > 1 ? router.history.back() : navigate({ to: "/stats" }));

  return (
    <div className="page">
      <nav className="crumbs" aria-label={t("common.back")}>
        <button type="button" className="crumbs__back" onClick={goBack}>
          <Icon name="arrow-left" /> {t("common.back")}
        </button>
      </nav>
      <div className="airport-hero">
        <h1 className="route-hero__code">{code}</h1>
        <p className="route-hero__place">
          <span className="route-hero__city">{cityName(ap) ?? airportName(ap)}</span>
          <span className="route-hero__name">
            {airportName(ap)}
            {ap.country ? ` · ${countryName(ap.country)}` : ""}
          </span>
          {other && (
            <span className="route-hero__icao">
              <span className="route-hero__sep">{"\u00a0· "}</span>
              {other}
            </span>
          )}
        </p>
      </div>
      <div className="view-top view-top--airport">
        <PeriodControl year={year} years={years} onChange={setYear} />
      </div>
      <h2 className="lead lead--airport">
        {headline(
          <>
          {nothing ? (
            t("airport.lead.nothing", { airport: name, year })
          ) : (
            <>
              {flownText && (
                <>
                  {tx("airport.lead.flown", { period, year, voice: voice.kind, owner: who, cap: voice.kind === "none" && period === "all" ? "yes" : "no", parts, airport: name, dep, land, trans }, { fig })}{sentenceGap()}
                </>
              )}
              {sightings.length > 0 &&
                tx("airport.lead.spotted", { period: flownText ? "all" : period, year, voice: voice.kind, owner: who, aircraft: spotted.length, there: flownText ? "yes" : "no", airport: name, days: days.size }, { fig })}
            </>
          )}
          </>,
        )}
      </h2>
      {nothing && year !== "all" && (
        <p>
          <button type="button" className="btn btn--quiet" onClick={() => setYear("all")}>
            {t("airport.showAll")}
          </button>
        </p>
      )}

      {!nothing && (
        <dl className="facts">
          {here.length > 0 && (
            <>
              <Fact label={t("airport.departures")} value={dep} detail={dep ? t("airport.departures.detail") : t("airport.none")} />
              <Fact label={t("airport.transits")} value={trans} detail={t("airport.transits.detail")} />
              <Fact label={t("airport.landings")} value={land} detail={land ? t("airport.landings.detail") : t("airport.none")} />
            </>
          )}
          {topOther && (
            <Fact
              label={t("airport.mostFlownWith")}
              value={
                <Link className="facts__link" to="/airports/$id" params={{ id: topOther[0] }}>
                  {airportWithCode(topOther[0], ref)}
                </Link>
              }
              detail={t("common.count.flights", { count: topOther[1] })}
            />
          )}
          {sightings.length > 0 && (
            <Fact
              label={t("airport.photographed")}
              value={t("common.count.aircraft", { count: spotted.length })}
              detail={t("airport.photographed.detail", { sightings: sightings.length, days: days.size })}
            />
          )}
          {firstDay && (
            <Fact label={t("airport.firstTime", { period: year === "all" ? "all" : "year", year })} value={dateOnly(firstDay, { day: "numeric", month: "short", year: "numeric" })} />
          )}
        </dl>
      )}

      {!nothing &&
        (mapStyle.style === "globe" ? (
          <GlobePanel
            flights={marks}
            spots={spots}
            height={mapStyle.height}
            head={mapHead}
            label={t("airport.globeLabel", { count: here.length, airport: name })}
            onFlightClick={(f) => navigate({ to: "/flights/$id", params: { id: f.id } })}
            onAirportClick={(other) => other !== id && navigate({ to: "/airports/$id", params: { id: other } })}
          />
        ) : (
          <div className="map-wrap" ref={mapStyle.box}>
            <div className="legend">{mapHead}</div>
            <WorldMap
              flights={marks}
              spots={spots}
              mode="fit"
              onArcClick={(f) => navigate({ to: "/flights/$id", params: { id: f.id } })}
              onAirportClick={(other) => other !== id && navigate({ to: "/airports/$id", params: { id: other } })}
              label={t("airport.mapLabel", { count: here.length, airport: name })}
            />
          </div>
        ))}

      {here.length > 0 && (
        <section className="section" aria-labelledby="airport-flights">
          <div className="section__head">
            <h2 className="section__title" id="airport-flights">
              {t("airport.flights")}
            </h2>
            <span className="section__aside">
              {t("common.count.flights", { count: here.length })} · {distance(here.reduce((s, v) => s + (v.km ?? 0), 0), unit)}
            </span>
          </div>
          <div ref={flightPages.top} className="list-top" />
          <ul className="rows">
            {flightPages.slice.map((v) => (
              <FlightRow key={v.f.id} v={v} track={trackMeta.get(v.f.id) ?? null} review={review.has(v.f.id)} badge={transitIds.has(v.f.id) ? <span className="pill">{t("airport.transit")}</span> : null} />
            ))}
          </ul>
          <Pager paging={flightPages} kind="flights" />
        </section>
      )}

      {spotted.length > 0 && (
        <section className="section" aria-labelledby="airport-spotted">
          <div className="section__head">
            <h2 className="section__title" id="airport-spotted">
              {t("airport.spotted")}
            </h2>
            <span className="section__aside">{t("common.count.sightings", { count: sightings.length })}</span>
          </div>
          <div className="cols cols--aircraft" aria-hidden="true">
            <span>{t("aircraft.cols.registration")}</span>
            <span>{t("aircraft.cols.type")}</span>
            <span>{t("aircraft.cols.airline")}</span>
            <span className="num">{t("airport.cols.here")}</span>
            <span className="num">{t("aircraft.cols.flights")}</span>
            <span className="num">{t("airport.cols.lastHere")}</span>
          </div>
          <div ref={aircraftPages.top} className="list-top" />
          <ul className="rows">
            {aircraftPages.slice.map((e) => {
              const flown = e.airframeId ? (flownOn.get(e.airframeId) ?? 0) : 0;
              const body = (
                <>
                  <span className="row__route-wrap">
                    <span className="row__route">{e.registration || t("aircraft.noRegistration")}</span>
                    <span className="row__cities">{airlineLabel(e.operatorId, ref) || e.operatorRaw || t("airport.unknownOperator")}</span>
                  </span>
                  <TypeCell code={e.typeCode} />
                  <span className="row__cell row__airline">{airlineLabel(e.operatorId, ref) || e.operatorRaw || "—"}</span>
                  <span className="row__num tabular" title={t("airport.seenHere", { count: e.days.size || 1 })}>
                    <span className="dot dot--spotted" />
                    {e.count}
                  </span>
                  <span className="row__num tabular" title={flown ? t("airport.flownOn", { where: shared ? "link" : "log" }) : ""}>
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
          <Pager paging={aircraftPages} kind="aircraft" />
        </section>
      )}
    </div>
  );
}

