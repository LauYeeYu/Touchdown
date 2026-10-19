// A small reference set and helpers for tests. Airports and airlines are real public facts; every
// flight, sighting and registration in the tests is made up.

import { RefIndex, Store, type RefTables } from "../src/index.ts";

export const refTables: RefTables = {
  airports: [
    { id: "ap_egll", icao: "EGLL", iata: "LHR", name: "London Heathrow", city: "London", country: "GB", lat: 51.4706, lon: -0.4619, elevationFt: 83, tz: "Europe/London" },
    { id: "ap_kjfk", icao: "KJFK", iata: "JFK", name: "John F. Kennedy International", city: "New York", country: "US", lat: 40.6398, lon: -73.7789, elevationFt: 13, tz: "America/New_York" },
    { id: "ap_kbos", icao: "KBOS", iata: "BOS", name: "Logan International", city: "Boston", country: "US", lat: 42.3643, lon: -71.0052, elevationFt: 20, tz: "America/New_York" },
    { id: "ap_ksea", icao: "KSEA", iata: "SEA", name: "Seattle-Tacoma International", city: "Seattle", country: "US", lat: 47.449, lon: -122.3093, elevationFt: 433, tz: "America/Los_Angeles" },
    { id: "ap_zspd", icao: "ZSPD", iata: "PVG", name: "Shanghai Pudong International", city: "Shanghai", country: "CN", lat: 31.1434, lon: 121.8052, elevationFt: 13, tz: "Asia/Shanghai" },
    { id: "ap_eddf", icao: "EDDF", iata: "FRA", name: "Frankfurt am Main", city: "Frankfurt", country: "DE", lat: 50.0333, lon: 8.5706, elevationFt: 364, tz: "Europe/Berlin" },
    { id: "ap_rjtt", icao: "RJTT", iata: "HND", name: "Tokyo Haneda", city: "Tokyo", country: "JP", lat: 35.5523, lon: 139.7798, elevationFt: 35, tz: "Asia/Tokyo" },
    { id: "ap_katl", icao: "KATL", iata: "ATL", name: "Hartsfield-Jackson Atlanta International", city: "Atlanta", country: "US", lat: 33.6367, lon: -84.4281, elevationFt: 1026, tz: "America/New_York" },
  ],
  operators: [
    { id: "op_dal", icao: "DAL", iata: "DL", name: "Delta Air Lines", callsign: "DELTA", country: "US", kind: "airline", validFrom: null, validTo: null },
    { id: "op_ual", icao: "UAL", iata: "UA", name: "United Airlines", callsign: "UNITED", country: "US", kind: "airline", validFrom: null, validTo: null },
    { id: "op_aal", icao: "AAL", iata: "AA", name: "American Airlines", callsign: "AMERICAN", country: "US", kind: "airline", validFrom: null, validTo: null },
    { id: "op_dlh", icao: "DLH", iata: "LH", name: "Lufthansa", callsign: "LUFTHANSA", country: "DE", kind: "airline", validFrom: null, validTo: null },
    { id: "op_baw", icao: "BAW", iata: "BA", name: "British Airways", callsign: "SPEEDBIRD", country: "GB", kind: "airline", validFrom: null, validTo: null },
    { id: "op_old", icao: "XXO", iata: "XO", name: "Old Carrier", callsign: null, country: "GB", kind: "airline", validFrom: "1990-01-01", validTo: "2005-12-31" },
    { id: "op_new", icao: "XXN", iata: "XO", name: "New Carrier", callsign: null, country: "FR", kind: "airline", validFrom: "2010-01-01", validTo: null },
    { id: "op_private", icao: null, iata: null, name: "Private owner", callsign: null, country: null, kind: "private", validFrom: null, validTo: null },
  ],
  aircraftTypes: [
    { designator: "A21N", manufacturer: "Airbus", name: "A321neo", familyId: "A320", engineType: "jet", engineCount: 2, wtc: "M" },
    { designator: "A321", manufacturer: "Airbus", name: "A321", familyId: "A320", engineType: "jet", engineCount: 2, wtc: "M" },
    { designator: "A319", manufacturer: "Airbus", name: "A319", familyId: "A320", engineType: "jet", engineCount: 2, wtc: "M" },
    { designator: "B738", manufacturer: "Boeing", name: "737-800", familyId: "B737", engineType: "jet", engineCount: 2, wtc: "M" },
    { designator: "B752", manufacturer: "Boeing", name: "757-200", familyId: "B757", engineType: "jet", engineCount: 2, wtc: "M" },
    { designator: "B77W", manufacturer: "Boeing", name: "777-300ER", familyId: "B777", engineType: "jet", engineCount: 2, wtc: "H" },
    { designator: "B788", manufacturer: "Boeing", name: "787-8", familyId: "B787", engineType: "jet", engineCount: 2, wtc: "H" },
    { designator: "A333", manufacturer: "Airbus", name: "A330-300", familyId: "A330", engineType: "jet", engineCount: 2, wtc: "H" },
    { designator: "E75L", manufacturer: "Embraer", name: "E175", familyId: "E175", engineType: "jet", engineCount: 2, wtc: "M" },
  ],
  families: [
    { id: "A320", name: "Airbus A320 family", manufacturer: "Airbus" },
    { id: "A330", name: "Airbus A330", manufacturer: "Airbus" },
    { id: "B737", name: "Boeing 737", manufacturer: "Boeing" },
    { id: "B757", name: "Boeing 757", manufacturer: "Boeing" },
    { id: "B777", name: "Boeing 777", manufacturer: "Boeing" },
    { id: "B787", name: "Boeing 787", manufacturer: "Boeing" },
    { id: "E175", name: "Embraer E175", manufacturer: "Embraer" },
  ],
  modelPatterns: [
    { designator: "A21N", pattern: "^A321-2[57]\\dNX?$", example: "A321-271NX" },
    { designator: "A321", pattern: "^A321-[12]\\d\\d$", example: "A321-211" },
    { designator: "A319", pattern: "^A319-1\\d\\d$", example: "A319-112" },
    { designator: "B738", pattern: "^737-8[0-9A-Z]{2}$", example: "737-8H4" },
    { designator: "B752", pattern: "^757-2[0-9A-Z]{2}$", example: "757-224" },
    { designator: "B77W", pattern: "^777-3[0-9A-Z]{2}\\(ER\\)$", example: "777-322(ER)" },
    { designator: "B788", pattern: "^787-8$", example: "787-8" },
    { designator: "A333", pattern: "^A330-3\\d\\d$", example: "A330-343" },
    { designator: "E75L", pattern: "^E175(LR|SU)?$", example: "E175LR" },
  ],
  registrationPrefixes: [
    { prefix: "N", country: "US", pattern: "^N[1-9][0-9A-HJ-NP-Z]{0,4}$" },
    { prefix: "B-", country: "CN", pattern: "^B-[0-9][0-9A-Z]{3}$" },
    { prefix: "B-", country: "TW", pattern: "^B-[0-9]{5}$" },
    { prefix: "B-H", country: "HK", pattern: "^B-[HKL][A-Z]{2}$" },
    { prefix: "D-", country: "DE", pattern: "^D-[A-Z]{4}$" },
    { prefix: "G-", country: "GB", pattern: "^G-[A-Z]{4}$" },
    { prefix: "JA", country: "JP", pattern: "^JA[0-9A-Z]{4}$" },
    { prefix: "C-", country: "CA", pattern: "^C-[FGI][A-Z]{3}$" },
  ],
};

export const ref = new RefIndex(refTables);

export function newStore(now = Date.UTC(2026, 0, 1)): Store {
  let t = now;
  return new Store({ deviceId: "dev_test", now: () => (t += 1000) });
}
