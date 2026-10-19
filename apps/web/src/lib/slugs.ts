// Readable, stable addresses for records (docs/31-ui.md, "Addresses"). Stored ids change when a log is
// rebuilt from its sources, so pages are addressed by what the record is:
//   flight    /flights/2025-03-14T0830-BOS-SEA      local takeoff date and time, route (no one leaves one airport
//                                                   twice in a minute); without a takeoff time: day, route,
//                                                   flight number
//   sighting  /spotting/2025-03-14-BOS-N1001X/edit  day, place, registration (one sighting per aircraft, place and day)
//   aircraft  /aircraft/airbus-99001                maker and serial number, the airframe's identity (docs/11);
//             /aircraft/N1001X-2024-03-01           until the serial number is known: registration and day first seen
//   airport   /airports/BOS                         IATA code, else ICAO
// Flight numbers repeat (often the same number both ways) and registrations rotate, so neither is the key.
// A second record with the same address gets "-2", "-3" in time order. Links keep passing record ids; the router
// turns them into addresses and back (main.tsx), and old addresses still open their page.

import { flightDay, registrationMatchForm, type Flight, type RefIndex, type Sighting } from "@touchdown/core";
import type { AppData } from "../data/app.ts";
import { aircraftViews } from "./views.ts";

interface Index {
  toSlug: Map<string, string>; // record id → address
  toId: Map<string, string>; // ADDRESS (upper case) → record id
}

interface Indexes {
  version: number;
  flights: Index;
  sightings: Index;
  aircraft: Index;
  /** Match form of every registration an aircraft carried → its ids, for addresses from before a re-registration. */
  aircraftByReg: Map<string, string[]>;
}

let app: AppData | null = null;
let cache: Indexes | null = null;

/** Called once the data is open; the indexes follow every change. */
export function setSlugData(data: AppData) {
  app = data;
  cache = null;
}

const clean = (s: string) => s.replace(/[^A-Za-z0-9-]+/g, "").replace(/-+/g, "-").replace(/^-|-$/g, "");

function index(items: { id: string; base: string }[]): Index {
  const out: Index = { toSlug: new Map(), toId: new Map() };
  for (const { id, base } of items) {
    let slug = base;
    for (let n = 2; out.toId.has(slug.toUpperCase()); n++) slug = `${base}-${n}`;
    out.toSlug.set(id, slug);
    out.toId.set(slug.toUpperCase(), id);
  }
  return out;
}

const code = (ref: RefIndex, id: string | null, raw: string | null) => {
  const a = ref.airport(id);
  return clean(a?.iata ?? a?.icao ?? raw ?? "") || "XXX";
};

export function flightSlugBase(f: Flight, ref: RefIndex): string {
  const route = `${code(ref, f.fromAirportId, f.fromRaw)}-${code(ref, f.divertedToAirportId ?? f.toAirportId, f.toRaw)}`;
  // "2025-03-14T08:30-04:00": the date and time as written at the departure airport.
  const t = f.takeoffAt && /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})/.exec(f.takeoffAt);
  if (t) return `${t[1]}T${t[2]}${t[3]}-${route}`;
  const parts = [flightDay(f) ?? f.scheduledDate ?? "undated", route];
  if (f.flightNumber) parts.push(clean(f.flightNumber.toUpperCase()));
  return parts.join("-");
}

export function sightingSlugBase(s: Sighting, ref: RefIndex): string {
  return [s.seenOn ?? "undated", code(ref, s.airportId, s.airportRaw), clean((s.registration ?? s.registrationRaw ?? "").toUpperCase()) || "unregistered"].join("-");
}

const byTime = (a: { t: string; id: string }, b: { t: string; id: string }) => a.t.localeCompare(b.t) || a.id.localeCompare(b.id);

