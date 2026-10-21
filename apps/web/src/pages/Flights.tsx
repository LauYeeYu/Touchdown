// Flights: the period in a sentence, the period's routes on a map, then the list grouped by month.

import { useMemo, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { flightStats } from "@touchdown/core";
import { useApp } from "../data/context.tsx";
import { routeCodes } from "../lib/codes.ts";
import { inPeriod, usePeriod } from "../lib/period.ts";
import { sortedFlights, type FlightView } from "../lib/views.ts";
import { mapFlights, trackIndex, trackInfo } from "../lib/mapdata.ts";
import { airlineLabel, distance, durLong, MONTHS_LONG, plural } from "../lib/format.ts";
import { Icon } from "../lib/icons.tsx";
import { PeriodControl } from "../components/PeriodControl.tsx";
import { WorldMap } from "../components/maps.tsx";
import { Fig, usePhrases } from "../components/Phrase.tsx";
import { FlightCols, FlightRow } from "../components/FlightRow.tsx";
import { Pager, usePaging } from "../components/Pager.tsx";
import { useViewState } from "../lib/viewState.ts";

type Highlight = { kind: "id" | "route"; key: string } | null;

const PAGE_SIZE = 30;

export function Flights() {
  const { app, version } = useApp();
  const { store, ref } = app;
  const navigate = useNavigate();
  const { year, setYear, years, thisYear } = usePeriod(store, version);
  const unit = app.settings().distanceUnit ?? "km";
  // Kept for Back (lib/viewState.ts).
  const [q, setQ] = useViewState("q", "");
  const [airline, setAirline] = useViewState("airline", "");
  const [recordedOnly, setRecordedOnly] = useViewState("recordedOnly", false);
  const [hover, setHover] = useState<Highlight>(null);
  const { focus, bind } = usePhrases();

  const data = useMemo(() => {
    const views = sortedFlights(store, ref).filter((v) => inPeriod(v.day, year));
    const airframes = new Map(store.all("airframes").map((a) => [a.id, a]));
    const fs = flightStats(views.map((v) => v.f), { ref, airframes });
    const tracks = trackIndex(store);
    const trackMeta = trackInfo(store);
    const review = new Set(app.findings().filter((f) => f.severity !== "info").flatMap((f) => f.records.filter((r) => r.table === "flights").map((r) => r.id)));
    return { views, fs, tracks, trackMeta, review };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store, ref, version, year]);

  const { views, fs, tracks, trackMeta, review } = data;
  const airlines = [...new Set(views.map((v) => v.f.airlineId).filter((x): x is string => !!x))].sort((a, b) => airlineLabel(a, ref).localeCompare(airlineLabel(b, ref)));
  const needle = q.trim().toLowerCase().replace(/\s+/g, "");
  const matches = (v: FlightView) => {
    if (airline && v.f.airlineId !== airline) return false;
    if (recordedOnly && !tracks.has(v.f.id)) return false;
    if (!needle) return true;
    const a = ref.airport(v.f.fromAirportId);
    const b = ref.airport(v.f.toAirportId);
    const hay = [v.f.flightNumber, v.fromCode, v.toCode, a?.icao, b?.icao, a?.city, b?.city, v.f.registration, airlineLabel(v.f.airlineId, ref), v.f.typeCode]
      .join("|")
      .toLowerCase()
      .replace(/\s+/g, "");
    return hay.includes(needle);
  };
  const shown = views.filter(matches);
  const shownKey = shown.map((v) => v.f.id).join(",");
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const marks = useMemo(() => mapFlights(shown, ref, unit, new Set(), store), [shownKey, version, unit]);
  const hasGaps = marks.some((m) => m.gaps?.length);
  const recordedShown = marks.filter((m) => m.track).length;
  const shownKm = shown.reduce((s, v) => s + (v.km ?? 0), 0);

  const opening = year === "all" ? `Since ${years[0] ?? thisYear} you have taken` : year === thisYear ? `So far in ${year} you have taken` : `In ${year} you took`;
  const longest = fs.longestByDistance ? views.find((v) => v.f.id === fs.longestByDistance!.id) : undefined;
  const topRoute = fs.byRoute.items[0];
  const [ra, rb] = topRoute ? routeCodes(topRoute.key, ref, " ").split(" ") : [];

  // A highlight comes from a hovered row or arc, else from a pointed-at or pinned phrase.
  const active: Highlight = hover ?? (focus ? { kind: "route", key: focus } : null);
  const isActive = (v: FlightView) => !!active && (active.kind === "id" ? v.f.id === active.key : v.route === active.key);

  // Newest first, a page at a time; each page is grouped by month, with the month's totals over all its flights.
  const newestFirst = [...shown].reverse();
  const paging = usePaging(newestFirst, PAGE_SIZE, `${year}|${needle}|${airline}|${recordedOnly}`);
  const monthOf = (v: FlightView) => v.day?.slice(0, 7) ?? "undated";
  const monthTotals = new Map<string, { count: number; km: number }>();
  for (const v of newestFirst) {
    const t = monthTotals.get(monthOf(v)) ?? { count: 0, km: 0 };
    t.count++;
    t.km += v.km ?? 0;
    monthTotals.set(monthOf(v), t);
  }
  const groups = new Map<string, FlightView[]>();
  for (const v of paging.slice) groups.set(monthOf(v), [...(groups.get(monthOf(v)) ?? []), v]);
  const clear = () => {
    setQ("");
    setAirline("");
    setRecordedOnly(false);
  };

  return (
    <div className="page">
      <div className="view-top">
        <PeriodControl year={year} years={years} onChange={setYear} />
        <Link className="btn btn--quiet hide-phone" to="/flights/new">
          <Icon name="plus" />
          Add flight
        </Link>
      </div>
      <h1 className="lead">
        {views.length ? (
          <>
            {opening} <Fig>{plural(views.length, "flight")}</Fig>
            {fs.distanceKm.value > 0 && (
              <>
                : <Fig>{distance(fs.distanceKm.value, unit)}</Fig>
              </>
            )}
            {fs.minutes.value > 0 && (
              <>
                {" "}
                and <Fig>{durLong(fs.minutes.value)}</Fig> in the air
              </>
            )}
            .{" "}
            {longest?.km && longest.route && (
              <>
                The longest was{" "}
                <span className="phrase phrase--flown" {...bind(longest.route)}>
                  <Fig>
                    {longest.fromCode} → {longest.toCode}
                  </Fig>
                  , {distance(longest.km, unit)}
                </span>
              </>
            )}
            {topRoute && topRoute.count > 1 && (
              <>
                ; the route you flew most was{" "}
                <span className="phrase phrase--flown" {...bind(topRoute.key)}>
                  <Fig>
                    {ra} ⇄ {rb}
                  </Fig>
                  , {plural(topRoute.count, "time")}
                </span>
              </>
            )}
            {longest?.km ? "." : ""}
          </>
        ) : (
          `No flights logged in ${year === "all" ? "your log" : year}.`
        )}
      </h1>
      <div className="map-wrap">
        <div className="legend">
          <span className="legend__item">
            <span className="swatch-line" />
            {recordedShown === shown.length && shown.length
              ? `Recorded tracks for all ${plural(shown.length, "flight")}`
              : recordedShown
                ? `Recorded track on ${recordedShown} of ${plural(shown.length, "flight")}, great circle on the rest`
                : "Great circles: no recorded tracks for these flights"}
          </span>
          {hasGaps && (
            <span className="legend__item">
              <span className="swatch-line swatch-line--gap" />
              Not recorded
            </span>
          )}
          <span className="legend__item">Point at a row or an underlined route to find it</span>
          <Link className="legend__action" to="/stats">
            <Icon name="globe" />
            Explore on a globe
          </Link>
        </div>
        <WorldMap
          flights={marks}
          mode="fit"
          activeIds={active ? new Set(shown.filter(isActive).map((v) => v.f.id)) : null}
          onArcEnter={(f) => setHover({ kind: "id", key: f.id })}
          onArcLeave={() => setHover(null)}
          onArcClick={(f) => navigate({ to: "/flights/$id", params: { id: f.id } })}
          onAirportClick={(id) => navigate({ to: "/airports/$id", params: { id } })}
          label={`Map of ${plural(shown.length, "flight")}`}
        />
      </div>
      <div className="filters" role="search">
        <label className="search">
          <span className="visually-hidden">Search flights</span>
          <Icon name="search" />
          <input className="input" type="search" placeholder="Flight number, airport, registration or type" value={q} onChange={(e) => setQ(e.target.value)} autoComplete="off" />
        </label>
        <label>
          <span className="visually-hidden">Airline</span>
          <select className="select" value={airline} onChange={(e) => setAirline(e.target.value)}>
            <option value="">All airlines</option>
            {airlines.map((id) => (
              <option key={id} value={id}>
                {airlineLabel(id, ref)}
              </option>
            ))}
          </select>
        </label>
        <label className="check">
          <input type="checkbox" checked={recordedOnly} onChange={(e) => setRecordedOnly(e.target.checked)} />
          Recorded tracks only
        </label>
        <span className="filters__count">
          {plural(shown.length, "flight")} · {distance(shownKm, unit)}
        </span>
      </div>
      <FlightCols />
      <div ref={paging.top} className="list-top" />
      {!shown.length ? (
        <div className="empty">
          <p>{views.length ? "No flights match these filters." : "No flights in this period."}</p>
          {views.length > 0 && (
            <button type="button" className="btn btn--quiet" onClick={clear}>
              Clear filters
            </button>
          )}
        </div>
      ) : (
        [...groups].map(([ym, list]) => {
          const month = monthTotals.get(ym)!;
          return (
            <section className="month" key={ym} aria-label={ym === "undated" ? "No date" : `${MONTHS_LONG[Number(ym.slice(5)) - 1]} ${ym.slice(0, 4)}`}>
              <div className="month__head">
                <h2 className="month__title">{ym === "undated" ? "No date" : `${MONTHS_LONG[Number(ym.slice(5)) - 1]}${year === "all" || ym.slice(0, 4) !== year ? " " + ym.slice(0, 4) : ""}`}</h2>
                <span className="month__sum">
                  {plural(month.count, "flight")} · {distance(month.km, unit)}
                </span>
              </div>
              <ul className="rows">
                {list.map((v) => (
                  <FlightRow
                    key={v.f.id}
                    v={v}
                    track={trackMeta.get(v.f.id) ?? null}
                    review={review.has(v.f.id)}
                    active={isActive(v)}
                    onHover={(on) => setHover(on ? { kind: "id", key: v.f.id } : null)}
                  />
                ))}
              </ul>
            </section>
          );
        })
      )}
      <Pager paging={paging} noun={["flight", "flights"]} />
    </div>
  );
}
