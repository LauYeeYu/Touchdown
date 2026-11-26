// Stamps (docs/24-statistics.md, "Stamps"): each earned by the record its rule names, on that record's day, and by no
// record that falls short of it. Every flight, sighting and registration here is made up.
import { describe, expect, it } from "vitest";
import { markStampsSeen, POPULAR_MAKERS, RefIndex, slugOf, type Airport, type AircraftType, type Flight, type Store } from "../src/index.ts";
import { FACTORIES, stamps, stampsIfFlown, stampsOf, stampsToPress, crossesDateLine, greatCircleMaxLat, shownStamps, type GrantedStamp, type Stamp } from "../src/view/index.ts";
import { newStore, refTables } from "./fixtures.ts";

const airport = (icao: string, iata: string, country: string, lat: number, lon: number, elevationFt: number, tz: string): Airport => ({ id: `ap_${icao.toLowerCase()}`, icao, iata, name: iata, city: iata, country, lat, lon, elevationFt, tz });
const type = (designator: string, manufacturer: string, familyId: string | null, engineCount = 2): AircraftType => ({ designator, manufacturer, name: designator, familyId, engineType: "jet", engineCount, wtc: "H", kind: "landplane" });

const ref = new RefIndex({
  ...refTables,
  airports: [
    ...refTables.airports,
    airport("YSSY", "SYD", "AU", -33.946, 151.177, 21, "Australia/Sydney"),
    airport("PHNL", "HNL", "US", 21.318, -157.922, 13, "Pacific/Honolulu"),
    airport("SLLP", "LPB", "BO", -16.513, -68.192, 13325, "America/La_Paz"),
    airport("EHAM", "AMS", "NL", 52.309, 4.764, -11, "Europe/Amsterdam"),
    airport("FAOR", "JNB", "ZA", -26.139, 28.246, 5558, "Africa/Johannesburg"),
    airport("SBGR", "GRU", "BR", -23.432, -46.469, 2459, "America/Sao_Paulo"),
    airport("VHHH", "HKG", "HK", 22.309, 113.915, 28, "Asia/Hong_Kong"),
    airport("VQPR", "PBH", "BT", 27.403, 89.425, 7332, "Asia/Thimphu"),
    airport("EGPR", "BRR", "GB", 57.023, -7.443, 5, "Europe/London"),
    airport("EGPA", "KOI", "GB", 58.958, -2.905, 50, "Europe/London"),
    airport("EGEW", "WRY", "GB", 59.35, -2.95, 29, "Europe/London"),
    airport("TNCM", "SXM", "SX", 18.041, -63.109, 13, "America/Lower_Princes"),
    airport("KPAE", "PAE", "US", 47.906, -122.282, 606, "America/Los_Angeles"),
    airport("KLGB", "LGB", "US", 33.818, -118.152, 60, "America/Los_Angeles"),
  ],
  aircraftTypes: [
    ...refTables.aircraftTypes,
    type("B744", "Boeing", "B747", 4),
    type("A388", "Airbus", "A380", 4),
    type("A346", "Airbus", "A340", 4),
    type("B752", "Boeing", "B757"),
    type("B753", "Boeing", "B757"),
    type("B38M", "Boeing", "B737"),
    type("B763", "Boeing", "B767"),
    type("B778", "Boeing", "B777"),
    type("B779", "Boeing", "B777"),
    type("A318", "Airbus", "A320"),
    type("A320", "Airbus", "A320"),
    type("CONC", "Aérospatiale-BAC", "Concorde", 4),
    type("B712", "Boeing", "B717"),
    type("MD11", "McDonnell Douglas", "MD11", 3),
  ],
});

const flight = (store: Store, v: Partial<Flight>) => store.insert("flights", { flightNumber: "XY1", ...v });
const of = (store: Store, opts = {}) => new Map(stamps(store, ref, { now: Date.UTC(2026, 6, 1), ...opts }).map((b) => [b.id, b]));
const earned = (b: Stamp | undefined) => b?.by?.id ?? null;

