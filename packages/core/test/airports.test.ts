import { describe, expect, it } from "vitest";
import { applyFix, checkAll, logNeedsMoreAirports, nearestAirport, parsePosition, refOverridesOf, RefIndex, saveFlight, saveOwnAirport, saveSighting, type Airport } from "../src/index.ts";
import { newStore, refTables } from "./fixtures.ts";

// Airfields as the small-airfield table has them (real public facts); every flight and sighting here is made up.
const airfields: Airport[] = [
  { id: "ap_eglm", icao: "EGLM", iata: null, name: "White Waltham Airfield", city: "Maidenhead", country: "GB", lat: 51.5008, lon: -0.77444, elevationFt: 131, tz: "Europe/London" },
  { id: "ap_egtf", icao: "EGTF", iata: null, name: "Fairoaks Airport", city: "Chobham", country: "GB", lat: 51.3481, lon: -0.5589, elevationFt: 80, tz: "Europe/London" },
];
const farm = { code: "XFRM", name: "Example Farm Strip", city: "Exampleton", country: "GB", lat: 51.6, lon: -1.2, tz: "Europe/London" };

describe("positions", () => {
  it("read decimal degrees, with or without hemisphere letters", () => {
    expect(parsePosition("51.5008, -0.77444")).toEqual({ lat: 51.5008, lon: -0.77444 });
    expect(parsePosition("51.5008 -0.77444")).toEqual({ lat: 51.5008, lon: -0.77444 });
    expect(parsePosition("51.5008° N, 0.77444° W")).toEqual({ lat: 51.5008, lon: -0.77444 });
    expect(parsePosition("N51.5008 W0.77444")).toEqual({ lat: 51.5008, lon: -0.77444 });
    expect(parsePosition("33.9° S, 151.2° E")).toEqual({ lat: -33.9, lon: 151.2 });
  });

  it("read degrees, minutes and seconds, in the order the letters give", () => {
    expect(parsePosition(`51°30'03"N 0°46'28"W`)).toEqual({ lat: 51.50083, lon: -0.77444 });
    expect(parsePosition("51°30′03″N 0°46′28″W")).toEqual({ lat: 51.50083, lon: -0.77444 });
    expect(parsePosition(`0°46'28"W 51°30'03"N`)).toEqual({ lat: 51.50083, lon: -0.77444 });
  });

  it("refuse what is not a position", () => {
    for (const text of ["", "51.5", "51.5 0.7 3", "White Waltham", "91, 0", "10, 181", "51 N 52 S", "-51 N, 0 W", `51°75'N 0°W`]) expect(parsePosition(text), text).toBeNull();
  });
});

describe("airports beyond the tables shipped", () => {
  it("are added to the index later, under the user's own", () => {
    const store = newStore();
    const own = saveOwnAirport(store, new RefIndex(refTables), { ...farm, code: "EGLM", name: "My strip" }).row;
    const ref = new RefIndex(refTables, refOverridesOf(store));
    expect(ref.airportByCode("EGTF")).toBeNull();
    ref.addReferenceAirports(airfields);
    expect(ref.airportByCode("EGTF")?.name).toBe("Fairoaks Airport");
    // The user's own keeps the code: a reference airfield with the same code stays under it.
    expect(ref.airportByCode("EGLM")?.name).toBe("My strip");
    expect(ref.isOwnAirport(own.id)).toBe(true);
    // Without it, the reference airfield is back.
    ref.setUserOverrides({});
    expect(ref.airportByCode("EGLM")?.name).toBe("White Waltham Airfield");
    expect(ref.isOwnAirport(own.id)).toBe(false);
  });

  it("are needed by a log with a code or an id the index lacks", () => {
    const ref = new RefIndex(refTables);
    const store = newStore();
    saveFlight(store, ref, { scheduledDate: "2025-05-01", fromRaw: "LHR", toRaw: "JFK" });
    expect(logNeedsMoreAirports(store, ref)).toBe(false);
    saveSighting(store, ref, { seenOn: "2025-05-02", airportRaw: "EGTF", registrationRaw: "G-ABCD" });
    expect(logNeedsMoreAirports(store, ref)).toBe(true);
    ref.addReferenceAirports(airfields);
    // Saved before the airfields were loaded: the code is known now, the sighting not linked yet.
    expect(logNeedsMoreAirports(store, ref)).toBe(false);

    // Linked to an airfield, read by an index without the airfields.
    const linked = saveFlight(store, ref, { scheduledDate: "2025-05-03", fromRaw: "EGLM", toRaw: "LHR" }).row;
    expect(linked.fromAirportId).toBe("ap_eglm");
    const fresh = new RefIndex(refTables);
    expect(logNeedsMoreAirports(store, fresh)).toBe(true);
  });

  it("give the nearest airport for a position", () => {
    const ref = new RefIndex(refTables);
    ref.addReferenceAirports(airfields);
    expect(nearestAirport(ref, 51.49, -0.7)?.id).toBe("ap_eglm");
    expect(nearestAirport(ref, 40.7, -74)?.id).toBe("ap_kjfk");
  });
});

