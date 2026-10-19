// Stats (docs/24-statistics.md): flights, sightings and both together, and a pivot of any one or two
// dimensions by one measure. Every number says what it left out.

import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import {
  combinedStats,
  DIMENSIONS,
  EARTH_CIRCUMFERENCE_KM,
  flightDay,
  flightStats,
  pivot,
  sightingStats,
  type Dataset,
  type Measure,
  type Measured,
  type Sighting,
  type StatsContext,
  type Tally,
} from "@touchdown/core";
import { useApp } from "../data/context.tsx";
import { inPeriod, usePeriod } from "../lib/period.ts";
import { airlineLabel, airportLabel, CABIN_LABEL, countryName, distance, durLong, nf, PHASE_LABEL, plural, typeName } from "../lib/format.ts";
import { Icon } from "../lib/icons.tsx";
import { PeriodControl } from "../components/PeriodControl.tsx";
import { toast } from "../components/overlay.tsx";

type Tab = "flights" | "sightings" | "both" | "pivot";

function LeftOut({ m, what }: { m: { leftOut: number }; what: string }) {
  if (!m.leftOut) return null;
  return (
    <span className="left-out">
      {plural(m.leftOut, "record")} left out (no {what})
    </span>
  );
}

function Stat({ label, value, detail }: { label: string; value: React.ReactNode; detail?: React.ReactNode }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>
        <span className="facts__value">{value}</span>
        {detail && <span className="facts__detail">{detail}</span>}
      </dd>
    </div>
  );
}

/** A ranked list with thin bars; the label and number are text, the bar only shows proportion. */
function Ranked({ title, t, label, unit, limit = 8, color = "var(--flown)", missing }: { title: string; t: Tally; label: (k: string) => string; unit: [string, string]; limit?: number; color?: string; missing: string }) {
  const [all, setAll] = useState(false);
  const items = all ? t.items : t.items.slice(0, limit);
  const max = t.items[0]?.count ?? 1;
  return (
    <section className="ranked">
      <h3 className="ranked__title">{title}</h3>
      {!t.items.length ? (
        <p className="section__aside">Nothing recorded.</p>
      ) : (
        <ol className="ranked__list">
          {items.map((x) => (
            <li key={x.key} title={`${label(x.key)}: ${plural(x.count, unit[0], unit[1])}`}>
              <span className="ranked__label">{label(x.key)}</span>
              <span className="ranked__bar" aria-hidden="true">
                <span style={{ width: `${(x.count / max) * 100}%`, background: color }} />
              </span>
              <span className="ranked__num tabular">{nf.format(x.count)}</span>
            </li>
          ))}
        </ol>
      )}
      <p className="ranked__foot">
        {t.items.length > limit && (
          <button type="button" className="link-btn" onClick={() => setAll((a) => !a)}>
            {all ? "Show fewer" : `Show all ${t.items.length}`}
          </button>
        )}
        <LeftOut m={t} what={missing} />
      </p>
    </section>
  );
}

function measuredText(m: Measured, fmt: (n: number) => string = (n) => nf.format(n)) {
  return fmt(m.value);
}