describe("stamps earned by one flight", () => {
  it("dates a stamp by the first flight that meets its rule, not a later one", () => {
    const store = newStore();
    const later = flight(store, { scheduledDate: "2025-08-01", typeCode: "B744", fromAirportId: "ap_egll", toAirportId: "ap_kjfk" });
    const first = flight(store, { scheduledDate: "2024-03-14", typeCode: "B744", fromAirportId: "ap_eddf", toAirportId: "ap_kjfk" });
    flight(store, { scheduledDate: "2023-01-01", typeCode: "B738", fromAirportId: "ap_egll", toAirportId: "ap_eddf" });
    const b = of(store).get("queen")!;
    expect(b.by).toEqual({ table: "flights", id: first.id, day: "2024-03-14" });
    expect(earned(of(store).get("superjumbo"))).toBeNull();
    expect(earned(of(store).get("fourEngines"))).toBe(first.id);
    expect(later.id).not.toBe(first.id);
  });

  it("gives the A340-600 and the 757 a stamp each, the 757's showing the one flown", () => {
    const store = newStore();
    expect(of(store).get("atariFerrari")!.emblem).toEqual({ kind: "type", code: "B752" });
    const pencil = flight(store, { scheduledDate: "2024-05-02", typeCode: "A346", fromAirportId: "ap_eddf", toAirportId: "ap_kjfk" });
    const ferrari = flight(store, { scheduledDate: "2024-06-09", typeCode: "B753", fromAirportId: "ap_kjfk", toAirportId: "ap_egll" });
    flight(store, { scheduledDate: "2024-07-01", typeCode: "B752", fromAirportId: "ap_egll", toAirportId: "ap_kjfk" });
    const got = of(store);
    expect(earned(got.get("flyingPencil"))).toBe(pencil.id);
    expect(earned(got.get("atariFerrari"))).toBe(ferrari.id);
    expect(got.get("atariFerrari")!.emblem).toEqual({ kind: "type", code: "B753" });
  });

  it("keeps Pride of Seattle for the Boeings designed there before 2001", () => {
    const store = newStore();
    const at = (day: string, typeCode: string) => flight(store, { scheduledDate: day, typeCode, fromAirportId: "ap_egll", toAirportId: "ap_kjfk" });
    at("2024-01-01", "B38M");
    at("2024-01-02", "B788");
    at("2024-01-03", "B712");
    expect(earned(of(store).get("prideOfSeattle"))).toBeNull();
    expect(earned(of(store).get("douglasInDisguise"))).not.toBeNull();
    const seattle = at("2024-01-04", "B763");
    at("2024-01-05", "B744");
    at("2024-01-06", "B752");
    expect(earned(of(store).get("prideOfSeattle"))).toBe(seattle.id);
    expect(of(store).get("prideOfSeattle")!.emblem).toEqual({ kind: "type", code: "B763" });
    expect(earned(of(store).get("worthTheWait"))).toBeNull();
    const late = at("2024-01-07", "B778");
    at("2024-01-08", "B779");
    const got = of(store);
    expect(earned(got.get("worthTheWait"))).toBe(late.id);
    expect(got.get("worthTheWait")!.emblem).toEqual({ kind: "type", code: "B778" });
  });

  it("counts a planned flight only once its time has passed, and says what it would earn", () => {
    const store = newStore();
    const planned = flight(store, { scheduledDate: "2026-12-14", planned: true, typeCode: "A388", fromAirportId: "ap_egll", toAirportId: "ap_yssy" });
    expect(earned(of(store).get("superjumbo"))).toBeNull();
    expect(stampsIfFlown(store, ref, planned, { now: Date.UTC(2026, 6, 1) }).map((b) => b.id)).toEqual(expect.arrayContaining(["superjumbo", "equator", "fourEngines"]));
    expect(earned(of(store, { now: Date.UTC(2026, 11, 16) }).get("superjumbo"))).toBe(planned.id);
  });

  it("reads the globe from the great circle between the airports", () => {
    const store = newStore();
    const south = flight(store, { scheduledDate: "2024-01-05", fromAirportId: "ap_egll", toAirportId: "ap_yssy" });
    const pacific = flight(store, { scheduledDate: "2024-02-05", fromAirportId: "ap_rjtt", toAirportId: "ap_phnl" });
    const polar = flight(store, { scheduledDate: "2024-03-05", fromAirportId: "ap_kjfk", toAirportId: "ap_zspd" });
    const b = of(store);
    expect(earned(b.get("equator"))).toBe(south.id);
    expect(earned(b.get("dateLine"))).toBe(pacific.id);
    expect(earned(b.get("arcticCircle"))).toBe(polar.id);
    expect(earned(b.get("ultraLongHaul"))).toBe(south.id);
    expect(crossesDateLine({ lon: 139.8 }, { lon: -73.8 })).toBe(true);
    expect(crossesDateLine({ lon: -0.5 }, { lon: -73.8 })).toBe(false);
    expect(greatCircleMaxLat({ lat: 51.47, lon: -0.46 }, { lat: 50.03, lon: 8.57 })).toBeLessThan(52);
  });

  it("lands on an earlier date only when the arrival's local date is before the departure's", () => {
    const store = newStore();
    // 00:30 in Tokyo on the 3rd is 15:30 UTC on the 2nd; landing 13 hours later is still the 2nd in New York.
    flight(store, { fromAirportId: "ap_rjtt", toAirportId: "ap_kjfk", takeoffAt: "2026-03-02T22:00+09:00", landingAt: "2026-03-02T20:20-05:00" });
    expect(earned(of(store).get("backToYesterday"))).toBeNull();
    const back = flight(store, { fromAirportId: "ap_rjtt", toAirportId: "ap_kjfk", takeoffAt: "2026-03-03T00:30+09:00", landingAt: "2026-03-02T23:50-05:00" });
    expect(earned(of(store).get("backToYesterday"))).toBe(back.id);
  });

  it("finds the red-eye and the flight in the air at New Year at either airport's time", () => {
    const store = newStore();
    flight(store, { fromAirportId: "ap_kjfk", toAirportId: "ap_egll", takeoffAt: "2025-06-01T23:00-04:00", landingAt: "2025-06-02T01:30+01:00" });
    expect(earned(of(store).get("redEye"))).toBeNull();
    const red = flight(store, { fromAirportId: "ap_kjfk", toAirportId: "ap_egll", takeoffAt: "2025-06-03T22:10-04:00", landingAt: "2025-06-04T09:55+01:00" });
    expect(earned(of(store).get("redEye"))).toBe(red.id);
    // Lands at 23:40 in London, but it is already the new year in Frankfurt, where it took off, at 23:00 London time.
    const ny = flight(store, { fromAirportId: "ap_eddf", toAirportId: "ap_egll", takeoffAt: "2025-12-31T23:50+01:00", landingAt: "2025-12-31T23:40+00:00" });
    flight(store, { fromAirportId: "ap_eddf", toAirportId: "ap_egll", takeoffAt: "2025-12-31T21:00+01:00", landingAt: "2025-12-31T21:30+00:00" });
    expect(earned(of(store).get("newYear"))).toBe(ny.id);
  });

  it("knows thin air, below sea level, short hops, diversions and the cabin", () => {
    const store = newStore();
    const high = flight(store, { scheduledDate: "2024-05-01", fromAirportId: "ap_sllp", toAirportId: "ap_sbgr" });
    const low = flight(store, { scheduledDate: "2024-05-02", fromAirportId: "ap_eham", toAirportId: "ap_egll" });
    const hop = flight(store, { scheduledDate: "2024-05-03", fromAirportId: "ap_egpa", toAirportId: "ap_egew" });
    const diverted = flight(store, { scheduledDate: "2024-05-04", fromAirportId: "ap_egll", toAirportId: "ap_kjfk", divertedToAirportId: "ap_kbos" });
    const front = flight(store, { scheduledDate: "2024-05-05", fromAirportId: "ap_egll", toAirportId: "ap_kjfk", cabinClass: "first" });
    const b = of(store);
    expect([earned(b.get("thinAir")), earned(b.get("belowSeaLevel")), earned(b.get("shortHop")), earned(b.get("planB")), earned(b.get("upFront"))]).toEqual([high.id, low.id, hop.id, diverted.id, front.id]);
    expect(b.has("patience")).toBe(false);
  });

  it("dates Kai Tak by the flight's day", () => {
    const store = newStore();
    flight(store, { scheduledDate: "1998-07-06", fromAirportId: "ap_egll", toAirportId: "ap_vhhh" });
    expect(earned(of(store).get("kaiTak"))).toBeNull();
    const old = flight(store, { scheduledDate: "1998-07-05", fromAirportId: "ap_vhhh", toAirportId: "ap_egll" });
    expect(earned(of(store).get("kaiTak"))).toBe(old.id);
  });
});