describe("the user's own airports", () => {
  it("link the records with their code, and get times a zone", () => {
    const ref = new RefIndex(refTables);
    const store = newStore();
    const a = saveFlight(store, ref, { scheduledDate: "2025-06-01", fromRaw: "xfrm", toRaw: "LHR" }).row;
    const b = saveSighting(store, ref, { seenOn: "2025-06-02", airportRaw: "XFRM", registrationRaw: "G-ABCD" }).row;
    const other = saveFlight(store, ref, { scheduledDate: "2025-06-03", fromRaw: "Farm", toRaw: "LHR" }).row;
    expect(checkAll(store, ref).filter((f) => f.ruleId === "V-AIRPORT-KNOWN")).toHaveLength(3);

    const r = saveOwnAirport(store, ref, farm, { raw: "Farm" });
    expect(r.row).toMatchObject({ icao: "XFRM", iata: null, name: "Example Farm Strip", tz: "Europe/London" });
    const id = r.row.id;
    expect(r.linked).toBe(3);
    expect(r.message).toBe("Saved XFRM and linked 3 entries to it.");
    expect(store.get("flights", a.id)?.fromAirportId).toBe(id);
    expect(store.get("sightings", b.id)?.airportId).toBe(id);
    expect(store.get("flights", other.id)?.fromAirportId).toBe(id);
    expect(store.all("record_history").map((h) => h.recordId).sort()).toEqual([a.id, b.id, other.id].sort());
    expect(checkAll(store, ref).filter((f) => f.ruleId === "V-AIRPORT-KNOWN")).toEqual([]);

    // A time at it is stored with its UTC offset now.
    const timed = saveFlight(store, ref, { scheduledDate: "2025-07-01", fromRaw: "XFRM", toRaw: "LHR", takeoffAt: "2025-07-01T10:00+01:00" }).row;
    expect(timed.fromAirportId).toBe(id);
  });

  it("change in place, by id or by code", () => {
    const ref = new RefIndex(refTables);
    const store = newStore();
    const first = saveOwnAirport(store, ref, farm).row;
    const again = saveOwnAirport(store, ref, { ...farm, name: "Example Farm" }, { id: first.id });
    expect(again.row.id).toBe(first.id);
    expect(again.message).toBe("Saved XFRM.");
    expect(ref.airportByCode("XFRM")?.name).toBe("Example Farm");
    expect(saveOwnAirport(store, ref, { ...farm, code: "xfrm", name: "Farm" }).row.id).toBe(first.id);
    expect(store.all("airport_overrides")).toHaveLength(1);

    // A new code for it: the old one no longer finds it.
    saveOwnAirport(store, ref, { ...farm, code: "XFRN" }, { id: first.id });
    expect(ref.airportByCode("XFRN")?.id).toBe(first.id);
    expect(ref.airportByCode("XFRM")).toBeNull();
    // A three-letter code is an IATA code.
    expect(saveOwnAirport(store, ref, { ...farm, code: "XFM" }).row).toMatchObject({ icao: null, iata: "XFM" });
  });

  it("are left out while they lack a position or a time zone", () => {
    const store = newStore();
    store.insert("airport_overrides", { icao: "XNOP", name: "No position", tz: "Europe/London" });
    store.insert("airport_overrides", { icao: "XNOZ", name: "No zone", lat: 51, lon: 0 });
    expect(refOverridesOf(store).airports).toEqual([]);
  });
});

describe("unknown airport codes", () => {
  it("offer to link the records once the code is known", () => {
    const ref = new RefIndex(refTables);
    const store = newStore();
    const a = saveFlight(store, ref, { scheduledDate: "2025-05-01", flightNumber: "G-ABCD", fromRaw: "EGTF", toRaw: "LHR" }).row;
    const b = saveFlight(store, ref, { scheduledDate: "2025-05-02", fromRaw: "LHR", toRaw: "egtf" }).row;
    const unknown = checkAll(store, ref).filter((f) => f.ruleId === "V-AIRPORT-KNOWN");
    expect(unknown.map((f) => f.fixes.length)).toEqual([0, 0]);
    expect(unknown[0]!.message).toContain("airport code EGTF is not known");

    ref.addReferenceAirports(airfields);
    const known = checkAll(store, ref).filter((f) => f.ruleId === "V-AIRPORT-KNOWN");
    expect(known).toHaveLength(2);
    expect(known[0]!.message).toContain("was not known when the entry was saved");
    // The same finding as before, so an earlier choice about it still holds.
    expect(known[0]!.fingerprint).toBe(unknown[0]!.fingerprint);
    const fix = known[0]!.fixes[0]!;
    expect(fix).toMatchObject({ field: "fromAirportId", value: "ap_egtf", airportCode: "EGTF", label: "Use Fairoaks Airport (EGTF)" });

    // One fix links every record with the code.
    expect(applyFix(store, ref, fix).message).toBe("Linked 2 entries to EGTF.");
    expect(store.get("flights", a.id)?.fromAirportId).toBe("ap_egtf");
    expect(store.get("flights", b.id)?.toAirportId).toBe("ap_egtf");
    expect(checkAll(store, ref).filter((f) => f.ruleId === "V-AIRPORT-KNOWN")).toEqual([]);
  });
});