function build(data: AppData): Indexes {
  const { store, ref } = data;
  const flights = store
    .all("flights")
    .map((f) => ({ id: f.id, t: f.takeoffAt ?? f.scheduledDate ?? "", base: flightSlugBase(f, ref) }))
    .sort(byTime);
  const sightings = store
    .all("sightings")
    .map((s) => ({ id: s.id, t: s.seenOn ?? "", base: sightingSlugBase(s, ref) }))
    .sort(byTime);
  // Aircraft: the identity. Maker and serial number when known; until then the registration it was first
  // seen with and that day, which is what the provisional identity is made of (docs/11).
  const views = aircraftViews(store).filter((v) => v.flights.length || v.sightings.length);
  const aircraft = views.map((v) => {
    const a = v.airframe;
    let base: string;
    if (a.msn && a.manufacturer) base = `${clean(a.manufacturer.toLowerCase().replace(/\s+/g, "-"))}-${clean(a.msn)}`;
    else {
      const firstReg = [...v.flights.map((f) => ({ d: flightDay(f) ?? "", reg: f.registration })), ...v.sightings.map((x) => ({ d: x.seenOn ?? "", reg: x.registration }))]
        .filter((r) => r.reg)
        .sort((x, y) => x.d.localeCompare(y.d))[0]?.reg;
      base = [clean(firstReg ?? v.registration ?? "") || "unregistered", v.first].filter(Boolean).join("-");
    }
    return { id: a.id, t: v.first ?? "", base };
  });
  aircraft.sort(byTime);
  const aircraftByReg = new Map<string, string[]>();
  for (const p of store.all("registration_periods")) {
    if (!p.registration) continue;
    const key = registrationMatchForm(p.registration);
    aircraftByReg.set(key, [...new Set([...(aircraftByReg.get(key) ?? []), p.airframeId])]);
  }
  return { version: data.version, flights: index(flights), sightings: index(sightings), aircraft: index(aircraft), aircraftByReg };
}

function indexes(): Indexes | null {
  if (!app) return null;
  if (!cache || cache.version !== app.version) cache = build(app);
  return cache;
}

type Kind = "flights" | "sightings" | "aircraft";

/** Record id → address; the id itself when the record is unknown. */
export function toSlug(kind: Kind, id: string): string {
  return indexes()?.[kind].toSlug.get(id) ?? id;
}

/** Address (or an old id) → record id; the address itself when nothing matches, so the page shows "not found". */
export function fromSlug(kind: Kind, slug: string): string {
  const ix = indexes();
  if (!ix) return slug;
  const hit = ix[kind].toId.get(slug.toUpperCase());
  if (hit) return hit;
  if (ix[kind].toSlug.has(slug)) return slug;
  // An aircraft address made from a registration (bare, or with the day first seen, from before its serial
  // number was known) opens that aircraft when only one aircraft in the log carried the registration.
  if (kind === "aircraft") {
    const reg = slug.replace(/-\d{4}-\d{2}-\d{2}$/, "");
    const ids = ix.aircraftByReg.get(registrationMatchForm(reg));
    if (ids?.length === 1) return ids[0]!;
  }
  return slug;
}

export function airportSlug(id: string): string {
  const a = app?.ref.airport(id);
  if (!a) return id;
  // The IATA code when it leads back to this airport (a code can sit on a closed field too), else ICAO.
  if (a.iata && app!.ref.airportByCode(a.iata)?.id === a.id) return a.iata;
  return a.icao ?? id;
}

export function airportFromSlug(slug: string): string {
  return app?.ref.airportByCode(slug)?.id ?? slug;
}

/** Route parameter translation for TanStack Router: links pass ids, addresses show readable names. */
export function slugParams(kind: Kind) {
  return {
    parse: (p: { id: string }) => ({ id: fromSlug(kind, p.id) }),
    stringify: (p: { id: string }) => ({ id: toSlug(kind, p.id) }),
  };
}

export const airportParams = {
  parse: (p: { id: string }) => ({ id: airportFromSlug(p.id) }),
  stringify: (p: { id: string }) => ({ id: airportSlug(p.id) }),
};
