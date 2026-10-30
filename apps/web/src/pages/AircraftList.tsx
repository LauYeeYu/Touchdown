// Aircraft: every airframe in the log, counted once however many registrations it had (requirement I4).

import { useMemo } from "react";
import { Link } from "../lib/link.tsx";
import { flightDay, liveryNames } from "@touchdown/core";
import { useApp } from "../data/context.tsx";
import { aircraftViews } from "../lib/views.ts";
import { airlineLabel, dateOnly, plural, typeName } from "../lib/format.ts";
import { Icon } from "../lib/icons.tsx";
import { Fig } from "../components/Phrase.tsx";
import { Pager, usePaging } from "../components/Pager.tsx";
import { TypeCell } from "../components/TypeCell.tsx";
import { useViewState } from "../lib/viewState.ts";

type Filter = "all" | "flown" | "both" | "livery";

const FILTERS: [Filter, string][] = [
  ["all", "All"],
  ["flown", "Flown on"],
  ["both", "Flown and photographed"],
  ["livery", "Special livery"],
];

const PAGE_SIZE = 50;

export function AircraftList() {
  const { app, version } = useApp();
  const { store, ref } = app;
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
      <h1 className="lead">
        {views.length ? (
          <>
            {app.readOnly ? (
              // A share link names nobody (docs/32, "The public page"), and leaves out how aircraft are matched.
              <>
                The log holds <Fig>{plural(views.length, "aircraft", "aircraft")}</Fig>: <Fig>{flown}</Fig> flown on, and <Fig>{both}</Fig> of those also photographed.
              </>
            ) : (
              <>
                Your log holds <Fig>{plural(views.length, "aircraft", "aircraft")}</Fig>: you flew on <Fig>{flown}</Fig>, and <Fig>{both}</Fig> of those you also photographed.{" "}
                {provisional > 0 && `${provisional === views.length ? "All are" : provisional === 1 ? "One is" : `${provisional} are`} matched by registration until a serial number is known.`}
              </>
            )}
          </>
        ) : (
          app.readOnly ? "No aircraft in the log." : "No aircraft yet. They appear as you log flights and sightings with registrations."
        )}
      </h1>
      <div className="filters" role="search">
        <label className="search">
          <span className="visually-hidden">Search aircraft</span>
          <Icon name="search" />
          <input className="input" type="search" placeholder="Registration, type, airline or serial number" value={q} onChange={(e) => setQ(e.target.value)} autoComplete="off" />
        </label>
        <div className="chips" role="radiogroup" aria-label="Show">
          {FILTERS.map(([k, label]) => (
            <button key={k} type="button" role="radio" aria-checked={filter === k} className="chip" onClick={() => setFilter(k)}>
              {label}
            </button>
          ))}
        </div>
        <label>
          <span className="visually-hidden">Sort</span>
          <select className="select" value={sort} onChange={(e) => setSort(e.target.value as typeof sort)}>
            <option value="last">Last seen first</option>
            <option value="count">Most records first</option>
            <option value="reg">By registration</option>
          </select>
        </label>
        <span className="filters__count">{plural(shown.length, "aircraft", "aircraft")}</span>
      </div>
      <div className="cols cols--aircraft" aria-hidden="true">
        <span>Registration</span>
        <span>Type</span>
        <span>Airline</span>
        <span className="num">Flights</span>
        <span className="num">Sightings</span>
        <span className="num">Last seen</span>
      </div>
      <div ref={paging.top} className="list-top" />
      <ul className="rows">
        {paging.slice.map((v) => (
          <li key={v.airframe.id}>
            <Link className="row row--aircraft" to="/aircraft/$id" params={{ id: v.airframe.id }}>
              <span className="row__route-wrap">
                <span className="row__route">
                  {v.registration ?? "No registration"}
                  {liveries.get(v.airframe.id)?.map((name) => (
                    <span key={name} className="pill pill--paint" title={`${name} livery`}>
                      <Icon name="paint-roller" />
                      <span>
                        <span className="visually-hidden">Special livery: </span>
                        {name}
                      </span>
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
      <Pager paging={paging} noun={["aircraft", "aircraft"]} />
    </div>
  );
}
