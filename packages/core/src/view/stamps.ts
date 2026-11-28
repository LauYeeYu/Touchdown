// Stamps (G13, docs/24-statistics.md, "Stamps"): things done in the log, worked out from it each time and never
// stored. Each stamp is earned by a record: the first, in date order, that meets its rule, or for a rule over several
// records the one that completes it. Its date is that record's day. The words are in the message files
// (`stamps.<id>.name`, `stamps.<id>.rule`); here are the rules. The stamps the site's owner gives come from the
// account instead (`granted`), and which hidden ones have been shown from the log's stamps_seen table.

import type { FlownDistance } from "../flown.ts";
import type { RefIndex } from "../ref/index.ts";
import type { Airport } from "../ref/types.ts";
import type { Airframe, Flight, Sighting } from "../schema/tables.ts";
import type { Store } from "../store.ts";
import { arrivalAirportId, flightDay, flightDistanceKm, greatCircleKm } from "../derive.ts";
import { parseFlightNumber } from "../normalise/flight.ts";
import { daysBetween, instant, localDateOf, parseDateTime } from "../time/index.ts";
import { continentOf, SIX_CONTINENTS } from "../stamps/continents.ts";
import { SEATTLE_BOEINGS, TRIPLE_SEVEN_X } from "../stamps/boeing.ts";
import { FACTORIES, PARTS_FREIGHTERS, type Factory, type FactorySite } from "../stamps/factories.ts";
import { GRANTED_STAMP_IDS, type GrantedStamp, type GrantedStampId } from "../stamps/granted.ts";
import { countedFlights } from "./views.ts";
import { t, tDynamic } from "@touchdown/i18n";
import type { Settings } from "../schema/tables.ts";
import { airportCode } from "../derive.ts";
import { distance, makerName, nf } from "./format.ts";

export { FACTORIES, type Factory, type FactorySite } from "../stamps/factories.ts";
export { continentOf, SIX_CONTINENTS, type Continent } from "../stamps/continents.ts";
export { GRANTED_STAMP_IDS, isGrantedStampId, type GrantedStamp, type GrantedStampId } from "../stamps/granted.ts";

/** The groups in the order they are listed. `granted`: the stamps the site's owner gave, listed only when given. */
export type StampGroup = "factories" | "aircraft" | "globe" | "places" | "flights" | "spotting" | "granted";
export const STAMP_GROUPS: readonly StampGroup[] = ["factories", "aircraft", "globe", "places", "flights", "spotting", "granted"];

/**
 * Flown gold, spotted blue, or half and half for a stamp earned by a flight and a sighting together. A stamp the owner
 * gave is in the page's own ink, as it says nothing of flights or sightings.
 */
export type StampInk = "flown" | "spotted" | "both" | "granted";

/** The small drawings inside a stamp (the web app's `lib/stampGlyphs.tsx`). */
export type StampGlyph =
  | "equator"
  | "dateLine"
  | "arctic"
  | "yesterday"
  | "longHaul"
  | "hop"
  | "mountain"
  | "waves"
  | "continents"
  | "snow"
  | "world"
  | "moon"
  | "moonBack"
  | "redEye"
  | "newYear"
  | "diverted"
  | "seat"
  | "fresh"
  | "factory"
  | "flag"
  | "palette"
  | "bug"
  | "languages";

/** Inside the stamp: a type's silhouette, an airport's code (in the chosen code style), a few characters or a drawing. */
export type StampEmblem = { kind: "type"; code: string } | { kind: "airport"; id: string } | { kind: "text"; text: string } | { kind: "glyph"; glyph: StampGlyph };

/**
 * The record that earned a stamp, a part or a level, and its day (the flight day, or the day seen). For a stamp the owner
 * gave, `granted` with the stamp's id and the day it was given: there is no record to open.
 */
export interface StampRecord {
  table: "flights" | "sightings" | "granted";
  id: string;
  day: string | null;
}

export interface StampPart {
  /** An airport's id, a type's designator or a continent's code, by the parts' kind. */
  key: string;
  by: StampRecord | null;
}

