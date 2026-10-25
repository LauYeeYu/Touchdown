import { describe, expect, it } from "vitest";
import { buildFlightTimes, commitImport, matchCandidates, parseSource, readCsv, undoImport, checkAll } from "../src/index.ts";
import { newStore, ref, refTables } from "./fixtures.ts";
import { namedOperator, normaliseSighting, operatorFromOverride, RefIndex, type Store } from "../src/index.ts";

// Made-up rows in the myFR24 export format (19 columns, leading empty line).
const FR24 = `
Date,Flight number,From,To,Dep time,Arr time,Duration,Airline,Aircraft,Registration,Seat number,Seat type,Flight class,Flight reason,Note,Dep_id,Arr_id,Airline_id,Aircraft_id
2025-03-14,XY123,London / Heathrow (LHR/EGLL),New York / John F. Kennedy (JFK/KJFK),10:40:00,13:30:00,07:50:00,Delta Air Lines (DL/DAL),Boeing 777-300ER (B77W),N2001X,14A,3,1,1,,122,456,7,0
2025-04-02,DL300,Boston / Logan (BOS/KBOS),Seattle / Seattle-Tacoma (SEA/KSEA),08:00:00,11:05:00,06:05:00,Delta Air Lines (DL/DAL),Airbus A321neo (A21N),N3001X,12A,1,1,1,,0,0,0,0
`;

// Made-up rows in the flight log spreadsheet format.
const LOG = `Date,Airlines,Flight Number,Seat,Class,Departure,Gate,Boarding Time,Departure Time,Destination,Landing Time,Duration,Distance (km),Route,ETKT,Manufacturer,Plane Family,Type Code,Aircraft,Registration Number,First Flight Date,Special Livery,Misc
14-Mar-2025,XY,XY123,14A,Main Cabin (L),LHR,B32,10:00,10:40,JFK,13:30,07:50,6000,LHR-JFK,0000000000001/1,Boeing,B777,B77W,B777-322(ER),N2001X,12-Apr-2016,,
12-Jul-2025,LH,LH700,42K,Economy Saver,PVG,D60,23:05,12:25,FRA,07:40,13:15,8878,PVG-FRA,0000000000002/1,Airbus,A330,A333,A330-343,D-ABCD,19-Aug-2016,,
`;

describe("building date-times from clock times", () => {
  it("moves a takeoff after midnight to the next day when boarding was before midnight", () => {
    const t = buildFlightTimes({ scheduledDate: "2025-03-14", originTz: "Europe/Paris", destTz: "Europe/London", boarding: "23:20", takeoff: "00:12", landing: "00:05", durationMin: 53 });
    expect(t.boardingAt).toBe("2025-03-14T23:20+01:00");
    expect(t.takeoffAt).toBe("2025-03-15T00:12+01:00");
    expect(t.landingAt).toBe("2025-03-15T00:05+00:00");
    expect(t.issues).toEqual([]);
  });

  it("flags a landing time that does not fit takeoff plus duration, and spots a 12-hour slip", () => {
    const t = buildFlightTimes({ scheduledDate: "2025-07-12", originTz: "Asia/Shanghai", destTz: "Europe/Berlin", boarding: "23:05", takeoff: "12:25", landing: "07:40", durationMin: 13 * 60 + 15 });
    expect(t.issues[0]?.ruleId).toBe("I-SOURCE-DIFF");
    expect(t.issues[0]?.message).toContain("gives takeoff 00:25");
    expect(t.issues[0]?.message).toContain("12-hour clock");
  });

  it("places the landing after takeoff when there is no duration", () => {
    const t = buildFlightTimes({ scheduledDate: "2025-03-14", originTz: "America/Los_Angeles", destTz: "America/New_York", takeoff: "22:00", landing: "06:10" });
    expect(t.landingAt).toBe("2025-03-15T06:10-04:00");
  });

  // On 2025-10-26 the clocks in Dublin and London went back at 02:00 summer time: 01:00–01:59 happened twice.
  it("places a landing in the repeated hour on the same day", () => {
    const t = buildFlightTimes({ scheduledDate: "2025-10-26", originTz: "Europe/Dublin", destTz: "Europe/London", takeoff: "01:30", landing: "01:10" });
    expect(t.takeoffAt).toBe("2025-10-26T01:30+01:00");
    expect(t.landingAt).toBe("2025-10-26T01:10+00:00");
  });

  it("uses the landing time to tell which repeated takeoff time it was", () => {
    const t = buildFlightTimes({ scheduledDate: "2025-10-26", originTz: "Europe/Dublin", destTz: "Europe/London", boarding: "01:05", takeoff: "01:30", landing: "02:20", durationMin: 50 });
    expect(t.takeoffAt).toBe("2025-10-26T01:30+00:00");
    expect(t.landingAt).toBe("2025-10-26T02:20+00:00");
    expect(t.boardingAt).toBe("2025-10-26T01:05+00:00");
    expect(t.issues).toEqual([]);
  });

  it("counts the flight time across a clock change", () => {
    // London's clocks went back during the flight: 6h05 in the air, 10h05 apart on the clocks.
    const t = buildFlightTimes({ scheduledDate: "2025-10-25", originTz: "America/New_York", destTz: "Europe/London", takeoff: "22:00", landing: "08:05", durationMin: 6 * 60 + 5 });
    expect(t.takeoffAt).toBe("2025-10-25T22:00-04:00");
    expect(t.landingAt).toBe("2025-10-26T08:05+00:00");
    expect(t.issues).toEqual([]);
  });
});

