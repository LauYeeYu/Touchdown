// Spotting: the period's figures, where the sightings happened, then each session (a day at a place).

import { useMemo, type ReactNode } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Link } from "../lib/link.tsx";
import { phaseIndex, sightingStats, type Sighting } from "@touchdown/core";
import { list, t } from "@touchdown/i18n";
import { useApp } from "../data/context.tsx";
import { airportWithCode, textCode } from "../lib/codes.ts";
import { inPeriod, usePeriod } from "../lib/period.ts";
import { sessionsOf } from "../lib/views.ts";
import { mapSpots } from "../lib/mapdata.ts";
import { airlineLabel, dateOnly, dayLong, nf, PHASE_LABEL, shortAirport, TAG_LABEL, typeName } from "../lib/format.ts";
import { Icon } from "../lib/icons.tsx";
import { PeriodControl } from "../components/PeriodControl.tsx";
import { WorldMap } from "../components/maps.tsx";
import { Pager, usePaging } from "../components/Pager.tsx";
import { Select } from "../components/Select.tsx";
import { TypeCell } from "../components/TypeCell.tsx";
import { Fact } from "../components/Facts.tsx";
import { useViewState } from "../lib/viewState.ts";
import { useGrow } from "../lib/motion.ts";
import { isolated, voiceOf } from "../lib/voice.tsx";
import { headline } from "../lib/i18n.tsx";

const SESSION_PREVIEW = 12;
const SESSIONS_PER_PAGE = 10;

