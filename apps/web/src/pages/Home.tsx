// Home: the period in one sentence, the main stats, and the period's map; then context below.

import { useMemo, type ReactNode } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Link } from "../lib/link.tsx";
import { flightStats, phaseIndex, sightingStats, todayIn, type Sighting } from "@touchdown/core";
import { list, t } from "@touchdown/i18n";
import { useApp } from "../data/context.tsx";
import { airportWithCode, textCode } from "../lib/codes.ts";
import { BigCode } from "../components/BigCode.tsx";
import { ShareLogButton } from "../components/ShareDialog.tsx";
import { usePeriod, inPeriod } from "../lib/period.ts";
import { sessionsOf, sortedFlights, flownAndPhotographed } from "../lib/views.ts";
import { mapFlights, mapSpots } from "../lib/mapdata.ts";
import { airlineLabel, cityOf, dateOnly, dayShort, distance, durLong, monthNames, typeName } from "../lib/format.ts";
import { ArrowGlyph, Icon } from "../lib/icons.tsx";
import { PeriodControl } from "../components/PeriodControl.tsx";
import { WorldMap } from "../components/maps.tsx";
import { MonthChart } from "../components/charts.tsx";
import { Credit, Photo } from "../components/Photo.tsx";
import { Duration } from "../components/Duration.tsx";
import { Fig, Phrase, usePhrases } from "../components/Phrase.tsx";
import { EmptyLog } from "./EmptyLog.tsx";
import { Disclosure } from "../components/Disclosure.tsx";
import { Fact } from "../components/Facts.tsx";
import { Name, voiceOf } from "../lib/voice.tsx";
import { tx } from "../lib/i18n.tsx";

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
    const ctx = { ref, airframes, phases: phaseIndex(store) };
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
  if (!store.count("flights") && !store.count("sightings"))
    return app.readOnly ? (
      <div className="page placeholder">
        <h1 className="lead">{t("home.nothingShared")}</h1>
      </div>
    ) : (
      <EmptyLog />
    );

  const { views, fs, ss, sessions, both } = d;
  const period = year === "all" ? "all" : year === thisYear ? "current" : "past";
  const firstYear = years[0] ?? thisYear;
  // About "you", a shared whole log's owner by name, or nobody on a link to one record (lib/voice.tsx). The messages
  // choose their words by `voice`: "you", "named" or "none".
  const voice = voiceOf(app);
  const who = voice.kind === "named" ? <Name name={voice.name} /> : "";
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

  // The lead's figures: each underlined phrase shows its part of the map (components/Phrase.tsx).
  const fig = (text: ReactNode) => <Fig>{text}</Fig>;
  const flown = (text: ReactNode) => (
    <Phrase kind="flown" bind={bind}>
      <Fig>{text}</Fig>
    </Phrase>
  );
  const spotted = (text: ReactNode) => (
    <Phrase kind="spotted" bind={bind}>
      {text}
    </Phrase>
  );
  const bothPhrase = (text: ReactNode) => (
    <Phrase kind="both" bind={bind}>
      {text}
    </Phrase>
  );

  const facts: [string, React.ReactNode, React.ReactNode][] = [];
  if (longest?.km) facts.push([t("home.facts.longest"), `${longest.fromCode} → ${longest.toCode}`, [distance(longest.km, unit), longest.f.flightNumber].filter(Boolean).join(" · ")]);
  if (fs.minutes.value) facts.push([t("home.facts.time"), <Duration min={fs.minutes.value} pad={false} />, t("home.facts.timeDetail", { count: views.length - fs.minutes.leftOut })]);
  if (topAirline) facts.push([t("home.facts.airline", { count: fs.byAirline.top.length }), <Keep text={list(fs.byAirline.top.map((id) => airlineLabel(id, ref)))} />, t("common.count.flights", { count: topAirline.count })]);
  if (topFrame && topFrame.count > 1 && topFrameFlight) facts.push([t("home.facts.aircraft"), topFrameFlight.f.registration ?? "", `${t("common.count.flights", { count: topFrame.count })} · ${typeName(topFrameFlight.f.typeCode, ref)}`]);
  if (topSpotType) facts.push([t("home.facts.type"), <Keep text={typeName(topSpotType.key, ref)} />, t("common.count.aircraft", { count: topSpotType.count })]);

  return (
    <div className="page">
      <div className="view-top">
        <PeriodControl year={year} years={years} onChange={setYear} />
        <ShareLogButton />
      </div>
      <h1 className="lead">
        {!views.length && !ss.aircraft.value ? (
          t("home.lead.nothing", { period, voice: voice.kind, year })
        ) : (
          <>
            {tx(
              "home.lead.summary",
              {
                voice: voice.kind,
                period,
                first: firstYear,
                year,
                name: who,
                flights: views.length,
                withDistance: fs.distanceKm.value > 0 ? "yes" : "no",
                distance: distance(fs.distanceKm.value, unit),
                aircraft: flownAircraft,
                spotted: ss.aircraft.value,
                airports: spotAirports,
              },
              { flown, spotted, fig },
            )}
            {both.length > 0 && (
              <>
                {" "}
                {tx("home.lead.both", { voice: voice.kind, name: who, count: both.length }, { both: bothPhrase, fig })}
              </>
            )}
          </>
        )}
      </h1>

      {facts.length > 0 && (
        <dl className="facts">
          {facts.map(([label, value, detail]) => (
            <Fact key={label} label={label} value={value} detail={detail} />
          ))}
        </dl>
      )}
      {issues.length > 0 && (
        <p className="review-line">
          <Icon name="info" />
          <Link to="/issues">{t("home.issues", { count: issues.length })}</Link>
        </p>
      )}

      <div className="map-wrap">
        <div className="legend">
          <span className="legend__item">
            <span className="swatch-line" />
            {t("home.map.flights")}
          </span>
          <span className="legend__item">
            <span className="swatch-dot" />
            {t("home.map.spots")}
          </span>
          <span className="legend__item">
            <span className="swatch-dot swatch-dot--ink" />
            {t("home.map.airports")}
          </span>
          <Link className="legend__action" to="/stats">
            <Icon name="globe" />
            {t("home.map.globe")}
          </Link>
        </div>
        <WorldMap
          flights={d.marks}
          spots={d.spots}
          className={focus ? `is-focus-${focus}` : ""}
          onArcClick={(f) => navigate({ to: "/flights/$id", params: { id: f.id } })}
          onAirportClick={(id) => navigate({ to: "/airports/$id", params: { id } })}
          label={t("home.map.label", { count: views.length, spots: d.sightings.length ? "yes" : "no" })}
        />
      </div>

      <section className="section" aria-labelledby="recent-title">
        <div className="section__head">
          <h2 className="section__title" id="recent-title">
            {t("home.recent.title")}
          </h2>
        </div>
        <div className="split">
          <div>
            {last ? (
              <>
                <h3 className="route-mini" aria-label={t("home.recent.route", { from: cityOf(last.f.fromAirportId, ref), to: cityOf(last.f.toAirportId, ref) })}>
                  <BigCode airport={ref.airport(last.f.fromAirportId)} raw={last.f.fromRaw} />
                  <ArrowGlyph />
                  <BigCode airport={ref.airport(last.f.divertedToAirportId ?? last.f.toAirportId)} raw={last.f.toRaw} />
                </h3>
                <p className="recent__line">
                  {last.day && <b>{dayShort(last.day)}</b>} · {t("home.recent.route", { from: cityOf(last.f.fromAirportId, ref), to: cityOf(last.f.toAirportId, ref) })}
                  {last.f.flightNumber && ` · ${last.f.flightNumber}`}
                  {last.f.airlineId && ` · ${airlineLabel(last.f.airlineId, ref)}`}
                </p>
                <ul className="facts-inline">
                  {last.min !== null && (
                    <li>
                      <Icon name="clock" />
                      <Duration min={last.min} pad={false} />
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
                  {t("home.recent.open")} <Icon name="arrow-right" />
                </Link>
              </>
            ) : (
              <>
                <h3 className="session__title">{t("home.recent.noFlights")}</h3>
                <p className="recent__line">{t("home.recent.noFlightsText")}</p>
              </>
            )}
          </div>
          <div>
            {lastSession ? (
              <>
                <h3 className="session__title">{airportWithCode(lastSession.airportId, ref) || lastSession.sightings[0]?.airportRaw || t("home.recent.unknownPlace")}</h3>
                <p className="recent__line">
                  {lastSession.date && <b>{dayShort(lastSession.date)}</b>} ·{" "}
                  {tx("home.recent.seen", { count: lastSession.aircraft, new: lastSession.newAircraft, voice: voice.kind }, { new: (text) => <span className="tag-new">{text}</span> })}
                </p>
                <div className="thumbs">
                  {lastSession.sightings.slice(0, 3).map((s) => (
                    <figure className={`thumb${s.airframeId ? " stretch" : ""}`} key={s.id}>
                      <Photo reg={s.registration} alt={t("home.photoAlt", { registration: s.registration ?? "", type: typeName(s.typeCode, ref) })} />
                      <figcaption>
                        {s.airframeId ? (
                          <Link className="stretch__link" to="/aircraft/$id" params={{ id: s.airframeId }}>
                            <b>{s.registration ?? t("home.recent.noRegistration")}</b>
                          </Link>
                        ) : (
                          <b>{s.registration ?? t("home.recent.noRegistration")}</b>
                        )}
                        <span>{typeName(s.typeCode, ref)}</span>
                        <Credit reg={s.registration} short />
                      </figcaption>
                    </figure>
                  ))}
                </div>
                <Link className="link-arrow" to="/spotting">
                  {t("home.recent.allSpotting")} <Icon name="arrow-right" />
                </Link>
              </>
            ) : (
              <>
                <h3 className="session__title">{t("home.recent.noSpotting")}</h3>
                <p className="recent__line">{t("home.recent.noSpottingText")}</p>
              </>
            )}
          </div>
        </div>
      </section>

      <section className="section" aria-labelledby="both-title">
        <div className="section__head">
          <h2 className="section__title" id="both-title">
            {t("home.both.title")}
          </h2>
          <span className="section__aside">{t("home.both.aside", { count: both.length, period, voice: voice.kind, year })}</span>
        </div>
        {both.length ? (
          <div className="gallery">
            {both.map(({ airframe, flight, sighting }) => (
              <article className="card stretch" key={airframe.id}>
                <Photo reg={flight.registration} alt={t("home.photoAlt", { registration: flight.registration ?? "", type: typeName(airframe.typeCode, ref) })} />
                <div className="card__body">
                  <Link className="card__reg stretch__link" to="/aircraft/$id" params={{ id: airframe.id }}>
                    {flight.registration}
                  </Link>
                  <span className="card__type">
                    {typeName(airframe.typeCode, ref)}
                    {flight.airlineId && ` · ${airlineLabel(flight.airlineId, ref)}`}
                  </span>
                  <ul className="card__events">
                    <li>
                      <span className="dot dot--flown" />
                      {t("home.both.flew", { date: flight.scheduledDate ? dateOnly(flight.scheduledDate) : "" })}
                      {flight.flightNumber && ` · ${flight.flightNumber}`}
                    </li>
                    <li>
                      <span className="dot dot--spotted" />
                      {t("home.both.spotted", { date: sighting.seenOn ? dateOnly(sighting.seenOn) : "" })}
                      {sighting.airportId && ` · ${textCode(ref.airport(sighting.airportId))}`}
                    </li>
                  </ul>
                  <Credit reg={flight.registration} />
                </div>
              </article>
            ))}
          </div>
        ) : (
          <p className="section__aside">{t("home.both.none")}</p>
        )}
      </section>

      <section className="section" aria-labelledby="months-title">
        <div className="section__head">
          <h2 className="section__title" id="months-title">
            {t("home.months.title")}
          </h2>
          <span className="section__aside">{year === "all" ? t("home.months.combined", { first: firstYear, last: years[years.length - 1] ?? firstYear }) : year}</span>
        </div>
        <div className="charts">
          <div className="chart">
            <h3 className="chart__title">
              <span className="dot dot--flown" />
              {t("home.months.flights")}
            </h3>
            <p className="chart__sub">{t("home.months.flightsSub", { count: views.length })}</p>
            <MonthChart values={flightsByMonth} color="var(--flown)" count={(n) => t("common.count.flights", { count: n })} futureFrom={futureFrom} yearLabel={year === "all" ? "" : year} />
          </div>
          <div className="chart">
            <h3 className="chart__title">
              <span className="dot dot--spotted" />
              {t("home.months.new")}
            </h3>
            <p className="chart__sub">{t("home.months.newSub", { count: newByMonth.reduce((a, b) => a + b, 0), voice: voice.kind })}</p>
            <MonthChart values={newByMonth} color="var(--spotted)" count={(n) => t("home.months.newCount", { count: n })} futureFrom={futureFrom} yearLabel={year === "all" ? "" : year} />
          </div>
        </div>
        <Disclosure className="numbers" summary={t("home.months.show")}>
          <table>
            <thead>
              <tr>
                <th>{t("home.months.month")}</th>
                <th>{t("home.months.flightsColumn")}</th>
                <th>{t("home.months.newColumn")}</th>
              </tr>
            </thead>
            <tbody>
              {monthNames().map((mo, i) => (
                <tr key={mo}>
                  <td>{mo}</td>
                  <td>{flightsByMonth[i]}</td>
                  <td>{newByMonth[i]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Disclosure>
      </section>
    </div>
  );
}
