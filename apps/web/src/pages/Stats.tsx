// Stats (docs/24-statistics.md): the period on a globe, then flights, sightings and both together, and a custom
// view (a pivot) of any one or two dimensions by one measure. Every number says what it left out.

import { useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { extensionPercent, routeExtensionByRoute, routeExtensions, type RouteExtension, type RouteExtensionByRoute } from "@touchdown/core/view";
import { combinedStats, DIMENSIONS, EARTH_CIRCUMFERENCE_KM, flightDay, flightStats, phaseIndex, pivot, sightingStats, type Dataset, type Measure, type Measured, type Settings, type Sighting, type StatsContext } from "@touchdown/core";
import { useApp } from "../data/context.tsx";
import { inPeriod, usePeriod } from "../lib/period.ts";
import { sortedFlights } from "../lib/views.ts";
import { mapFlights, mapSpots } from "../lib/mapdata.ts";
import { airlineLabel, CABIN_LABEL, countryName, dateOnly, distance, durShort, nf, PHASE_LABEL, plural, typeName } from "../lib/format.ts";
import { Link } from "../lib/link.tsx";
import { airportWithCode, routeCodes } from "../lib/codes.ts";
import { Icon } from "../lib/icons.tsx";
import { PeriodControl } from "../components/PeriodControl.tsx";
import { toast } from "../components/overlay.tsx";
import { Duration } from "../components/Duration.tsx";
import { Tabs } from "../components/Tabs.tsx";
import { Fact, LeftOut } from "../components/Facts.tsx";
import { Ranked } from "../components/Ranked.tsx";
import { HelpTip } from "../components/HelpTip.tsx";
import { GlobePanel } from "../components/GlobePanel.tsx";
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
              <label>
                <span className="visually-hidden">Airline</span>
                <select className="select" value={globe.picked} onChange={(e) => setAirline(e.target.value)}>
                  <option value="">All airlines</option>
                  {globe.airlines.map((a) => (
                    <option key={a} value={a}>
                      {airlineLabel(a, ref)}
                    </option>
                  ))}
                </select>
              </label>
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

      {tab === "pivot" && <Pivot ctx={ctx} flights={flights} sightings={sightings} label={{ op, ap, ty, fam }} />}
    </div>
  );
}

const pct = (e: { percent: number; minimum: boolean }) => `${e.minimum ? "at least " : ""}${extensionPercent(e.percent)}`;

/** The route extension tables sort by the extra distance (the default, since a percentage ranks short flights first), or by the percentage. */
type ExtensionSort = "percent" | "extra";
const byExtension = <T extends { percent: number; extraKm: number }>(rows: T[], sort: ExtensionSort) => [...rows].sort((a, b) => (sort === "extra" ? b.extraKm - a.extraKm : b.percent - a.percent));

