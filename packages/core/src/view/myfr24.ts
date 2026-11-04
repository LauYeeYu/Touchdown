// The log's flights as a file for my.flightradar24.com's import (docs/21-import-export.md, "Exports"): the 19 columns
// of its own export, laid out as that export is (a blank first line, LF line ends, a value with a space in quotes), so
// its import reads it as it reads its own. The web app (Settings) and the CLI (`export myfr24`) write the same file.

import { arrivalAirportId, flightDay } from "../derive.ts";
import type { RefIndex } from "../ref/index.ts";
import type { Airport } from "../ref/types.ts";
import type { Flight } from "../schema/tables.ts";
import type { Store } from "../store.ts";
import { instant, parseDateTime } from "../time/index.ts";

export const MYFR24_HEADER = ["Date", "Flight number", "From", "To", "Dep time", "Arr time", "Duration", "Airline", "Aircraft", "Registration", "Seat number", "Seat type", "Flight class", "Flight reason", "Note", "Dep_id", "Arr_id", "Airline_id", "Aircraft_id"] as const;

/** myFR24's own ids, kept from its export (`external_ids`, system `fr24`, beside the time a flight was first exported). */
const FR24_IDS = ["Dep_id", "Arr_id", "Airline_id", "Aircraft_id"] as const;

const SEAT: Record<string, string> = { window: "1", middle: "2", aisle: "3" };
const CLASS: Record<string, string> = { economy: "1", business: "2", first: "3", premium_economy: "4", private: "5" };
const REASON: Record<string, string> = { leisure: "1", business: "2", crew: "3", other: "4" };

/** A value as myFR24's export writes it: in quotes when it holds a space, a comma, a quote or a line end. */
function cell(v: string): string {
  return /[\s",]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

/** "London / Heathrow (LHR/EGLL)", as myFR24 names an airport: the city, the name without it, both codes. */
function airportText(a: Airport | null, raw: string | null): string {
  if (!a) return `${raw ?? ""} (/)`;
  const name = a.city && a.name.startsWith(`${a.city} `) ? a.name.slice(a.city.length + 1) : a.name;
  const label = a.city && a.city !== a.name ? `${a.city} / ${name}` : a.name;
  return `${label} (${a.iata ?? ""}/${a.icao ?? ""})`;
}

/** "12:10:00": the clock time at the airport, as the date-time stores it. */
function clock(t: string | null): string {
  const p = t ? parseDateTime(t) : null;
  return p ? `${p.time.slice(0, 5)}:00` : "";
}

function duration(f: Flight): string {
  const a = instant(f.takeoffAt);
  const b = instant(f.landingAt);
  if (a === null || b === null || b <= a) return "";
  const min = Math.round((b - a) / 60_000);
  return `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}:00`;
}

/** The fr24 ids and export time each flight has. */
function fr24Index(store: Store): Map<string, Map<string, string>> {
  const out = new Map<string, Map<string, string>>();
  for (const e of store.all("external_ids")) {
    if (e.ownerTable !== "flights" || e.system !== "fr24" || !e.key || !e.value) continue;
    const m = out.get(e.ownerId) ?? new Map<string, string>();
    m.set(e.key, e.value);
    out.set(e.ownerId, m);
  }
  return out;
}

/**
 * Whether a flight is in myFR24 already, as far as the log knows: it came from myFR24's export, or was written to a
 * myFR24 file before.
 */
export function inMyFr24(f: Flight, ids: Map<string, string> | undefined): boolean {
  return f.sourceKind === "fr24_csv" || !!ids?.size;
}

/** The flights a myFR24 file holds, oldest first: every flight, or only those not in myFR24 already. */
export function myFr24Flights(store: Store, onlyNew = false): Flight[] {
  const fr24 = fr24Index(store);
  return store
    .all("flights")
    .filter((f) => !onlyNew || !inMyFr24(f, fr24.get(f.id)))
    .sort((a, b) => (a.scheduledDate ?? flightDay(a) ?? "").localeCompare(b.scheduledDate ?? flightDay(b) ?? "") || (a.takeoffAt ?? "").localeCompare(b.takeoffAt ?? ""));
}

/** The file for myFR24's import. */
export function myFr24Csv(store: Store, ref: RefIndex, flights: Flight[]): string {
  const fr24 = fr24Index(store);
  const rows = flights.map((f) => {
    const ids = fr24.get(f.id);
    const op = ref.operator(f.airlineId);
    const type = ref.type(f.typeCode);
    // A note a spreadsheet would run as a formula gets a leading apostrophe, as in every CSV Touchdown writes.
    const note = f.notes && /^[=+\-@\t\r]/.test(f.notes) ? `'${f.notes}` : (f.notes ?? "");
    return [
      f.scheduledDate ?? flightDay(f) ?? "",
      f.flightNumber ?? "",
      airportText(ref.airport(f.fromAirportId), f.fromRaw),
      airportText(ref.airport(arrivalAirportId(f)), f.toRaw),
      clock(f.takeoffAt),
      clock(f.landingAt),
      duration(f),
      op ? `${op.name} (${op.iata ?? ""}/${op.icao ?? ""})` : " (/)",
      type ? `${type.manufacturer} ${type.name} (${type.designator})` : f.typeCode ? ` (${f.typeCode})` : " ()",
      f.registration ?? "",
      f.seat ?? "",
      SEAT[f.seatPosition ?? ""] ?? "0",
      CLASS[f.cabinClass ?? ""] ?? "0",
      REASON[f.reason ?? ""] ?? "0",
      note,
      ...FR24_IDS.map((k) => ids?.get(k) ?? "0"),
    ]
      .map(cell)
      .join(",");
  });
  return `\n${[MYFR24_HEADER.map(cell).join(","), ...rows].join("\n")}\n`;
}
