// Home: the period in one sentence, the main stats, and the period's map; then context below.

import { useMemo, type ReactNode } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Link } from "../lib/link.tsx";
import { flightName, todayIn } from "@touchdown/core";
import { sentenceGap, t } from "@touchdown/i18n";
import { useApp } from "../data/context.tsx";
import { airportWithCode, textCode } from "../lib/codes.ts";
import { BigCode } from "../components/BigCode.tsx";
import { ShareButton } from "../components/ShareDialog.tsx";
import { usePeriod, inPeriod } from "../lib/period.ts";
import { sessionsOf, flownAndPhotographed } from "../lib/views.ts";
import { mapFlights, mapSpots } from "../lib/mapdata.ts";
import { airlineLabel, cityOf, dateOnly, dayShort, distance, monthNames, typeName } from "../lib/format.ts";
import { ArrowGlyph, Icon } from "../lib/icons.tsx";
import { PeriodControl } from "../components/PeriodControl.tsx";
import { WorldMap } from "../components/maps.tsx";
import { MonthChart } from "../components/charts.tsx";
import { Credit, Photo } from "../components/Photo.tsx";
import { Duration } from "../components/Duration.tsx";
import { Fig, Phrase, usePhrases } from "../components/Phrase.tsx";
import { EmptyLog } from "./EmptyLog.tsx";
import { Disclosure } from "../components/Disclosure.tsx";
import { Fact, Keep } from "../components/Facts.tsx";
import { Name, voiceOf } from "../lib/voice.tsx";
import { headline, tx } from "../lib/i18n.tsx";
import { periodVideo } from "../lib/videoContent.ts";
import type { FigureContent } from "../lib/figure.ts";
import { periodFacts, periodOf, periodWords } from "../lib/figureWords.ts";

export function Home() {
  const { app, version } = useApp();
  const { store, ref } = app;
  const navigate = useNavigate();
  const { year, setYear, years, thisYear } = usePeriod(store, version);
  const unit = app.settings().distanceUnit ?? "km";
  const { focus, bind } = usePhrases();

  const d = useMemo(() => {
    const p = periodOf({ store, ref, settings: app.settings() }, year);
    const sessions = sessionsOf(store).filter((s) => inPeriod(s.date, year));
    const both = flownAndPhotographed(store, year);
    const bothIds = new Set(both.map((b) => b.airframe.id));
    const marks = mapFlights(p.views, ref, unit, bothIds, store);
    const spots = mapSpots(p.sightings, ref, bothIds);
    return { ...p, sessions, both, bothIds, marks, spots };
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

  // The figures above the map (lib/figureWords.ts), each value shown the page's way; an image's figures share them.
  const logData = { store, ref, settings: app.settings() };
  const facts = periodFacts(logData, d).map((x) => ({ ...x, value: x.kind === "time" ? <Duration min={x.minutes!} pad={false} /> : x.kind === "airline" || x.kind === "type" ? <Keep text={x.text} /> : x.text }));

  /**
   * The period's map as an image (components/FigureDialog.tsx): its flights and its spotting places, with the words of
   * lib/figureWords.ts, how many and how far, and as statistics the flights, the aircraft spotted and the figures above
   * the map.
   */
  const figureContent = (): FigureContent => ({
    flights: d.marks,
    spots: d.spots.map((sp) => ({ at: sp.at, code: sp.code, aircraft: sp.aircraft })),
    ...periodWords(logData, year, d, d.spots.length, facts),
  });

  return (
    <div className="page">
      <div className="view-top">
        <PeriodControl year={year} years={years} onChange={setYear} />
        {/* The whole log's link, and the image and the video of the period shown, which may be a year of it. */}
        <ShareButton
          icon
          kind="log"
          year={year === "all" ? null : year}
          image={{ content: figureContent, name: (ext) => `touchdown-${year === "all" ? "all" : year}.${ext}` }}
          video={
            views.length > 0 || d.sightings.length > 0
              ? {
                  content: () => {
                    const words = figureContent();
                    return periodVideo(app, views, { title: words.title ?? "", stats: words.stats }, d.sightings);
                  },
                  name: `touchdown-${year === "all" ? "all" : year}.mp4`,
                }
              : undefined
          }
        />
      </div>
      <h1 className="lead">
        {headline(
          <>
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
                  {sentenceGap()}
                  {tx("home.lead.both", { voice: voice.kind, name: who, count: both.length }, { both: bothPhrase, fig })}
                </>
              )}
            </>
          )}
          </>,
        )}
      </h1>

      {facts.length > 0 && (
        <dl className="facts">
          {facts.map((x) => (
            <Fact key={x.label} label={x.label} value={x.value} detail={x.detail} />
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
          {/* Explore on a globe at the row's end, on its own line on a phone. */}
          <div className="legend__actions">
            <Link className="legend__action" to="/stats">
              <Icon name="globe" />
              {t("home.map.globe")}
            </Link>
          </div>
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
                  {flightName(last.f) && ` · ${flightName(last.f)}`}
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
                      <Icon name="spline" />
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
                      {flightName(flight) && ` · ${flightName(flight)}`}
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