describe("import pipeline", () => {
  it("imports the FR24 export, then merges the flight log into the same flights", () => {
    const store = newStore();
    const fr24 = parseSource(readCsv(FR24), "fr24.csv", ref)!;
    expect(fr24.format).toBe("fr24_csv");
    expect(fr24.candidates).toHaveLength(2);
    const first = fr24.candidates[0]!;
    expect(first.values).toMatchObject({
      scheduledDate: "2025-03-14",
      fromAirportId: "ap_egll",
      toAirportId: "ap_kjfk",
      airlineId: "op_dal",
      typeCode: "B77W",
      takeoffAt: "2025-03-14T10:40+00:00",
      landingAt: "2025-03-14T14:30-04:00",
      seatPosition: "aisle",
      cabinClass: "economy",
      reason: "leisure",
    });
    expect(first.external.map((e) => e.key)).toEqual(["Dep_id", "Arr_id", "Airline_id"]);
    // The FR24 arrival clock says 13:30, but 10:40 GMT + 7h50 is 14:30 in New York (EDT).
    expect(first.issues.map((i) => i.ruleId)).toContain("I-SOURCE-DIFF");

    const m1 = matchCandidates(store, fr24.candidates);
    expect(m1.map((m) => m.kind)).toEqual(["new", "new"]);
    const r1 = commitImport(store, ref, fr24, m1);
    expect(r1.created).toBe(2);
    expect(store.count("airframes")).toBe(2);

    const log = parseSource(readCsv(LOG), "log.csv", ref)!;
    expect(log.format).toBe("sheet");
    const c0 = log.candidates[0]!;
    expect(c0.values).toMatchObject({ bookingClass: "L", fareBrand: "Main Cabin", model: "777-322(ER)", ticketNumber: "0000000000001/1", boardingAt: "2025-03-14T10:00+00:00" });
    expect(c0.airframeFacts.firstFlightDate).toBe("2016-04-12");
    expect(c0.issues.some((i) => i.ruleId === "V-DISTANCE-DIFF")).toBe(true);

    const m2 = matchCandidates(store, log.candidates);
    expect(m2[0]!.kind).toBe("conflict"); // same flight; airline code differs (XY vs DL)
    expect(m2[0]!.fills).toEqual(expect.arrayContaining(["boardingAt", "model", "ticketNumber", "departureGate"]));
    expect(m2[1]!.kind).toBe("new");
    const r2 = commitImport(store, ref, log, m2);
    expect(r2).toMatchObject({ created: 1, updated: 1 });
    const f = store.all("flights").find((x) => x.flightNumber === "XY123")!;
    expect(f.model).toBe("777-322(ER)");
    expect(f.airlineId).toBe("op_dal"); // conflicts keep the existing value by default
    const a = store.get("airframes", f.airframeId)!;
    expect(a.firstFlightDate).toBe("2016-04-12");
    expect(store.all("field_provenance").some((p) => p.ownerId === a.id && p.field === "firstFlightDate" && p.source === "user")).toBe(true);

    // Undo the second import: the new flight goes, the merged one gets its old values back.
    const u = undoImport(store, ref, r2.batchId);
    expect(u).toMatchObject({ removed: 1, restored: 1 });
    expect(store.count("flights")).toBe(2);
    expect(store.all("flights").find((x) => x.flightNumber === "XY123")!.model).toBeNull();
  });

  it("parses the spotting sheet's misc column and compares the country", () => {
    const csv = `Registration,Date,Location,Airlines,Country,Manufacturer,Plane Family,Type Code,Aircraft,Status,Special Livery,Misc
N999ZZ,45000,KBOS,AAl,US,Boeing,B757,B752,B757-2Q8,Approaching,,Partial body; Blue Tail Livery
N999ZZ,45001,KBOS,AAL,Germany,Airbus,A320,A319,A319-112,Touching-down,,Taken this aircraft
N888ZZ,45001,KBOS,DLH,US,Boeing,B757,B752,B757-2Q8,Parked,,
N777AA,,KBOS,Private Owner,US,Boeing,B737,B738,B737-8H4,Parked,Retro Livery,
D-ABCD,45001,KBOS,DLH,Germany,Boeing,B757,B752,B757-2Q8,Parked,,`;
    const src = parseSource(readCsv(csv), "photos.csv", ref)!;
    expect(src.format).toBe("sheet");
    const [a, b, us, c, de] = src.candidates as Extract<(typeof src.candidates)[number], { table: "sightings" }>[];
    expect(us!.issues).toEqual([]);
    expect(de!.issues).toEqual([]);
    expect(a!.values).toMatchObject({ seenOn: "2023-03-15", airportId: "ap_kbos", operatorId: "op_aal", phase: "approaching", livery: "Blue Tail Livery", notes: null });
    expect(a!.tags).toEqual(["partial_body"]);
    expect(b!.values).toMatchObject({ phase: "landing", notes: "Taken this aircraft" });
    expect(b!.issues.some((i) => i.message.includes("Germany"))).toBe(true);
    expect(c!.values).toMatchObject({ seenOn: null, operatorId: "op_private", specialLivery: "Retro Livery" });

    const store = newStore();
    commitImport(store, ref, src, matchCandidates(store, src.candidates));
    // One registration recorded with two types: same provisional airframe, the odd one flagged.
    // Four registrations in all, so four airframes.
    expect(store.count("airframes")).toBe(4);
    const findings = checkAll(store, ref, { today: "2026-10-01" });
    const ids = findings.map((f) => f.ruleId);
    expect(ids).toContain("C-TYPE-MISMATCH");
    expect(ids).toContain("C-CODE-VARIANTS");
    expect(ids).toContain("V-INCOMPLETE");
    expect(store.all("sighting_tags").map((t) => t.tag)).toEqual(["partial_body"]);
  });
});