/** A column heading that sorts the route extension tables by its column, largest first. */
function SortHeading({ by, label, sort, onSort }: { by: ExtensionSort; label: string; sort: ExtensionSort; onSort: (s: ExtensionSort) => void }) {
  const on = sort === by;
  return (
    <th className="num" aria-sort={on ? "descending" : "none"}>
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
  return (
    <div>
      <h3 className="ranked__title">Most indirect flights</h3>
      <table className="table table--fixed">
        <colgroup>
          <col />
          <col className="col-route" />
          <col className="col-num" />
          <col className="col-num" />
        </colgroup>
        <thead>
          <tr>
            <th>Flight</th>
            <th>Route</th>
            <SortHeading by="percent" label="Extension" sort={sort} onSort={onSort} />
            <SortHeading by="extra" label="Extra" sort={sort} onSort={onSort} />
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
                </td>
                <td className="extension-route">{v ? `${v.fromCode} → ${v.toCode}` : ""}</td>
                <td className="num">{pct(e)}</td>
                <td className="num">{distance(e.extraKm, unit)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
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
        <colgroup>
          <col />
          <col className="col-count" />
          <col className="col-wide-num" />
          <col className="col-wide-num" />
        </colgroup>
        <thead>
          <tr>
            <th>Route</th>
            <th className="num">Flights</th>
            <SortHeading by="percent" label="Extension" sort={sort} onSort={onSort} />
            <SortHeading by="extra" label="Extra" sort={sort} onSort={onSort} />
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.route}>
              <td className="extension-route">{label(r.route)}</td>
              <td className="num">{nf.format(r.flights)}</td>
              <td className="num">{pct(r)}</td>
              <td className="num">{distance(r.extraKm, unit)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Pivot({ ctx, flights, sightings, label }: { ctx: StatsContext; flights: ReturnType<typeof flightStats> extends never ? never : import("@touchdown/core").Flight[]; sightings: Sighting[]; label: { op: (k: string) => string; ap: (k: string) => string; ty: (k: string) => string; fam: (k: string) => string } }) {
  const { app } = useApp();
  const unit = app.settings().distanceUnit ?? "km";
  const [dataset, setDataset] = useViewState<Dataset>("custom.dataset", "sightings");
  const dims = DIMENSIONS.filter((d) => d.datasets.includes(dataset));
  const [rowId, setRowId] = useViewState("custom.rows", "airline");
  const [colId, setColId] = useViewState("custom.columns", "family");
  const [measure, setMeasure] = useViewState<Measure>("custom.measure", "aircraft");
  const rowDim = dims.find((d) => d.id === rowId) ?? dims[0]!;
  const colDim = colId ? (dims.find((d) => d.id === colId && d.id !== rowDim.id) ?? null) : null;
  const records = dataset === "flights" ? flights : sightings;
  const result = useMemo(() => pivot(dataset, records, rowDim, colDim, measure, ctx), [dataset, records, rowDim, colDim, measure, ctx]);
  const saved = app.store.all("saved_views");

  const name = (dimId: string, k: string) => {
    if (dimId === "airline") return label.op(k);
    if (["airport", "from", "to"].includes(dimId)) return label.ap(k);
    if (dimId === "type") return label.ty(k);
    if (dimId === "family") return label.fam(k);
    if (dimId === "regCountry") return countryName(k);
    if (dimId === "phase") return PHASE_LABEL[k] ?? k;
    if (dimId === "cabin") return CABIN_LABEL[k] ?? k;
    return k;
  };
  const fmt = (n: number) => (measure === "distance" ? distance(n, unit) : measure === "time" ? durShort(n) : nf.format(n));
  const cols = colDim ? result.columns : [""];
  const maxCols = 14;

  const apply = (v: (typeof saved)[number]) => {
    if (v.dataset === "flights" || v.dataset === "sightings") setDataset(v.dataset);
    if (v.rowDimension) setRowId(v.rowDimension);
    setColId(v.columnDimension ?? "");
    if (v.measure) setMeasure(v.measure as Measure);
  };

  return (
    <div role="tabpanel">
      <p className="section__aside pivot-intro">Count flights or sightings, grouped by one thing and, if you like, split by a second.</p>
      <div className="pivot-controls">
        <label className="field">
          <span className="field__label">From</span>
          <select className="select" value={dataset} onChange={(e) => {
            const ds = e.target.value as Dataset;
            setDataset(ds);
            if (ds === "flights" && measure === "aircraft") setMeasure("records");
          }}>
            <option value="flights">Flights</option>
            <option value="sightings">Sightings</option>
          </select>
        </label>
        <label className="field">
          <span className="field__label">Count</span>
          <select className="select" value={measure} onChange={(e) => setMeasure(e.target.value as Measure)}>
            <option value="records">{dataset === "flights" ? "Number of flights" : "Number of sightings"}</option>
            <option value="aircraft">Aircraft (each once)</option>
            {dataset === "flights" && <option value="distance">Distance</option>}
            {dataset === "flights" && <option value="time">Time in the air</option>}
          </select>
        </label>
        <label className="field">
          <span className="field__label">Group by</span>
          <select className="select" value={rowDim.id} onChange={(e) => setRowId(e.target.value)}>
            {dims.map((d) => (
              <option key={d.id} value={d.id}>
                {d.label}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span className="field__label">Split by</span>
          <select className="select" value={colDim?.id ?? ""} onChange={(e) => setColId(e.target.value)}>
            <option value="">Nothing</option>
            {dims
              .filter((d) => d.id !== rowDim.id)
              .map((d) => (
                <option key={d.id} value={d.id}>
                  {d.label}
                </option>
              ))}
          </select>
        </label>
        {/* Saved views belong to the log: a share link only reads it. */}
        {!app.readOnly && (
          <button
            type="button"
            className="btn btn--quiet btn--small"
            onClick={() => {
              const n = window.prompt("Name this view", `${rowDim.label}${colDim ? ` by ${colDim.label}` : ""}`);
              if (!n) return;
              app.saveView({ name: n, dataset, rowDimension: rowDim.id, columnDimension: colDim?.id ?? null, measure });
              toast("View saved.");
            }}
          >
            Save this view
          </button>
        )}
      </div>
      {saved.length > 0 && (
        <div className="chips saved-views" aria-label="Saved views">
          {saved.map((v) => (
            <span key={v.id} className="chip chip--removable">
              <button type="button" className="link-btn" onClick={() => apply(v)}>
                {v.name}
              </button>
              <button type="button" className="chip__x" aria-label={`Remove ${v.name}`} onClick={() => app.removeView(v.id)}>
                <Icon name="x" />
              </button>
            </span>
          ))}
        </div>
      )}
      {result.leftOut > 0 && <p className="left-out">{plural(result.leftOut, "record")} left out (missing a value for the chosen dimensions)</p>}
      <div className="table-scroll">
        <table className="table table--pivot">
          <thead>
            <tr>
              <th>{rowDim.label}</th>
              {colDim && cols.slice(0, maxCols).map((c) => <th key={c} className="num">{name(colDim.id, c)}</th>)}
              {colDim && cols.length > maxCols && <th className="num">Others</th>}
              <th className="num">Total</th>
            </tr>
          </thead>
          <tbody>
            {result.rows.map((r) => (
              <tr key={r}>
                <th scope="row">{name(rowDim.id, r)}</th>
                {colDim &&
                  cols.slice(0, maxCols).map((c) => {
                    const v = result.cells.get(`${r}\u0000${c}`);
                    return (
                      <td key={c} className="num">
                        {v ? fmt(v) : ""}
                      </td>
                    );
                  })}
                {colDim && cols.length > maxCols && (
                  <td className="num">
                    {fmt(cols.slice(maxCols).reduce((s, c) => s + (result.cells.get(`${r}\u0000${c}`) ?? 0), 0)) || ""}
                  </td>
                )}
                <td className="num">
                  <b>{fmt(result.rowTotals.get(r) ?? 0)}</b>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {measure === "aircraft" && <p className="section__aside stats-note">Row totals count each aircraft once, so they can be lower than the sum of the row.</p>}
      {(rowDim.id === "phase" || colDim?.id === "phase") && <p className="section__aside stats-note">A sighting seen in several phases counts under each.</p>}
    </div>
  );
}
