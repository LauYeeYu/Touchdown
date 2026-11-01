import { describe, expect, it } from "vitest";
import { attachTrack, checkAll, normaliseFlight, normaliseSighting, resolveAirframes, type FlightValues, type SightingValues, type TrackPointInput } from "../src/index.ts";
import { newStore, ref } from "./fixtures.ts";

const TODAY = "2026-10-01";

// A clean, made-up flight: BOS → SEA, 4017 km in 6h05.
const goodFlight: Partial<FlightValues> = {
  scheduledDate: "2025-04-02",
  flightNumber: "DL300",
  airlineRaw: "DL",
  fromRaw: "BOS",
  toRaw: "SEA",
  boardingAt: "2025-04-02T07:20-04:00",
  takeoffAt: "2025-04-02T08:00-04:00",
  landingAt: "2025-04-02T11:05-07:00",
  seat: "12A",
  registrationRaw: "N3001X",
  typeCodeRaw: "A21N",
  modelRaw: "A321-271NX",
};

const goodSighting: Partial<SightingValues> = {
  seenOn: "2025-06-21",
  airportRaw: "KBOS",
  operatorRaw: "DAL",
  registrationRaw: "N4001X",
  typeCodeRaw: "B752",
  modelRaw: "B757-232",
  phase: "approaching",
};

function run(flights: Partial<FlightValues>[] = [], sightings: Partial<SightingValues>[] = []) {
  const store = newStore();
  for (const f of flights) store.insert("flights", normaliseFlight(f, ref));
  for (const s of sightings) store.insert("sightings", normaliseSighting(s, ref));
  const res = resolveAirframes(store, ref);
  return { store, findings: checkAll(store, ref, { today: TODAY, overlaps: res.overlaps }) };
}

const ids = (fs: { ruleId: string }[]) => fs.map((f) => f.ruleId);

describe("field rules: a clean record passes", () => {
  it("raises nothing for the clean flight and sighting", () => {
    expect(ids(run([goodFlight], [goodSighting]).findings)).toEqual([]);
  });
});

describe("the registration's country", () => {
  it("is compared with the airline that flew the flight, when another than the one that sold it", () => {
    expect(ids(run([{ ...goodFlight, registrationRaw: "D-ABCD", operatingAirlineId: "op_dlh" }]).findings)).not.toContain("V-REG-COUNTRY");
    expect(ids(run([{ ...goodFlight, operatingAirlineId: "op_dlh" }]).findings)).toContain("V-REG-COUNTRY");
  });
});

