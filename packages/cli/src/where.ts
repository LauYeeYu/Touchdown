// `--where DIM=VALUE[,VALUE]` on `stats --by` and `stats views save` (docs/34): a filter of the custom view, as the
// Statistics page's Filter makes one. A value can be given as stored, as the page shows it, or by its code.

import { DIMENSIONS, dimensionValues, type Dataset, type PivotFilter, type StatsContext } from "@touchdown/core";
import { MONTHS, MONTHS_LONG, pivotValueLabel } from "@touchdown/core/view";
import { plain, type OpenedLog } from "./read.ts";

/** The value among `known` that `raw` names: the stored value, the name shown, or a code (BA, LHR, JFK-BOS, March, 9). */
function matchValue(log: OpenedLog, dimId: string, raw: string, known: string[]): string | null {
  const t = raw.trim().toLowerCase();
  const found = (k: string | null | undefined) => (k && known.includes(k) ? k : null);
  const exact = known.find((k) => k.toLowerCase() === t) ?? known.find((k) => plain(pivotValueLabel(dimId, k, log.ref, log.codes)).toLowerCase() === t);
  if (exact) return exact;
  switch (dimId) {
    case "airline":
      return found(log.ref.operatorByCode(raw.trim())?.id);
    case "airport":
    case "from":
    case "to":
      return found(log.ref.airportByCode(raw.trim())?.id);
    case "route": {
      const ends = raw.split(/[-⇄>→\s]+/).filter(Boolean);
      if (ends.length !== 2) return null;
      const codes = ends.map((e) => {
        const a = log.ref.airportByCode(e);
        return a ? (a.iata ?? a.icao) : e.toUpperCase();
      });
      return found([...codes].sort().join("-"));
    }
    case "month": {
      const i = MONTHS_LONG.findIndex((m) => m.toLowerCase() === t);
      const j = MONTHS.findIndex((m) => m.toLowerCase() === t);
      const n = i >= 0 ? i + 1 : j >= 0 ? j + 1 : Number(t);
      return Number.isInteger(n) && n >= 1 && n <= 12 ? found(String(n).padStart(2, "0")) : null;
    }
    case "hour": {
      const n = Number(t.replace(/:00$/, ""));
      return Number.isInteger(n) && n >= 0 && n <= 23 ? found(String(n).padStart(2, "0")) : null;
    }
    default:
      return null;
  }
}

/** The filters `--where` gives, checked against the log's records of the dataset, or what is wrong with one. */
export function whereFilters(log: OpenedLog, ctx: StatsContext, dataset: Dataset, items: string[]): PivotFilter[] | { error: string } {
  const out: PivotFilter[] = [];
  const records = dataset === "flights" ? log.store.all("flights") : log.store.all("sightings");
  for (const item of items) {
    const eq = item.indexOf("=");
    if (eq < 1) return { error: `--where takes DIM=VALUE, or several values of one dimension: DIM=A,B (not "${item}").` };
    const id = item.slice(0, eq).trim();
    const dim = DIMENSIONS.find((d) => d.id === id);
    if (!dim) return { error: `There is no dimension "${id}". Choose from: ${DIMENSIONS.map((d) => d.id).join(", ")}.` };
    if (!dim.datasets.includes(dataset)) return { error: `${id} is for ${dim.datasets.join(" and ")}, not ${dataset}.` };
    if (out.some((f) => f.dimension === id)) return { error: `${id} is given twice: give its values together, ${id}=A,B.` };
    const known = dimensionValues(dataset, records, dim, ctx).map((v) => v.value);
    const values: string[] = [];
    for (const raw of item.slice(eq + 1).split(",").map((s) => s.trim()).filter(Boolean)) {
      const key = matchValue(log, id, raw, known);
      if (!key) {
        const some = known.slice(0, 6).map((k) => plain(pivotValueLabel(id, k, log.ref, log.codes)));
        return { error: `No ${dim.label.toLowerCase()} "${raw}" among the log's ${dataset}.${some.length ? ` Some there are: ${some.join(", ")}.` : ""}` };
      }
      if (!values.includes(key)) values.push(key);
    }
    if (!values.length) return { error: `--where ${id}= needs a value.` };
    out.push({ dimension: id, values });
  }
  return out;
}