export interface StampLevel {
  need: number;
  by: StampRecord | null;
}

export interface Stamp {
  /** Stable: "queen", "dateLine", "factory.boeing". The messages are `stamps.<id>.name` and `.rule`, a factory's `stamps.factory.*`. */
  id: string;
  group: StampGroup;
  ink: StampInk;
  /** Not shown until earned. */
  hidden: boolean;
  emblem: StampEmblem;
  /** The record that earned it; null while not earned. */
  by: StampRecord | null;
  /** Earned by any part, or only by all (`all`), each ticked by its own record. */
  parts?: { kind: "airport" | "type" | "continent"; all: boolean; list: StampPart[] };
  /** Earned at the first level: how many so far, and the record that reached each. */
  levels?: { have: number; list: StampLevel[] };
  /** A factory stamp's maker. */
  factory?: Factory;
}

export interface StampOptions {
  now?: number;
  /** Each flight's distance along its recorded track (`flownDistances`), as Statistics counts it. */
  flown?: ReadonlyMap<string, FlownDistance>;
  /** Flights to count as flown though planned and still to come: what Coming up says one would earn. */
  asFlown?: readonly Flight[];
  /** The stamps the site's owner gave the log's owner, from their account. */
  granted?: readonly GrantedStamp[];
}

/** The stamps the owner gives that count as hidden: pressed onto the page the first time their owner sees one. */
const GRANTED_HIDDEN: ReadonlySet<GrantedStampId> = new Set(["alpha"]);

/** What is inside each stamp the owner gives. */
const GRANTED_EMBLEMS: Record<GrantedStampId, StampEmblem> = {
  alpha: { kind: "text", text: "α" },
  bugFinder: { kind: "glyph", glyph: "bug" },
  translator: { kind: "glyph", glyph: "languages" },
};

const HOUR = 3600_000;

/** A record with what the rules read, and the instant it sorts by. */
interface Hit {
  rec: StampRecord;
  at: number;
}
interface FlightIn extends Hit {
  f: Flight;
  type: string | null;
  airframe: Airframe | null;
  airports: Airport[];
  /** Departure and arrival airports, the diversion's when it diverted. */
  from: Airport | null;
  to: Airport | null;
  /** The departure and arrival times as stored, at their airports: actual, else gate, else scheduled. */
  leaves: string | null;
  lands: string | null;
}
interface SightingIn extends Hit {
  s: Sighting;
  type: string | null;
  airframe: Airframe | null;
  airport: Airport | null;
}

/** A day's sorting instant: its middle, or after every dated record when there is no day. */
const dayAt = (day: string | null | undefined) => (day ? Date.parse(`${day}T12:00:00Z`) : Infinity);
const byTime = (a: Hit, b: Hit) => a.at - b.at || (a.rec.id < b.rec.id ? -1 : a.rec.id > b.rec.id ? 1 : 0);
const earlier = (a: Hit | null, b: Hit | null) => (!a ? b : !b ? a : byTime(b, a) < 0 ? b : a);
const later = (a: Hit | null, b: Hit | null) => (!a || !b ? null : byTime(b, a) > 0 ? b : a);
const first = <T extends Hit>(xs: readonly T[], ok: (x: T) => boolean): T | null => xs.find(ok) ?? null;
const hourOf = (s: string | null) => (s ? Number(parseDateTime(s)?.time.slice(0, 2) ?? NaN) : NaN);