describe("field rules: each fails on a bad value", () => {
  const cases: [string, Partial<FlightValues> | null, Partial<SightingValues> | null][] = [
    ["V-REG-FORMAT", { ...goodFlight, registrationRaw: "QQ12345" }, null],
    ["V-DATE-SANE", { ...goodFlight, scheduledDate: "2027-01-01", boardingAt: null, takeoffAt: null, landingAt: null }, null],
    ["V-DATE-SANE", null, { ...goodSighting, seenOn: "1890-01-01" }],
    ["V-AIRPORT-KNOWN", { ...goodFlight, toRaw: "XQX" }, null],
    ["V-AIRPORT-SAME", { ...goodFlight, toRaw: "BOS", landingAt: null }, null],
    ["V-OPERATOR-KNOWN", null, { ...goodSighting, operatorRaw: "QQQ" }],
    ["V-TYPE-KNOWN", { ...goodFlight, typeCodeRaw: "Z99Z" }, null],
    ["V-MODEL-TYPE", { ...goodFlight, modelRaw: "A321-211" }, null],
    ["V-FLIGHTNO-FORMAT", { ...goodFlight, flightNumber: "DELTA" }, null],
    ["V-FLIGHTNO-AIRLINE", { ...goodFlight, flightNumber: "UA300" }, null],
    ["V-SEAT-FORMAT", { ...goodFlight, seat: "aisle" }, null],
    ["V-TIMES-ORDER", { ...goodFlight, landingAt: "2025-04-02T04:00-07:00" }, null],
    ["V-TIME-OFFSET", { ...goodFlight, takeoffAt: "2025-04-02T08:00-05:00" }, null],
    ["V-DAY-ROLLOVER", { ...goodFlight, takeoffAt: "2025-04-04T08:00-04:00", landingAt: "2025-04-04T11:05-07:00", boardingAt: null }, null],
    ["V-DURATION-SPEED", { ...goodFlight, landingAt: "2025-04-02T05:30-07:00" }, null],
    ["V-DISTANCE-DIFF", { ...goodFlight, distanceKmOverride: 5000 }, null],
    ["V-REG-COUNTRY", { ...goodFlight, registrationRaw: "D-ABCD" }, null],
    ["V-INCOMPLETE", { ...goodFlight, registrationRaw: null }, null],
    ["V-PRIVATE-IN-NOTES", { ...goodFlight, notes: "ticket 0161234567890" }, null],
    ["V-MODEL-PARSE", null, { ...goodSighting, modelRaw: "???" }],
  ];
  for (const [rule, f, s] of cases) {
    it(rule, () => {
      const { findings } = run(f ? [f] : [], s ? [s] : []);
      expect(ids(findings)).toContain(rule);
    });
  }

  it("V-DAY-ROLLOVER is only information for a takeoff on the day after", () => {
    const { findings } = run([{ ...goodFlight, scheduledDate: "2025-04-01" }]);
    expect(findings.find((x) => x.ruleId === "V-DAY-ROLLOVER")?.severity).toBe("info");
  });

  it("V-DAY-ROLLOVER asks about a takeoff just after midnight with no boarding time", () => {
    const { findings } = run([{ ...goodFlight, boardingAt: null, takeoffAt: "2025-04-02T00:30-04:00", landingAt: "2025-04-02T03:35-07:00" }]);
    expect(findings.find((x) => x.ruleId === "V-DAY-ROLLOVER")?.severity).toBe("warning");
  });

  it("V-TIMES-ORDER offers to move a takeoff just after midnight to the next day", () => {
    const { findings } = run([{ ...goodFlight, flightNumber: "DL310", boardingAt: "2025-04-02T23:15-04:00", takeoffAt: "2025-04-02T00:10-04:00", landingAt: "2025-04-02T03:15-07:00" }]);
    const fix = findings.find((x) => x.ruleId === "V-TIMES-ORDER")?.fixes[0];
    expect(fix).toMatchObject({ field: "takeoffAt", value: "2025-04-03T00:10-04:00", also: [{ field: "landingAt", value: "2025-04-03T03:15-07:00" }] });
  });

  it("V-TIME-OFFSET offers the corrected offset", () => {
    const { findings } = run([{ ...goodFlight, takeoffAt: "2025-04-02T08:00-05:00" }]);
    expect(findings.find((x) => x.ruleId === "V-TIME-OFFSET")?.fixes[0]?.value).toBe("2025-04-02T08:00-04:00");
  });

  it("V-TIMES-ORDER moves a takeoff to the next day with the offset in force then", () => {
    // New York's clocks went forward on 2025-03-09 at 02:00.
    const { findings } = run([{ ...goodFlight, scheduledDate: "2025-03-08", fromRaw: "JFK", toRaw: "LHR", boardingAt: "2025-03-08T23:40-05:00", takeoffAt: "2025-03-08T03:10-05:00", landingAt: "2025-03-08T14:10+00:00" }]);
    const fix = findings.find((x) => x.ruleId === "V-TIMES-ORDER")?.fixes[0];
    expect(fix).toMatchObject({ field: "takeoffAt", value: "2025-03-09T03:10-04:00", also: [{ field: "landingAt", value: "2025-03-09T14:10+00:00" }] });
  });

  it("V-TIME-OFFSET checks a diverted landing against the airport it landed at", () => {
    const diverted = { ...goodFlight, scheduledDate: "2025-04-02", fromRaw: "JFK", toRaw: "LHR", divertedToAirportId: "ap_eddf", boardingAt: null, takeoffAt: "2025-04-02T19:00-04:00", landingAt: "2025-04-03T09:10+02:00" };
    expect(ids(run([diverted]).findings)).not.toContain("V-TIME-OFFSET");
    expect(ids(run([{ ...diverted, landingAt: "2025-04-03T08:10+01:00" }]).findings)).toContain("V-TIME-OFFSET");
  });

  it("V-BEFORE-FIRST-FLIGHT", () => {
    const { store } = run([goodFlight]);
    const a = store.all("airframes")[0]!;
    store.update("airframes", a.id, { firstFlightDate: "2025-05-01" });
    expect(ids(checkAll(store, ref, { today: TODAY }))).toContain("V-BEFORE-FIRST-FLIGHT");
    store.update("airframes", a.id, { firstFlightDate: "2025-03-01" });
    expect(ids(checkAll(store, ref, { today: TODAY }))).not.toContain("V-BEFORE-FIRST-FLIGHT");
  });
});