describe("stamps over several records", () => {
  it("earns Full family at the last of the four sizes, the neo counting", () => {
    const store = newStore();
    flight(store, { scheduledDate: "2020-01-01", typeCode: "A318" });
    flight(store, { scheduledDate: "2020-02-01", typeCode: "A319" });
    flight(store, { scheduledDate: "2020-03-01", typeCode: "A321" });
    expect(earned(of(store).get("fullFamily"))).toBeNull();
    expect(of(store).get("fullFamily")!.parts!.list.map((p) => !!p.by)).toEqual([true, true, false, true]);
    const last = flight(store, { scheduledDate: "2019-06-01", typeCode: "A20N" });
    expect(earned(of(store).get("fullFamily"))).not.toBe(last.id);
    expect(of(store).get("fullFamily")!.by!.day).toBe("2020-03-01");
  });

  it("earns Six continents at the flight that adds the sixth", () => {
    const store = newStore();
    flight(store, { scheduledDate: "2021-01-01", fromAirportId: "ap_egll", toAirportId: "ap_kjfk" });
    flight(store, { scheduledDate: "2021-02-01", fromAirportId: "ap_egll", toAirportId: "ap_faor" });
    flight(store, { scheduledDate: "2021-03-01", fromAirportId: "ap_vhhh", toAirportId: "ap_yssy" });
    expect(earned(of(store).get("sixContinents"))).toBeNull();
    const sixth = flight(store, { scheduledDate: "2021-04-01", fromAirportId: "ap_sbgr", toAirportId: "ap_kjfk" });
    expect(earned(of(store).get("sixContinents"))).toBe(sixth.id);
  });

  it("earns Old friend on the fifth flight on one aircraft and Both sides by the later record", () => {
    const store = newStore();
    const plane = store.insert("airframes", { typeCode: "A320" });
    const flights = [1, 2, 3, 4, 5, 6].map((m) => flight(store, { scheduledDate: `2022-0${m}-01`, airframeId: plane.id, typeCode: "A320" }));
    expect(earned(of(store).get("oldFriend"))).toBe(flights[4]!.id);
    const seen = store.insert("sightings", { seenOn: "2022-03-15", airframeId: plane.id, registration: "G-ZZZB" });
    expect(of(store).get("bothSides")!.by).toEqual({ table: "sightings", id: seen.id, day: "2022-03-15" });
    expect(of(store).get("bothSides")!.emblem).toEqual({ kind: "type", code: "A320" });
  });

  it("counts registers and a big day among the sightings", () => {
    const store = newStore();
    const regs = ["N123AB", "B-1234", "B-HKA", "D-ABCD", "G-ABCD", "JA801A", "C-FABC", "B-12345"];
    regs.forEach((registration, i) => store.insert("sightings", { seenOn: `2023-01-${String(i + 1).padStart(2, "0")}`, registration }));
    const registers = of(store).get("registers")!;
    expect(registers.by).toBeNull();
    expect(registers.levels!.have).toBe(8);
    for (let i = 0; i < 100; i++) store.insert("sightings", { seenOn: "2023-05-20", registration: `N${100 + i}AB` });
    expect(of(store).get("bigDay")!.by!.day).toBe("2023-05-20");
  });

  it("adds up the distance flown for Around the world", () => {
    const store = newStore();
    for (let i = 1; i <= 4; i++) flight(store, { scheduledDate: `2024-0${i}-01`, fromAirportId: "ap_egll", toAirportId: "ap_yssy" });
    const b = of(store);
    expect(b.get("aroundTheWorld")!.by!.day).toBe("2024-03-01");
    expect(earned(b.get("toTheMoon"))).toBeNull();
  });
});