/** The northernmost latitude of the great circle between two places, in degrees. */
export function greatCircleMaxLat(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const rad = Math.PI / 180;
  const v = (p: { lat: number; lon: number }) => [Math.cos(p.lat * rad) * Math.cos(p.lon * rad), Math.cos(p.lat * rad) * Math.sin(p.lon * rad), Math.sin(p.lat * rad)] as const;
  const [p, q] = [v(a), v(b)];
  const w = Math.acos(Math.min(1, Math.max(-1, p[0] * q[0] + p[1] * q[1] + p[2] * q[2])));
  let max = Math.max(a.lat, b.lat);
  if (w < 1e-9) return max;
  for (let i = 1; i < 128; i++) {
    const t = i / 128;
    const [k0, k1] = [Math.sin((1 - t) * w) / Math.sin(w), Math.sin(t * w) / Math.sin(w)];
    const z = k0 * p[2] + k1 * q[2];
    const r = Math.hypot(k0 * p[0] + k1 * q[0], k0 * p[1] + k1 * q[1], z);
    max = Math.max(max, Math.asin(z / r) / rad);
  }
  return max;
}

/** Whether the great circle between two places crosses the 180° meridian. */
export function crossesDateLine(a: { lon: number }, b: { lon: number }): boolean {
  return Math.abs(a.lon - b.lon) > 180;
}

/** Whether a flight is in the air at midnight on 1 January at its departure's or its arrival's UTC offset. */
function inAirAtNewYear(leaves: string | null, lands: string | null): boolean {
  const [p0, p1] = [leaves ? parseDateTime(leaves) : null, lands ? parseDateTime(lands) : null];
  if (!p0 || !p1 || p1.epochMs <= p0.epochMs) return false;
  const year = Number(p0.date.slice(0, 4));
  for (const off of [p0.offsetMin, p1.offsetMin])
    for (const y of [year, year + 1]) {
      const midnight = Date.UTC(y, 0, 1) - off * 60_000;
      if (p0.epochMs < midnight && midnight < p1.epochMs) return true;
    }
  return false;
}

/** Short hop: airports closer than this, in km, so Helsinki–Tallinn (101) and Tenerife North–Gran Canaria (112) count. */
const SHORT_HOP_KM = 120;