describe("cross-record rules", () => {
  it("C-TYPE-MISMATCH: one registration, two types", () => {
    const { findings, store } = run([], [goodSighting, { ...goodSighting, seenOn: "2025-09-20", typeCodeRaw: "B752" }, { ...goodSighting, seenOn: "2025-10-01", typeCodeRaw: "A319", modelRaw: "A319-112" }]);
    expect(store.count("airframes")).toBe(1);
    const tm = findings.filter((x) => x.ruleId === "C-TYPE-MISMATCH");
    expect(tm).toHaveLength(1);
    expect(tm[0]!.message).toContain("A319");
    expect(tm[0]!.fixes[0]).toMatchObject({ field: "typeCode", value: "B752" });
    expect(tm[0]!.fixes).toHaveLength(1); // two records agree on B752, so no reverse fix
  });

  it("C-TYPE-MISMATCH: same type passes", () => {
    expect(ids(run([], [goodSighting, { ...goodSighting, seenOn: "2025-09-20" }]).findings)).not.toContain("C-TYPE-MISMATCH");
  });

  it("C-DUP-FLIGHT", () => {
    expect(ids(run([goodFlight, { ...goodFlight, seat: "14C" }]).findings)).toContain("C-DUP-FLIGHT");
    expect(ids(run([goodFlight, { ...goodFlight, scheduledDate: "2025-04-03", takeoffAt: null, landingAt: null, boardingAt: null }]).findings)).not.toContain("C-DUP-FLIGHT");
  });

  it("C-DUP-SIGHTING", () => {
    expect(ids(run([], [goodSighting, goodSighting]).findings)).toContain("C-DUP-SIGHTING");
    expect(ids(run([], [goodSighting, { ...goodSighting, airportRaw: "KJFK" }]).findings)).not.toContain("C-DUP-SIGHTING");
  });

  it("C-DUP-TICKET never shows the ticket number", () => {
    const a = { ...goodFlight, ticketNumber: "0060000000000/1" };
    const b = { ...goodFlight, scheduledDate: "2025-04-05", flightNumber: "DL301", fromRaw: "SEA", toRaw: "BOS", boardingAt: null, takeoffAt: null, landingAt: null, ticketNumber: "0060000000000/1" };
    const f = run([a, b]).findings.find((x) => x.ruleId === "C-DUP-TICKET");
    expect(f).toBeDefined();
    expect(f!.message).not.toContain("0060000000000");
    expect(ids(run([a, { ...b, ticketNumber: "0060000000000/2" }]).findings)).not.toContain("C-DUP-TICKET");
  });

  it("C-DUP-TICKET lets the legs of one flight number in a row share a coupon", () => {
    // DL300 stops at Seattle and goes on to Tokyo: one segment, one coupon, two flights in the log.
    const a = { ...goodFlight, ticketNumber: "0060000000000/1" };
    const on = { ...goodFlight, fromRaw: "SEA", toRaw: "HND", boardingAt: null, takeoffAt: "2025-04-02T12:40-07:00", landingAt: "2025-04-03T15:30+09:00", seat: "12A", ticketNumber: "0060000000000/1" };
    expect(ids(run([on, a]).findings)).not.toContain("C-DUP-TICKET");
    const undated = { ...on, takeoffAt: null, landingAt: null, scheduledDate: "2025-04-02" };
    expect(ids(run([a, undated]).findings)).not.toContain("C-DUP-TICKET");
    // The same number from Seattle a week later is another flight, so its coupon is not this one.
    expect(ids(run([a, { ...on, scheduledDate: "2025-04-09", takeoffAt: "2025-04-09T12:40-07:00", landingAt: "2025-04-10T15:30+09:00" }]).findings)).toContain("C-DUP-TICKET");
  });

  it("C-FLIGHT-OVERLAP", () => {
    const b = { ...goodFlight, flightNumber: "DL302", scheduledDate: "2025-04-02", fromRaw: "BOS", toRaw: "SEA", boardingAt: null, takeoffAt: "2025-04-02T09:00-04:00", landingAt: "2025-04-02T12:05-07:00" };
    expect(ids(run([goodFlight, b]).findings)).toContain("C-FLIGHT-OVERLAP");
    expect(ids(run([goodFlight, { ...b, takeoffAt: "2025-04-02T18:00-04:00", landingAt: "2025-04-02T21:05-07:00" }]).findings)).not.toContain("C-FLIGHT-OVERLAP");
  });

  it("C-CODE-VARIANTS: AAl and AAL", () => {
    expect(ids(run([], [{ ...goodSighting, operatorRaw: "AAl" }, { ...goodSighting, registrationRaw: "N4002X", operatorRaw: "AAL" }]).findings)).toContain("C-CODE-VARIANTS");
    expect(ids(run([], [{ ...goodSighting, operatorRaw: "AAL" }, { ...goodSighting, registrationRaw: "N4002X", operatorRaw: "AAL" }]).findings)).not.toContain("C-CODE-VARIANTS");
  });

  it("C-LIVERY-NAME", () => {
    expect(ids(run([], [{ ...goodSighting, specialLivery: "Oneworld Livery" }, { ...goodSighting, seenOn: "2025-09-20", specialLivery: "oneworld livery" }]).findings)).toContain("C-LIVERY-NAME");
    expect(ids(run([], [{ ...goodSighting, specialLivery: "Oneworld Livery" }, { ...goodSighting, seenOn: "2025-09-20", specialLivery: "Oneworld Livery" }]).findings)).not.toContain("C-LIVERY-NAME");
  });

  it("C-LIVERY-MISSING", () => {
    const s = (seenOn: string, specialLivery: string | null = null): Partial<SightingValues> => ({ seenOn, airportRaw: "EGLL", registrationRaw: "G-ABCD", operatorRaw: "BAW", typeCodeRaw: "A21N", phase: "landing", specialLivery });
    const missing = (list: Partial<SightingValues>[]) => run([], list).findings.filter((f) => f.ruleId === "C-LIVERY-MISSING");
    // Between two records with the livery, and within a year after the last one.
    const found = missing([s("2025-03-14", "Retro Livery"), s("2025-05-01"), s("2025-08-20", "Retro Livery"), s("2026-02-01")]);
    expect(found).toHaveLength(2);
    expect(found[0]!.message).toBe("G-ABCD was in Retro Livery on 2025-03-14, but this sighting has no special livery.");
    expect(found[0]!.fixes[0]).toMatchObject({ field: "specialLivery", value: "Retro Livery" });
    // More than a year after the last one, before the first one, or between two different liveries: not known.
    expect(missing([s("2023-01-01", "Retro Livery"), s("2025-03-14")])).toHaveLength(0);
    expect(missing([s("2025-01-01"), s("2025-03-14", "Retro Livery")])).toHaveLength(0);
    expect(missing([s("2025-01-01", "Retro Livery"), s("2025-03-14"), s("2025-06-01", "Sports Livery")])).toHaveLength(0);
  });

  it("C-SAME-DAY", () => {
    const s = { ...goodSighting, seenOn: "2025-04-02", registrationRaw: "N3001X", typeCodeRaw: "A21N", modelRaw: "A321-271NX" };
    expect(ids(run([goodFlight], [s]).findings)).toContain("C-SAME-DAY");
    expect(ids(run([goodFlight], [{ ...s, seenOn: "2025-04-09" }]).findings)).not.toContain("C-SAME-DAY");
  });

  it("C-REG-OVERLAP", () => {
    const { store } = run([goodFlight]);
    const other = store.insert("airframes", { identityKey: "msn:airbus:1", provisional: false });
    store.insert("registration_periods", { airframeId: other.id, registration: "N3001X", validFrom: "2020-01-01", validTo: null });
    const res = resolveAirframes(store, ref);
    expect(res.overlaps).toHaveLength(1);
    expect(ids(checkAll(store, ref, { today: TODAY, overlaps: res.overlaps }))).toContain("C-REG-OVERLAP");
  });
});

