// Stats (docs/24-statistics.md): the period on a globe, then flights, sightings and both together, and a custom
// view (a pivot) of any one or two dimensions by one measure. Every number says what it left out.

import { useContext, useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { sentenceGap, t } from "@touchdown/i18n";
import { ageLeftOutText, ageText, aircraftAges, ageTodayNote, averageAge, byAge, extensionPercent, routeExtensionByRoute, routeExtensions, seatPositionLabel, STATUS_WORD, type AgeNow, type AgeOrder, type AgeWhenFlown, type AircraftAges, type RouteExtension, type RouteExtensionByRoute } from "@touchdown/core/view";
import { combinedStats, EARTH_CIRCUMFERENCE_KM, flightDay, flightStats, phaseIndex, sightingStats, todayIn, type Flight, type Measured, type RefIndex, type Settings, type Sighting, type StatsContext, type Store } from "@touchdown/core";
import { useApp } from "../data/context.tsx";
import { inPeriod, usePeriod } from "../lib/period.ts";
import { sortedFlights } from "../lib/views.ts";
import { mapFlights, mapSpots } from "../lib/mapdata.ts";
import { airlineLabel, CABIN_LABEL, countryName, dateOnly, dayMonthYear, distance, familyName, makerName, nf, oneDecimal, PHASE_LABEL, typeName, typeWithCode } from "../lib/format.ts";
import { Link } from "../lib/link.tsx";
import { airportWithCode, routeCodes } from "../lib/codes.ts";
import { Icon } from "../lib/icons.tsx";
import { PeriodControl } from "../components/PeriodControl.tsx";
import { Duration } from "../components/Duration.tsx";
import { Tabs } from "../components/Tabs.tsx";
import { Fact, LeftOut } from "../components/Facts.tsx";
import { Ranked } from "../components/Ranked.tsx";
import { HelpTip } from "../components/HelpTip.tsx";
import { useGrow } from "../lib/motion.ts";
import { GlobePanel } from "../components/GlobePanel.tsx";
import { CustomView } from "../components/CustomView.tsx";
import { Select } from "../components/Select.tsx";
import { useViewState } from "../lib/viewState.ts";
import { TrackLoading, TrackLoadingNote } from "../lib/trackLoading.tsx";
import { tx } from "../lib/i18n.tsx";

type Tab = "flights" | "sightings" | "both" | "pivot";

function measuredText(m: Measured, fmt: (n: number) => string = (n) => nf.format(n)) {
  return fmt(m.value);
}

export function Stats() {
  const { app, version } = useApp();
  const { store, ref } = app;
  const { year, setYear, years } = usePeriod(store, version);
  const settings = app.settings();
  const unit = settings.distanceUnit ?? "km";
  // Kept for Back (lib/viewState.ts), as are the custom view's choices.
  const [tab, setTab] = useViewState<Tab>("tab", "flights");
  const [showFlights, setShowFlights] = useViewState("showFlights", true);
  const [showSpots, setShowSpots] = useViewState("showSpots", true);
  const [airline, setAirline] = useViewState("airline", "");
  const [extensionSort, setExtensionSort] = useViewState<ExtensionSort>("extensionSort", "extra");
  const [ageOrder, setAgeOrder] = useViewState<AgeOrder>("ageOrder", "oldest");
  const navigate = useNavigate();
  const tracksLoading = useContext(TrackLoading);

  const data = useMemo(() => {
    const airframes = new Map(store.all("airframes").map((a) => [a.id, a]));
    const ctx: StatsContext = { ref, airframes, phases: phaseIndex(store) };
    const flights = store.all("flights").filter((f) => inPeriod(flightDay(f), year));
    const sightings = store.all("sightings").filter((s) => inPeriod(s.seenOn, year));
    const before: Sighting[] = year === "all" ? [] : store.all("sightings").filter((s) => s.seenOn && s.seenOn < `${year}-01-01`);
    return { ctx, flights, sightings, fs: flightStats(flights, ctx), ss: sightingStats(sightings, ctx, before), cs: combinedStats(flights, sightings, ctx) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store, ref, version, year]);
  const { ctx, flights, sightings, fs, ss, cs } = data;

  // The globe: the period's flights (recorded track where there is one) and spotting locations.
  const globe = useMemo(() => {
    const views = sortedFlights(store, ref).filter((v) => inPeriod(v.day, year));
    const airlines = [...new Set(views.map((v) => v.f.airlineId).filter((x): x is string => !!x))].sort((a, b) => airlineLabel(a, ref).localeCompare(airlineLabel(b, ref)));
    // An airline picked in another period may not fly in this one: then every airline shows.
    const picked = airlines.includes(airline) ? airline : "";
    const marks = mapFlights(
      views.filter((v) => !picked || v.f.airlineId === picked),
      ref,
      unit,
      new Set(),
      store,
    );
    return { airlines, picked, marks, spots: mapSpots(sightings, ref) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store, ref, version, year, unit, airline, sightings]);
  const recorded = globe.marks.filter((f) => f.track).length;

  // The distance the period's flights flew beyond the great circle, from their recorded tracks. While some of their
  // tracks are still loading (a share link's requests, or sync on a new device), the section keeps its place and
  // size and fills in once, when they are all in, instead of growing and reordering as each arrives.
  const extension = useMemo(() => {
    const views = new Map(sortedFlights(store, ref).map((v) => [v.f.id, v]));
    const wait = tracksLoading ? trackWait(store, flights, views) : null;
    if (wait) return { flights: [], byRoute: [], views, wait };
    const ext = routeExtensions(store, ref, flights);
    return { flights: [...ext.values()].sort((a, b) => b.percent - a.percent), byRoute: routeExtensionByRoute(flights, ext, ref), views, wait };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store, ref, version, flights, tracksLoading]);

  // Each aircraft's age when the period's flights were on it, and now (docs/24, "Aircraft age").
  const ages = useMemo(() => aircraftAges(flights, ctx.airframes, todayIn()), [flights, ctx]);

  const op = (id: string) => airlineLabel(id, ref) || id;
  const ap = (id: string) => airportWithCode(id, ref) || id;
  const ty = (code: string) => typeWithCode(code, ref);
  const fam = (id: string) => familyName(id, ref);
  const flightCount = (n: number) => t("common.count.flights", { count: n });
  const aircraftCount = (n: number) => t("common.count.aircraft", { count: n });

  return (
    <div className="page">
      <div className="view-top">
        <PeriodControl year={year} years={years} onChange={setYear} />
      </div>
      <GlobePanel
        flights={showFlights ? globe.marks : []}
        spots={showSpots ? globe.spots : []}
        label={t("stats.globe.label", { flights: showFlights ? globe.marks.length : 0, spots: showSpots ? globe.spots.length : 0 })}
        note={`${year === "all" ? t("stats.globe.allTime") : year}${recorded ? ` · ${t("stats.globe.recorded", { recorded, count: globe.marks.length })}` : ""}`}
        onFlightClick={(f) => navigate({ to: "/flights/$id", params: { id: f.id } })}
        onAirportClick={(id) => navigate({ to: "/airports/$id", params: { id } })}
        head={
          <>
            <div className="chips" role="group" aria-label={t("stats.globe.show")}>
              <button type="button" className="chip" aria-pressed={showFlights} onClick={() => setShowFlights((v) => !v)}>
                <span className="swatch-line" />
                {t("stats.globe.flights", { count: globe.marks.length })}
              </button>
              <button type="button" className="chip" aria-pressed={showSpots} onClick={() => setShowSpots((v) => !v)}>
                <span className="swatch-dot" />
                {t("stats.globe.spots", { count: globe.spots.length })}
              </button>
            </div>
            {globe.airlines.length > 1 && (
              <Select label={t("stats.globe.airline")} value={globe.picked} onChange={setAirline} options={[{ value: "", label: t("stats.globe.allAirlines") }, ...globe.airlines.map((a) => ({ value: a, label: airlineLabel(a, ref) }))]} />
            )}
          </>
        }
      />
      <Tabs
        label={t("stats.tabs.label")}
        value={tab}
        onChange={setTab}
        items={[
          ["flights", t("stats.tabs.flights")],
          ["sightings", t("stats.tabs.sightings")],
          ["both", t("stats.tabs.both")],
          ["pivot", t("stats.tabs.custom")],
        ]}
      />

      {tab === "flights" && (
        <div role="tabpanel">
          <dl className="facts facts--stats">
            <Fact label={t("stats.flights.flights")} value={nf.format(fs.flights)} />
            <Fact label={t("stats.flights.distance")} value={distance(fs.distanceKm.value, unit)} detail={<>{t("stats.flights.aroundEarth", { times: oneDecimal(fs.distanceKm.value / EARTH_CIRCUMFERENCE_KM) })} <LeftOut m={fs.distanceKm} what="airports" /></>} />
            <Fact label={t("stats.flights.time")} value={<Duration min={fs.minutes.value} pad={false} />} detail={<LeftOut m={fs.minutes} what="times" />} />
            <Fact label={t("stats.flights.airports")} value={measuredText(fs.airports)} detail={t("common.count.countries", { count: fs.countries.value })} />
            <Fact label={t("stats.flights.airlines")} value={measuredText(fs.airlines)} />
            <Fact label={t("stats.flights.aircraft")} value={measuredText(fs.aircraft)} detail={<>{fs.aircraft.provisional ? t("stats.aircraft.provisional", { count: fs.aircraft.provisional }) : t("stats.aircraft.confirmed")} <LeftOut m={fs.aircraft} what="registration" /></>} />
            <Fact label={t("stats.flights.types")} value={measuredText(fs.types)} />
            <Fact label={t("stats.flights.routes")} value={measuredText(fs.routes)} detail={t("stats.flights.routesBothWays")} />
          </dl>
          <div className="ranked-grid">
            <Ranked title={t("stats.flights.airlines")} t={fs.byAirline} label={op} count={flightCount} missing="airline" />
            <Ranked title={t("stats.flights.routes")} t={fs.byRoute} label={(k) => routeCodes(k, ref)} count={flightCount} missing="airports" />
            <Ranked title={t("stats.flights.airports")} t={fs.airportVisits} label={ap} count={(n) => t("stats.flights.visits", { count: n })} missing="airport" />
            <Ranked title={t("stats.flights.types")} t={fs.byType} label={ty} count={flightCount} missing="type" />
            <Ranked title={t("stats.flights.families")} t={fs.byFamily} label={fam} count={flightCount} missing="type" />
            <Ranked title={t("stats.flights.manufacturers")} t={fs.byManufacturer} label={makerName} count={flightCount} missing="type" />
            <Ranked title={t("stats.flights.seatPosition")} t={fs.seatPositions} label={seatPositionLabel} count={flightCount} missing="seat position" />
            <Ranked title={t("stats.flights.cabin")} t={fs.cabinClasses} label={(k) => CABIN_LABEL[k] ?? k} count={flightCount} missing="cabin" />
          </div>
          {(extension.flights.length > 0 || extension.wait) && (
            <section className="section" aria-labelledby="extension-title">
              <div className="section__head section__head--wrap">
                <span className="titled">
                  <h2 className="section__title" id="extension-title">
                    {t("stats.extension.title")}
                  </h2>
                  <HelpTip
                    label={t("stats.extension.about")}
                    text={`${t("stats.extension.help")}${
                      !extension.wait && extension.flights.length < flights.length ? `${sentenceGap()}${t("stats.extension.shownFor", { shown: extension.flights.length, count: flights.length })}` : ""
                    }`}
                  />
                </span>
                <div className="extension-sort">
                  <span className="extension-sort__label" id="extension-sort">
                    {t("stats.extension.sortBy")}
                  </span>
                  <div className="segmented segmented--small" role="group" aria-labelledby="extension-sort">
                    <button type="button" className="seg" aria-pressed={extensionSort === "percent"} onClick={() => setExtensionSort("percent")}>
                      {t("stats.extension.percent")}
                    </button>
                    <button type="button" className="seg" aria-pressed={extensionSort === "extra"} onClick={() => setExtensionSort("extra")}>
                      {t("stats.extension.extra")}
                    </button>
                  </div>
                </div>
              </div>
              {extension.wait ? (
                <ExtensionWaiting wait={extension.wait} />
              ) : (
                <div className="extension-grid">
                  <MostIndirect rows={byExtension(extension.flights, extensionSort)} views={extension.views} unit={unit} sort={extensionSort} onSort={setExtensionSort} />
                  {extension.byRoute.length > 0 && <ExtensionByRoute rows={byExtension(extension.byRoute, extensionSort)} label={(k) => routeCodes(k, ref)} unit={unit} sort={extensionSort} onSort={setExtensionSort} />}
                </div>
              )}
            </section>
          )}
          {ages.whenFlown.length > 0 && (
            <section className="section" aria-labelledby="age-title">
              <div className="section__head section__head--wrap">
                <span className="titled">
                  <h2 className="section__title" id="age-title">
                    {t("stats.age.title")}
                  </h2>
                  <HelpTip label={t("stats.age.about")} text={ageHelp(ages, flights.length)} />
                </span>
                <div className="segmented segmented--small" role="group" aria-label={t("stats.age.order")}>
                  <button type="button" className="seg" aria-pressed={ageOrder === "oldest"} onClick={() => setAgeOrder("oldest")}>
                    {t("stats.age.oldest")}
                  </button>
                  <button type="button" className="seg" aria-pressed={ageOrder === "youngest"} onClick={() => setAgeOrder("youngest")}>
                    {t("stats.age.youngest")}
                  </button>
                </div>
              </div>
              <AgeSummary rows={ages.whenFlown} />
              <div className="age-grid">
                <AgeWhenFlownTable rows={byAge(ages.whenFlown, ageOrder)} views={extension.views} reference={ref} />
                <AgeNowTable rows={byAge(ages.now, ageOrder)} reference={ref} />
              </div>
              <AgeLeftOut left={ages.leftOut} />
            </section>
          )}
          {fs.perYear.length > 1 && (
            <section className="section">
              <div className="section__head">
                <h2 className="section__title">{t("stats.byYear.title")}</h2>
              </div>
              <table className="table">
                <thead>
                  <tr>
                    <th>{t("stats.column.year")}</th>
                    <th className="num">{t("stats.flights.flights")}</th>
                    <th className="num">{t("stats.flights.distance")}</th>
                    <th className="num">{t("stats.flights.time")}</th>
                  </tr>
                </thead>
                <tbody>
                  {fs.perYear.map((y) => (
                    <tr key={y.year}>
                      <td>{y.year}</td>
                      <td className="num">{y.flights}</td>
                      <td className="num">{distance(y.distanceKm, unit)}</td>
                      <td className="num">
                        <Duration min={y.minutes} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}
        </div>
      )}

      {tab === "sightings" && (
        <div role="tabpanel">
          <dl className="facts facts--stats">
            <Fact label={t("stats.sightings.aircraft")} value={measuredText(ss.aircraft)} detail={<>{ss.aircraft.provisional ? t("stats.aircraft.provisional", { count: ss.aircraft.provisional }) : t("stats.aircraft.confirmed")} <LeftOut m={ss.aircraft} what="registration" /></>} />
            <Fact label={t("stats.sightings.sightings")} value={nf.format(ss.sightings)} />
            <Fact label={t("stats.sightings.airlines")} value={measuredText(ss.airlines)} detail={<LeftOut m={ss.airlines} what="airline" />} />
            <Fact label={t("stats.sightings.families")} value={measuredText(ss.families)} />
            <Fact label={t("stats.sightings.types")} value={measuredText(ss.typeCodes)} />
            <Fact label={t("stats.sightings.specialLivery")} value={measuredText(ss.specialLiveryAircraft)} detail={t("common.count.liveries", { count: ss.specialLiveries.value })} />
            <Fact label={t("stats.sightings.repeats")} value={nf.format(ss.repeats.length)} detail={t("stats.sightings.repeatsUnit")} />
            <Fact label={t("stats.sightings.locations")} value={measuredText(ss.airports)} />
          </dl>
          <p className="section__aside stats-note">{t("stats.sightings.note")}</p>
          <div className="ranked-grid">
            <Ranked title={t("stats.sightings.airlines")} t={ss.byAirline} label={op} count={aircraftCount} color="var(--spotted)" missing="airline" />
            <Ranked title={t("stats.sightings.families")} t={ss.byFamily} label={fam} count={aircraftCount} color="var(--spotted)" missing="type" />
            <Ranked title={t("stats.sightings.types")} t={ss.byType} label={ty} count={aircraftCount} color="var(--spotted)" missing="type" />
            <Ranked title={t("stats.sightings.manufacturers")} t={ss.byManufacturer} label={makerName} count={aircraftCount} color="var(--spotted)" missing="type" />
            <Ranked title={t("stats.sightings.locations")} t={ss.byLocation} label={ap} count={aircraftCount} color="var(--spotted)" missing="location" />
            <Ranked title={t("stats.sightings.regCountries")} t={ss.byRegistrationCountry} label={countryName} count={aircraftCount} color="var(--spotted)" missing="registration" />
            <Ranked title={t("stats.sightings.phase")} t={ss.byPhase} label={(k) => PHASE_LABEL[k] ?? k} count={(n) => t("common.count.sightings", { count: n })} color="var(--spotted)" missing="phase" />
          </div>
        </div>
      )}

      {tab === "both" && (
        <div role="tabpanel">
          <dl className="facts facts--stats">
            <Fact label={t("stats.both.flownAndPhotographed")} value={nf.format(cs.flownAndPhotographed.length)} detail={t("stats.both.flownAndPhotographedUnit")} />
            <Fact label={t("stats.both.spottedNeverFlown")} value={nf.format(cs.spottedNeverFlown.length)} />
          </dl>
          <section className="section">
            <div className="section__head">
              <h2 className="section__title">{t("stats.both.types")}</h2>
            </div>
            <table className="table">
              <thead>
                <tr>
                  <th>{t("stats.column.type")}</th>
                  <th className="num">{t("stats.flights.flights")}</th>
                  <th className="num">{t("stats.both.aircraftFlown")}</th>
                  <th className="num">{t("stats.both.aircraftSpotted")}</th>
                </tr>
              </thead>
              <tbody>
                {cs.typesFlownVsSpotted.map((r) => (
                  <tr key={r.typeCode}>
                    <td>{ty(r.typeCode)}</td>
                    <td className="num">{r.flights || "—"}</td>
                    <td className="num">{r.aircraftFlown || "—"}</td>
                    <td className="num">{r.aircraftSpotted || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </div>
      )}

      {tab === "pivot" && <CustomView ctx={ctx} flights={flights} sightings={sightings} />}
    </div>
  );
}

/** "+6.4%", or "at least +6.4%": on a phone "at least" goes under the figure, beside the row's second line. */
function Pct({ e }: { e: { percent: number; minimum: boolean } }) {
  return (
    <span className="ext-fig">
      {e.minimum ? tx("stats.extension.atLeast", { percent: extensionPercent(e.percent) }, { min: (text) => <span className="ext-min">{text}</span>, figure: (text) => <span>{text}</span> }) : <span>{extensionPercent(e.percent)}</span>}
    </span>
  );
}

/** The route extension tables sort by the extra distance (the default, since a percentage ranks short flights first), or by the percentage. */
type ExtensionSort = "percent" | "extra";
const byExtension = <T extends { percent: number; extraKm: number }>(rows: T[], sort: ExtensionSort) => [...rows].sort((a, b) => (sort === "extra" ? b.extraKm - a.extraKm : b.percent - a.percent));

/** A column heading that sorts the route extension tables by its column, largest first. */
function SortHeading({ by, label, sort, onSort, className }: { by: ExtensionSort; label: string; sort: ExtensionSort; onSort: (s: ExtensionSort) => void; className: string }) {
  const on = sort === by;
  return (
    <th className={`num ${className}`} aria-sort={on ? "descending" : "none"}>
      <button type="button" className={`th-sort${on ? " is-on" : ""}`} onClick={() => onSort(by)} title={on ? t("stats.extension.sortedByColumn", { by }) : t("stats.extension.sortByColumn", { by })}>
        {label}
        <Icon name={on ? "chevron-down" : "chevrons-up-down"} />
      </button>
    </th>
  );
}

/** The flights furthest off the great circle, each linking to its page: the first ten, then all. */
function MostIndirect({ rows, views, unit, sort, onSort }: { rows: RouteExtension[]; views: Map<string, ReturnType<typeof sortedFlights>[number]>; unit: Settings["distanceUnit"]; sort: ExtensionSort; onSort: (s: ExtensionSort) => void }) {
  const [all, setAll] = useState(false);
  const shown = all ? rows : rows.slice(0, 10);
  // "Show all" opens the table as a disclosure opens, so what is below slides down instead of jumping.
  const grow = useGrow<HTMLDivElement>(all);
  return (
    <div>
      <h3 className="ranked__title">{t("stats.extension.mostIndirect")}</h3>
      <div ref={grow}>
        <table className="table table--fixed">
          <thead>
            <tr>
              <th>{t("stats.column.flight")}</th>
              <th className="col-route">{t("stats.column.route")}</th>
              <SortHeading by="percent" label={t("stats.extension.percent")} sort={sort} onSort={onSort} className="col-ext" />
              <SortHeading by="extra" label={t("stats.extension.extra")} sort={sort} onSort={onSort} className="col-extra" />
            </tr>
          </thead>
          <tbody>
            {shown.map((e) => {
              const v = views.get(e.flightId);
              return (
                <tr key={e.flightId}>
                  <td>
                    <Link to="/flights/$id" params={{ id: e.flightId }}>
                      {v?.f.flightNumber ?? t("stats.column.flight")}
                    </Link>
                    {v?.day && <span className="muted"> · {dateOnly(v.day, { day: "numeric", month: "short", year: "numeric" })}</span>}
                    {v && <span className="extension-sub">{`${v.fromCode} → ${v.toCode}`}</span>}
                  </td>
                  <td className="col-route extension-route">{v ? `${v.fromCode} → ${v.toCode}` : ""}</td>
                  <td className="num">
                    <Pct e={e} />
                  </td>
                  <td className="num">{distance(e.extraKm, unit)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {rows.length > 10 && (
        <p className="ranked__foot">
          <button type="button" className="link-btn" onClick={() => setAll((a) => !a)}>
            {all ? t("stats.showFewer") : t("stats.showAll", { count: rows.length })}
          </button>
        </p>
      )}
    </div>
  );
}

/** Each route flown more than once with a track that reaches both airports: its flights taken together. */
function ExtensionByRoute({ rows, label, unit, sort, onSort }: { rows: RouteExtensionByRoute[]; label: (key: string) => string; unit: Settings["distanceUnit"]; sort: ExtensionSort; onSort: (s: ExtensionSort) => void }) {
  return (
    <div>
      <h3 className="ranked__title">{t("stats.extension.byRoute")}</h3>
      <table className="table table--fixed">
        <thead>
          <tr>
            <th>{t("stats.column.route")}</th>
            <th className="num col-count">{t("stats.flights.flights")}</th>
            <SortHeading by="percent" label={t("stats.extension.percent")} sort={sort} onSort={onSort} className="col-ext" />
            <SortHeading by="extra" label={t("stats.extension.extra")} sort={sort} onSort={onSort} className="col-extra" />
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.route}>
              <td className="extension-route">
                {label(r.route)}
                <span className="extension-sub">{t("common.count.flights", { count: r.flights })}</span>
              </td>
              <td className="num col-count">{nf.format(r.flights)}</td>
              <td className="num">
                <Pct e={r} />
              </td>
              <td className="num">{distance(r.extraKm, unit)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

type FlightViews = Map<string, ReturnType<typeof sortedFlights>[number]>;

/** The period's flights with a recorded track while some of those tracks are still loading, and the rows to keep room for. */
interface TrackWait {
  /** Flights with a recorded track, and how many of those are in. */
  total: number;
  done: number;
  /** Rows the two tables will have at most: up to ten flights, and up to ten routes flown more than once. */
  flightRows: number;
  routeRows: number;
}

/** Null when none of the period's recorded tracks is still to come. */
function trackWait(store: Store, flights: Flight[], views: FlightViews): TrackWait | null {
  const inPeriod = new Set(flights.map((f) => f.id));
  const flightOf = new Map(store.all("tracks").filter((t) => inPeriod.has(t.flightId)).map((t) => [t.id, t.flightId]));
  if (!flightOf.size) return null;
  const here = new Set<string>();
  for (const p of store.all("track_points")) {
    const f = flightOf.get(p.trackId);
    if (f) here.add(f);
  }
  const recorded = new Set(flightOf.values());
  if (here.size >= recorded.size) return null;
  const perRoute = new Map<string, number>();
  for (const id of recorded) {
    const route = views.get(id)?.route;
    if (route) perRoute.set(route, (perRoute.get(route) ?? 0) + 1);
  }
  const routes = [...perRoute.values()].filter((n) => n > 1).length;
  return { total: recorded.size, done: here.size, flightRows: Math.min(10, recorded.size), routeRows: Math.min(10, routes) };
}

/** Bars in place of a row's figures, as many rows as the tables will have, with the loading note over them. */
function ExtensionWaiting({ wait }: { wait: TrackWait }) {
  const bar = (w: string) => <span className="skeleton-bar" style={{ width: w }} />;
  return (
    <div className="extension-grid extension-wait" aria-busy="true">
      <TrackLoadingNote waiting={wait.total - wait.done} total={wait.total} />
      <div aria-hidden="true">
        <h3 className="ranked__title">{t("stats.extension.mostIndirect")}</h3>
        <table className="table table--fixed">
          <thead>
            <tr>
              <th>{t("stats.column.flight")}</th>
              <th className="col-route">{t("stats.column.route")}</th>
              <th className="num col-ext">{t("stats.extension.percent")}</th>
              <th className="num col-extra">{t("stats.extension.extra")}</th>
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: wait.flightRows }, (_, i) => (
              <tr key={i}>
                <td>
                  {bar("70%")}
                  <span className="extension-sub">{bar("40%")}</span>
                </td>
                <td className="col-route">{bar("75%")}</td>
                <td className="num">{bar("60%")}</td>
                <td className="num">{bar("60%")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {wait.routeRows > 0 && (
        <div aria-hidden="true">
          <h3 className="ranked__title">{t("stats.extension.byRoute")}</h3>
          <table className="table table--fixed">
            <thead>
              <tr>
                <th>{t("stats.column.route")}</th>
                <th className="num col-count">{t("stats.flights.flights")}</th>
                <th className="num col-ext">{t("stats.extension.percent")}</th>
                <th className="num col-extra">{t("stats.extension.extra")}</th>
              </tr>
            </thead>
            <tbody>
              {Array.from({ length: wait.routeRows }, (_, i) => (
                <tr key={i}>
                  <td className="extension-route">
                    {bar("75%")}
                    <span className="extension-sub">{bar("35%")}</span>
                  </td>
                  <td className="num col-count">{bar("40%")}</td>
                  <td className="num">{bar("60%")}</td>
                  <td className="num">{bar("60%")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/** What the section measures, and for how many of the period's flights. */
function ageHelp(ages: AircraftAges, flights: number): string {
  const shown = ages.whenFlown.length < flights ? `${sentenceGap()}${t("stats.age.shownFor", { shown: ages.whenFlown.length, count: flights })}` : "";
  return `${t("stats.age.help", { note: ageTodayNote() })}${shown}`;
}

/** The section's figures in a sentence: the average age when flown, and its range. */
function AgeSummary({ rows }: { rows: AgeWhenFlown[] }) {
  const days = rows.map((r) => r.days);
  const average = averageAge(rows)!;
  if (rows.length === 1)
    return (
      <p className="age-summary">{tx("stats.age.one", { age: ageText(average) }, { b: (text) => <b>{text}</b> })}</p>
    );
  return (
    <p className="age-summary">{tx("stats.age.average", { average: ageText(average), min: ageText(Math.min(...days)), max: ageText(Math.max(...days)) }, { b: (text) => <b>{text}</b> })}</p>
  );
}

/** Flights the section could not measure, by reason. */
function AgeLeftOut({ left }: { left: AircraftAges["leftOut"] }) {
  const text = ageLeftOutText(left);
  return text ? <p className="age-note">{text}</p> : null;
}

/** Ten rows, then "Show all", opening as a disclosure opens. */
function useTenRows<T>(rows: T[]) {
  const [all, setAll] = useState(false);
  const grow = useGrow<HTMLDivElement>(all);
  const foot =
    rows.length > 10 ? (
      <p className="ranked__foot">
        <button type="button" className="link-btn" onClick={() => setAll((a) => !a)}>
          {all ? t("stats.showFewer") : t("stats.showAll", { count: rows.length })}
        </button>
      </p>
    ) : null;
  return { shown: all ? rows : rows.slice(0, 10), grow, foot };
}

/** The aircraft's age on the day of each flight. */
function AgeWhenFlownTable({ rows, views, reference }: { rows: AgeWhenFlown[]; views: FlightViews; reference: RefIndex }) {
  const { shown, grow, foot } = useTenRows(rows);
  return (
    <div>
      <h3 className="ranked__title">{t("stats.age.whenFlown")}</h3>
      <div ref={grow}>
        <table className="table table--fixed">
          <thead>
            <tr>
              <th>{t("stats.column.flight")}</th>
              <th className="col-reg">{t("stats.column.aircraft")}</th>
              <th className="num col-age">{t("stats.age.age")}</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => {
              const f = views.get(r.flightId)?.f;
              const type = typeName(f?.typeCode, reference);
              return (
                <tr key={r.flightId}>
                  <td>
                    <Link to="/flights/$id" params={{ id: r.flightId }}>
                      {f?.flightNumber ?? t("stats.column.flight")}
                    </Link>
                    <span className="muted"> · {dayMonthYear(r.day)}</span>
                    <span className="extension-sub">{[f?.registration, type].filter(Boolean).join(" · ")}</span>
                  </td>
                  <td className="col-reg">
                    <Link to="/aircraft/$id" params={{ id: r.airframeId }}>
                      {f?.registration ?? t("stats.column.aircraft")}
                    </Link>
                    {type && <span className="age-sub">{type}</span>}
                  </td>
                  <td className="num">{ageText(r.days)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {foot}
    </div>
  );
}

/**
 * Each aircraft's time since its first flight. For one still flying that is its age. For one retired or written off
 * it is only the time since its first flight, so the column says that, and the row carries its status.
 */
function AgeNowTable({ rows, reference }: { rows: AgeNow[]; reference: RefIndex }) {
  const { shown, grow, foot } = useTenRows(rows);
  return (
    <div>
      <h3 className="ranked__title">{t("stats.age.today")}</h3>
      <div ref={grow}>
        <table className="table table--fixed">
          <thead>
            <tr>
              <th>{t("stats.column.aircraft")}</th>
              <th className="col-first">{t("stats.age.firstFlight")}</th>
              <th className="num col-age">{t("stats.age.sinceFirstFlight")}</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => {
              const status = r.status ? STATUS_WORD[r.status] : undefined;
              const type = typeName(r.typeCode, reference);
              return (
                <tr key={r.airframeId}>
                  <td>
                    <span className="age-aircraft">
                      <Link to="/aircraft/$id" params={{ id: r.airframeId }}>
                        {r.registration ?? t("stats.column.aircraft")}
                      </Link>
                      {status && <span className="pill">{status}</span>}
                    </span>
                    <span className="age-sub">
                      {type}
                      <span className="age-sub__phone">
                        {type ? " · " : ""}
                        {t("stats.age.firstFlew", { date: dayMonthYear(r.firstFlightDate) })}
                      </span>
                    </span>
                  </td>
                  <td className="col-first">{dayMonthYear(r.firstFlightDate)}</td>
                  <td className="num">{ageText(r.days)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {foot}
    </div>
  );
}
