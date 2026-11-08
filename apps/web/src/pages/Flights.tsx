// Flights: the period's figures, its routes on a map, then the list grouped by month.

import { useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { list, t } from "@touchdown/i18n";
import { Link } from "../lib/link.tsx";
import { flightName, flightStats, flownDistances, todayIn } from "@touchdown/core";
import { flightSearch, flightsWithoutTrack, missingTracksCsv } from "@touchdown/core/view";
import { useApp } from "../data/context.tsx";
import { routeCodes } from "../lib/codes.ts";
import { inPeriod, usePeriod } from "../lib/period.ts";
import { sortedFlights, type FlightView } from "../lib/views.ts";
import { mapFlights, trackIndex, trackInfo } from "../lib/mapdata.ts";
import { airlineLabel, dateOnly, distance, durShort, monthNames, nf } from "../lib/format.ts";
import { Icon } from "../lib/icons.tsx";
import { PeriodControl } from "../components/PeriodControl.tsx";
import { WorldMap } from "../components/maps.tsx";
import { usePhrases } from "../components/Phrase.tsx";
import { Fact, Keep } from "../components/Facts.tsx";
import { Duration } from "../components/Duration.tsx";
import { FlightRow } from "../components/FlightRow.tsx";
import { Select } from "../components/Select.tsx";
import { Pager, usePaging } from "../components/Pager.tsx";
import { useViewState } from "../lib/viewState.ts";
import { download } from "../lib/download.ts";
import { FigureDialog } from "../components/FigureDialog.tsx";
import type { FigureContent } from "../lib/figure.ts";
import { headline } from "../lib/i18n.tsx";

type Highlight = { kind: "id" | "route"; key: string } | null;

const PAGE_SIZE = 30;

export function Flights() {
  const { app, version } = useApp();
  const { store, ref } = app;
  const navigate = useNavigate();
  const { year, setYear, years } = usePeriod(store, version);
  const unit = app.settings().distanceUnit ?? "km";
  // Kept for Back (lib/viewState.ts).
  const [q, setQ] = useViewState("q", "");
  const [airline, setAirline] = useViewState("airline", "");
  const [recordedOnly, setRecordedOnly] = useViewState("recordedOnly", false);
  const [hover, setHover] = useState<Highlight>(null);
  // The image dialog's content, taken when it opens (components/FigureDialog.tsx).
  const [figure, setFigure] = useState<FigureContent | null>(null);
  const { focus, bind } = usePhrases();

  const data = useMemo(() => {
    const views = sortedFlights(store, ref).filter((v) => inPeriod(v.day, year));
    const airframes = new Map(store.all("airframes").map((a) => [a.id, a]));
    const fs = flightStats(views.map((v) => v.f), { ref, airframes, flown: flownDistances(store, ref) });
    const tracks = trackIndex(store);
    const trackMeta = trackInfo(store);
    const review = new Set(app.findings().filter((f) => f.severity !== "info").flatMap((f) => f.records.filter((r) => r.table === "flights").map((r) => r.id)));
    // Every year's, as the list it downloads: what someone else could look for.
    const withoutTrack = flightsWithoutTrack(store, ref).length;
    return { views, fs, tracks, trackMeta, review, withoutTrack };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store, ref, version, year]);

  const { views, fs, tracks, trackMeta, review, withoutTrack } = data;
  const airlines = [...new Set(views.map((v) => v.f.airlineId).filter((x): x is string => !!x))].sort((a, b) => airlineLabel(a, ref).localeCompare(airlineLabel(b, ref)));
  const needle = q.trim();
  const search = useMemo(() => flightSearch(needle, ref), [needle, ref]);
  const matches = (v: FlightView) => {
    if (airline && v.f.airlineId !== airline) return false;
    if (recordedOnly && !tracks.has(v.f.id)) return false;
    return search(v);
  };
  const shown = views.filter(matches);
  const shownIds = new Set(shown.map((v) => v.f.id));
  const shownKey = shown.map((v) => v.f.id).join(",");
  // The map draws the whole period, so a search or a filter never moves it: the flights left out turn grey.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const marks = useMemo(() => mapFlights(views, ref, unit, new Set(), store), [data, unit]);
  /**
   * The flights shown, on a map as an image (components/FigureDialog.tsx): the period, how many and how far, and as
   * statistics the figures this page shows above its map, for the flights shown.
   */
  const figureContent = (): FigureContent => {
    const st = flightStats(
      shown.map((v) => v.f),
      { ref, airframes: new Map(store.all("airframes").map((a) => [a.id, a])), flown: flownDistances(store, ref) },
    );
    const km = st.distanceKm.value;
    const far = st.longestByDistance ? shown.find((v) => v.f.id === st.longestByDistance!.id) : undefined;
    const route = st.byRoute.items[0];
    const company = st.byAirline.items[0];
    const [a, b] = route ? routeCodes(route.key, ref, " ").split(" ") : [];
    const stats = [
      { label: t("stats.flights.flights"), value: nf.format(shown.length), detail: km > 0 ? distance(km, unit) : undefined },
      st.minutes.value > 0 ? { label: t("home.facts.time"), value: durShort(st.minutes.value), detail: t("home.facts.timeDetail", { count: shown.length - st.minutes.leftOut }) } : null,
      far?.km ? { label: t("home.facts.longest"), value: `${far.fromCode} → ${far.toCode}`, detail: [distance(far.km, unit), flightName(far.f)].filter(Boolean).join(" · ") } : null,
      route && route.count > 1 ? { label: t("flights.facts.topRoute"), value: `${a} ⇄ ${b}`, detail: t("common.count.times", { count: route.count }) } : null,
      company ? { label: t("home.facts.airline", { count: st.byAirline.top.length }), value: list(st.byAirline.top.map((id) => airlineLabel(id, ref))), detail: t("common.count.flights", { count: company.count }) } : null,
    ];
    return {
      flights: marks.filter((m) => shownIds.has(m.id)),
      title: t("flights.figure.title", { period: year === "all" ? "all" : "year", year }),
      subtitle: [t("common.count.flights", { count: shown.length }), km > 0 && distance(km, unit)].filter(Boolean).join(" · "),
      stats: stats.filter((x) => x !== null),
    };
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const muted = useMemo(() => (shown.length < views.length ? new Set(views.filter((v) => !shownIds.has(v.f.id)).map((v) => v.f.id)) : null), [shownKey, data]);
  const hasGaps = marks.some((m) => m.gaps?.length && shownIds.has(m.id));
  const recordedShown = marks.filter((m) => m.track && shownIds.has(m.id)).length;
  const shownKm = shown.reduce((s, v) => s + (v.km ?? 0), 0);

  const shared = app.readOnly;
  const longest = fs.longestByDistance ? views.find((v) => v.f.id === fs.longestByDistance!.id) : undefined;
  const topRoute = fs.byRoute.items[0];
  const topAirline = fs.byAirline.items[0];
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
      {views.length > 0 && <h1 className="form-title title--phone">{t("shell.nav.flights")}</h1>}
      <div className="view-top">
        <PeriodControl year={year} years={years} onChange={setYear} />
        {!shared && (
          <Link className="btn btn--quiet hide-phone" to="/flights/new">
            <Icon name="plus" />
            {t("flights.add")}
          </Link>
        )}
      </div>
      {views.length ? (
        <>
          <dl className="facts">
            <Fact label={t("stats.flights.flights")} value={nf.format(views.length)} detail={fs.distanceKm.value > 0 ? distance(fs.distanceKm.value, unit) : undefined} />
            {fs.minutes.value > 0 && <Fact label={t("home.facts.time")} value={<Duration min={fs.minutes.value} pad={false} />} detail={t("home.facts.timeDetail", { count: views.length - fs.minutes.leftOut })} />}
            {longest?.km && longest.route && (
              <Fact
                label={t("home.facts.longest")}
                value={
                  <span className="phrase phrase--flown" {...bind(longest.route)}>
                    {longest.fromCode} → {longest.toCode}
                  </span>
                }
                detail={[distance(longest.km, unit), flightName(longest.f)].filter(Boolean).join(" · ")}
              />
            )}
            {topRoute && topRoute.count > 1 && (
              <Fact
                label={t("flights.facts.topRoute")}
                value={
                  <span className="phrase phrase--flown" {...bind(topRoute.key)}>
                    {ra} ⇄ {rb}
                  </span>
                }
                detail={t("common.count.times", { count: topRoute.count })}
              />
            )}
            {topAirline && <Fact label={t("home.facts.airline", { count: fs.byAirline.top.length })} value={<Keep text={list(fs.byAirline.top.map((id) => airlineLabel(id, ref)))} />} detail={t("common.count.flights", { count: topAirline.count })} />}
          </dl>
        </>
      ) : (
        <h1 className="lead">{headline(t("flights.lead.empty", { scope: year !== "all" ? "year" : shared ? "shared" : "own", year }))}</h1>
      )}
      <div className="map-wrap">
        <div className="legend">
          <span className="legend__item">
            <span className="swatch-line" />
            {recordedShown === shown.length && shown.length
              ? t("flights.legend.allRecorded", { count: shown.length })
              : recordedShown
                ? t("flights.legend.someRecorded", { recorded: recordedShown, count: shown.length })
                : t("flights.legend.noneRecorded")}
          </span>
          {hasGaps && (
            <span className="legend__item">
              <span className="swatch-line swatch-line--unrecorded" />
              {t("flights.legend.notRecorded")}
            </span>
          )}
          {/* A share link's page shows the log, read only: its images are its owner's to make. */}
          {!shared && (
            <button type="button" className="legend__action" aria-haspopup="dialog" onClick={() => setFigure(figureContent())}>
              <Icon name="download" />
              {t("flights.legend.image")}
            </button>
          )}
          {figure && <FigureDialog content={figure} fileName={(ext) => `touchdown-flights-${year === "all" ? "all" : year}.${ext}`} onClose={() => setFigure(null)} />}
          <Link className="legend__action" to="/stats">
            <Icon name="globe" />
            {t("flights.legend.globe")}
          </Link>
        </div>
        <WorldMap
          flights={marks}
          mode="fit"
          activeIds={active ? new Set(shown.filter(isActive).map((v) => v.f.id)) : null}
          mutedIds={muted}
          onArcEnter={(f) => setHover({ kind: "id", key: f.id })}
          onArcLeave={() => setHover(null)}
          onArcClick={(f) => navigate({ to: "/flights/$id", params: { id: f.id } })}
          onAirportClick={(id) => navigate({ to: "/airports/$id", params: { id } })}
          label={t("flights.map.label", { filtered: muted ? "yes" : "no", count: views.length, shown: shown.length })}
        />
      </div>
      <div className="filters" role="search">
        <label className="search">
          <span className="visually-hidden">{t("flights.filters.search")}</span>
          <Icon name="search" />
          <input className="input" type="search" placeholder={t("flights.filters.placeholder")} value={q} onChange={(e) => setQ(e.target.value)} autoComplete="off" />
        </label>
        <Select label={t("flights.filters.airline")} value={airline} onChange={setAirline} options={[{ value: "", label: t("flights.filters.allAirlines") }, ...airlines.map((id) => ({ value: id, label: airlineLabel(id, ref) }))]} />
        <label className="check">
          <input type="checkbox" checked={recordedOnly} onChange={(e) => setRecordedOnly(e.target.checked)} />
          {t("flights.filters.recordedOnly")}
        </label>
        {/* For the owner, to send to someone who can find the tracks: not on a share link. */}
        {withoutTrack > 0 && !shared && (
          <button
            type="button"
            className="btn btn--quiet btn--small"
            title={t("flights.missingTracks.title")}
            onClick={() => download(`flights-without-track-${todayIn()}.csv`, missingTracksCsv(store, ref), "text/csv")}
          >
            <Icon name="download" />
            {t("flights.missingTracks.button", { count: withoutTrack })}
          </button>
        )}
        <span className="filters__count">
          {t("common.count.flights", { count: shown.length })} · {distance(shownKm, unit)}
        </span>
      </div>
      <div ref={paging.top} className="list-top" />
      {!shown.length ? (
        <div className="empty">
          <p>{views.length ? t("flights.empty.filtered") : t("flights.empty.period")}</p>
          {views.length > 0 && (
            <button type="button" className="btn btn--quiet" onClick={clear}>
              {t("flights.empty.clear")}
            </button>
          )}
        </div>
      ) : (
        [...groups].map(([ym, list]) => {
          const month = monthTotals.get(ym)!;
          return (
            <section className="month" key={ym} aria-label={ym === "undated" ? t("flights.noDate") : dateOnly(`${ym}-01`, { month: "long", year: "numeric" })}>
              <div className="month__head">
                <h2 className="month__title">{ym === "undated" ? t("flights.noDate") : year === "all" || ym.slice(0, 4) !== year ? dateOnly(`${ym}-01`, { month: "long", year: "numeric" }) : monthNames()[Number(ym.slice(5)) - 1]}</h2>
                <span className="month__sum">
                  {t("common.count.flights", { count: month.count })} · {distance(month.km, unit)}
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
      <Pager paging={paging} kind="flights" />
    </div>
  );
}