/** Every stamp, earned or not, hidden ones included, in the order of the groups. */
export function stamps(store: Store, ref: RefIndex, opts: StampOptions = {}): Stamp[] {
  const airframes = new Map(store.all("airframes").map((a) => [a.id, a]));
  const counted = countedFlights(store, ref, opts.now);
  const ids = new Set(counted.map((f) => f.id));
  const allFlights = [...counted, ...(opts.asFlown ?? []).filter((f) => !ids.has(f.id))];
  const typeOf = (r: Flight | Sighting) => r.typeCode ?? (r.airframeId ? (airframes.get(r.airframeId)?.typeCode ?? null) : null);

  const flights: FlightIn[] = allFlights
    .map((f) => {
      const leaves = f.takeoffAt ?? f.departureAt ?? f.departureScheduledAt ?? null;
      const lands = f.landingAt ?? f.arrivalAt ?? f.arrivalScheduledAt ?? null;
      const day = flightDay(f);
      const from = ref.airport(f.fromAirportId);
      const to = ref.airport(arrivalAirportId(f));
      return {
        f,
        rec: { table: "flights" as const, id: f.id, day },
        at: instant(leaves) ?? dayAt(day),
        type: typeOf(f),
        airframe: f.airframeId ? (airframes.get(f.airframeId) ?? null) : null,
        airports: [from, to].filter((a): a is Airport => !!a),
        from,
        to,
        leaves,
        lands,
      };
    })
    .sort(byTime);
  const sightings: SightingIn[] = store
    .all("sightings")
    .map((s) => ({
      s,
      rec: { table: "sightings" as const, id: s.id, day: s.seenOn ?? localDateOf(s.seenAt) ?? null },
      at: instant(s.seenAt) ?? dayAt(s.seenOn),
      type: typeOf(s),
      airframe: s.airframeId ? (airframes.get(s.airframeId) ?? null) : null,
      airport: ref.airport(s.airportId),
    }))
    .sort(byTime);

  const out: Stamp[] = [];
  const add = (b: Omit<Stamp, "by" | "hidden"> & { by: Hit | null; hidden?: boolean }) => out.push({ ...b, hidden: b.hidden ?? false, by: b.by?.rec ?? null });
  const flightStamp = (id: string, group: StampGroup, emblem: StampEmblem, ok: (x: FlightIn) => boolean, hidden = false) => add({ id, group, ink: "flown", emblem, by: first(flights, ok), hidden });
  const sightingStamp = (id: string, group: StampGroup, emblem: StampEmblem, ok: (x: SightingIn) => boolean, hidden = false) => add({ id, group, ink: "spotted", emblem, by: first(sightings, ok), hidden });
  const airportId = (icao: string) => ref.airportByCode(icao)?.id ?? null;
  const airportEmblem = (icao: string): StampEmblem => {
    const id = airportId(icao);
    return id ? { kind: "airport", id } : { kind: "text", text: icao };
  };
  const parted = (kind: "airport" | "type" | "continent", all: boolean, list: { key: string; hit: Hit | null }[]) => {
    const hits = list.map((p) => p.hit);
    const by = all ? (hits.every(Boolean) ? hits.reduce<Hit | null>((a, h) => (a ? later(a, h) : h), null) : null) : hits.reduce(earlier, null);
    return { by, parts: { kind, all, list: list.map((p) => ({ key: p.key, by: p.hit?.rec ?? null })) } };
  };

  // ---------- Factories ----------
  const builtBy = (factory: Factory, type: string | null, airframe: Airframe | null) => {
    const maker = ref.manufacturerOf(type) ?? airframe?.manufacturer ?? null;
    return !!maker && factory.manufacturers.includes(maker);
  };
  const atSite = (site: FactorySite, factory: Factory, x: SightingIn) => {
    if (x.airport?.icao !== site.icao || !builtBy(factory, x.type, x.airframe)) return false;
    const year = x.rec.day ? Number(x.rec.day.slice(0, 4)) : null;
    // A sighting without a day counts at a site still building, the only one it can be sure of.
    if (year === null) return site.to === null;
    return year >= site.from && (site.to === null || year <= site.to);
  };
  // Each aircraft's first sighting at one of its maker's sites, for Saw it built.
  const atFactory = new Map<string, SightingIn>();
  for (const factory of FACTORIES) {
    const sites = factory.sites.map((site) => ({ site, hit: first(sightings, (x) => atSite(site, factory, x)) }));
    for (const x of sightings) if (x.airframe && !atFactory.has(x.airframe.id) && factory.sites.some((site) => atSite(site, factory, x))) atFactory.set(x.airframe.id, x);
    const list = sites.flatMap(({ site, hit }) => {
      const id = airportId(site.icao);
      return id ? [{ key: id, hit }] : [];
    });
    const { by, parts } = parted("airport", false, list);
    const shown = sites.find((p) => p.hit) ?? sites[0];
    add({ id: `factory.${factory.id}`, group: "factories", ink: "spotted", emblem: shown ? airportEmblem(shown.site.icao) : { kind: "glyph", glyph: "factory" }, by, parts, factory });
  }
  const freighter = first(sightings, (x) => !!x.type && PARTS_FREIGHTERS.includes(x.type));
  add({ id: "partsOnTheWay", group: "factories", ink: "spotted", emblem: { kind: "type", code: freighter?.type ?? "BLCF" }, by: freighter });
  const built = first(flights, (x) => {
    const s = x.airframe ? atFactory.get(x.airframe.id) : undefined;
    return !!s && byTime(s, x) < 0;
  });
  add({ id: "sawItBuilt", group: "factories", ink: "both", emblem: { kind: "glyph", glyph: "factory" }, by: built, hidden: true });

  // ---------- Aircraft ----------
  const family = (x: FlightIn) => ref.familyIdOf(x.type);
  flightStamp("queen", "aircraft", { kind: "type", code: "B744" }, (x) => family(x) === "B747");
  flightStamp("superjumbo", "aircraft", { kind: "type", code: "A388" }, (x) => x.type === "A388");
  flightStamp("flyingPencil", "aircraft", { kind: "type", code: "A346" }, (x) => x.type === "A346");
  // A family's own stamp shows the type flown, so a 757-300 shows the longer one, and the given type until one is.
  const familyStamp = (id: string, familyId: string, code: string) => {
    const by = first(flights, (x) => family(x) === familyId);
    add({ id, group: "aircraft", ink: "flown", emblem: { kind: "type", code: by?.type ?? code }, by });
  };
  familyStamp("atariFerrari", "B757", "B752");
  familyStamp("babyBoeing", "B737", "B732");
  familyStamp("etops", "B767", "B762");
  familyStamp("tripleSeven", "B777", "B772");
  familyStamp("dreamliner", "B787", "B788");
  familyStamp("zorroMask", "A350", "A359");
  // Boeing, fondly: its Seattle years, the 777-9 that took its time, and the Douglas that took its name.
  const seattle = first(flights, (x) => !!x.type && SEATTLE_BOEINGS.includes(x.type));
  add({ id: "prideOfSeattle", group: "aircraft", ink: "flown", emblem: { kind: "type", code: seattle?.type ?? "B703" }, by: seattle });
  const late = first(flights, (x) => !!x.type && TRIPLE_SEVEN_X.includes(x.type));
  add({ id: "worthTheWait", group: "aircraft", ink: "flown", emblem: { kind: "type", code: late?.type ?? "B779" }, by: late });
  flightStamp("douglasInDisguise", "aircraft", { kind: "type", code: "B712" }, (x) => x.type === "B712");
  const four = first(flights, (x) => ref.type(x.type)?.engineCount === 4);
  add({ id: "fourEngines", group: "aircraft", ink: "flown", emblem: { kind: "type", code: four?.type ?? "A343" }, by: four });
  const SIZES: [string, string[]][] = [
    ["A318", ["A318"]],
    ["A319", ["A319", "A19N"]],
    ["A320", ["A320", "A20N"]],
    ["A321", ["A321", "A21N"]],
  ];
  add({ id: "fullFamily", group: "aircraft", ink: "flown", emblem: { kind: "type", code: "A320" }, ...parted("type", true, SIZES.map(([key, codes]) => ({ key, hit: first(flights, (x) => !!x.type && codes.includes(x.type)) }))) });
  flightStamp("freshOffTheLine", "aircraft", { kind: "glyph", glyph: "fresh" }, (x) => {
    const day = x.rec.day;
    const a = x.airframe;
    if (!day || !a) return false;
    const since = a.deliveryDate ? daysBetween(a.deliveryDate, day) : a.firstFlightDate ? daysBetween(a.firstFlightDate, day) : null;
    return since !== null && since >= 0 && since <= (a.deliveryDate ? 30 : 60);
  });
  flightStamp("veteran", "aircraft", { kind: "text", text: "30+" }, (x) => {
    const born = x.airframe?.firstFlightDate;
    return !!born && !!x.rec.day && x.rec.day >= `${Number(born.slice(0, 4)) + 30}${born.slice(4)}`;
  });
  const times = new Map<string, number>();
  flightStamp("oldFriend", "aircraft", { kind: "text", text: "5×" }, (x) => {
    if (!x.airframe) return false;
    const n = (times.get(x.airframe.id) ?? 0) + 1;
    times.set(x.airframe.id, n);
    return n === 5;
  });
  // Both sides of the fence: for each aircraft, the later of its first flight and its first sighting; the earliest such.
  const firstSeen = new Map<string, SightingIn>();
  for (const x of sightings) if (x.airframe && !firstSeen.has(x.airframe.id)) firstSeen.set(x.airframe.id, x);
  const flownFirst = new Map<string, FlightIn>();
  for (const x of flights) if (x.airframe && !flownFirst.has(x.airframe.id)) flownFirst.set(x.airframe.id, x);
  let fence: { hit: Hit; type: string | null } | null = null;
  for (const [id, f] of flownFirst) {
    const s = firstSeen.get(id);
    const both = s ? later(f, s) : null;
    if (both && (!fence || byTime(both, fence.hit) < 0)) fence = { hit: both, type: f.type ?? s!.type };
  }
  add({ id: "bothSides", group: "aircraft", ink: "both", emblem: { kind: "type", code: fence?.type ?? "A320" }, by: fence?.hit ?? null });
  flightStamp("supersonic", "aircraft", { kind: "type", code: "CONC" }, (x) => x.type === "CONC" || x.type === "T144", true);

  // ---------- The globe ----------
  const route = (x: FlightIn) => (x.from && x.to ? ([x.from, x.to] as const) : null);
  flightStamp("equator", "globe", { kind: "glyph", glyph: "equator" }, (x) => {
    const r = route(x);
    return !!r && r[0].lat * r[1].lat < 0;
  });
  flightStamp("dateLine", "globe", { kind: "glyph", glyph: "dateLine" }, (x) => {
    const r = route(x);
    return !!r && crossesDateLine(r[0], r[1]);
  });
  flightStamp("arcticCircle", "globe", { kind: "glyph", glyph: "arctic" }, (x) => {
    const r = route(x);
    return !!r && greatCircleMaxLat(r[0], r[1]) >= 66 + 34 / 60;
  });
  flightStamp("backToYesterday", "globe", { kind: "glyph", glyph: "yesterday" }, (x) => {
    const [d0, d1] = [localDateOf(x.leaves), localDateOf(x.lands)];
    return !!d0 && !!d1 && d1 < d0;
  });
  const km = (x: FlightIn) => flightDistanceKm(x.f, ref, opts.flown);
  flightStamp("ultraLongHaul", "globe", { kind: "glyph", glyph: "longHaul" }, (x) => (km(x) ?? 0) >= 14_000);
  // On the straight line between the airports: a hop's climb-out and approach can add tens of kilometres to its track.
  flightStamp("shortHop", "globe", { kind: "glyph", glyph: "hop" }, (x) => {
    const d = greatCircleKm(x.f, ref);
    return d !== null && d > 0 && d < SHORT_HOP_KM;
  });
  const THIN = 3000 / 0.3048;
  flightStamp("thinAir", "globe", { kind: "glyph", glyph: "mountain" }, (x) => x.airports.some((a) => (a.elevationFt ?? 0) >= THIN));
  flightStamp("belowSeaLevel", "globe", { kind: "glyph", glyph: "waves" }, (x) => x.airports.some((a) => a.elevationFt !== null && a.elevationFt < 0), true);
  add({
    id: "sixContinents",
    group: "globe",
    ink: "flown",
    emblem: { kind: "glyph", glyph: "continents" },
    ...parted("continent", true, SIX_CONTINENTS.map((c) => ({ key: c, hit: first(flights, (x) => x.airports.some((a) => continentOf(a) === c)) }))),
  });
  flightStamp("antarctica", "globe", { kind: "glyph", glyph: "snow" }, (x) => x.airports.some((a) => continentOf(a) === "AN"), true);
  let total = 0;
  const reached: (FlightIn | null)[] = [null, null, null];
  const LAPS = [40_075, 384_400, 768_800];
  for (const x of flights) {
    total += km(x) ?? 0;
    LAPS.forEach((need, i) => {
      if (!reached[i] && total >= need) reached[i] = x;
    });
  }
  add({ id: "aroundTheWorld", group: "globe", ink: "flown", emblem: { kind: "glyph", glyph: "world" }, by: reached[0] ?? null });
  add({ id: "toTheMoon", group: "globe", ink: "flown", emblem: { kind: "glyph", glyph: "moon" }, by: reached[1] ?? null });
  add({ id: "andBack", group: "globe", ink: "flown", emblem: { kind: "glyph", glyph: "moonBack" }, by: reached[2] ?? null });

  // ---------- Places ----------
  sightingStamp("mahoBeach", "places", airportEmblem("TNCM"), (x) => x.airport?.icao === "TNCM");
  const TRICKY = ["VQPR", "VNLK", "TFFJ", "LXGB", "LPMA"];
  const tricky = TRICKY.flatMap((icao) => {
    const id = airportId(icao);
    return id ? [{ key: id, icao, hit: first(flights, (x) => x.airports.some((a) => a.icao === icao)) }] : [];
  });
  add({ id: "trickyApproaches", group: "places", ink: "flown", emblem: airportEmblem((tricky.find((p) => p.hit) ?? tricky[0])?.icao ?? "VQPR"), ...parted("airport", false, tricky) });
  flightStamp("beachLanding", "places", airportEmblem("EGPR"), (x) => x.airports.some((a) => a.icao === "EGPR"), true);
  flightStamp("kaiTak", "places", airportEmblem("VHHH"), (x) => !!x.rec.day && x.rec.day < "1998-07-06" && x.airports.some((a) => a.icao === "VHHH"), true);

  // ---------- Flights ----------
  flightStamp("redEye", "flights", { kind: "glyph", glyph: "redEye" }, (x) => {
    const [h0, h1] = [hourOf(x.leaves), hourOf(x.lands)];
    const [t0, t1] = [instant(x.leaves), instant(x.lands)];
    return (h0 >= 21 || h0 <= 1) && h1 >= 5 && h1 <= 9 && t0 !== null && t1 !== null && t1 - t0 >= 3 * HOUR;
  });
  flightStamp("newYear", "flights", { kind: "glyph", glyph: "newYear" }, (x) => inAirAtNewYear(x.leaves, x.lands));
  flightStamp("planB", "flights", { kind: "glyph", glyph: "diverted" }, (x) => !!x.f.divertedToAirportId);
  flightStamp("upFront", "flights", { kind: "glyph", glyph: "seat" }, (x) => x.f.cabinClass === "business" || x.f.cabinClass === "first");
  // Lufthansa's Munich to Toulouse, a favourite on Instagram for its number: LH or DLH 2222, booked to Toulouse.
  flightStamp("lh2222", "flights", { kind: "text", text: "2222" }, (x) => {
    const n = parseFlightNumber(x.f.flightNumber);
    return !!n && (n.designator === "LH" || n.designator === "DLH") && n.number === "2222" && ref.airport(x.f.toAirportId)?.icao === "LFBO";
  }, true);

  // ---------- Spotting ----------
  const levels = (needs: number[], keyOf: (x: SightingIn) => string | null) => {
    const seen = new Set<string>();
    const list: { need: number; hit: Hit | null }[] = needs.map((need) => ({ need, hit: null }));
    for (const x of sightings) {
      const key = keyOf(x);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      for (const l of list) if (!l.hit && seen.size >= l.need) l.hit = x;
    }
    return { by: list[0]!.hit, levels: { have: seen.size, list: list.map((l) => ({ need: l.need, by: l.hit?.rec ?? null })) } };
  };
  add({ id: "registers", group: "spotting", ink: "spotted", emblem: { kind: "glyph", glyph: "flag" }, ...levels([10, 25, 50], (x) => (x.s.registration ? (ref.classifyRegistration(x.s.registration)?.prefix.country ?? null) : null)) });
  add({
    id: "specialLiveries",
    group: "spotting",
    ink: "spotted",
    emblem: { kind: "glyph", glyph: "palette" },
    ...levels([10, 50], (x) => {
      const livery = x.s.specialLivery?.trim().toLowerCase();
      return livery ? `${x.s.airframeId ?? x.s.registration ?? x.s.id}|${livery}` : null;
    }),
  });
  const days = new Map<string, Set<string>>();
  sightingStamp("bigDay", "spotting", { kind: "text", text: "100" }, (x) => {
    if (!x.rec.day) return false;
    const set = days.get(x.rec.day) ?? new Set<string>();
    days.set(x.rec.day, set);
    const before = set.size;
    set.add(x.s.airframeId ?? x.s.registration ?? x.s.id);
    return before === 99 && set.size === 100;
  });

  // ---------- From Touchdown ----------
  // Only those given, in the list's order, each dated the day it was given (in UTC, as the server keeps it).
  const given = new Map((opts.granted ?? []).map((g) => [g.id, g.grantedAt] as const));
  for (const id of GRANTED_STAMP_IDS) {
    const at = given.get(id);
    if (at) out.push(grantedStamp(id, at));
  }

  return out;
}