import { attachTrack, matchTrack, parseTrackCsv, simplifyTrack, normaliseFlight } from "../src/index.ts";

describe("recorded tracks", () => {
  // A made-up track from Boston to JFK, one point a minute, in the FR24 playback format.
  const lines = ["Timestamp,UTC,Callsign,Position,Altitude,Speed,Direction"];
  const t0 = Date.parse("2025-04-02T12:00:00Z") / 1000;
  for (let i = 0; i <= 60; i++) {
    const f = i / 60;
    const lat = 42.3643 + (40.6398 - 42.3643) * f;
    const lon = -71.0052 + (-73.7789 - -71.0052) * f;
    lines.push(`${t0 + i * 60},x,XYZ1,"${lat.toFixed(5)},${lon.toFixed(5)}",${Math.round(Math.sin(Math.PI * f) * 30000)},400,225`);
  }
  lines.splice(30, 0, `${t0 + 28 * 60 + 30},x,XYZ1,"10.0,10.0",30000,400,225`); // a bad point far away

  it("reads the FR24 format, drops impossible jumps and matches the flight by file name", () => {
    const pts = parseTrackCsv(lines.join("\n"));
    expect(pts).toHaveLength(61);
    const store = newStore();
    const f = store.insert("flights", normaliseFlight({ scheduledDate: "2025-04-02", flightNumber: "XY1", fromRaw: "BOS", toRaw: "JFK", takeoffAt: "2025-04-02T08:00-04:00", landingAt: "2025-04-02T09:00-04:00" }, ref));
    const m = matchTrack(pts, store.all("flights"), ref, "XY1_BOS_JFK_20250402_abc123.csv");
    expect(m?.flight.id).toBe(f.id);
    expect(m?.coverage).toBe("complete");
    const id = attachTrack(store, f.id, pts, { provider: "fr24_csv", attribution: "Track data: test", coverage: m!.coverage });
    expect(store.all("track_points").filter((p) => p.trackId === id)).toHaveLength(61);
    // A second attach replaces the first, points included.
    attachTrack(store, f.id, pts.slice(0, 10), { provider: "fr24_csv", attribution: "Track data: test", coverage: "partial" });
    expect(store.all("tracks")).toHaveLength(1);
    expect(store.all("track_points")).toHaveLength(10);
  });

  it("simplifies to the limit and keeps both ends", () => {
    const pts = Array.from({ length: 5000 }, (_, i) => ({ lat: Math.sin(i / 100), lon: i / 100 }));
    const s = simplifyTrack(pts, 2000);
    expect(s).toHaveLength(2000);
    expect(s[0]).toBe(pts[0]);
    expect(s[s.length - 1]).toBe(pts[pts.length - 1]);
  });
});

