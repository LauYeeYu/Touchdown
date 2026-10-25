// Display formatting. Stored date-times carry their local wall-clock time and offset, so times are shown
// from the stored text, never converted through the viewer's time zone.

import { cityName, type RefIndex } from "../ref/index.ts";
import { parseDateTime } from "../time/index.ts";
import { formatModel } from "../normalise/model.ts";
import type { Settings } from "../schema/tables.ts";

export const nf = new Intl.NumberFormat("en-GB");
export const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const MONTHS_LONG = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const NBSP = " ";

export function plural(n: number, one: string, many = one + "s"): string {
  return `${nf.format(n)}${NBSP}${n === 1 ? one : many}`;
}

const dateFormats = new Map<string, Intl.DateTimeFormat>();
/** Format a calendar date (YYYY-MM-DD). */
export function dateOnly(ymd: string, opts: Intl.DateTimeFormatOptions = { day: "numeric", month: "short" }): string {
  const key = JSON.stringify(opts);
  let f = dateFormats.get(key);
  if (!f) dateFormats.set(key, (f = new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", ...opts })));
  return f.format(new Date(ymd + "T12:00:00Z"));
}

export const dayShort = (ymd: string) => dateOnly(ymd, { weekday: "short", day: "numeric", month: "short" });
export const dayLong = (ymd: string) => dateOnly(ymd, { weekday: "long", day: "numeric", month: "long", year: "numeric" });
export const dayMonthYear = (ymd: string) => dateOnly(ymd, { day: "numeric", month: "short", year: "numeric" });

/** Local clock time of a stored date-time: "00:12". */
export function clock(dt: string | null | undefined): string {
  const p = dt ? parseDateTime(dt) : null;
  return p ? p.time.slice(0, 5) : "";
}

export function localDay(dt: string | null | undefined): string | null {
  return dt ? (parseDateTime(dt)?.date ?? null) : null;
}

/** A moment on this device's clock, with its date and UTC offset: "23 Oct 2026, 14:05 UTC+1". */
/** "08:00 Wed 2 Apr · UTC−4": a precise time with its local date and offset (DESIGN.md, "The Dated Time Rule"). */
export function dateTimeLabel(dt: string | null | undefined): string {
  if (!dt) return "";
  const d = localDay(dt);
  return [clock(dt), d && dayShort(d), "·", offsetLabel(dt)].filter(Boolean).join(" ");
}

export function momentLabel(ms: number): string {
  const d = new Date(ms);
  const off = -d.getTimezoneOffset();
  const h = Math.floor(Math.abs(off) / 60);
  const m = Math.abs(off) % 60;
  const day = d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
  const time = d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  return `${day}, ${time} UTC${off < 0 ? "−" : "+"}${h}${m ? ":" + String(m).padStart(2, "0") : ""}`;
}

/** "UTC+8", "UTC−5", "UTC+5:30". */
export function offsetLabel(dt: string): string {
  const m = /([+-])(\d{2}):(\d{2})$/.exec(dt);
  if (!m) return "UTC";
  return `UTC${m[1] === "-" ? "−" : "+"}${Number(m[2])}${m[3] !== "00" ? ":" + m[3] : ""}`;
}

export function durLong(min: number): string {
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return h ? `${nf.format(h)}${NBSP}h${m ? ` ${m}${NBSP}min` : ""}` : `${m}${NBSP}min`;
}

/** "2h 07m" as plain text (for tooltips and labels); pages use the Duration component. */
export function durShort(min: number): string {
  const total = Math.round(min);
  const h = Math.floor(total / 60);
  return h ? `${nf.format(h)}h${NBSP}${String(total % 60).padStart(2, "0")}m` : `${total % 60}m`;
}

const UNIT = { km: 1, mi: 0.621371, nm: 0.539957 } as const;

export function distance(km: number, unit: Settings["distanceUnit"] = "km"): string {
  const u: keyof typeof UNIT = unit ?? "km";
  return `${nf.format(Math.round(km * UNIT[u]))}${NBSP}${u}`;
}

export function airportLabel(id: string | null | undefined, ref: RefIndex, style: Settings["codeDisplay"] = "iata"): string {
  const a = ref.airport(id);
  if (!a) return "";
  if (style === "icao") return a.icao ?? a.iata ?? "";
  if (style === "both") return [a.iata, a.icao].filter(Boolean).join("/");
  return a.iata ?? a.icao ?? "";
}

export function airlineLabel(id: string | null | undefined, ref: RefIndex): string {
  return ref.operator(id)?.name ?? "";
}

export function airlineCode(id: string | null | undefined, ref: RefIndex, style: Settings["codeDisplay"] = "iata"): string {
  const o = ref.operator(id);
  if (!o) return "";
  if (style === "icao") return o.icao ?? o.iata ?? "";
  if (style === "both") return [o.iata, o.icao].filter(Boolean).join("/");
  return o.iata ?? o.icao ?? "";
}

/** Short airport name for sentences: "Boston Logan" rather than "Boston Logan International Airport". */
export function shortAirport(id: string | null | undefined, ref: RefIndex): string {
  const a = ref.airport(id);
  if (!a) return "";
  const name = a.name.replace(/\s+(International\s+)?Airport$/i, "").replace(/\s+International$/i, "");
  const city = cityName(a) ?? "";
  return city && !name.includes(city) ? `${city} ${name}` : name;
}

export function cityOf(id: string | null | undefined, ref: RefIndex): string {
  const a = ref.airport(id);
  return cityName(a) ?? a?.name ?? "";
}

/** Maker and name, "Boeing 737-800", the same for every maker (a name that already starts with its maker is not doubled). */
export function typeName(typeCode: string | null | undefined, ref: RefIndex): string {
  const t = ref.type(typeCode);
  if (!t) return typeCode ?? "";
  if (!t.manufacturer || t.name.toLowerCase().startsWith(t.manufacturer.toLowerCase())) return t.name;
  return `${t.manufacturer} ${t.name}`;
}

export function modelLabel(model: string | null | undefined, typeCode: string | null | undefined, ref: RefIndex, style: Settings["modelNaming"] = "standard"): string {
  if (!model) return typeName(typeCode, ref);
  return formatModel(model, ref.manufacturerOf(typeCode), (style ?? "standard") as "standard" | "compact");
}

export const CABIN_LABEL: Record<string, string> = {
  economy: "Economy",
  premium_economy: "Premium economy",
  business: "Business",
  first: "First",
  private: "Private",
};

export const PHASE_LABEL: Record<string, string> = {
  approaching: "Approaching",
  landing: "Landing",
  taking_off: "Taking off",
  taxiing: "Taxiing",
  parked: "Parked",
  towing: "Towing",
  overflight: "Overflight",
  other: "Other",
};

export const REASON_LABEL: Record<string, string> = { leisure: "Leisure", business: "Business", crew: "Crew", other: "Other" };

export const TAG_LABEL: Record<string, string> = {
  partial_body: "Partial body",
  too_far: "Too far",
  night: "Night",
  backlit: "Backlit",
  blurry: "Blurry",
};

/** Where a recorded track came from, after "from": "the path the aircraft flew, from adsb.lol". */
export const TRACK_SOURCE: Record<string, string> = { fr24_csv: "a Flightradar24 track file", fr24_kml: "a Flightradar24 track file", adsblol: "adsb.lol", aeroapi: "FlightAware", gpx: "a GPX file" };

export function countryName(code: string | null | undefined): string {
  if (!code) return "";
  try {
    return new Intl.DisplayNames(["en-GB"], { type: "region" }).of(code) ?? code;
  } catch {
    return code;
  }
}