export function Spotting() {
  const { app, version } = useApp();
  const { store, ref } = app;
  const navigate = useNavigate();
  const { year, setYear, years } = usePeriod(store, version);
  // Kept for Back (lib/viewState.ts).
  const [q, setQ] = useViewState("q", "");
  const [airport, setAirport] = useViewState("airport", "");
  const [expanded, setExpanded] = useViewState<string[]>("expanded", []);

  const data = useMemo(() => {
    const sightings = store.all("sightings").filter((s) => inPeriod(s.seenOn, year));
    const before: Sighting[] = year === "all" ? [] : store.all("sightings").filter((s) => s.seenOn && s.seenOn < `${year}-01-01`);
    const airframes = new Map(store.all("airframes").map((a) => [a.id, a]));
    const phases = phaseIndex(store);
    const ss = sightingStats(sightings, { ref, airframes, phases }, before);
    const sessions = sessionsOf(store).filter((s) => inPeriod(s.date, year));
    const flown = new Set(store.all("flights").map((f) => f.airframeId).filter(Boolean));
    const review = new Set(app.findings().filter((f) => f.severity !== "info").flatMap((f) => f.records.filter((r) => r.table === "sightings").map((r) => r.id)));
    const tags = new Map<string, string[]>();
    for (const t of store.all("sighting_tags")) if (t.tag) tags.set(t.sightingId, [...(tags.get(t.sightingId) ?? []), t.tag]);
    return { sightings, ss, sessions, flown, review, tags, phases };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store, ref, version, year]);

  const { sightings, ss, sessions, flown, review, tags, phases } = data;
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
  // About "you", a shared whole log's owner by name, or nobody on a link to one record (lib/voice.tsx).
  const shared = app.readOnly;
  const voice = voiceOf(app);
  const busiest = [...sessions].sort((a, b) => b.sightings.length - a.sightings.length)[0];
  const topAirline = ss.byAirline.items[0];
  const topType = ss.byType.items[0];

  return (
    <div className="page">
      <div className="view-top">
        <PeriodControl year={year} years={years} onChange={setYear} />
        {!shared && (
          <span className="view-top__actions hide-phone">
            <Link className="btn btn--quiet" to="/spotting/session">
              <Icon name="notebook-pen" />
              {t("spotting.logSession")}
            </Link>
          </span>
        )}
      </div>
      {sightings.length ? <h1 className="visually-hidden">{t("shell.nav.spotting")}</h1> : <h1 className="lead">{headline(t("spotting.empty", { period: year === "all" ? "all" : "year", voice: voice.kind, year }))}</h1>}
      {sightings.length > 0 && (
        <dl className="facts facts--three">
          <Fact
            label={t("spotting.facts.aircraft")}
            value={nf.format(ss.aircraft.value)}
            detail={year !== "all" && newCount > 0 && newCount !== ss.aircraft.value ? t("spotting.facts.newToLog", { count: newCount }) : t("common.count.sightings", { count: sightings.length })}
          />
          <Fact label={t("spotting.facts.days")} value={nf.format(sessions.length)} detail={t("spotting.facts.airports", { count: ss.airports.value })} />
          {topAirline && (
            <Fact label={t("spotting.facts.topAirline", { count: ss.byAirline.top.length })} value={list(ss.byAirline.top.map((id) => airlineLabel(id, ref)))} detail={t("common.count.aircraft", { count: topAirline.count })} />
          )}
          {topType && (
            <Fact label={t("spotting.facts.topType")} value={typeName(topType.key, ref)} detail={t("common.count.aircraft", { count: topType.count })} />
          )}
          <Fact label={t("spotting.facts.specialLiveries")} value={t("common.count.aircraft", { count: ss.specialLiveryAircraft.value })} detail={t("common.count.liveries", { count: ss.specialLiveries.value })} />
          {busiest && (
            <Fact label={t("spotting.facts.busiestDay")} value={t("common.count.sightings", { count: busiest.sightings.length })} detail={<>{busiest.date ? dateOnly(busiest.date, { day: "numeric", month: "short", year: "numeric" }) : ""}
                  {busiest.airportId ? ` · ${textCode(ref.airport(busiest.airportId))}` : ""}</>} />
          )}
        </dl>
      )}

      {sightings.length > 0 && (
        <div className="map-wrap">
          <div className="legend" aria-hidden="true">
            <span className="legend__item">
              <span className="swatch-dot" />
              {t("spotting.map.legend")}
            </span>
          </div>
          <WorldMap flights={[]} spots={mapSpots(sightings, ref)} mode="fit" onAirportClick={(id) => navigate({ to: "/airports/$id", params: { id } })} label={t("spotting.map.label", { count: ss.airports.value })} />
        </div>
      )}

      <div className="filters" role="search">
        <label className="search">
          <span className="visually-hidden">{t("spotting.search.label")}</span>
          <Icon name="search" />
          <input className="input" type="search" placeholder={t("spotting.search.placeholder")} value={q} onChange={(e) => setQ(e.target.value)} autoComplete="off" />
        </label>
        <Select label={t("spotting.field.location")} value={airport} onChange={setAirport} options={[{ value: "", label: t("spotting.filters.allLocations") }, ...airports.map((id) => ({ value: id, label: airportWithCode(id, ref) }))]} />
        <span className="filters__count">{t("common.count.sightings", { count: shownSessions.reduce((a, s) => a + s.shown.length, 0) })}</span>
      </div>

      {!shownSessions.length && sightings.length > 0 && (
        <div className="empty">
          <p>{t("spotting.filters.noMatch")}</p>
          <button
            type="button"
            className="btn btn--quiet"
            onClick={() => {
              setQ("");
              setAirport("");
            }}
          >
            {t("spotting.filters.clear")}
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
                {sess.date ? dayLong(sess.date) : t("spotting.day.noDate")} · {airportWithCode(sess.airportId, ref) || sess.sightings[0]?.airportRaw || t("spotting.day.unknownPlace")}
              </h2>
              <span className="month__sum">
                {t("common.count.aircraft", { count: sess.aircraft })}
                {sess.newAircraft > 0 && (
                  <>
                    {" "}
                    · <span className="tag-new">{t("spotting.day.new", { count: sess.newAircraft })}</span>
                  </>
                )}
              </span>
            </div>
            <SessionRows all={expanded.includes(sess.key)}>
              {rows.map((s) => (
                <li key={s.id}>
                  {/* The aircraft's page, like every list of aircraft; the sighting itself until it is matched to one. */}
                  <Link className="row row--sighting" {...(s.airframeId ? { to: "/aircraft/$id", params: { id: s.airframeId } } : { to: "/spotting/$id/edit", params: { id: s.id } })}>
                    <span className="row__route-wrap">
                      <span className="row__route">
                        {s.registration ?? s.registrationRaw ?? t("spotting.row.noRegistration")}
                        {review.has(s.id) && (
                          <span className="review" title={t("spotting.row.reviewTitle")}>
                            <Icon name="info" />
                            {t("spotting.row.review")}
                          </span>
                        )}
                      </span>
                      <span className="row__cities">{airlineLabel(s.operatorId, ref) || s.operatorRaw || t("spotting.row.unknownOperator")}</span>
                    </span>
                    <TypeCell code={s.typeCode} />
                    {/* Every phase it was seen in, all equal, one per line in the fixed order of phases. */}
                    <span className="row__cell row__phase">
                      {(phases.get(s.id) ?? []).map((p) => (
                        <span key={p}>{PHASE_LABEL[p] ?? p}</span>
                      ))}
                    </span>
                    <span className="row__cell row__notes">
                      {s.specialLivery && <span className="pill pill--livery">{s.specialLivery}</span>}
                      {(tags.get(s.id) ?? []).map((t) => (
                        <span className="pill" key={t}>
                          {TAG_LABEL[t] ?? t}
                        </span>
                      ))}
                    </span>
                    <span className="row__track" title={s.airframeId && flown.has(s.airframeId) ? t("spotting.row.flown", { voice: voice.kind, name: voice.kind === "named" ? isolated(voice.name) : "" }) : ""}>
                      {s.airframeId && flown.has(s.airframeId) && <Icon name="tickets-plane" />}
                    </span>
                  </Link>
                </li>
              ))}
            </SessionRows>
            {!open && (
              <button type="button" className="btn btn--quiet btn--small show-all" onClick={() => setExpanded((e) => [...e, sess.key])}>
                {t("spotting.day.showAll", { count: sess.shown.length })}
              </button>
            )}
          </section>
        );
      })}
      <Pager paging={paging} kind="daysOut" />
    </div>
  );
}

/** A day's sightings. "Show all" opens the list as a disclosure opens, so the days below slide down. */
function SessionRows({ all, children }: { all: boolean; children: ReactNode }) {
  const grow = useGrow<HTMLUListElement>(all);
  return (
    <ul className="rows" ref={grow}>
      {children}
    </ul>
  );
}