describe("merging rules", () => {
  it("takes the file's takeoff a day later when its boarding time shows the flight left after midnight", () => {
    const store = newStore();
    // First source: takeoff 00:10 placed on the scheduled date (no boarding time to say otherwise).
    store.insert("flights", normaliseFlight({ scheduledDate: "2025-06-21", flightNumber: "XY733", fromRaw: "FRA", toRaw: "LHR", takeoffAt: "2025-06-21T00:10+02:00", landingAt: "2025-06-21T00:50+01:00" }, ref));
    const csv = `Date,Airlines,Flight Number,Seat,Class,Departure,Gate,Boarding Time,Departure Time,Destination,Landing Time,Duration,Distance (km),Route,ETKT,Manufacturer,Plane Family,Type Code,Aircraft,Registration Number,First Flight Date,Special Livery,Misc
21-Jun-2025,XY,XY733,1A,Y,FRA,A1,23:15,00:10,LHR,00:50,01:40,650,FRA-LHR,,,,,,,,,`;
    const src = parseSource(readCsv(csv), "log.csv", ref)!;
    const [m] = matchCandidates(store, src.candidates);
    expect(m!.kind).toBe("update");
    expect(m!.corrections.map((x) => x.field)).toEqual(["takeoffAt", "landingAt"]);
    commitImport(store, ref, src, [m!]);
    const f = store.all("flights")[0]!;
    expect(f.takeoffAt).toBe("2025-06-22T00:10+02:00");
    expect(f.boardingAt).toBe("2025-06-21T23:15+02:00");
  });

  it("merges a sighting repeated in the same file into the first one", () => {
    const csv = `Registration,Date,Location,Airlines,Country,Manufacturer,Plane Family,Type Code,Aircraft,Status,Special Livery,Misc
N1001X,45000,KBOS,DAL,US,Boeing,B737,B738,B737-8H4,Taxiing,,Too far
N1001X,45000,KBOS,DAL,US,Boeing,B737,B738,B737-8H4,Taking-off,Retro Livery,Partial body`;
    const store = newStore();
    const src = parseSource(readCsv(csv), "photos.csv", ref)!;
    const ms = matchCandidates(store, src.candidates);
    expect(ms.map((m) => m.kind)).toEqual(["new", "duplicate"]);
    const r = commitImport(store, ref, src, ms);
    expect(r).toMatchObject({ created: 1, merged: 1 });
    const s = store.all("sightings");
    expect(s).toHaveLength(1);
    expect(s[0]).toMatchObject({ phase: "taxiing", specialLivery: "Retro Livery", notes: "Also taking off" });
    expect(store.all("sighting_tags").map((t) => t.tag).sort()).toEqual(["partial_body", "too_far"]);
  });

  it("keeps a repeat as its own sighting when the user asks", () => {
    const csv = `Registration,Date,Location,Airlines,Country,Manufacturer,Plane Family,Type Code,Aircraft,Status,Special Livery,Misc
N1001X,45000,KBOS,DAL,US,Boeing,B737,B738,B737-8H4,Taxiing,,
N1001X,45000,KBOS,DAL,US,Boeing,B737,B738,B737-8H4,Taking-off,,`;
    const store = newStore();
    const src = parseSource(readCsv(csv), "photos.csv", ref)!;
    commitImport(store, ref, src, matchCandidates(store, src.candidates), new Map([[1, { keepSeparate: true }]]));
    expect(store.count("sightings")).toBe(2);
  });
});

