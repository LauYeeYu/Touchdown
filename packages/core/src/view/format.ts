// Display formatting. Stored date-times carry their local wall-clock time and offset, so times are shown
// from the stored text, never converted through the viewer's time zone.

import { getDateStyle, locale, numberFormat, t, tDynamic, type DateStyle } from "@touchdown/i18n";
import { cityName, type RefIndex } from "../ref/index.ts";
import { parseDateTime } from "../time/index.ts";
import { formatModel } from "../normalise/model.ts";
import type { Settings } from "../schema/tables.ts";

/** Numbers in the interface's language: "12,345". */
export const nf = { format: (n: number | bigint): string => numberFormat(locale()).format(n) };

const decimals = new Map<string, Intl.NumberFormat>();
/** "24.3", "1.0" ("24,3" in German): one decimal, in the interface's language. */
export function oneDecimal(n: number): string {
  let f = decimals.get(locale());
  if (!f) decimals.set(locale(), (f = new Intl.NumberFormat(locale(), { minimumFractionDigits: 1, maximumFractionDigits: 1, useGrouping: false })));
  return f.format(n);
}

/** The months' names in the interface's language, January first: "J" (narrow), "Jan" (short) or "January" (long). */
export function monthNames(width: "narrow" | "short" | "long" = "long"): string[] {
  return Array.from({ length: 12 }, (_, i) => dateOnly(`2000-${String(i + 1).padStart(2, "0")}-01`, { month: width }));
}

const dateFormats = new Map<string, Intl.DateTimeFormat>();

function intlDate(tag: string, ymd: string, opts: Intl.DateTimeFormatOptions): string {
  const key = tag + JSON.stringify(opts);
  let f = dateFormats.get(key);
  if (!f) dateFormats.set(key, (f = new Intl.DateTimeFormat(tag, { timeZone: "UTC", ...opts })));
  return f.format(new Date(ymd + "T12:00:00Z"));
}

/**
 * Format a calendar date (YYYY-MM-DD) in the date format chosen (docs/31-ui.md, "Language"): the language's own way,
 * another regional way of it ("Mar 15, 2025"), or ISO 8601 ("2025-03-15", "03-15" without the year) for a date with
 * its day. Weekday and month names are always in the language, and a month without a day is always a name. Settings
 * passes `dateStyle` to show each choice.
 */
