import { describe, expect, it } from "vitest";
import { markMyFr24Export, parseSource, readCsv, saveFlight } from "../src/index.ts";
import { MYFR24_HEADER, myFr24Csv, myFr24Flights, myFr24States } from "../src/view/index.ts";
import { newStore, ref } from "./fixtures.ts";

function aLog() {
  const store = newStore();
  const full = saveFlight(store, ref, {
    scheduledDate: "2025-03-14",
    flightNumber: "DL9001",
    airlineRaw: "DL",
    fromRaw: "LHR",
    toRaw: "JFK",
    takeoffAt: "2025-03-14T10:40+00:00",
    landingAt: "2025-03-14T14:30-04:00",
    typeCodeRaw: "B77W",
    registrationRaw: "N901DX",
    seat: "23C",
    seatPosition: "aisle",
    cabinClass: "economy",
    reason: "leisure",
    notes: "-window blind stuck, so asked to move",
  }).row;
  const bare = saveFlight(store, ref, { scheduledDate: "2024-06-01", flightNumber: "BA9002", fromRaw: "BOS", toRaw: "SEA" }).row;
  return { store, full, bare };
}

describe("the myFR24 file", () => {
  it("is laid out as myFR24's own export: a blank first line, its 19 columns, a value with a space in quotes", () => {
    const { store } = aLog();
    const text = myFr24Csv(store, ref, myFr24Flights(store));
    const lines = text.split("\n");
    expect(lines[0]).toBe("");
    expect(lines[1]).toBe('Date,"Flight number",From,To,"Dep time","Arr time",Duration,Airline,Aircraft,Registration,"Seat number","Seat type","Flight class","Flight reason",Note,Dep_id,Arr_id,Airline_id,Aircraft_id');
    // Oldest first. A flight with only its date and airports gets myFR24's empty values.
    expect(lines[2]).toBe('2024-06-01,BA9002,"Boston / Logan International (BOS/KBOS)","Seattle / Seattle-Tacoma International (SEA/KSEA)",,,," (/)"," ()",,,0,0,0,,0,0,0,0');
    expect(lines[3]).toBe(
      '2025-03-14,DL9001,"London / Heathrow (LHR/EGLL)","New York / John F. Kennedy International (JFK/KJFK)",10:40:00,14:30:00,07:50:00,"Delta Air Lines (DL/DAL)","Boeing 777-300ER (B77W)",N901DX,23C,3,1,1,"\'-window blind stuck, so asked to move",0,0,0,0',
    );
    expect(lines.slice(4)).toEqual([""]);
  });

  it("reads back through the myFR24 import as the flights it came from", () => {
    const { store, full } = aLog();
    const parsed = parseSource(readCsv(myFr24Csv(store, ref, [full])), "flightdiary.csv", ref)!;
    expect(parsed.format).toBe("fr24_csv");
    expect(parsed.candidates[0]!.values).toMatchObject({
      scheduledDate: "2025-03-14",
      flightNumber: "DL9001",
      airlineId: "op_dal",
      fromAirportId: "ap_egll",
      toAirportId: "ap_kjfk",
      takeoffAt: "2025-03-14T10:40+00:00",
      landingAt: "2025-03-14T14:30-04:00",
      typeCode: "B77W",
      registration: "N901DX",
      seat: "23C",
      seatPosition: "aisle",
      cabinClass: "economy",
      reason: "leisure",
    });
    expect(parsed.candidates[0]!.issues).toEqual([]);
    expect(MYFR24_HEADER).toHaveLength(19);
  });

  it("can leave out the flights already in myFR24: imported from its export, or written to a file before", () => {
    const { store, full, bare } = aLog();
    const imported = saveFlight(store, ref, { scheduledDate: "2023-01-05", flightNumber: "UA9003", fromRaw: "JFK", toRaw: "SEA", sourceKind: "fr24_csv" }).row;
    expect(myFr24Flights(store).map((f) => f.id)).toEqual([imported.id, bare.id, full.id]);
    expect(myFr24Flights(store, true).map((f) => f.id)).toEqual([bare.id, full.id]);
    expect(markMyFr24Export(store, [bare.id], Date.UTC(2026, 10, 4, 9, 30))).toBe(1);
    expect(myFr24Flights(store, true).map((f) => f.id)).toEqual([full.id]);
    // A flight keeps the time of its first file.
    expect(markMyFr24Export(store, [bare.id, full.id], Date.UTC(2026, 10, 5))).toBe(1);
    expect(store.all("external_ids").filter((e) => e.ownerId === bare.id).map((e) => [e.system, e.key, e.value])).toEqual([["fr24", "exportedAt", "2026-11-04T09:30:00Z"]]);
    expect(myFr24Flights(store, true)).toEqual([]);
  });

  it("says how each flight got into myFR24, for the chooser: from its export, or sent in a file and when", () => {
    const { store, full, bare } = aLog();
    const imported = saveFlight(store, ref, { scheduledDate: "2023-01-05", flightNumber: "UA9003", fromRaw: "JFK", toRaw: "SEA", sourceKind: "fr24_csv" }).row;
    markMyFr24Export(store, [bare.id], Date.UTC(2026, 10, 4, 9, 30));
    const states = myFr24States(store);
    expect(states.get(imported.id)).toEqual({ kind: "imported" });
    expect(states.get(bare.id)).toEqual({ kind: "sent", at: "2026-11-04T09:30:00Z" });
    expect(states.has(full.id)).toBe(false);
  });

  it("keeps myFR24's own ids for a flight that came from its export", () => {
    const { store, full } = aLog();
    store.insert("external_ids", { ownerTable: "flights", ownerId: full.id, system: "fr24", key: "Dep_id", value: "122" });
    store.insert("external_ids", { ownerTable: "flights", ownerId: full.id, system: "fr24", key: "Airline_id", value: "45" });
    expect(myFr24Csv(store, ref, [full]).trimEnd().endsWith(",122,0,45,0")).toBe(true);
  });
});
