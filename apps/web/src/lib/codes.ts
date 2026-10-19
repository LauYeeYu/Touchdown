// Airport codes as the user chose to see them (Settings, "Codes": IATA, ICAO or both), used by every page.
// Text shows the chosen codes, both when the user chose both ("LHR/EGLL"). Large type and map labels have room
// for one code: ICAO when the user chose ICAO, else IATA (BigCode adds the other one small with "both").
// Names carry their code in parentheses: "London Heathrow (LHR)".

import type { Airport, RefIndex, Settings } from "@touchdown/core";
import { shortAirport } from "./format.ts";

type Style = NonNullable<Settings["codeDisplay"]>;

let style: Style = "iata";

/** Called when the data opens and whenever it changes, so the setting applies everywhere. */
export function setCodeStyle(s: Settings["codeDisplay"] | null | undefined) {
  style = s ?? "iata";
}

/** The current choice: "iata", "icao" or "both". */
export function codeStyle(): Style {
  return style;
}

/** One code: for large type and map labels. */
export function primaryCode(a: Airport | null | undefined, raw?: string | null): string {
  if (!a) return raw ?? "";
  return (style === "icao" ? (a.icao ?? a.iata) : (a.iata ?? a.icao)) ?? raw ?? "";
}

/** The other code, shown beside the primary one where there is room (the airport and flight headers). */
export function secondaryCode(a: Airport | null | undefined): string | null {
  if (!a) return null;
  const p = primaryCode(a);
  const other = p === a.iata ? a.icao : a.iata;
  return other && other !== p ? other : null;
}

/** The code as text: "LHR", "EGLL" or "LHR/EGLL". */
export function textCode(a: Airport | null | undefined, raw?: string | null): string {
  if (!a) return raw ?? "";
  if (style === "both") return [a.iata, a.icao].filter(Boolean).join("/") || (raw ?? "");
  return primaryCode(a, raw);
}

/** "London Heathrow (LHR)"; the raw text when the airport is unknown. */
export function airportWithCode(id: string | null | undefined, ref: RefIndex, raw?: string | null): string {
  const a = ref.airport(id);
  if (!a) return raw ?? "";
  const code = textCode(a);
  // A non-breaking space keeps the code with its name when a line wraps.
  return code ? `${shortAirport(a.id, ref)}\u00a0(${code})` : shortAirport(a.id, ref);
}

/** A route key from the statistics ("AMS-LHR", codes in alphabetical order) in the user's codes. */
export function routeCodes(key: string, ref: RefIndex, sep = " ⇄ "): string {
  return key
    .split("-")
    .map((c) => textCode(ref.airportByCode(c), c))
    .join(sep);
}