export function Stats() {
  const { app, version } = useApp();
  const { store, ref } = app;
  const { year, setYear, years } = usePeriod(store, version);
  const settings = app.settings();
  const unit = settings.distanceUnit ?? "km";
  const [tab, setTab] = useState<Tab>("flights");

  const data = useMemo(() => {
    const airframes = new Map(store.all("airframes").map((a) => [a.id, a]));
    const ctx: StatsContext = { ref, airframes };
    const flights = store.all("flights").filter((f) => inPeriod(flightDay(f), year));
    const sightings = store.all("sightings").filter((s) => inPeriod(s.seenOn, year));
    const before: Sighting[] = year === "all" ? [] : store.all("sightings").filter((s) => s.seenOn && s.seenOn < `${year}-01-01`);
    return { ctx, flights, sightings, fs: flightStats(flights, ctx), ss: sightingStats(sightings, ctx, before), cs: combinedStats(flights, sightings, ctx) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store, ref, version, year]);
  const { ctx, flights, sightings, fs, ss, cs } = data;

  const op = (id: string) => airlineLabel(id, ref) || id;
  const ap = (id: string) => airportLabel(id, ref, settings.codeDisplay ?? "iata") || id;
  const ty = (code: string) => `${typeName(code, ref)} (${code})`;
  const fam = (id: string) => ref.family(id)?.name ?? id;

  return (
    <div className="page">
      <div className="view-top">
        <PeriodControl year={year} years={years} onChange={setYear} />
        <Link className="btn btn--quiet hide-phone" to="/map">
          <Icon name="map" />
          Map
        </Link>
      </div>
      <div className="tabs" role="tablist" aria-label="Statistics">
        {(
          [
            ["flights", "Flights"],
            ["sightings", "Spotting"],
            ["both", "Both"],
            ["pivot", "Pivot"],
          ] as [Tab, string][]
        ).map(([k, label]) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} className="tab" onClick={() => setTab(k)}>
            {label}
          </button>
        ))}
      </div>

      {tab === "flights" && (
        <div role="tabpanel">
          <dl className="facts facts--stats">
            <Stat label="Flights" value={nf.format(fs.flights)} />
            <Stat label="Distance" value={distance(fs.distanceKm.value, unit)} detail={<>{(fs.distanceKm.value / EARTH_CIRCUMFERENCE_KM).toFixed(1)} times around the Earth <LeftOut m={fs.distanceKm} what="airports" /></>} />
            <Stat label="Time in the air" value={durLong(fs.minutes.value)} detail={<LeftOut m={fs.minutes} what="times" />} />
            <Stat label="Airports" value={measuredText(fs.airports)} detail={`${plural(fs.countries.value, "country", "countries")}`} />
            <Stat label="Airlines" value={measuredText(fs.airlines)} />
            <Stat label="Aircraft" value={measuredText(fs.aircraft)} detail={<>{fs.aircraft.provisional ? `${nf.format(fs.aircraft.provisional)} without a serial number` : "all confirmed"} <LeftOut m={fs.aircraft} what="registration" /></>} />
            <Stat label="Types" value={measuredText(fs.types)} />
            <Stat label="Routes" value={measuredText(fs.routes)} detail="counted both ways as one" />
          </dl>
          <div className="ranked-grid">
            <Ranked title="Airlines" t={fs.byAirline} label={op} unit={["flight", "flights"]} missing="airline" />
            <Ranked title="Routes" t={fs.byRoute} label={(k) => k.replace("-", " ⇄ ")} unit={["flight", "flights"]} missing="airports" />
            <Ranked title="Airports" t={fs.airportVisits} label={ap} unit={["visit", "visits"]} missing="airport" />
            <Ranked title="Aircraft types" t={fs.byType} label={ty} unit={["flight", "flights"]} missing="type" />
            <Ranked title="Families" t={fs.byFamily} label={fam} unit={["flight", "flights"]} missing="type" />
            <Ranked title="Manufacturers" t={fs.byManufacturer} label={(k) => k} unit={["flight", "flights"]} missing="type" />
            <Ranked title="Seat" t={fs.seatPositions} label={(k) => k[0]!.toUpperCase() + k.slice(1)} unit={["flight", "flights"]} missing="seat position" />
            <Ranked title="Cabin" t={fs.cabinClasses} label={(k) => CABIN_LABEL[k] ?? k} unit={["flight", "flights"]} missing="cabin" />
          </div>
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
                      <td className="num">{durLong(y.minutes)}</td>
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
            <Stat label="Aircraft" value={measuredText(ss.aircraft)} detail={<>{ss.aircraft.provisional ? `${nf.format(ss.aircraft.provisional)} without a serial number` : "all confirmed"} <LeftOut m={ss.aircraft} what="registration" /></>} />
            <Stat label="Sightings" value={nf.format(ss.sightings)} />
            <Stat label="Airlines" value={measuredText(ss.airlines)} detail={<LeftOut m={ss.airlines} what="airline" />} />
            <Stat label="Families" value={measuredText(ss.families)} />
            <Stat label="Type codes" value={measuredText(ss.typeCodes)} />
            <Stat label="Special-livery aircraft" value={measuredText(ss.specialLiveryAircraft)} detail={plural(ss.specialLiveries.value, "livery", "liveries")} />
            <Stat label="Seen more than once" value={nf.format(ss.repeats.length)} detail="aircraft" />
            <Stat label="Locations" value={measuredText(ss.airports)} />
          </dl>
          <p className="section__aside stats-note">Counts are aircraft, each physical aircraft once, unless they say sightings.</p>
          <div className="ranked-grid">
            <Ranked title="Airlines" t={ss.byAirline} label={op} unit={["aircraft", "aircraft"]} color="var(--spotted)" missing="airline" />
            <Ranked title="Families" t={ss.byFamily} label={fam} unit={["aircraft", "aircraft"]} color="var(--spotted)" missing="type" />
            <Ranked title="Type codes" t={ss.byType} label={ty} unit={["aircraft", "aircraft"]} color="var(--spotted)" missing="type" />
            <Ranked title="Manufacturers" t={ss.byManufacturer} label={(k) => k} unit={["aircraft", "aircraft"]} color="var(--spotted)" missing="type" />
            <Ranked title="Locations" t={ss.byLocation} label={ap} unit={["aircraft", "aircraft"]} color="var(--spotted)" missing="location" />
            <Ranked title="Registration countries" t={ss.byRegistrationCountry} label={countryName} unit={["aircraft", "aircraft"]} color="var(--spotted)" missing="registration" />
            <Ranked title="Phase (sightings)" t={ss.byPhase} label={(k) => PHASE_LABEL[k] ?? k} unit={["sighting", "sightings"]} color="var(--spotted)" missing="phase" />
          </div>
        </div>
      )}

      {tab === "both" && (
        <div role="tabpanel">
          <dl className="facts facts--stats">
            <Stat label="Flown and photographed" value={nf.format(cs.flownAndPhotographed.length)} detail="aircraft" />
            <Stat label="Types spotted, never flown" value={nf.format(cs.spottedNeverFlown.length)} />
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

function Pivot({ ctx, flights, sightings, label }: { ctx: StatsContext; flights: ReturnType<typeof flightStats> extends never ? never : import("@touchdown/core").Flight[]; sightings: Sighting[]; label: { op: (k: string) => string; ap: (k: string) => string; ty: (k: string) => string; fam: (k: string) => string } }) {
  const { app } = useApp();
  const unit = app.settings().distanceUnit ?? "km";
  const [dataset, setDataset] = useState<Dataset>("sightings");
  const dims = DIMENSIONS.filter((d) => d.datasets.includes(dataset));
  const [rowId, setRowId] = useState("airline");
  const [colId, setColId] = useState("family");
  const [measure, setMeasure] = useState<Measure>("aircraft");
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
  const fmt = (n: number) => (measure === "distance" ? distance(n, unit) : measure === "time" ? durLong(n) : nf.format(n));
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
      <div className="pivot-controls">
        <label className="field">
          <span className="field__label">Records</span>
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
          <span className="field__label">Rows</span>
          <select className="select" value={rowDim.id} onChange={(e) => setRowId(e.target.value)}>
            {dims.map((d) => (
              <option key={d.id} value={d.id}>
                {d.label}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span className="field__label">Columns</span>
          <select className="select" value={colDim?.id ?? ""} onChange={(e) => setColId(e.target.value)}>
            <option value="">None</option>
            {dims
              .filter((d) => d.id !== rowDim.id)
              .map((d) => (
                <option key={d.id} value={d.id}>
                  {d.label}
                </option>
              ))}
          </select>
        </label>
        <label className="field">
          <span className="field__label">Measure</span>
          <select className="select" value={measure} onChange={(e) => setMeasure(e.target.value as Measure)}>
            <option value="records">{dataset === "flights" ? "Flights" : "Sightings"}</option>
            <option value="aircraft">Aircraft (each once)</option>
            {dataset === "flights" && <option value="distance">Distance</option>}
            {dataset === "flights" && <option value="time">Time in the air</option>}
          </select>
        </label>
        <button
          type="button"
          className="btn btn--quiet btn--small"
          onClick={() => {
            const n = window.prompt("Name this view", `${rowDim.label} by ${colDim?.label ?? "total"}`);
            if (!n) return;
            app.store.insert("saved_views", { name: n, dataset, rowDimension: rowDim.id, columnDimension: colDim?.id ?? null, measure });
            toast("View saved.");
          }}
        >
          Save view
        </button>
      </div>
      {saved.length > 0 && (
        <div className="chips saved-views" aria-label="Saved views">
          {saved.map((v) => (
            <span key={v.id} className="chip chip--removable">
              <button type="button" className="link-btn" onClick={() => apply(v)}>
                {v.name}
              </button>
              <button type="button" className="chip__x" aria-label={`Remove ${v.name}`} onClick={() => app.store.remove("saved_views", v.id)}>
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
    </div>
  );
}