/** A stamp the site's owner gave, dated the day it was given (in UTC): as the Stamps tab lists it, and People shows it. */
export function grantedStamp(id: GrantedStampId, grantedAt: string): Stamp {
  return { id: `granted.${id}`, group: "granted", ink: "granted", hidden: GRANTED_HIDDEN.has(id), emblem: GRANTED_EMBLEMS[id], by: { table: "granted", id, day: grantedAt.slice(0, 10) } };
}

/** The stamps a flight earned: those whose earning record it is. */
export function stampsOf(list: readonly Stamp[], flightId: string): Stamp[] {
  return list.filter((b) => b.by?.table === "flights" && b.by.id === flightId);
}

/** The stamps a planned flight would earn once flown, as Coming up says (docs/31, "Stamps"). */
export function stampsIfFlown(store: Store, ref: RefIndex, flight: Flight, opts: StampOptions = {}): Stamp[] {
  return stampsOf(stamps(store, ref, { ...opts, asFlown: [...(opts.asFlown ?? []), flight] }), flight.id);
}

/** The stamps to list: every one earned, and those still to earn that are not hidden. */
export function shownStamps(list: readonly Stamp[]): Stamp[] {
  return list.filter((b) => b.by || !b.hidden);
}

/**
 * The hidden stamps earned and not yet shown on any device (the log's stamps_seen table): each is pressed onto the page
 * with an animation the first time the Stamps tab or Home shows it (docs/31, "Stamps").
 */
