// Airport codes as the user chose to see them (Settings, "Codes"), used by every page. The functions are in the
// core package (@touchdown/core/view), shared with the CLI; the choice is kept here, set when the data opens and
// whenever it changes, so it applies everywhere.

import type { Airport, RefIndex, Settings } from "@touchdown/core";
import { airportWithCode as withCode, primaryCode as primary, routeCodes as route, secondaryCode as secondary, textCode as text, type CodeStyle } from "@touchdown/core/view";

let style: CodeStyle = "iata";

export function setCodeStyle(s: Settings["codeDisplay"] | null | undefined) {
  style = s ?? "iata";
}

/** The current choice: "iata", "icao" or "both". */
export function codeStyle(): CodeStyle {
  return style;
}

/** One code: for large type and map labels. */
export const primaryCode = (a: Airport | null | undefined, raw?: string | null): string => primary(a, raw, style);

/** The other code, shown beside the primary one where there is room (the airport and flight headers). */
export const secondaryCode = (a: Airport | null | undefined): string | null => secondary(a, style);

/** The code as text: "LHR", "EGLL" or "LHR/EGLL". */
export const textCode = (a: Airport | null | undefined, raw?: string | null): string => text(a, raw, style);

/** "London Heathrow (LHR)"; the raw text when the airport is unknown. */
export const airportWithCode = (id: string | null | undefined, ref: RefIndex, raw?: string | null): string => withCode(id, ref, raw, style);

/** A route key from the statistics ("AMS-LHR") in the user's codes. */
export const routeCodes = (key: string, ref: RefIndex, sep = " ⇄ "): string => route(key, ref, sep, style);