describe("operators written by name", () => {
  it("adds an unknown operator name as the user's own operator and links the records", () => {
    const csv = `Registration,Date,Location,Airlines,Country,Manufacturer,Plane Family,Type Code,Aircraft,Status,Special Livery,Misc
G-ABCD,45000,KBOS,Example Motors,GB,Boeing,B737,B738,B737-8H4,Parked,,
G-ABCE,45001,KBOS,Example Motors,GB,Boeing,B737,B738,B737-8H4,Parked,,
N1001X,45001,KBOS,Delta Air Lines,US,Boeing,B737,B738,B737-8H4,Parked,,`;
    const local = new RefIndex(refTables);
    const store = newStore();
    const src = parseSource(readCsv(csv), "photos.csv", local)!;
    expect(src.candidates[0]!.issues.some((i) => i.message.includes("added as an operator"))).toBe(true);
    commitImport(store, local, src, matchCandidates(store, src.candidates));
    const ops = store.all("operator_overrides");
    expect(ops.map((o) => o.name)).toEqual(["Example Motors"]);
    const s = store.all("sightings");
    expect(s[0]!.operatorId).toBe(ops[0]!.id);
    expect(s[1]!.operatorId).toBe(ops[0]!.id);
    expect(s[2]!.operatorId).toBe("op_dal"); // a known airline's name resolves to it
    expect(checkAll(store, local, { today: "2026-10-01" }).some((f) => f.ruleId === "V-OPERATOR-KNOWN")).toBe(false);
  });

  it("offers a name typed in the app as the user's own operator, and adds it once", () => {
    const local = new RefIndex(refTables);
    const store = newStore();
    store.insert("sightings", normaliseSighting({ seenOn: "2026-05-01", airportRaw: "KBOS", registrationRaw: "G-ABCD", operatorRaw: "Example Motors" }, local));
    store.insert("sightings", normaliseSighting({ seenOn: "2026-05-01", airportRaw: "KBOS", registrationRaw: "G-ABCE", operatorRaw: "QQQ" }, local));
    const fixes = checkAll(store, local, { today: "2026-10-01" })
      .filter((f) => f.ruleId === "V-OPERATOR-KNOWN")
      .map((f) => f.fixes.map((x) => [x.operatorName, x.label]));
    expect(fixes).toEqual([[["Example Motors", "Add Example Motors as an operator"]], []]);

    const op = namedOperator(store, local, "Example Motors")!;
    expect(namedOperator(store, local, "example  motors")!.id).toBe(op.id);
    // Another device's reference index has not seen it yet: the stored operator is found, not added again.
    expect(namedOperator(store, new RefIndex(refTables), "Example Motors")!.id).toBe(op.id);
    expect(store.all("operator_overrides")).toHaveLength(1);
    expect(namedOperator(store, local, "QQQ")).toBeNull();
  });

  const own = (store: Store) => store.all("operator_overrides").map((o) => operatorFromOverride(o));

  it("reaches an index built before the log arrived, as in a browser signed in again", () => {
    const store = newStore();
    const op = namedOperator(store, new RefIndex(refTables), "Example Motors")!;
    store.insert("sightings", { ...normaliseSighting({ seenOn: "2026-05-01", airportRaw: "KBOS", registrationRaw: "G-ABCD", operatorRaw: "Example Motors" }, ref), operatorId: op.id });
    // The index was built while the browser was empty; the rows came later by sync.
    const later = new RefIndex(refTables);
    const unknown = () => checkAll(store, later, { today: "2026-10-01" }).filter((f) => f.ruleId === "V-OPERATOR-KNOWN");
    expect(unknown()).toHaveLength(1);
    later.setUserOverrides({ operators: own(store), familyOverrides: [{ designator: "E75L", familyId: "A320" }] });
    expect(unknown()).toHaveLength(0);
    expect(later.familyIdOf("E75L")).toBe("A320");
    // Removed on another device: unknown again, and the reference operators are still there.
    later.setUserOverrides({});
    expect(unknown()).toHaveLength(1);
    expect(later.familyIdOf("E75L")).toBe("E175");
    expect(later.operatorByCode("Delta Air Lines")!.id).toBe("op_dal");
  });

  it("links the import to the log's own operator after a preview into a scratch copy", () => {
    const csv = `Registration,Date,Location,Airlines,Country,Manufacturer,Plane Family,Type Code,Aircraft,Status,Special Livery,Misc
G-ABCD,45000,KBOS,Example Motors,GB,Boeing,B737,B738,B737-8H4,Parked,,`;
    const local = new RefIndex(refTables);
    const store = newStore();
    const src = parseSource(readCsv(csv), "photos.csv", local)!;
    const matches = matchCandidates(store, src.candidates);
    // The Import page's preview: the same matches committed into a scratch copy, then the index set back to the log's.
    commitImport(newStore(), local, src, matches);
    expect((src.candidates[0]!.values as { operatorId?: string | null }).operatorId ?? null).toBeNull();
    local.setUserOverrides({ operators: own(store) });
    commitImport(store, local, src, matches);
    const ops = store.all("operator_overrides");
    expect(ops.map((o) => o.name)).toEqual(["Example Motors"]);
    expect(store.all("sightings")[0]!.operatorId).toBe(ops[0]!.id);
  });
});
