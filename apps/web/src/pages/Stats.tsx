// Stats (docs/24-statistics.md): the period on a globe, then flights, sightings and both together, and a custom
// view (a pivot) of any one or two dimensions by one measure. Every number says what it left out.

import { useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { AGE_TODAY_NOTE, ageLeftOutText, ageText, aircraftAges, averageAge, byAge, extensionPercent, routeExtensionByRoute, routeExtensions, STATUS_WORD, type AgeNow, type AgeOrder, type AgeWhenFlown, type AircraftAges, type RouteExtension, type RouteExtensionByRoute } from "@touchdown/core/view";
import { combinedStats, EARTH_CIRCUMFERENCE_KM, flightDay, flightStats, phaseIndex, sightingStats, todayIn, type Measured, type RefIndex, type Settings, type Sighting, type StatsContext } from "@touchdown/core";
import { useApp } from "../data/context.tsx";
import { inPeriod, usePeriod } from "../lib/period.ts";
import { sortedFlights } from "../lib/views.ts";
import { mapFlights, mapSpots } from "../lib/mapdata.ts";
import { airlineLabel, CABIN_LABEL, countryName, dateOnly, dayMonthYear, distance, nf, PHASE_LABEL, plural, typeName } from "../lib/format.ts";
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

  // The distance the period's flights flew beyond the great circle, from their recorded tracks.
  const extension = useMemo(() => {
    const ext = routeExtensions(store, ref, flights);
    const views = new Map(sortedFlights(store, ref).map((v) => [v.f.id, v]));
    return { flights: [...ext.values()].sort((a, b) => b.percent - a.percent), byRoute: routeExtensionByRoute(flights, ext, ref), views };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store, ref, version, flights]);

  // Each aircraft's age when the period's flights were on it, and now (docs/24, "Aircraft age").
  const ages = useMemo(() => aircraftAges(flights, ctx.airframes, todayIn()), [flights, ctx]);

  const op = (id: string) => airlineLabel(id, ref) || id;
  const ap = (id: string) => airportWithCode(id, ref) || id;
  const ty = (code: string) => `${typeName(code, ref)} (${code})`;
  const fam = (id: string) => ref.family(id)?.name ?? id;

  return (
    <div className="page">
      <div className="view-top">
        <PeriodControl year={year} years={years} onChange={setYear} />
      </div>
      <GlobePanel
        flights={showFlights ? globe.marks : []}
        spots={showSpots ? globe.spots : []}
        label={`Globe with ${plural(showFlights ? globe.marks.length : 0, "flight")} and ${plural(showSpots ? globe.spots.length : 0, "spotting location")}`}
        note={`${year === "all" ? "all time" : year}${recorded ? ` · ${recorded} of ${plural(globe.marks.length, "flight")} with a recorded track` : ""}`}
        onFlightClick={(f) => navigate({ to: "/flights/$id", params: { id: f.id } })}
        onAirportClick={(id) => navigate({ to: "/airports/$id", params: { id } })}
        head={
          <>
            <div className="chips" role="group" aria-label="Show on the globe">
              <button type="button" className="chip" aria-pressed={showFlights} onClick={() => setShowFlights((v) => !v)}>
                <span className="swatch-line" />
                Flights ({globe.marks.length})
              </button>
              <button type="button" className="chip" aria-pressed={showSpots} onClick={() => setShowSpots((v) => !v)}>
                <span className="swatch-dot" />
                Spotting ({globe.spots.length})
              </button>
            </div>
            {globe.airlines.length > 1 && (
              <Select label="Airline" value={globe.picked} onChange={setAirline} options={[{ value: "", label: "All airlines" }, ...globe.airlines.map((a) => ({ value: a, label: airlineLabel(a, ref) }))]} />
            )}
          </>
        }
      />
      <Tabs
        label="Statistics"
        value={tab}
        onChange={setTab}
        items={[
          ["flights", "Flights"],
          ["sightings", "Spotting"],
          ["both", "Both"],
          ["pivot", "Custom view"],
        ]}
      />

      {tab === "flights" && (
        <div role="tabpanel">
          <dl className="facts facts--stats">
            <Fact label="Flights" value={nf.format(fs.flights)} />
            <Fact label="Distance" value={distance(fs.distanceKm.value, unit)} detail={<>{(fs.distanceKm.value / EARTH_CIRCUMFERENCE_KM).toFixed(1)} times around the Earth <LeftOut m={fs.distanceKm} what="airports" /></>} />
            <Fact label="Time in the air" value={<Duration min={fs.minutes.value} pad={false} />} detail={<LeftOut m={fs.minutes} what="times" />} />
            <Fact label="Airports" value={measuredText(fs.airports)} detail={`${plural(fs.countries.value, "country", "countries")}`} />
            <Fact label="Airlines" value={measuredText(fs.airlines)} />
            <Fact label="Aircraft" value={measuredText(fs.aircraft)} detail={<>{fs.aircraft.provisional ? `${nf.format(fs.aircraft.provisional)} without a serial number` : "all confirmed"} <LeftOut m={fs.aircraft} what="registration" /></>} />
            <Fact label="Aircraft types" value={measuredText(fs.types)} />
            <Fact label="Routes" value={measuredText(fs.routes)} detail="counted both ways as one" />
          </dl>
          <div className="ranked-grid">
            <Ranked title="Airlines" t={fs.byAirline} label={op} unit={["flight", "flights"]} missing="airline" />
            <Ranked title="Routes" t={fs.byRoute} label={(k) => routeCodes(k, ref)} unit={["flight", "flights"]} missing="airports" />
            <Ranked title="Airports" t={fs.airportVisits} label={ap} unit={["visit", "visits"]} missing="airport" />
            <Ranked title="Aircraft types" t={fs.byType} label={ty} unit={["flight", "flights"]} missing="type" />
            <Ranked title="Families" t={fs.byFamily} label={fam} unit={["flight", "flights"]} missing="type" />
            <Ranked title="Manufacturers" t={fs.byManufacturer} label={(k) => k} unit={["flight", "flights"]} missing="type" />
            <Ranked title="Seat position" t={fs.seatPositions} label={(k) => k[0]!.toUpperCase() + k.slice(1)} unit={["flight", "flights"]} missing="seat position" />
            <Ranked title="Cabin" t={fs.cabinClasses} label={(k) => CABIN_LABEL[k] ?? k} unit={["flight", "flights"]} missing="cabin" />
          </div>
          {extension.flights.length > 0 && (
            <section className="section" aria-labelledby="extension-title">
              <div className="section__head section__head--wrap">
                <span className="titled">
                  <h2 className="section__title" id="extension-title">
                    Route extension
                  </h2>
                  <HelpTip
                    label="About route extension"
                    text={`The distance each flight flew beyond the great circle between its airports. A track that has a gap or does not reach an airport counts that stretch as the great circle, so its figure is a minimum, marked "at least".${
                      extension.flights.length < flights.length ? ` Shown for ${nf.format(extension.flights.length)} of ${plural(flights.length, "flight")} with a recorded track.` : ""
                    }`}
                  />
                </span>
                <div className="extension-sort">
                  <span className="extension-sort__label" id="extension-sort">
                    Sort by
                  </span>
                  <div className="segmented segmented--small" role="group" aria-labelledby="extension-sort">
                    <button type="button" className="seg" aria-pressed={extensionSort === "percent"} onClick={() => setExtensionSort("percent")}>
                      Extension
                    </button>
                    <button type="button" className="seg" aria-pressed={extensionSort === "extra"} onClick={() => setExtensionSort("extra")}>
                      Extra
                    </button>
                  </div>
                </div>
              </div>
              <div className="extension-grid">
                <MostIndirect rows={byExtension(extension.flights, extensionSort)} views={extension.views} unit={unit} sort={extensionSort} onSort={setExtensionSort} />
                {extension.byRoute.length > 0 && <ExtensionByRoute rows={byExtension(extension.byRoute, extensionSort)} label={(k) => routeCodes(k, ref)} unit={unit} sort={extensionSort} onSort={setExtensionSort} />}
              </div>
            </section>
          )}
          {ages.whenFlown.length > 0 && (
            <section className="section" aria-labelledby="age-title">
              <div className="section__head section__head--wrap">
                <span className="titled">
                  <h2 className="section__title" id="age-title">
                    Aircraft age
                  </h2>
                  <HelpTip label="About aircraft age" text={ageHelp(ages, flights.length)} />
                </span>
                <div className="segmented segmented--small" role="group" aria-label="Order">
                  <button type="button" className="seg" aria-pressed={ageOrder === "oldest"} onClick={() => setAgeOrder("oldest")}>
                    Oldest first
                  </button>
                  <button type="button" className="seg" aria-pressed={ageOrder === "youngest"} onClick={() => setAgeOrder("youngest")}>
                    Youngest first
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
                <h2 className="section__title">By year</h2>
              </div>
              <table className="table">
                <thead>
                  <tr>
                    <th>Year</th>
                    <th className="num">Flights</th>
                    <th className="num">Distance</th>
                    <th className="num">Time in the air</th>
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
            <Fact label="Aircraft" value={measuredText(ss.aircraft)} detail={<>{ss.aircraft.provisional ? `${nf.format(ss.aircraft.provisional)} without a serial number` : "all confirmed"} <LeftOut m={ss.aircraft} what="registration" /></>} />
            <Fact label="Sightings" value={nf.format(ss.sightings)} />
            <Fact label="Airlines" value={measuredText(ss.airlines)} detail={<LeftOut m={ss.airlines} what="airline" />} />
            <Fact label="Families" value={measuredText(ss.families)} />
            <Fact label="Aircraft types" value={measuredText(ss.typeCodes)} />
            <Fact label="Special-livery aircraft" value={measuredText(ss.specialLiveryAircraft)} detail={plural(ss.specialLiveries.value, "livery", "liveries")} />
            <Fact label="Seen more than once" value={nf.format(ss.repeats.length)} detail="aircraft" />
            <Fact label="Locations" value={measuredText(ss.airports)} />
          </dl>
          <p className="section__aside stats-note">Counts are aircraft, each physical aircraft once, unless they say sightings.</p>
          <div className="ranked-grid">
            <Ranked title="Airlines" t={ss.byAirline} label={op} unit={["aircraft", "aircraft"]} color="var(--spotted)" missing="airline" />
            <Ranked title="Families" t={ss.byFamily} label={fam} unit={["aircraft", "aircraft"]} color="var(--spotted)" missing="type" />
            <Ranked title="Aircraft types" t={ss.byType} label={ty} unit={["aircraft", "aircraft"]} color="var(--spotted)" missing="type" />
            <Ranked title="Manufacturers" t={ss.byManufacturer} label={(k) => k} unit={["aircraft", "aircraft"]} color="var(--spotted)" missing="type" />
            <Ranked title="Locations" t={ss.byLocation} label={ap} unit={["aircraft", "aircraft"]} color="var(--spotted)" missing="location" />
            <Ranked title="Registration countries" t={ss.byRegistrationCountry} label={countryName} unit={["aircraft", "aircraft"]} color="var(--spotted)" missing="registration" />
            <Ranked title="Phase" t={ss.byPhase} label={(k) => PHASE_LABEL[k] ?? k} unit={["sighting", "sightings"]} color="var(--spotted)" missing="phase" />
          </div>
        </div>
      )}

      {tab === "both" && (
        <div role="tabpanel">
          <dl className="facts facts--stats">
            <Fact label="Flown and photographed" value={nf.format(cs.flownAndPhotographed.length)} detail="aircraft" />
            <Fact label="Types spotted, never flown" value={nf.format(cs.spottedNeverFlown.length)} />
          </dl>
          <section className="section">
            <div className="section__head">
              <h2 className="section__title">Types flown and spotted</h2>
            </div>
            <table className="table">
              <thead>
                <tr>
                  <th>Type</th>
                  <th className="num">Flights</th>
                  <th className="num">Aircraft flown</th>
                  <th className="num">Aircraft spotted</th>
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
      {e.minimum && <span className="ext-min">at least </span>}
      <span>{extensionPercent(e.percent)}</span>
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
      <button type="button" className={`th-sort${on ? " is-on" : ""}`} onClick={() => onSort(by)} title={on ? `Sorted by ${label.toLowerCase()}, largest first` : `Sort by ${label.toLowerCase()}`}>
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
      <h3 className="ranked__title">Most indirect flights</h3>
      <div ref={grow}>
        <table className="table table--fixed">
          <thead>
            <tr>
              <th>Flight</th>
              <th className="col-route">Route</th>
              <SortHeading by="percent" label="Extension" sort={sort} onSort={onSort} className="col-ext" />
              <SortHeading by="extra" label="Extra" sort={sort} onSort={onSort} className="col-extra" />
            </tr>
          </thead>
          <tbody>
            {shown.map((e) => {
              const v = views.get(e.flightId);
              return (
                <tr key={e.flightId}>
                  <td>
                    <Link to="/flights/$id" params={{ id: e.flightId }}>
                      {v?.f.flightNumber ?? "Flight"}
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
            {all ? "Show fewer" : `Show all ${rows.length}`}
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
      <h3 className="ranked__title">By route</h3>
      <table className="table table--fixed">
        <thead>
          <tr>
            <th>Route</th>
            <th className="num col-count">Flights</th>
            <SortHeading by="percent" label="Extension" sort={sort} onSort={onSort} className="col-ext" />
            <SortHeading by="extra" label="Extra" sort={sort} onSort={onSort} className="col-extra" />
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.route}>
              <td className="extension-route">
                {label(r.route)}
                <span className="extension-sub">{plural(r.flights, "flight")}</span>
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

/** What the section measures, and for how many of the period's flights. */
function ageHelp(ages: AircraftAges, flights: number): string {
  const shown = ages.whenFlown.length < flights ? ` Shown for ${nf.format(ages.whenFlown.length)} of ${plural(flights, "flight")}.` : "";
  return `Age is calculated from each aircraft's first flight to your flight date, and to today. ${AGE_TODAY_NOTE}.${shown}`;
}

/** The section's figures in a sentence: the average age when flown, and its range. */
function AgeSummary({ rows }: { rows: AgeWhenFlown[] }) {
  const days = rows.map((r) => r.days);
  const average = averageAge(rows)!;
  if (rows.length === 1)
    return (
      <p className="age-summary">
        Aircraft age: <b>{ageText(average)}</b> when you flew.
      </p>
    );
  return (
    <p className="age-summary">
      Average aircraft age: <b>{ageText(average)}</b> (range: <b>{ageText(Math.min(...days))}</b> to <b>{ageText(Math.max(...days))}</b>).
    </p>
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
          {all ? "Show fewer" : `Show all ${rows.length}`}
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
      <h3 className="ranked__title">When you flew</h3>
      <div ref={grow}>
        <table className="table table--fixed">
          <thead>
            <tr>
              <th>Flight</th>
              <th className="col-reg">Aircraft</th>
              <th className="num col-age">Age</th>
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
                      {f?.flightNumber ?? "Flight"}
                    </Link>
                    <span className="muted"> · {dayMonthYear(r.day)}</span>
                    <span className="extension-sub">{[f?.registration, type].filter(Boolean).join(" · ")}</span>
                  </td>
                  <td className="col-reg">
                    <Link to="/aircraft/$id" params={{ id: r.airframeId }}>
                      {f?.registration ?? "Aircraft"}
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
      <h3 className="ranked__title">Age today</h3>
      <div ref={grow}>
        <table className="table table--fixed">
          <thead>
            <tr>
              <th>Aircraft</th>
              <th className="col-first">First flight</th>
              <th className="num col-age">Since first flight</th>
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
                        {r.registration ?? "Aircraft"}
                      </Link>
                      {status && <span className="pill">{status}</span>}
                    </span>
                    <span className="age-sub">
                      {type}
                      <span className="age-sub__phone">
                        {type ? " · " : ""}first flew {dayMonthYear(r.firstFlightDate)}
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