describe("factory stamps", () => {
  it("has one for each popular maker of the aircraft types pages that has a factory airfield, and no other", () => {
    expect(FACTORIES.map((f) => slugOf(f.maker)).filter((slug) => !POPULAR_MAKERS.all.includes(slug))).toEqual([]);
    expect(stamps(newStore(), ref).filter((b) => b.factory).map((b) => b.id)).toEqual(["factory.boeing", "factory.mcdonnellDouglas", "factory.airbus", "factory.embraer", "factory.comac", "factory.bombardier", "factory.lockheed"]);
  });

  it("counts a sighting at a maker's site of an aircraft it built, while the site built them", () => {
    const store = newStore();
    store.insert("sightings", { seenOn: "2024-06-01", airportId: "ap_kpae", typeCode: "A320", registration: "N1001A" });
    expect(earned(of(store).get("factory.boeing"))).toBeNull();
    const boeing = store.insert("sightings", { seenOn: "2024-06-02", airportId: "ap_kpae", typeCode: "B77W", registration: "N1002A" });
    const b = of(store).get("factory.boeing")!;
    expect(b.by).toEqual({ table: "sightings", id: boeing.id, day: "2024-06-02" });
    expect(b.parts!.list.find((p) => p.key === "ap_kpae")!.by!.id).toBe(boeing.id);
    expect(b.emblem).toEqual({ kind: "airport", id: "ap_kpae" });
    // Long Beach built the 717 until 2006 and McDonnell Douglas's airliners until 2001.
    store.insert("sightings", { seenOn: "2010-05-01", airportId: "ap_klgb", typeCode: "MD11", registration: "N1003A" });
    expect(earned(of(store).get("factory.mcdonnellDouglas"))).toBeNull();
    const md = store.insert("sightings", { seenOn: "1995-05-01", airportId: "ap_klgb", typeCode: "MD11", registration: "N1004A" });
    expect(earned(of(store).get("factory.mcdonnellDouglas"))).toBe(md.id);
  });

  it("knows a test registration, and a flight on an aircraft photographed at its factory", () => {
    const store = newStore();
    store.insert("sightings", { seenOn: "2024-01-01", registration: "F-GKXA" });
    expect(earned(of(store).get("testRegistration"))).toBeNull();
    const test = store.insert("sightings", { seenOn: "2024-01-02", registration: "F-WWBA" });
    expect(earned(of(store).get("testRegistration"))).toBe(test.id);
    const plane = store.insert("airframes", { typeCode: "B77W" });
    const before = flight(store, { scheduledDate: "2023-05-01", airframeId: plane.id });
    store.insert("sightings", { seenOn: "2023-06-01", airportId: "ap_kpae", airframeId: plane.id, registration: "N1005A" });
    expect(earned(of(store).get("sawItBuilt"))).toBeNull();
    const after = flight(store, { scheduledDate: "2023-09-01", airframeId: plane.id });
    expect(earned(of(store).get("sawItBuilt"))).toBe(after.id);
    expect(before.id).not.toBe(after.id);
  });
});

