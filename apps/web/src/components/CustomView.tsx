// The Statistics page's Custom view (docs/24, "Custom view"): what to count, by one dimension and split by a second,
// read as one sentence of choices; filters that keep only some values; a table shaded by size whose every figure
// opens the flights or sightings behind it; and views saved by name with all of it.

import { useEffect, useMemo, useRef, useState } from "react";
import { dimensionValues, DIMENSIONS, filterRecords, pivot, pivotRecords, viewFilters, type Dataset, type Dimension, type Flight, type Measure, type PivotFilter, type Sighting, type StatsContext } from "@touchdown/core";
import { dimensionLabel, pivotValueLabel } from "@touchdown/core/view";
import { t } from "@touchdown/i18n";
import { useApp } from "../data/context.tsx";
import { airlineLabel, dateOnly, distance, durShort, nf } from "../lib/format.ts";
import { codeStyle, airportWithCode } from "../lib/codes.ts";
import { Icon } from "../lib/icons.tsx";
import { Link } from "../lib/link.tsx";
import { trackInfo } from "../lib/mapdata.ts";
import { useGrow } from "../lib/motion.ts";
import { sortedFlights } from "../lib/views.ts";
import { useViewState } from "../lib/viewState.ts";
import { FlightRow } from "./FlightRow.tsx";
import { Select } from "./Select.tsx";
import { Pager, usePaging } from "./Pager.tsx";
import { TypeCell } from "./TypeCell.tsx";
import { toast } from "./overlay.tsx";
import { tx } from "../lib/i18n.tsx";

/** What the first choice counts: the dataset and the measure together, as one plain phrase. */
const COUNTS: { dataset: Dataset; measure: Measure; label: () => string; head: () => string }[] = [
  { dataset: "flights", measure: "records", label: () => t("views.measure.flights"), head: () => t("views.head.flights") },
  { dataset: "flights", measure: "aircraft", label: () => t("views.measure.aircraftFlown"), head: () => t("views.head.aircraft") },
  { dataset: "flights", measure: "distance", label: () => t("views.measure.distance"), head: () => t("views.head.distance") },
  { dataset: "flights", measure: "time", label: () => t("views.measure.time"), head: () => t("views.head.time") },
  { dataset: "sightings", measure: "records", label: () => t("views.measure.sightings"), head: () => t("views.head.sightings") },
  { dataset: "sightings", measure: "aircraft", label: () => t("views.measure.aircraftSeen"), head: () => t("views.head.aircraft") },
];

/** Rows shown before "Show all". */
const FIRST_ROWS = 25;
/** Columns shown before the rest are added up as "Others". */
const MAX_COLUMNS = 14;
/** Records listed a page under the table. */
const RECORD_PAGE = 20;

/** A figure picked in the table: null for a total's side. */
type Picked = { row: string | null; col: string | null };

const lower = (d: Dimension) => d.label.toLowerCase();

