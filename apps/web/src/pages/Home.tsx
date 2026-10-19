// Home: the period in one sentence, the main stats, and the period's map; then context below.

import { useMemo } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { flightStats, sightingStats, todayIn, type Sighting } from "@touchdown/core";
import { useApp } from "../data/context.tsx";
import { usePeriod, inPeriod } from "../lib/period.ts";
import { sessionsOf, sortedFlights, flownAndPhotographed } from "../lib/views.ts";
import { mapFlights, mapSpots } from "../lib/mapdata.ts";
import { airlineLabel, cityOf, dateOnly, dayShort, distance, durLong, MONTHS_LONG, nf, plural, shortAirport, typeName } from "../lib/format.ts";
import { ArrowGlyph, Icon } from "../lib/icons.tsx";
import { PeriodControl } from "../components/PeriodControl.tsx";
import { WorldMap } from "../components/maps.tsx";
import { MonthChart } from "../components/charts.tsx";
import { Credit, Photo } from "../components/Photo.tsx";
import { Duration } from "../components/Duration.tsx";
import { Fig, Phrase, usePhrases } from "../components/Phrase.tsx";
import { EmptyLog } from "./EmptyLog.tsx";

/** Model names such as 737-800 stay on one line instead of breaking at the hyphen. */
function Keep({ text }: { text: string }) {
  return (
    <>
      {text.split(/(\S*-\S*)/).map((part, i) =>
        /-/.test(part) ? (
          <span key={i} className="keep">
            {part}
          </span>
        ) : (
          part
        ),
      )}
    </>
  );
}

