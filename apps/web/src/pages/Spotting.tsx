// Spotting: the period's sightings in a sentence, where they happened, then each session (a day at a place).

import { useMemo } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { sightingStats, type Sighting } from "@touchdown/core";
import { useApp } from "../data/context.tsx";
import { airportWithCode, textCode } from "../lib/codes.ts";
import { inPeriod, usePeriod } from "../lib/period.ts";
import { sessionsOf } from "../lib/views.ts";
import { mapSpots } from "../lib/mapdata.ts";
import { airlineLabel, dateOnly, dayLong, nf, PHASE_LABEL, plural, shortAirport, TAG_LABEL, typeName } from "../lib/format.ts";
import { Icon } from "../lib/icons.tsx";
import { PeriodControl } from "../components/PeriodControl.tsx";
import { WorldMap } from "../components/maps.tsx";
import { Fig } from "../components/Phrase.tsx";
import { Pager, usePaging } from "../components/Pager.tsx";
import { TypeCell } from "../components/TypeCell.tsx";
import { Fact } from "../components/Facts.tsx";
import { useViewState } from "../lib/viewState.ts";

const SESSION_PREVIEW = 12;
const SESSIONS_PER_PAGE = 10;

export function Spotting() {
  const { app, version } = useApp();
  const { store, ref } = app;
  const navigate = useNavigate();
  const { year, setYear, years, thisYear } = usePeriod(store, version);
  // Kept for Back (lib/viewState.ts).
  const [q, setQ] = useViewState("q", "");
  const [airport, setAirport] = useViewState("airport", "");
  const [expanded, setExpanded] = useViewState<string[]>("expanded", []);

  const data = useMemo(() => {
    const sightings = store.all("sightings").filter((s) => inPeriod(s.seenOn, year));
    const before: Sighting[] = year === "all" ? [] : store.all("sightings").filter((s) => s.seenOn && s.seenOn < `${year}-01-01`);
    const airframes = new Map(store.all("airframes").map((a) => [a.id, a]));
    const ss = sightingStats(sightings, { ref, airframes }, before);
    const sessions = sessionsOf(store).filter((s) => inPeriod(s.date, year));
    const flown = new Set(store.all("flights").map((f) => f.airframeId).filter(Boolean));
    const review = new Set(app.findings().filter((f) => f.severity !== "info").flatMap((f) => f.records.filter((r) => r.table === "sightings").map((r) => r.id)));
    const tags = new Map<string, string[]>();
    for (const t of store.all("sighting_tags")) if (t.tag) tags.set(t.sightingId, [...(tags.get(t.sightingId) ?? []), t.tag]);
    return { sightings, ss, sessions, flown, review, tags };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store, ref, version, year]);

  const { sightings, ss, sessions, flown, review, tags } = data;
  const newCount = ss.newPerDay.reduce((a, b) => a + b.count, 0);
  const airports = [...new Set(sightings.map((s) => s.airportId).filter((x): x is string => !!x))].sort((a, b) => shortAirport(a, ref).localeCompare(shortAirport(b, ref)));
  const needle = q.trim().toLowerCase().replace(/\s+/g, "");
  const matches = (s: Sighting) => {
    if (airport && s.airportId !== airport) return false;
    if (!needle) return true;
    return [s.registration, s.typeCode, typeName(s.typeCode, ref), airlineLabel(s.operatorId, ref), s.operatorRaw, s.specialLivery, s.livery].join("|").toLowerCase().replace(/\s+/g, "").includes(needle);
  };
  const shownSessions = sessions.map((x) => ({ ...x, shown: x.sightings.filter(matches) })).filter((x) => x.shown.length);
  const paging = usePaging(shownSessions, SESSIONS_PER_PAGE, `${year}|${needle}|${airport}`);
  const when = year === "all" ? `Since ${years[0] ?? thisYear} you have spotted` : year === thisYear ? `So far in ${year} you have spotted` : `In ${year} you spotted`;
  const busiest = [...sessions].sort((a, b) => b.sightings.length - a.sightings.length)[0];
  const topAirline = ss.byAirline.items[0];
  const topType = ss.byType.items[0];

  return (
    <div className="page">
      <div className="view-top">
        <PeriodControl year={year} years={years} onChange={setYear} />
        <span className="view-top__actions hide-phone">
          <Link className="btn btn--quiet" to="/spotting/session">
            <Icon name="list-checks" />
            Log a session
          </Link>
        </span>
      </div>
      <h1 className="lead">
        {sightings.length ? (
          <>
            {when} <Fig>{plural(ss.aircraft.value, "aircraft", "aircraft")}</Fig>
            {year !== "all" && newCount > 0 && newCount !== ss.aircraft.value && <> ({nf.format(newCount)} new to your log)</>} at <Fig>{plural(ss.airports.value, "airport")}</Fig>, on {plural(sessions.length, "day out", "days out")}.
          </>
        ) : (
          `No sightings logged in ${year === "all" ? "your log" : year}.`
        )}
      </h1>
      {sightings.length > 0 && (
        <dl className="facts">
          {topAirline && (
            <Fact label={ss.byAirline.top.length > 1 ? "Most spotted airlines" : "Most spotted airline"} value={ss.byAirline.top.map((id) => airlineLabel(id, ref)).join(" and ")} detail={plural(topAirline.count, "aircraft", "aircraft")} />
          )}
          {topType && (
            <Fact label="Most spotted type" value={typeName(topType.key, ref)} detail={plural(topType.count, "aircraft", "aircraft")} />
          )}
          <Fact label="Special liveries" value={plural(ss.specialLiveryAircraft.value, "aircraft", "aircraft")} detail={plural(ss.specialLiveries.value, "livery", "liveries")} />
          {busiest && (
            <Fact label="Busiest day" value={plural(busiest.sightings.length, "sighting")} detail={<>{busiest.date ? dateOnly(busiest.date, { day: "numeric", month: "short", year: "numeric" }) : ""}
                  {busiest.airportId ? ` · ${textCode(ref.airport(busiest.airportId))}` : ""}</>} />
          )}
        </dl>
      )}

      {sightings.length > 0 && (
        <div className="map-wrap">
          <div className="legend" aria-hidden="true">
            <span className="legend__item">
              <span className="swatch-dot" />
              Spotting locations, sized by aircraft seen
            </span>
          </div>
          <WorldMap flights={[]} spots={mapSpots(sightings, ref)} mode="fit" onAirportClick={(id) => navigate({ to: "/airports/$id", params: { id } })} label={`Map of ${plural(ss.airports.value, "spotting location")}`} />
        </div>
      )}

      <div className="filters" role="search">
        <label className="search">
          <span className="visually-hidden">Search sightings</span>
          <Icon name="search" />
          <input className="input" type="search" placeholder="Registration, type, airline or livery" value={q} onChange={(e) => setQ(e.target.value)} autoComplete="off" />
        </label>
        <label>
          <span className="visually-hidden">Location</span>
          <select className="select" value={airport} onChange={(e) => setAirport(e.target.value)}>
            <option value="">All locations</option>
            {airports.map((id) => (
              <option key={id} value={id}>
                {airportWithCode(id, ref)}
              </option>
            ))}
          </select>
        </label>
        <span className="filters__count">{plural(shownSessions.reduce((a, s) => a + s.shown.length, 0), "sighting")}</span>
      </div>

      {!shownSessions.length && sightings.length > 0 && (
        <div className="empty">
          <p>No sightings match these filters.</p>
          <button
            type="button"
            className="btn btn--quiet"
            onClick={() => {
              setQ("");
              setAirport("");
            }}
          >
            Clear filters
          </button>
        </div>
      )}
      <div ref={paging.top} className="list-top" />
      {paging.slice.map((sess) => {
        const open = expanded.includes(sess.key) || !!needle || sess.shown.length <= SESSION_PREVIEW + 2;
        const rows = open ? sess.shown : sess.shown.slice(0, SESSION_PREVIEW);
        return (
          <section className="month session" key={sess.key}>
            <div className="month__head">
              <h2 className="month__title">
                {sess.date ? dayLong(sess.date) : "No date"} · {airportWithCode(sess.airportId, ref) || sess.sightings[0]?.airportRaw || "Unknown place"}
              </h2>
              <span className="month__sum">
                {plural(sess.aircraft, "aircraft", "aircraft")}
                {sess.newAircraft > 0 && (
                  <>
                    {" "}
                    · <span className="tag-new">{sess.newAircraft} new</span>
                  </>
                )}
              </span>
            </div>
            <ul className="rows">
              {rows.map((s) => (
                <li key={s.id}>
                  <Link className="row row--sighting" to="/spotting/$id/edit" params={{ id: s.id }}>
                    <span className="row__route-wrap">
                      <span className="row__route">
                        {s.registration ?? s.registrationRaw ?? "No registration"}
                        {review.has(s.id) && (
                          <span className="review" title="This sighting has a check to look at">
                            <Icon name="info" />
                            Review
                          </span>
                        )}
                      </span>
                      <span className="row__cities">{airlineLabel(s.operatorId, ref) || s.operatorRaw || "Unknown operator"}</span>
                    </span>
                    <TypeCell code={s.typeCode} />
                    <span className="row__cell row__phase">{s.phase ? PHASE_LABEL[s.phase] : ""}</span>
                    <span className="row__cell row__notes">
                      {s.specialLivery && <span className="pill pill--livery">{s.specialLivery}</span>}
                      {(tags.get(s.id) ?? []).map((t) => (
                        <span className="pill" key={t}>
                          {TAG_LABEL[t] ?? t}
                        </span>
                      ))}
                    </span>
                    <span className="row__track" title={s.airframeId && flown.has(s.airframeId) ? "You flew on this aircraft" : ""}>
                      {s.airframeId && flown.has(s.airframeId) && <Icon name="plane" />}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
            {!open && (
              <button type="button" className="btn btn--quiet btn--small show-all" onClick={() => setExpanded((e) => [...e, sess.key])}>
                Show all {plural(sess.shown.length, "sighting")}
              </button>
            )}
          </section>
        );
      })}
      <Pager paging={paging} noun={["day out", "days out"]} />
    </div>
  );
}