export function CustomView({ ctx, flights, sightings }: { ctx: StatsContext; flights: Flight[]; sightings: Sighting[] }) {
  const { app } = useApp();
  const { ref, store } = app;
  const unit = app.settings().distanceUnit ?? "km";
  const [dataset, setDataset] = useViewState<Dataset>("custom.dataset", "sightings");
  const [measure, setMeasure] = useViewState<Measure>("custom.measure", "aircraft");
  const [rowId, setRowId] = useViewState("custom.rows", "airline");
  const [colId, setColId] = useViewState("custom.columns", "family");
  const [filters, setFilters] = useViewState<PivotFilter[]>("custom.filters", []);
  const [picked, setPicked] = useState<Picked | null>(null);
  const [allRows, setAllRows] = useState(false);
  const [editing, setEditing] = useState<string | "new" | null>(null);

  const dims = DIMENSIONS.filter((d) => d.datasets.includes(dataset));
  const rowDim = dims.find((d) => d.id === rowId) ?? dims[0]!;
  const colDim = colId ? (dims.find((d) => d.id === colId && d.id !== rowDim.id) ?? null) : null;
  const active = filters.filter((f) => f.values.length && dims.some((d) => d.id === f.dimension));
  const all: (Flight | Sighting)[] = dataset === "flights" ? flights : sightings;
  const records = useMemo(() => filterRecords(dataset, all, active, ctx), [dataset, all, JSON.stringify(active), ctx]);
  const result = useMemo(() => pivot(dataset, records, rowDim, colDim, measure, ctx), [dataset, records, rowDim, colDim, measure, ctx]);
  const count = COUNTS.find((c) => c.dataset === dataset && c.measure === measure) ?? COUNTS[0]!;
  const name = (dimId: string, k: string) => pivotValueLabel(dimId, k, ref, codeStyle());
  const fmt = (n: number) => (measure === "distance" ? distance(n, unit) : measure === "time" ? durShort(n) : nf.format(n));

  // A new question: the list under the table was an answer to the old one.
  const query = `${dataset}|${measure}|${rowDim.id}|${colDim?.id ?? ""}|${JSON.stringify(active)}`;
  useEffect(() => {
    setPicked(null);
    setAllRows(false);
  }, [query]);

  const setCount = (value: string) => {
    const c = COUNTS.find((x) => `${x.dataset}:${x.measure}` === value)!;
    setDataset(c.dataset);
    setMeasure(c.measure);
    // Filters on what the other dataset does not have go.
    if (c.dataset !== dataset) setFilters((fs) => fs.filter((f) => DIMENSIONS.find((d) => d.id === f.dimension)?.datasets.includes(c.dataset)));
  };
  const swap = () => {
    if (!colDim) return;
    setRowId(colDim.id);
    setColId(rowDim.id);
  };
  const setFilter = (dimension: string, values: string[]) =>
    setFilters((fs) => {
      const rest = fs.filter((f) => f.dimension !== dimension);
      if (!values.length) return rest;
      const at = fs.findIndex((f) => f.dimension === dimension);
      const next = { dimension, values };
      return at < 0 ? [...rest, next] : [...fs.slice(0, at), next, ...fs.slice(at + 1)];
    });

  // Saved views (the log's saved_views): the one matching what shows is marked.
  const saved = store.all("saved_views");
  const savedFilters = new Map(saved.map((v) => [v.id, viewFilters(store, v.id)]));
  const isShown = (v: (typeof saved)[number]) => v.dataset === dataset && v.measure === measure && v.rowDimension === rowDim.id && (v.columnDimension ?? null) === (colDim?.id ?? null) && JSON.stringify(savedFilters.get(v.id)) === JSON.stringify(active);
  const apply = (v: (typeof saved)[number]) => {
    if (v.dataset === "flights" || v.dataset === "sightings") setDataset(v.dataset);
    if (v.measure) setMeasure(v.measure as Measure);
    if (v.rowDimension) setRowId(v.rowDimension);
    setColId(v.columnDimension ?? "");
    setFilters(savedFilters.get(v.id) ?? []);
  };
  const save = () => {
    const suggestion = colDim ? t("views.saved.suggestionSplit", { count: count.label(), rows: lower(rowDim), columns: lower(colDim) }) : t("views.saved.suggestion", { count: count.label(), rows: lower(rowDim) });
    const n = window.prompt(t("views.saved.prompt"), suggestion);
    if (!n?.trim()) return;
    app.saveView({ name: n.trim(), dataset, rowDimension: rowDim.id, columnDimension: colDim?.id ?? null, measure, ...(active.length && { filters: active }) });
    toast(t("views.saved.done"));
  };

  const cols = colDim ? result.columns : [];
  const shownCols = cols.slice(0, MAX_COLUMNS);
  const others = cols.slice(MAX_COLUMNS);
  const rows = allRows ? result.rows : result.rows.slice(0, FIRST_ROWS);
  const grow = useGrow<HTMLDivElement>(allRows);
  // The figures shaded by size: the cells when split, else the one figure a row has.
  const shaded = colDim ? [...result.cells.values()] : [...result.rowTotals.values()];
  const max = Math.max(1, ...shaded);
  const heat = (v: number) => ({ "--heat": (v / max).toFixed(3) }) as React.CSSProperties;

  const list = useRef<HTMLElement>(null);
  const pick = (p: Picked) => {
    setPicked(p);
    requestAnimationFrame(() => list.current?.scrollIntoView({ block: "nearest", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" }));
  };
  const isPicked = (row: string | null, col: string | null) => picked?.row === row && picked?.col === col;
  const countSelect = (
    <Select
      className="custom__select custom__select--lead"
      label={t("views.query.count")}
      value={`${dataset}:${measure}`}
      onChange={setCount}
      options={[
        { group: t("views.query.flights"), options: COUNTS.filter((c) => c.dataset === "flights").map((c) => ({ value: `${c.dataset}:${c.measure}`, label: c.label() })) },
        { group: t("views.query.spotting"), options: COUNTS.filter((c) => c.dataset === "sightings").map((c) => ({ value: `${c.dataset}:${c.measure}`, label: c.label() })) },
      ]}
    />
  );
  const rowsSelect = <Select className="custom__select" label={t("views.query.rowsLabel")} value={rowDim.id} onChange={setRowId} options={dims.map((d) => ({ value: d.id, label: lower(d) }))} />;
  const word = (text: React.ReactNode) => <span className="custom__word">{text}</span>;
  /** A figure that opens its records. */
  const figure = (key: string, value: number, row: string | null, col: string | null, total = false, style?: React.CSSProperties) => {
    const where = [row !== null && name(rowDim.id, row), col !== null && colDim && name(colDim.id, col)].filter(Boolean).join(", ") || t("views.figure.everyRow");
    return (
      <td key={key} className={`num pivot__cell${total ? " pivot__total" : ""}${style ? " is-shaded" : ""}`} style={style}>
        <button type="button" className={`pivot__fig${isPicked(row, col) ? " is-picked" : ""}`} aria-pressed={isPicked(row, col)} aria-label={t("views.figure.label", { value: fmt(value), where, dataset })} onClick={() => pick({ row, col })}>
          {fmt(value)}
        </button>
      </td>
    );
  };

  return (
    <div role="tabpanel" className="custom">
      <div className="custom__query">
        {/* One sentence of choices: "[Number of flights] by [airline] split by [family]". */}
        {colDim
          ? tx("views.query.split", { count: countSelect, rows: rowsSelect, columns: <Select className="custom__select" label={t("views.query.columnsLabel")} value={colDim.id} onChange={setColId} options={dims.filter((d) => d.id !== rowDim.id).map((d) => ({ value: d.id, label: lower(d) }))} /> }, { word })
          : tx("views.query.rows", { count: countSelect, rows: rowsSelect }, { word })}
        {colDim ? (
          <>
            <button type="button" className="icon-btn custom__tool" onClick={swap} aria-label={t("views.query.swap")} title={t("views.query.swap")}>
              <Icon name="arrow-left-right" />
            </button>
            <button type="button" className="icon-btn custom__tool" onClick={() => setColId("")} aria-label={t("views.query.stopSplitting")} title={t("views.query.stopSplitting")}>
              <Icon name="x" />
            </button>
          </>
        ) : (
          <button type="button" className="btn btn--quiet btn--small" onClick={() => setColId(dims.find((d) => d.id !== rowDim.id)?.id ?? "")}>
            <Icon name="plus" />
            {t("views.query.splitBy")}
          </button>
        )}
      </div>

      <div className="custom__filters" aria-label={t("views.filters.label")}>
        {active.map((f) => {
          const d = DIMENSIONS.find((x) => x.id === f.dimension)!;
          const shown = f.values.slice(0, 2).map((v) => name(d.id, v));
          return (
            <span key={f.dimension} className="menu-anchor">
              <span className="chip chip--removable filter-chip is-on">
                <button type="button" className="filter-chip__edit" aria-haspopup="dialog" aria-expanded={editing === f.dimension} onClick={() => setEditing(editing === f.dimension ? null : f.dimension)}>
                  <span className="filter-chip__dim">{t("views.filters.dimension", { dimension: d.label })}</span> {shown.join(", ")}
                  {f.values.length > 2 && <span className="filter-chip__more"> +{f.values.length - 2}</span>}
                </button>
                <button type="button" className="chip__x" aria-label={t("views.filters.remove", { dimension: lower(d) })} onClick={() => setFilter(f.dimension, [])}>
                  <Icon name="x" />
                </button>
              </span>
              {editing === f.dimension && <FilterPanel dataset={dataset} dim={d} all={all} active={active} ctx={ctx} name={name} onChange={setFilter} onClose={() => setEditing(null)} />}
            </span>
          );
        })}
        <span className="menu-anchor">
          <button type="button" className="chip filter-add" aria-haspopup="dialog" aria-expanded={editing === "new"} onClick={() => setEditing(editing === "new" ? null : "new")}>
            <Icon name="list-filter" />
            {t("views.filters.add")}
          </button>
          {editing === "new" && <FilterPanel dataset={dataset} dims={dims.filter((d) => !active.some((f) => f.dimension === d.id))} all={all} active={active} ctx={ctx} name={name} onChange={setFilter} onClose={() => setEditing(null)} />}
        </span>
        <span className="custom__count">{active.length ? t("views.filters.of", { shown: records.length, dataset, count: all.length }) : dataset === "flights" ? t("common.count.flights", { count: all.length }) : t("common.count.sightings", { count: all.length })}</span>
      </div>

      {(saved.length > 0 || !app.readOnly) && (
        <div className="custom__saved">
          {saved.length > 0 && (
            <div className="chips" aria-label={t("views.saved.label")}>
              {saved.map((v) => (
                <span key={v.id} className={`chip chip--removable${app.readOnly ? " chip--plain" : ""}`} aria-current={isShown(v) ? "true" : undefined}>
                  <button type="button" className="link-btn" onClick={() => apply(v)}>
                    {v.name}
                  </button>
                  {/* Saved views belong to the log: a share link only reads it. */}
                  {!app.readOnly && (
                    <button type="button" className="chip__x" aria-label={t("views.saved.remove", { name: v.name ?? "" })} onClick={() => app.removeView(v.id)}>
                      <Icon name="x" />
                    </button>
                  )}
                </span>
              ))}
            </div>
          )}
          {!app.readOnly && !saved.some(isShown) && (
            <button type="button" className="btn btn--quiet btn--small" onClick={save}>
              {t("views.saved.save")}
            </button>
          )}
        </div>
      )}

      {!all.length ? (
        <div className="empty">
          <p>{t("views.empty.period", { dataset })}</p>
        </div>
      ) : !records.length ? (
        <div className="empty">
          <p>{t("views.empty.filters", { dataset })}</p>
          <button type="button" className="btn btn--quiet" onClick={() => setFilters([])}>
            {t("views.empty.clear")}
          </button>
        </div>
      ) : (
        <>
          <div ref={grow}>
            <div className="table-scroll">
              <table className={`table table--pivot pivot--${dataset}`}>
                <thead>
                  <tr>
                    <th>{rowDim.label}</th>
                    {shownCols.map((c) => (
                      <th key={c} className="num">
                        {name(colDim!.id, c)}
                      </th>
                    ))}
                    {others.length > 0 && <th className="num">{t("views.table.others")}</th>}
                    <th className="num">{colDim ? t("views.table.total") : count.head()}</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r}>
                      <th scope="row">{name(rowDim.id, r)}</th>
                      {shownCols.map((c) => {
                        const v = result.cells.get(`${r}\u0000${c}`);
                        return v ? figure(c, v, r, c, false, heat(v)) : <td key={c} className="num" />;
                      })}
                      {others.length > 0 && <td className="num pivot__others">{fmt(others.reduce((s, c) => s + (result.cells.get(`${r}\u0000${c}`) ?? 0), 0)) || ""}</td>}
                      {figure("total", result.rowTotals.get(r) ?? 0, r, null, !!colDim, colDim ? undefined : heat(result.rowTotals.get(r) ?? 0))}
                    </tr>
                  ))}
                </tbody>
                {result.rows.length > 1 && (
                  <tfoot>
                    <tr>
                      <th scope="row">{t("views.table.total")}</th>
                      {shownCols.map((c) => figure(c, result.columnTotals.get(c) ?? 0, null, c, true))}
                      {others.length > 0 && <td className="num pivot__others" />}
                      {figure("total", result.total, null, null, true)}
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          </div>
          {result.rows.length > FIRST_ROWS && (
            <p className="ranked__foot">
              <button type="button" className="link-btn" onClick={() => setAllRows((a) => !a)}>
                {allRows ? t("views.showFewer") : t("views.showAll", { count: result.rows.length })}
              </button>
            </p>
          )}
          <div className="custom__notes">
            {result.leftOut > 0 && (
              <p>{colDim ? t("views.notes.leftOutSplit", { dataset, count: result.leftOut, rows: lower(rowDim), columns: lower(colDim) }) : t("views.notes.leftOut", { dataset, count: result.leftOut, rows: lower(rowDim) })}</p>
            )}
            {measure === "aircraft" && <p>{t("views.notes.aircraftOnce")}</p>}
            {(rowDim.id === "phase" || colDim?.id === "phase") && <p>{t("views.notes.phases")}</p>}
          </div>
          {picked && <Records anchor={list} picked={picked} dataset={dataset} records={pivotRecords(dataset, records, rowDim, colDim, picked.row, picked.col, ctx)} title={[picked.row !== null ? name(rowDim.id, picked.row) : null, picked.col !== null && colDim ? name(colDim.id, picked.col) : null].filter(Boolean).join(" · ") || t("views.records.everything")} onClose={() => setPicked(null)} />}
        </>
      )}
    </div>
  );
}

/**
 * The panel under "Filter" or a filter's chip: first the dimension (for a new filter), then its values to tick, each
 * with how many records have it among those the other filters keep. Ticking applies at once, so the table behind
 * answers while the panel is open. Escape, Done or a click outside closes it.
 */
function FilterPanel({ dataset, dim, dims = [], all, active, ctx, name, onChange, onClose }: { dataset: Dataset; dim?: Dimension; dims?: Dimension[]; all: (Flight | Sighting)[]; active: PivotFilter[]; ctx: StatsContext; name: (dimId: string, k: string) => string; onChange: (dimId: string, values: string[]) => void; onClose: () => void }) {
  const panel = useRef<HTMLDivElement>(null);
  const [q, setQ] = useState("");
  // A new filter: its dimension, once picked.
  const [picked, setPicked] = useState<Dimension | null>(null);
  const current = dim ?? picked;
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const outside = (e: PointerEvent) => {
      const anchor = panel.current?.parentElement;
      if (anchor && !anchor.contains(e.target as Node)) close.current();
    };
    document.addEventListener("pointerdown", outside, true);
    return () => document.removeEventListener("pointerdown", outside, true);
  }, []);
  // Focus the first thing in each step: a dimension, or the search and the values.
  useEffect(() => {
    panel.current?.querySelector<HTMLElement>("input, .menu__item")?.focus();
  }, [current?.id]);
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key !== "Escape") return;
    e.preventDefault();
    onClose();
    panel.current?.parentElement?.querySelector<HTMLButtonElement>("button")?.focus();
  };

  if (!current) {
    return (
      <div className="menu menu--start filter-panel" role="dialog" aria-label={t("views.filter.by")} ref={panel} onKeyDown={onKey}>
        <p className="filter-panel__title">{t("views.filter.by")}</p>
        {dims.map((d) => (
          <button key={d.id} type="button" className="menu__item" onClick={() => setPicked(d)}>
            {d.label}
          </button>
        ))}
      </div>
    );
  }

  const chosen = active.find((f) => f.dimension === current.id)?.values ?? [];
  const values = dimensionValues(dataset, filterRecords(dataset, all, active.filter((f) => f.dimension !== current.id), ctx), current, ctx);
  // A value ticked before stays in the list, though the other filters now leave none of it.
  for (const v of chosen) if (!values.some((x) => x.value === v)) values.push({ value: v, count: 0 });
  const needle = q.trim().toLowerCase();
  const shown = needle ? values.filter((v) => name(current.id, v.value).toLowerCase().includes(needle)) : values;
  const set = new Set(chosen);
  const toggle = (v: string) => onChange(current.id, set.has(v) ? chosen.filter((x) => x !== v) : [...chosen, v]);
  return (
    <div className="menu menu--start filter-panel" role="dialog" aria-label={t("views.filter.byDimension", { dimension: current.label.toLowerCase() })} ref={panel} onKeyDown={onKey}>
      <p className="filter-panel__title">
        {!dim && !chosen.length && (
          <button type="button" className="icon-btn filter-panel__back" onClick={() => setPicked(null)} aria-label={t("views.filter.back")} title={t("views.filter.back")}>
            <Icon name="arrow-left" />
          </button>
        )}
        {current.label}
      </p>
      {values.length > 8 && (
        <label className="search filter-panel__search">
          <span className="visually-hidden">{t("views.filter.find")}</span>
          <Icon name="search" />
          <input className="input" type="search" placeholder={t("views.filter.findDimension", { dimension: current.label.toLowerCase() })} value={q} onChange={(e) => setQ(e.target.value)} autoComplete="off" />
        </label>
      )}
      <div className="filter-panel__values">
        {shown.map((v) => (
          <label key={v.value} className="filter-panel__value">
            <input type="checkbox" checked={set.has(v.value)} onChange={() => toggle(v.value)} />
            <span className="filter-panel__name">{name(current.id, v.value)}</span>
            <span className="filter-panel__count">{nf.format(v.count)}</span>
          </label>
        ))}
        {!shown.length && <p className="filter-panel__none">{t("views.filter.none")}</p>}
      </div>
      <div className="filter-panel__foot">
        {chosen.length > 0 && (
          <button type="button" className="link-btn" onClick={() => onChange(current.id, [])}>
            {t("views.filter.clear")}
          </button>
        )}
        <button type="button" className="btn btn--small" onClick={onClose}>
          {t("common.done")}
        </button>
      </div>
    </div>
  );
}