describe("what is shown", () => {
  it("leaves a hidden stamp out until it is earned, and lists one not yet earned", () => {
    const store = newStore();
    const ids = () => shownStamps(stamps(store, ref)).map((b) => b.id);
    expect(ids()).toContain("superjumbo");
    expect(ids()).not.toContain("supersonic");
    const f = flight(store, { scheduledDate: "1999-08-01", typeCode: "CONC", fromAirportId: "ap_egll", toAirportId: "ap_kjfk" });
    expect(ids()).toContain("supersonic");
    expect(stampsOf(stamps(store, ref), f.id).map((b) => b.id)).toEqual(expect.arrayContaining(["supersonic", "fourEngines"]));
  });
});

describe("stamps the owner gives", () => {
  it("lists only those given, last, dated the day they were given, with no record", () => {
    const store = newStore();
    const granted = [
      { id: "translator", grantedAt: "2026-02-03T09:00:00Z" },
      { id: "alpha", grantedAt: "2025-11-20T18:30:00Z" },
      // An id the list no longer has is left out.
      { id: "gone", grantedAt: "2025-11-20T18:30:00Z" } as unknown as GrantedStamp,
    ] as GrantedStamp[];
    const list = stamps(store, ref, { granted });
    const given = list.filter((b) => b.group === "granted");
    expect(given.map((b) => b.id)).toEqual(["granted.alpha", "granted.translator"]);
    // Alpha user counts as hidden, so it is pressed onto the page the first time it is shown. The others do not.
    expect(given[0]).toMatchObject({ ink: "granted", hidden: true, by: { table: "granted", id: "alpha", day: "2025-11-20" } });
    expect(given[1]!.hidden).toBe(false);
    expect([...stampsToPress(store, list)]).toEqual(["granted.alpha"]);
    expect(list.at(-1)!.id).toBe("granted.translator");
    expect(stamps(store, ref).some((b) => b.group === "granted")).toBe(false);
  });
});

describe("the first press of a hidden stamp", () => {
  it("presses each hidden stamp earned once, until it is recorded as seen", () => {
    const store = newStore();
    flight(store, { scheduledDate: "1999-08-01", typeCode: "CONC", fromAirportId: "ap_egll", toAirportId: "ap_kjfk" });
    const press = () => [...stampsToPress(store, stamps(store, ref))];
    // Four engines is earned too, but it is not hidden.
    expect(press()).toEqual(["supersonic"]);
    expect(markStampsSeen(store, ["supersonic"], Date.UTC(2026, 10, 25))).toBe(1);
    expect(press()).toEqual([]);
    expect(markStampsSeen(store, ["supersonic"])).toBe(0);
    expect(store.all("stamps_seen")).toMatchObject([{ stampId: "supersonic", seenAt: "2026-11-25T00:00:00Z" }]);
  });
});
