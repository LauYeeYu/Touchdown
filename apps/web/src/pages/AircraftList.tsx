// Aircraft: every airframe in the log, counted once however many registrations it had (requirement I4).

import { useMemo } from "react";
import { t } from "@touchdown/i18n";
import { Link } from "../lib/link.tsx";
import { flightDay, liveryNames } from "@touchdown/core";
import { useApp } from "../data/context.tsx";
import { aircraftViews } from "../lib/views.ts";
import { airlineLabel, dateOnly, nf, typeName } from "../lib/format.ts";
import { Icon } from "../lib/icons.tsx";
import { Fact } from "../components/Facts.tsx";
import { Pager, usePaging } from "../components/Pager.tsx";
import { Select } from "../components/Select.tsx";
import { TypeCell } from "../components/TypeCell.tsx";
import { useViewState } from "../lib/viewState.ts";
import { voiceOf } from "../lib/voice.tsx";
import { headline, tx } from "../lib/i18n.tsx";

type Filter = "all" | "flown" | "both" | "livery";

const FILTERS: [Filter, () => string][] = [
  ["all", () => t("common.all")],
  ["flown", () => t("aircraft.list.filter.flown")],
  ["both", () => t("aircraft.list.filter.both")],
  ["livery", () => t("aircraft.list.filter.livery")],
];

const PAGE_SIZE = 50;