export function Home() {
  const { app, version } = useApp();
  const { store, ref } = app;
  const navigate = useNavigate();
  const { year, setYear, years, thisYear } = usePeriod(store, version);
  const unit = app.settings().distanceUnit ?? "km";
  const { focus, bind } = usePhrases();

  const d = useMemo(() => {
    const airframes = new Map(store.all("airframes").map((a) => [a.id, a]));
    const ctx = { ref, airframes };
    const views = sortedFlights(store, ref).filter((v) => inPeriod(v.day, year));
    const sightings = store.all("sightings").filter((s) => inPeriod(s.seenOn, year));
    const before: Sighting[] = year === "all" ? [] : store.all("sightings").filter((s) => s.seenOn && s.seenOn < `${year}-01-01`);
    const fs = flightStats(views.map((v) => v.f), ctx);
    const ss = sightingStats(sightings, ctx, before);
    const sessions = sessionsOf(store).filter((s) => inPeriod(s.date, year));
    const both = flownAndPhotographed(store, year);
    const bothIds = new Set(both.map((b) => b.airframe.id));
    const marks = mapFlights(views, ref, unit, bothIds, store);
    const spots = mapSpots(sightings, ref, bothIds);
    return { ctx, views, sightings, fs, ss, sessions, both, bothIds, marks, spots };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store, ref, version, year, unit]);

  const issues = app.findings().filter((f) => f.severity !== "info");
  if (!store.count("flights") && !store.count("sightings")) return <EmptyLog />;

  const { views, fs, ss, sessions, both } = d;
  const past = year === "all" || year === thisYear;
  const firstYear = years[0] ?? thisYear;
  const when = year === "all" ? `Since you started logging in ${firstYear}, you have` : year === thisYear ? `So far in ${year} you have` : `In ${year} you`;
  const flownAircraft = fs.aircraft.value;
  const spotAirports = ss.airports.value;

  const longest = fs.longestByDistance ? views.find((v) => v.f.id === fs.longestByDistance!.id) : undefined;
  const topAirline = fs.byAirline.items[0];
  const topFrame = fs.byAirframe.items[0];
  const topFrameFlight = topFrame ? views.find((v) => v.f.airframeId === topFrame.key) : undefined;
  const topSpotType = ss.byType.items[0];
  const last = views[views.length - 1];
  const lastSession = sessions[0];
  const futureFrom = year === thisYear ? Number(todayIn().slice(5, 7)) : null;
  const flightsByMonth = fs.perMonth;
  const newByMonth = ss.perMonth;

  const flownPart = views.length ? (
    <>
      {past ? "flown" : "flew"}{" "}
      <Phrase kind="flown" bind={bind}>
        <Fig>{plural(views.length, "flight")}</Fig>
      </Phrase>
      {fs.distanceKm.value > 0 && (
        <>
          ,{" "}
          <Phrase kind="flown" bind={bind}>
            <Fig>{distance(fs.distanceKm.value, unit)}</Fig>
          </Phrase>
        </>
      )}
      {flownAircraft > 0 && (
        <>
          {" "}
          on{" "}
          <Phrase kind="flown" bind={bind}>
            <Fig>{plural(flownAircraft, "aircraft", "aircraft")}</Fig>
          </Phrase>
        </>
      )}
    </>
  ) : null;
  const spotPart = ss.aircraft.value ? (
    <>
      spotted{" "}
      <Phrase kind="spotted" bind={bind}>
        <Fig>{plural(ss.aircraft.value, "aircraft", "aircraft")}</Fig> at {plural(spotAirports, "airport")}
      </Phrase>
    </>
  ) : null;

  const facts: [string, React.ReactNode, React.ReactNode][] = [];
  if (longest?.km) facts.push(["Longest flight", `${longest.fromCode} → ${longest.toCode}`, [distance(longest.km, unit), longest.f.flightNumber].filter(Boolean).join(" · ")]);
  if (fs.minutes.value) facts.push(["Time in the air", <Duration min={fs.minutes.value} pad={false} />, `across ${plural(views.length - fs.minutes.leftOut, "flight")}`]);
  if (topAirline) facts.push([fs.byAirline.top.length > 1 ? "Most flown airlines" : "Most flown airline", <Keep text={fs.byAirline.top.map((id) => airlineLabel(id, ref)).join(" and ")} />, plural(topAirline.count, "flight")]);
  if (topFrame && topFrame.count > 1 && topFrameFlight) facts.push(["Most flown aircraft", topFrameFlight.f.registration ?? "", `${plural(topFrame.count, "flight")} · ${typeName(topFrameFlight.f.typeCode, ref)}`]);
  if (topSpotType) facts.push(["Most spotted type", <Keep text={typeName(topSpotType.key, ref)} />, plural(topSpotType.count, "aircraft", "aircraft")]);

  return (
    <div className="page">
      <div className="view-top">
        <PeriodControl year={year} years={years} onChange={setYear} />
      </div>
      <h1 className="lead">
        {!flownPart && !spotPart ? (
          `Nothing logged in ${year === "all" ? "your log yet" : year}.`
        ) : (
          <>
            {when} {flownPart}
            {flownPart && spotPart ? ", and " : ""}
            {spotPart}.
            {both.length > 0 && (
              <>
                {" "}
                You flew on{" "}
                <Phrase kind="both" bind={bind}>
                  <Fig>{both.length}</Fig> of the aircraft you photographed
                </Phrase>
                .
              </>
            )}
          </>
        )}
      </h1>

      {facts.length > 0 && (
        <dl className="facts">
          {facts.map(([label, value, detail]) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd>
                <span className="facts__value">{value}</span>
                {detail && <span className="facts__detail">{detail}</span>}
              </dd>
            </div>
          ))}
        </dl>
      )}
      {issues.length > 0 && (
        <p className="review-line">
          <Icon name="info" />
          <Link to="/issues">{plural(issues.length, "entry", "entries")} to review</Link>
        </p>
      )}

      <div className="map-wrap">
        <div className="legend">
          <span className="legend__item">
            <span className="swatch-line" />
            Flights, recorded track where there is one
          </span>
          <span className="legend__item">
            <span className="swatch-dot" />
            Spotting locations, sized by aircraft seen
          </span>
          <span className="legend__item">
            <span className="swatch-dot swatch-dot--ink" />
            Airports flown through
          </span>
                  <Link className="legend__action" to="/globe">
            <Icon name="globe" />
            Explore on a globe
          </Link>
        </div>
        <WorldMap
          flights={d.marks}
          spots={d.spots}
          className={focus ? `is-focus-${focus}` : ""}
          onArcClick={(f) => navigate({ to: "/flights/$id", params: { id: f.id } })}
          onAirportClick={(id) => navigate({ to: "/airports/$id", params: { id } })}
          label={`Map of ${plural(views.length, "flight")}${d.sightings.length ? " and spotting locations" : ""}`}
        />
      </div>

      <section className="section" aria-labelledby="recent-title">
        <div className="section__head">
          <h2 className="section__title" id="recent-title">
            Most recent
          </h2>
        </div>
        <div className="split">
          <div>
            {last ? (
              <>
                <h3 className="route-mini" aria-label={`${cityOf(last.f.fromAirportId, ref)} to ${cityOf(last.f.toAirportId, ref)}`}>
                  <span>{last.fromCode}</span>
                  <ArrowGlyph />
                  <span>{last.toCode}</span>
                </h3>
                <p className="recent__line">
                  {last.day && <b>{dayShort(last.day)}</b>} · {cityOf(last.f.fromAirportId, ref)} to {cityOf(last.f.toAirportId, ref)}
                  {last.f.flightNumber && ` · ${last.f.flightNumber}`}
                  {last.f.airlineId && ` · ${airlineLabel(last.f.airlineId, ref)}`}
                </p>
                <ul className="facts-inline">
                  {last.min !== null && (
                    <li>
                      <Icon name="clock" />
                      {durLong(last.min)}
                    </li>
                  )}
                  {last.km !== null && (
                    <li>
                      <Icon name="ruler" />
                      {distance(last.km, unit)}
                    </li>
                  )}
                  {(last.f.typeCode || last.f.registration) && (
                    <li>
                      <Icon name="plane" />
                      {[last.f.typeCode && typeName(last.f.typeCode, ref), last.f.registration].filter(Boolean).join(" · ")}
                    </li>
                  )}
                </ul>
                <Link className="link-arrow" to="/flights/$id" params={{ id: last.f.id }}>
                  Open this flight <Icon name="arrow-right" />
                </Link>
              </>
            ) : (
              <>
                <h3 className="session__title">No flights</h3>
                <p className="recent__line">No flights logged in this period.</p>
              </>
            )}
          </div>
          <div>
            {lastSession ? (
              <>
                <h3 className="session__title">{shortAirport(lastSession.airportId, ref) || lastSession.sightings[0]?.airportRaw || "Unknown place"}</h3>
                <p className="recent__line">
                  {lastSession.date && <b>{dayShort(lastSession.date)}</b>} · {plural(lastSession.aircraft, "aircraft", "aircraft")} seen
                  {lastSession.newAircraft > 0 && (
                    <>
                      , <span className="tag-new">{lastSession.newAircraft} new</span> to your log
                    </>
                  )}
                </p>
                <div className="thumbs">
                  {lastSession.sightings.slice(0, 3).map((s) => (
                    <figure className="thumb" key={s.id}>
                      <Photo reg={s.registration} alt={`${s.registration ?? ""}, ${typeName(s.typeCode, ref)}`} />
                      <figcaption>
                        <b>{s.registration ?? "No registration"}</b>
                        <span>{typeName(s.typeCode, ref)}</span>
                        <Credit reg={s.registration} short />
                      </figcaption>
                    </figure>
                  ))}
                </div>
                <Link className="link-arrow" to="/spotting">
                  All spotting <Icon name="arrow-right" />
                </Link>
              </>
            ) : (
              <>
                <h3 className="session__title">No spotting yet</h3>
                <p className="recent__line">Nothing logged in this period.</p>
              </>
            )}
          </div>
        </div>
      </section>

      <section className="section" aria-labelledby="both-title">
        <div className="section__head">
          <h2 className="section__title" id="both-title">
            Flown and photographed
          </h2>
          <span className="section__aside">
            {plural(both.length, "aircraft", "aircraft")} in {year === "all" ? "your log" : year}
          </span>
        </div>
        {both.length ? (
          <div className="gallery">
            {both.map(({ airframe, flight, sighting }) => (
              <Link className="card" key={airframe.id} to="/aircraft/$id" params={{ id: airframe.id }}>
                <Photo reg={flight.registration} alt={`${flight.registration ?? ""}, ${typeName(airframe.typeCode, ref)}`} />
                <div className="card__body">
                  <span className="card__reg">{flight.registration}</span>
                  <span className="card__type">
                    {typeName(airframe.typeCode, ref)}
                    {flight.airlineId && ` · ${airlineLabel(flight.airlineId, ref)}`}
                  </span>
                  <ul className="card__events">
                    <li>
                      <span className="dot dot--flown" />
                      Flew {flight.scheduledDate ? dateOnly(flight.scheduledDate) : ""}
                      {flight.flightNumber && ` · ${flight.flightNumber}`}
                    </li>
                    <li>
                      <span className="dot dot--spotted" />
                      Spotted {sighting.seenOn ? dateOnly(sighting.seenOn) : ""}
                      {sighting.airportId && ` · ${ref.airport(sighting.airportId)?.iata ?? ref.airport(sighting.airportId)?.icao}`}
                    </li>
                  </ul>
                  <Credit reg={flight.registration} />
                </div>
              </Link>
            ))}
          </div>
        ) : (
          <p className="section__aside">None yet in this period.</p>
        )}
      </section>

      <section className="section" aria-labelledby="months-title">
        <div className="section__head">
          <h2 className="section__title" id="months-title">
            Month by month
          </h2>
          <span className="section__aside">{year === "all" ? `${firstYear} to ${years[years.length - 1] ?? firstYear} combined` : year}</span>
        </div>
        <div className="charts">
          <div className="chart">
            <h3 className="chart__title">
              <span className="dot dot--flown" />
              Flights
            </h3>
            <p className="chart__sub">{plural(views.length, "flight")} by month of takeoff</p>
            <MonthChart values={flightsByMonth} color="var(--flown)" unitOne="flight" unitMany="flights" futureFrom={futureFrom} yearLabel={year === "all" ? "" : year} />
          </div>
          <div className="chart">
            <h3 className="chart__title">
              <span className="dot dot--spotted" />
              New aircraft spotted
            </h3>
            <p className="chart__sub">{plural(newByMonth.reduce((a, b) => a + b, 0), "aircraft", "aircraft")} added to your log, by month</p>
            <MonthChart values={newByMonth} color="var(--spotted)" unitOne="new aircraft" unitMany="new aircraft" futureFrom={futureFrom} yearLabel={year === "all" ? "" : year} />
          </div>
        </div>
        <details className="numbers">
          <summary>Show the numbers</summary>
          <table>
            <thead>
              <tr>
                <th>Month</th>
                <th>Flights</th>
                <th>New aircraft</th>
              </tr>
            </thead>
            <tbody>
              {MONTHS_LONG.map((mo, i) => (
                <tr key={mo}>
                  <td>{mo}</td>
                  <td>{flightsByMonth[i]}</td>
                  <td>{newByMonth[i]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      </section>
    </div>
  );
}