/** The flights or sightings behind a figure, under the table: newest first, a page at a time. */
function Records({ anchor, picked, dataset, records, title, onClose }: { anchor: React.Ref<HTMLElement>; picked: Picked; dataset: Dataset; records: (Flight | Sighting)[]; title: string; onClose: () => void }) {
  const { app } = useApp();
  const { ref, store } = app;
  const key = `${dataset}|${picked.row}|${picked.col}`;
  const views = useMemo(() => {
    if (dataset !== "flights") return [];
    const ids = new Set(records.map((r) => r.id));
    return sortedFlights(store, ref)
      .filter((v) => ids.has(v.f.id))
      .reverse();
  }, [key, records]);
  const sightings = useMemo(() => (dataset === "sightings" ? [...(records as Sighting[])].sort((a, b) => (b.seenOn ?? "").localeCompare(a.seenOn ?? "")) : []), [key, records]);
  const tracks = useMemo(() => trackInfo(store), [key]);
  const flightPages = usePaging(views, RECORD_PAGE, key, "custom.flightsPage");
  const sightingPages = usePaging(sightings, RECORD_PAGE, key, "custom.sightingsPage");
  return (
    <section className="custom__records" ref={anchor} aria-labelledby="custom-records-title">
      <div className="section__head custom__records-head">
        <h3 className="custom__records-title" id="custom-records-title">
          {title}
        </h3>
        <span className="section__aside">{dataset === "flights" ? t("common.count.flights", { count: records.length }) : t("common.count.sightings", { count: records.length })}</span>
        <button type="button" className="icon-btn" onClick={onClose} aria-label={t("views.records.close")} title={t("views.records.close")}>
          <Icon name="x" />
        </button>
      </div>
      {dataset === "flights" ? (
        <>
          <div ref={flightPages.top} className="list-top" />
          <ul className="rows">
            {flightPages.slice.map((v) => (
              <FlightRow key={v.f.id} v={v} track={tracks.get(v.f.id) ?? null} />
            ))}
          </ul>
          <Pager paging={flightPages} kind="flights" />
        </>
      ) : (
        <>
          <div ref={sightingPages.top} className="list-top" />
          <ul className="rows">
            {sightingPages.slice.map((s) => (
              <li key={s.id}>
                <Link className="row row--sighting" {...(s.airframeId ? { to: "/aircraft/$id", params: { id: s.airframeId } } : { to: "/spotting/$id/edit", params: { id: s.id } })}>
                  <span className="row__route-wrap">
                    <span className="row__route">{s.registration ?? s.registrationRaw ?? t("views.records.noRegistration")}</span>
                    <span className="row__cities">{airlineLabel(s.operatorId, ref) || s.operatorRaw || t("views.records.unknownOperator")}</span>
                  </span>
                  <TypeCell code={s.typeCode} />
                  <span className="row__cell row__phase">
                    <span>{s.seenOn ? dateOnly(s.seenOn, { day: "numeric", month: "short", year: "numeric" }) : t("views.records.noDate")}</span>
                    <span className="muted">{airportWithCode(s.airportId, ref) || s.airportRaw || ""}</span>
                  </span>
                  <span className="row__cell row__notes">{s.specialLivery && <span className="pill pill--livery">{s.specialLivery}</span>}</span>
                  <span className="row__track" />
                </Link>
              </li>
            ))}
          </ul>
          <Pager paging={sightingPages} kind="sightings" />
        </>
      )}
    </section>
  );
}