export function AircraftList() {
  const { app, version } = useApp();
  const { store, ref } = app;
  const voice = voiceOf(app);
  // Kept for Back (lib/viewState.ts).
  const [q, setQ] = useViewState("q", "");
  const [kept, setFilter] = useViewState<Filter>("filter", "all");
  // A filter kept from before a chip was removed shows everything.
  const filter = FILTERS.some(([k]) => k === kept) ? kept : "all";
  const [sort, setSort] = useViewState<"last" | "count" | "reg">("sort", "last");

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const views = useMemo(() => aircraftViews(store).filter((v) => v.flights.length || v.sightings.length), [store, version]);
  // Each aircraft's special liveries, in the order its records first name them.
  const liveries = useMemo(
    () =>
      new Map(
        views.map((v) => {
          const named = [...v.flights.map((f) => ({ day: flightDay(f), name: f.specialLivery })), ...v.sightings.map((s) => ({ day: s.seenOn, name: s.specialLivery }))];
          return [v.airframe.id, liveryNames(named.sort((a, b) => (a.day ?? "").localeCompare(b.day ?? "")).map((r) => r.name))];
        }),
      ),
    [views],
  );
  const flown = views.filter((v) => v.flights.length).length;
  const both = views.filter((v) => v.flights.length && v.sightings.length).length;
  const provisional = views.filter((v) => v.airframe.provisional).length;
  const spotted = views.filter((v) => v.sightings.length).length;
  const sightings = views.reduce((n, v) => n + v.sightings.length, 0);
  const withLivery = views.filter((v) => liveries.get(v.airframe.id)?.length).length;
  const liveryCount = liveryNames([...liveries.values()].flat()).length;
  const mostFlown = views.reduce<(typeof views)[number] | null>((best, v) => (!best || v.flights.length > best.flights.length ? v : best), null);

  const needle = q.trim().toLowerCase().replace(/[\s-]+/g, "");
  const shown = views
    .filter((v) =>
      filter === "flown"
        ? v.flights.length > 0
        : filter === "both"
          ? v.flights.length > 0 && v.sightings.length > 0
          : filter === "livery"
            ? !!liveries.get(v.airframe.id)?.length
            : true,
    )
    .filter((v) => !needle || [v.registration, v.airframe.typeCode, typeName(v.airframe.typeCode, ref), airlineLabel(v.operatorId, ref), v.airframe.msn].join("|").toLowerCase().replace(/[\s-]+/g, "").includes(needle))
    .sort((a, b) =>
      sort === "reg"
        ? (a.registration ?? "").localeCompare(b.registration ?? "")
        : sort === "count"
          ? b.flights.length + b.sightings.length - (a.flights.length + a.sightings.length) || (b.last ?? "").localeCompare(a.last ?? "")
          : (b.last ?? "").localeCompare(a.last ?? ""),
    );
  const paging = usePaging(shown, PAGE_SIZE, `${needle}|${filter}|${sort}`);

  return (
    <div className="page">
      <div className="view-top" />
      {views.length ? (
        <>
          <h1 className="visually-hidden">{t("shell.nav.aircraft")}</h1>
          <dl className="facts">
            {/* A shared whole log leaves out how aircraft are matched (lib/voice.tsx). */}
            <Fact label={t("stats.flights.aircraft")} value={nf.format(views.length)} detail={voice.kind === "you" ? (provisional ? t("stats.aircraft.provisional", { count: provisional }) : t("stats.aircraft.confirmed")) : undefined} />
            {flown > 0 && <Fact label={t("aircraft.list.facts.flown")} value={t("common.count.aircraft", { count: flown })} detail={both > 0 ? t("aircraft.list.facts.alsoSpotted", { count: both }) : undefined} />}
            {spotted > 0 && <Fact label={t("aircraft.list.facts.spotted")} value={t("common.count.aircraft", { count: spotted })} detail={t("common.count.sightings", { count: sightings })} />}
            {withLivery > 0 && <Fact label={t("spotting.facts.specialLiveries")} value={t("common.count.aircraft", { count: withLivery })} detail={t("common.count.liveries", { count: liveryCount })} />}
            {mostFlown && mostFlown.flights.length > 1 && <Fact label={t("home.facts.aircraft")} value={mostFlown.registration ?? ""} detail={`${t("common.count.flights", { count: mostFlown.flights.length })} · ${typeName(mostFlown.airframe.typeCode, ref)}`} />}
          </dl>
        </>
      ) : (
        <h1 className="lead">{headline(app.readOnly ? t("aircraft.list.emptyShared") : t("aircraft.list.empty"))}</h1>
      )}
      <div className="filters" role="search">
        <label className="search">
          <span className="visually-hidden">{t("aircraft.list.search")}</span>
          <Icon name="search" />
          <input className="input" type="search" placeholder={t("aircraft.list.searchPlaceholder")} value={q} onChange={(e) => setQ(e.target.value)} autoComplete="off" />
        </label>
        <div className="chips" role="radiogroup" aria-label={t("aircraft.list.show")}>
          {FILTERS.map(([k, label]) => (
            <button key={k} type="button" role="radio" aria-checked={filter === k} className="chip" onClick={() => setFilter(k)}>
              {label()}
            </button>
          ))}
        </div>
        <Select<typeof sort>
          label={t("aircraft.list.sort")}
          value={sort}
          onChange={setSort}
          options={[
            { value: "last", label: t("aircraft.list.sort.last") },
            { value: "count", label: t("aircraft.list.sort.count") },
            { value: "reg", label: t("aircraft.list.sort.reg") },
          ]}
        />
        <span className="filters__count">{t("common.count.aircraft", { count: shown.length })}</span>
      </div>
      <div className="cols cols--aircraft" aria-hidden="true">
        <span>{t("aircraft.cols.registration")}</span>
        <span>{t("aircraft.cols.type")}</span>
        <span>{t("aircraft.cols.airline")}</span>
        <span className="num">{t("aircraft.cols.flights")}</span>
        <span className="num">{t("aircraft.cols.sightings")}</span>
        <span className="num">{t("aircraft.cols.lastSeen")}</span>
      </div>
      <div ref={paging.top} className="list-top" />
      <ul className="rows">
        {paging.slice.map((v) => (
          <li key={v.airframe.id}>
            <Link className="row row--aircraft" to="/aircraft/$id" params={{ id: v.airframe.id }}>
              <span className="row__route-wrap">
                <span className="row__route">
                  {v.registration ?? t("aircraft.noRegistration")}
                  {liveries.get(v.airframe.id)?.map((name) => (
                    <span key={name} className="pill pill--paint" title={t("aircraft.liveryName", { name })}>
                      <Icon name="paint-roller" />
                      <span>{tx("aircraft.list.liveryPill", { name }, { hidden: (text) => <span className="visually-hidden">{text}</span> })}</span>
                    </span>
                  ))}
                </span>
                {/* Phones hide the type column, so the type code moves under the registration. */}
                {v.airframe.typeCode && <span className="row__cities row__type-phone">{v.airframe.typeCode}</span>}
              </span>
              <TypeCell code={v.airframe.typeCode} />
              <span className="row__cell row__airline">{airlineLabel(v.operatorId, ref) || "—"}</span>
              <span className="row__num tabular">
                {v.flights.length > 0 && <span className="dot dot--flown" />}
                {v.flights.length || "—"}
              </span>
              <span className="row__num tabular">
                {v.sightings.length > 0 && <span className="dot dot--spotted" />}
                {v.sightings.length || "—"}
              </span>
              <span className="row__num row__num--date tabular">{v.last ? dateOnly(v.last, { day: "numeric", month: "short", year: "numeric" }) : "—"}</span>
            </Link>
          </li>
        ))}
      </ul>
      <Pager paging={paging} kind="aircraft" />
    </div>
  );
}