describe("a flight against its timetable and its track", () => {
  const schedule = (departureScheduledAt: string) => run([{ ...goodFlight, departureScheduledAt }]).findings.filter((x) => x.ruleId === "V-SCHEDULE-DATE");

  it("V-SCHEDULE-DATE: the scheduled departure falls on the flight's date", () => {
    expect(schedule("2025-04-02T07:55-04:00")).toHaveLength(0);
    expect(schedule("2025-04-03T07:55-04:00")[0]?.severity).toBe("warning");
    const far = schedule("2025-04-07T07:55-04:00")[0];
    expect(far?.severity).toBe("error");
    expect(far?.message).toBe("DL300 on 2025-04-02: the scheduled departure is on 2025-04-07, but the flight's date, the day it was scheduled to leave, is 2025-04-02.");
  });

  const BOS = { lat: 42.3656, lon: -71.0096 };
  const SEA = { lat: 47.4502, lon: -122.3088 };
  const ORD = { lat: 41.9786, lon: -87.9048 };
  // A made-up line of positions over the clean flight's times, 12:00 to 18:05 UTC.
  const line = (to = SEA): TrackPointInput[] =>
    Array.from({ length: 40 }, (_, i) => ({
      t: Date.parse("2025-04-02T12:00Z") / 1000 + i * 562,
      lat: BOS.lat + ((to.lat - BOS.lat) * i) / 39,
      lon: BOS.lon + ((to.lon - BOS.lon) * i) / 39,
      altitudeFt: 35000,
      groundSpeedKt: 450,
      headingDeg: 280,
    }));
  const tracked = (points = line(), coverage: "complete" | "partial" = "complete") => {
    const { store } = run([goodFlight]);
    const f = store.all("flights")[0]!;
    attachTrack(store, f.id, points, { provider: "fr24_csv", attribution: "Track data: test", coverage });
    const found = (rule: string) => checkAll(store, ref, { today: TODAY, overlaps: resolveAirframes(store, ref).overlaps }).filter((x) => x.ruleId === rule);
    return { store, f, found };
  };

  it("raises nothing for a track that fits its flight", () => {
    const { store } = tracked();
    expect(ids(checkAll(store, ref, { today: TODAY, overlaps: resolveAirframes(store, ref).overlaps }))).toEqual([]);
  });

  it("V-TRACK-TIMES: the track lies outside the flight after its date and times change", () => {
    const { store, f, found } = tracked();
    store.update("flights", f.id, { scheduledDate: "2025-04-02", boardingAt: "2025-04-02T09:20-04:00", takeoffAt: "2025-04-02T10:00-04:00", landingAt: "2025-04-02T13:05-07:00" });
    expect(found("V-TRACK-TIMES")).toHaveLength(0); // two hours later: a delay
    store.update("flights", f.id, { scheduledDate: "2025-04-07", boardingAt: "2025-04-07T07:20-04:00", takeoffAt: "2025-04-07T08:00-04:00", landingAt: "2025-04-07T11:05-07:00" });
    expect(found("V-TRACK-TIMES")[0]?.message).toBe("DL300 on 2025-04-07: the track runs from 2025-04-02 12:00 to 18:05 UTC, outside this flight (takeoff 2025-04-07 12:00 UTC). Correct the flight's date and times, or replace the track.");
    // Without takeoff and landing, the flight's day, give or take one.
    store.update("flights", f.id, { boardingAt: null, takeoffAt: null, landingAt: null, scheduledDate: "2025-04-03" });
    expect(found("V-TRACK-TIMES")).toHaveLength(0);
    store.update("flights", f.id, { scheduledDate: "2025-04-07" });
    expect(found("V-TRACK-TIMES")[0]?.message).toContain("the track is from 2025-04-02, but this flight is on 2025-04-07.");
  });

  it("V-TRACK-ROUTE: the track is far longer or, when complete, shorter than the route", () => {
    const moved = tracked();
    const jfk = normaliseFlight({ ...goodFlight, toRaw: "JFK" }, ref).toAirportId;
    moved.store.update("flights", moved.f.id, { toAirportId: jfk, toRaw: "JFK" });
    expect(moved.found("V-TRACK-ROUTE")[0]?.message).toMatch(/^DL300 on 2025-04-02: the track is 4,\d{3} km long, but BOS to JFK is 30\d km\. Correct the airports, or replace the track\.$/);
    // A complete track to Chicago on a flight to Seattle: too short. A partial one may stop anywhere.
    expect(tracked(line(ORD)).found("V-TRACK-ROUTE")[0]?.message).toMatch(/the track is 1,\d{3} km long, but BOS to SEA is 4,0\d\d km\./);
    expect(tracked(line(ORD), "partial").found("V-TRACK-ROUTE")).toHaveLength(0);
  });
});
