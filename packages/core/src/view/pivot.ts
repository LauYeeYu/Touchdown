// The values of a custom view's dimensions (docs/24, "Custom view") as the Statistics page names them: the web app, the
// CLI and the review of a saved view use the same names.

import { has, labelled, series, tDynamic } from "@touchdown/i18n";
import { DIMENSIONS, type PivotFilter } from "../stats/index.ts";
import type { RefIndex } from "../ref/index.ts";
import { airportWithCode, routeCodes, type CodeStyle } from "./codes.ts";
import { airlineLabel, CABIN_LABEL, countryName, monthNames, PHASE_LABEL, typeName } from "./format.ts";

/** "British Airways", "London Heathrow (LHR)", "Airbus A320neo (A20N)", "March", "09:00". */
export function pivotValueLabel(dimId: string, key: string, ref: RefIndex, codes: CodeStyle = "iata"): string {
  switch (dimId) {
    case "airline":
      return airlineLabel(key, ref) || key;
    case "airport":
    case "from":
    case "to":
      return airportWithCode(key, ref, null, codes) || key;
    case "route":
      return routeCodes(key, ref, " ⇄ ", codes);
    case "type":
      return `${typeName(key, ref)} (${key})`;
    case "family":
      return ref.family(key)?.name ?? key;
    case "regCountry":
      return countryName(key);
    case "phase":
      return PHASE_LABEL[key] ?? key;
    case "cabin":
      return CABIN_LABEL[key] ?? key;
    case "seatPosition":
      return seatPositionLabel(key);
    case "month":
      return monthNames()[Number(key) - 1] ?? key;
    case "hour":
      return `${key}:00`;
    default:
      return key;
  }
}

/** "Window", "Aisle": a seat position as a word; a value with no message as it is stored, with a capital. */
export function seatPositionLabel(key: string): string {
  return has(`view.seatPosition.${key}`) ? tDynamic(`view.seatPosition.${key}`) : key ? key[0]!.toUpperCase() + key.slice(1) : key;
}

/** A dimension's name, "Airline". */
export const dimensionLabel = (id: string) => DIMENSIONS.find((d) => d.id === id)?.label ?? id;

/** "Airline: British Airways, Lufthansa · Family: A320": a view's filters in a line. */
export function filtersText(filters: PivotFilter[], ref: RefIndex, codes: CodeStyle = "iata"): string {
  return filters.map((f) => labelled(dimensionLabel(f.dimension), series(f.values.map((v) => pivotValueLabel(f.dimension, v, ref, codes))))).join(" · ");
}