export function dateOnly(ymd: string, opts: Intl.DateTimeFormatOptions = { day: "numeric", month: "short" }, dateStyle: DateStyle = getDateStyle()): string {
  const style = dateStyle === "language" ? locale() : dateStyle;
  if (style !== "iso") return intlDate(style, ymd, opts);
  if (!opts.day) return intlDate(locale(), ymd, opts);
  const date = opts.year ? ymd.slice(0, 10) : ymd.slice(5, 10);
  return opts.weekday ? t("format.isoWithWeekday", { weekday: intlDate(locale(), ymd, { weekday: opts.weekday }), date }) : date;
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

/** "08:00 Wed 2 Apr · UTC−4": a precise time with its local date and offset (DESIGN.md, "The Dated Time Rule"). */
export function dateTimeLabel(dt: string | null | undefined): string {
  if (!dt) return "";
  const d = localDay(dt);
  return d ? t("format.dateTime", { time: clock(dt), day: dayShort(d), offset: offsetLabel(dt) }) : t("format.timeOffset", { time: clock(dt), offset: offsetLabel(dt) });
}

const pad2 = (n: number) => String(n).padStart(2, "0");

/** The day of a moment on this device's clock, in the date format chosen: "23 Oct 2026". */
export function momentDay(ms: number): string {
  const d = new Date(ms);
  return dayMonthYear(`${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`);
}

const momentTime = (d: Date) => `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;

/** A moment on this device's clock, its day and 24-hour time: "23 Oct 2026, 14:05". */
export function momentShort(ms: number): string {
  return t("format.momentShort", { day: momentDay(ms), time: momentTime(new Date(ms)) });
}

/** A moment on this device's clock, with its date and UTC offset: "23 Oct 2026, 14:05 UTC+1". Times are 24-hour. */
export function momentLabel(ms: number): string {
  const d = new Date(ms);
  const off = -d.getTimezoneOffset();
  const h = Math.floor(Math.abs(off) / 60);
  const m = Math.abs(off) % 60;
  return t("format.moment", { day: momentDay(ms), time: momentTime(d), offset: `UTC${off < 0 ? "−" : "+"}${h}${m ? ":" + pad2(m) : ""}` });
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
  if (!h) return t("format.duration.minutes", { m });
  return m ? t("format.duration.hoursMinutes", { h: nf.format(h), m }) : t("format.duration.hours", { h: nf.format(h) });
}

/** "2h 07m" as plain text (for tooltips and labels); pages use the Duration component. */
export function durShort(min: number): string {
  const total = Math.round(min);
  const h = Math.floor(total / 60);
  return h ? t("format.duration.short.hours", { h: nf.format(h), m: String(total % 60).padStart(2, "0") }) : t("format.duration.short.minutes", { m: total % 60 });
}

const UNIT = { km: 1, mi: 0.621371, nm: 0.539957 } as const;

export function distance(km: number, unit: Settings["distanceUnit"] = "km"): string {
  const u: keyof typeof UNIT = unit ?? "km";
  return t(`format.distance.${u}`, { n: nf.format(Math.round(km * UNIT[u])) });
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

// Words too common in place names to show that an airport's name already gives its city.
const COMMON_PLACE_WORDS = new Set(["and", "the", "upon", "des", "les", "sur", "sous", "der", "die", "den", "del", "ste", "saint", "sainte", "san", "santa", "sao", "port", "fort", "new", "city", "island", "islands", "isla", "ile", "lake", "bay", "mount", "north", "south", "east", "west", "regional", "international", "airport"]);

/** The words that set a place name apart, in lower case without accents: "Frankfurt am Main" gives frankfurt and main. */
function placeWords(s: string): Set<string> {
  const words = s.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().split(/[^a-z0-9]+/);
  return new Set(words.filter((w) => w.length >= 3 && !COMMON_PLACE_WORDS.has(w)));
}

/**
 * Short airport name for sentences: "Boston Logan" rather than "Boston Logan International Airport". The city goes
 * first unless the name already gives it, in any spelling: "Frankfurt Main", not "Frankfurt am Main Frankfurt Main".
 */
export function shortAirport(id: string | null | undefined, ref: RefIndex): string {
  const a = ref.airport(id);
  if (!a) return "";
  const name = a.name.replace(/\s+(International\s+)?Airport$/i, "").replace(/\s+International$/i, "");
  const city = cityName(a) ?? "";
  if (!city || name.includes(city)) return name;
  const named = placeWords(name);
  return [...placeWords(city)].some((w) => named.has(w)) ? name : `${city} ${name}`;
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

/**
 * Labels for stored values, read from the messages (`labels.json`) each time one is asked for, so they are in the
 * interface's language: `CABIN_LABEL.business` is "Business".
 */
function labelTable(prefix: string, keys: readonly string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of keys) Object.defineProperty(out, k, { enumerable: true, get: () => tDynamic(`labels.${prefix}.${k}`) });
  return out;
}

export const CABIN_LABEL = labelTable("cabin", ["economy", "premium_economy", "business", "first", "private"]);

export const PHASE_LABEL = labelTable("phase", ["approaching", "landing", "taking_off", "taxiing", "parked", "towing", "overflight", "other"]);

export const REASON_LABEL = labelTable("reason", ["leisure", "business", "crew", "other"]);

export const TAG_LABEL = labelTable("tag", ["partial_body", "too_far", "night", "backlit", "blurry"]);

/** Stored fields of flights and sightings, by the name the import review gives them. */
export const FIELD_LABEL = labelTable("field", ["scheduledDate", "flightNumber", "airlineId", "airlineRaw", "operatingAirlineId", "fromAirportId", "fromRaw", "toAirportId", "toRaw", "divertedToAirportId", "boardingAt", "departureScheduledAt", "departureAt", "takeoffAt", "landingAt", "arrivalScheduledAt", "arrivalAt", "departureTerminal", "departureGate", "arrivalTerminal", "arrivalGate", "seat", "seatPosition", "cabinClass", "bookingClass", "fareBrand", "reason", "ticketNumber", "bookingRef", "registration", "registrationRaw", "typeCode", "typeCodeRaw", "model", "modelRaw", "livery", "specialLivery", "notes", "seenOn", "seenAt", "airportId", "airportRaw", "spotName", "operatorId", "operatorRaw", "phase", "photoCount"]);

/** Where a recorded track came from, after "from": "the path the aircraft flew, from adsb.lol". */
export const TRACK_SOURCE = labelTable("trackSource", ["fr24_csv", "fr24_kml", "adsblol", "aeroapi", "gpx", "other"]);

export function countryName(code: string | null | undefined): string {
  if (!code) return "";
  try {
    return new Intl.DisplayNames([locale()], { type: "region" }).of(code) ?? code;
  } catch {
    return code;
  }
}