export function stampsToPress(store: Store, list: readonly Stamp[]): Set<string> {
  const seen = new Set(store.all("stamps_seen").map((r) => r.stampId));
  return new Set(list.filter((b) => b.hidden && b.by && !seen.has(b.id)).map((b) => b.id));
}

// ---------- Words ----------

/** A stamp's name, in the interface's language. */
export function stampName(b: Stamp): string {
  return b.factory ? t("stamps.factory.name", { maker: makerName(b.factory.maker) }) : tDynamic(`stamps.${b.id}.name`);
}

/** The level a stamp with levels is working towards: the first not reached, else the last. */
function nextLevel(b: Stamp): StampLevel | null {
  const list = b.levels?.list ?? [];
  return list.find((l) => !l.by) ?? list[list.length - 1] ?? null;
}

/** A stamp's rule, its distances in the log's unit. */
export function stampRule(b: Stamp, unit: Settings["distanceUnit"] = "km"): string {
  if (b.factory) return t("stamps.factory.rule", { maker: makerName(b.factory.maker), count: b.parts?.list.length ?? b.factory.sites.length });
  const km = { ultraLongHaul: 14_000, shortHop: SHORT_HOP_KM, aroundTheWorld: 40_075, toTheMoon: 384_400, andBack: 768_800 }[b.id];
  const height = unit === "km" ? t("format.measure.m", { n: nf.format(3000) }) : t("format.measure.ft", { n: nf.format(9843) });
  return tDynamic(`stamps.${b.id}.rule`, { distance: km ? distance(km, unit) : "", height, count: nextLevel(b)?.need ?? 0 });
}

/** How far a stamp with levels has got: "25 registers · next at 50". Null for one without levels. */
export function stampLevel(b: Stamp): string | null {
  if (!b.levels) return null;
  const next = b.levels.list.find((l) => !l.by);
  return tDynamic(`stamps.${b.id}.level`, { have: b.levels.have, next: next?.need ?? 0 });
}

/** A part's label: an airport's code in the chosen style, a type's code, or a continent's name. */
export function stampPartLabel(b: Stamp, part: StampPart, ref: RefIndex, style: Settings["codeDisplay"] = "iata"): string {
  const kind = b.parts?.kind;
  if (kind === "airport") return airportCode(part.key, ref, style === "icao" ? "icao" : "iata") ?? part.key;
  if (kind === "continent") return tDynamic(`stamps.continent.${part.key}`);
  return part.key;
}
