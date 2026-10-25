import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { backupZip, RefIndex, saveFlight, saveSighting, Store } from "@touchdown/core";
import { loadRefTables } from "@touchdown/refdata";

// The command line keeps its files in data/private/; here, in a folder of the test's own.
const dir = mkdtempSync(join(tmpdir(), "touchdown-read-"));
process.env.TOUCHDOWN_PRIVATE_DIR = dir;
const { flightCommand, flightsCommand, sessionsCommand, sightingsCommand } = await import("../src/records.ts");
const { aircraftCommand } = await import("../src/aircraft.ts");
const { airportCommand } = await import("../src/airport.ts");
const { statsCommand } = await import("../src/stats.ts");
const { importsCommand, issuesCommand } = await import("../src/issues.ts");
afterAll(() => rmSync(dir, { recursive: true, force: true }));

// Every flight number, registration, date and private value here is made up. The private values are canaries:
// no command may print them.
const TICKET = "0019990000001";
const BOOKING = "CNRY42";
const LOG = join(dir, "log.zip");

beforeAll(() => {
  const ref = new RefIndex(loadRefTables());
  const store = new Store({ deviceId: "test" });
  const ba = saveFlight(store, ref, { scheduledDate: "2025-03-14", flightNumber: "BA9001", airlineRaw: "BA", fromRaw: "EGLL", toRaw: "KJFK", takeoffAt: "2025-03-14T11:40+00:00", landingAt: "2025-03-14T14:35-04:00", registrationRaw: "G-ZZZA", typeCodeRaw: "B77W", seat: "14A", ticketNumber: TICKET, bookingRef: BOOKING }).row;
  // Fields changed on two devices: the seat, and the booking reference, whose values no command may print.
  const conflict = { tableName: "flights", recordId: ba.id, keptBy: "dev_a", keptAt: "2026-01-12T10:05:00Z", otherBy: "cli_b", otherAt: "2026-01-12T10:02:00Z", detectedAt: "2026-01-12T10:10:00Z" };
  store.insert("sync_conflicts", { ...conflict, field: "seat", keptValue: '"14A"', otherValue: '"12C"' });
  store.insert("sync_conflicts", { ...conflict, field: "bookingRef", keptValue: JSON.stringify(BOOKING), otherValue: JSON.stringify(`${BOOKING.slice(0, 5)}9`) });
  saveFlight(store, ref, { scheduledDate: "2025-04-02", flightNumber: "DL9002", airlineRaw: "DL", fromRaw: "KJFK", toRaw: "KBOS", registrationRaw: "N9001Z", typeCodeRaw: "A21N" });
  saveFlight(store, ref, { scheduledDate: "2026-01-10", flightNumber: "DL9003", airlineRaw: "DL", fromRaw: "KBOS", toRaw: "KJFK", registrationRaw: "N9001Z", typeCodeRaw: "A21N", notes: `ticket ${TICKET.slice(0, 4)}` });
  saveSighting(store, ref, { seenOn: "2025-03-14", airportRaw: "EGLL", registrationRaw: "G-ZZZB", typeCodeRaw: "A320", operatorRaw: "BAW", phase: "landing" });
  saveSighting(store, ref, { seenOn: "2026-01-10", airportRaw: "KBOS", registrationRaw: "N9001Z", typeCodeRaw: "A21N", operatorRaw: "DAL", phase: "taxiing" });
  saveSighting(store, ref, { seenOn: "2026-01-10", airportRaw: "KBOS", registrationRaw: "N9002Z", typeCodeRaw: "B739", operatorRaw: "QQQ" });
  store.insert("import_batches", { createdAt: "2026-01-11T09:00:00Z", sourceKind: "sheet", fileName: "made-up.csv", rowsRead: 3, rowsAccepted: 3, status: "committed" });
  writeFileSync(LOG, backupZip(store));
});

class Exit extends Error {
  constructor(readonly code: number) {
    super(`exit ${code}`);
  }
}

/** Run a command, catching what it prints and its exit status. */
async function run(command: (args: string[]) => Promise<void>, ...args: string[]) {
  const out: string[] = [];
  const log = vi.spyOn(console, "log").mockImplementation((...a: unknown[]) => void out.push(a.join(" ")));
  const err = vi.spyOn(console, "error").mockImplementation((...a: unknown[]) => void out.push(a.join(" ")));
  vi.spyOn(process, "exit").mockImplementation(((code: number) => {
    throw new Exit(code);
  }) as never);
  let code = 0;
  try {
    await command([...args, "--log", LOG]);
  } catch (e) {
    if (!(e instanceof Exit)) throw e;
    code = e.code;
  }
  log.mockRestore();
  err.mockRestore();
  const text = out.join("\n");
  return { text, code, json: () => JSON.parse(text) };
}
afterEach(() => vi.restoreAllMocks());

describe("reading the log from the command line", () => {
  it("lists flights with the Flights page's filters, newest first", async () => {
    const all = (await run(flightsCommand, "--json")).json();
    expect(all).toMatchObject({ ok: true, year: "all", count: 3 });
    expect(all.flights.map((f: { flightNumber: string }) => f.flightNumber)).toEqual(["DL9003", "DL9002", "BA9001"]);
    expect(all.flights[2]).toMatchObject({ from: { iata: "LHR" }, to: { iata: "JFK" }, registration: "G-ZZZA", seat: "14A", private: { ticketNumber: true, bookingRef: true } });
    expect((await run(flightsCommand, "--airline", "BA", "--json")).json().count).toBe(1);
    expect((await run(flightsCommand, "--airport", "BOS", "--json")).json().count).toBe(2);
    expect((await run(flightsCommand, "--year", "2025", "--json")).json().count).toBe(2);
    expect((await run(flightsCommand, "--search", "g-zzza", "--json")).json().count).toBe(1);
    expect(await run(flightsCommand, "--airline", "Nowhere Air Example")).toMatchObject({ code: 2 });
  });

  it("shows one flight by its number and day, and says which ones fit when the name is not enough", async () => {
    const one = (await run(flightCommand, "BA9001@2025-03-14", "--json")).json();
    expect(one.flight).toMatchObject({ flightNumber: "BA9001", date: "2025-03-14", takeoff: "2025-03-14T11:40+00:00" });
    const text = (await run(flightCommand, "BA9001@2025-03-14")).text;
    expect(text).toMatch(/Ticket number\s+recorded/);
    expect(text).toMatch(/Takeoff\s+11:40 Fri 14 Mar · UTC\+0/);
    expect(await run(flightCommand, "BA9001@2024-01-01")).toMatchObject({ code: 1 });
    expect(await run(flightCommand)).toMatchObject({ code: 2 });
  });

  it("lists sightings and days out", async () => {
    expect((await run(sightingsCommand, "--json")).json()).toMatchObject({ count: 3, aircraft: 3, airports: 2 });
    expect((await run(sightingsCommand, "--airport", "KBOS", "--json")).json().count).toBe(2);
    const days = (await run(sessionsCommand, "--json")).json();
    expect(days.sessions.map((s: { date: string; sightings: number }) => [s.date, s.sightings])).toEqual([
      ["2026-01-10", 2],
      ["2025-03-14", 1],
    ]);
  });

  it("lists aircraft and shows one with its timeline", async () => {
    const list = (await run(aircraftCommand, "--json")).json();
    expect(list.aircraft.find((a: { registration: string }) => a.registration === "N9001Z")).toMatchObject({ flights: 2, sightings: 1 });
    expect((await run(aircraftCommand, "--both", "--json")).json().count).toBe(1);
    const one = (await run(aircraftCommand, "N9001Z", "--json")).json();
    expect(one.timeline.map((e: { kind: string }) => e.kind)).toEqual(["flight", "flight", "sighting"]);
  });

  it("shows an airport's visits and the aircraft photographed there", async () => {
    const bos = (await run(airportCommand, "BOS", "--year", "all", "--json")).json();
    expect(bos).toMatchObject({ departures: 1, landings: 1, transits: 0 });
    expect(bos.spotted.map((s: { registration: string }) => s.registration).sort()).toEqual(["N9001Z", "N9002Z"]);
    expect(await run(airportCommand, "EDDF", "--year", "all")).toMatchObject({ code: 1 });
  });

  it("gives Home's sentence and the Statistics page's figures, and a pivot", async () => {
    const s = (await run(statsCommand, "--year", "all", "--json")).json();
    expect(s.summary.sentence).toMatch(/^Since you started logging in 2025, you have flown 3 flights, .* on 2 aircraft, and spotted 3 aircraft at 2 airports\. You flew on 1 of the aircraft you photographed\.$/);
    expect(s.flights.ranked.airlines.items[0]).toMatchObject({ label: "Delta Air Lines", count: 2 });
    expect(s.both.flownAndPhotographed).toBe(1);
    const p = (await run(statsCommand, "--by", "airline", "--cols", "year", "--year", "all", "--json")).json();
    expect(p.rows.map((r: { label: string; total: number }) => [r.label, r.total])).toEqual([
      ["Delta Air Lines", 2],
      ["British Airways", 1],
    ]);
    expect(await run(statsCommand, "--by", "phase")).toMatchObject({ code: 2 });
  });

  it("lists open findings with their ids and fixes, and the imports", async () => {
    const issues = (await run(issuesCommand, "--json")).json();
    expect(issues.open.changedOnTwoDevices).toBe(2);
    expect(issues.changedOnTwoDevices).toMatchObject([
      { field: "seat", private: false, inLog: "14A", other: "12C", recordLabel: expect.stringContaining("BA9001") },
      { field: "bookingRef", private: true, inLog: null, other: null },
    ]);
    const known = issues.groups.find((g: { rule: string }) => g.rule === "V-OPERATOR-KNOWN");
    expect(known.findings[0]).toMatchObject({ severity: "error", recordLabels: ["sighting N9002Z at KBOS on 2026-01-10"] });
    expect(known.findings[0].id).toMatch(/^[0-9a-f]{8}$/);
    expect((await run(importsCommand, "--json")).json().imports).toMatchObject([{ file: "made-up.csv", rowsImported: 3, status: "committed" }]);
  });

  it("never prints a ticket number or a booking reference", async () => {
    const runs = [
      [flightsCommand],
      [flightCommand, "BA9001@2025-03-14"],
      [sightingsCommand],
      [sessionsCommand],
      [aircraftCommand],
      [aircraftCommand, "G-ZZZA"],
      [airportCommand, "LHR", "--year", "all"],
      [statsCommand, "--year", "all"],
      [statsCommand, "--by", "airline", "--year", "all"],
      [issuesCommand, "--severity", "all"],
      [issuesCommand, "--accepted"],
      [importsCommand],
    ] as [(args: string[]) => Promise<void>, ...string[]][];
    for (const [command, ...args] of runs) {
      for (const form of [[], ["--json"]]) {
        const { text } = await run(command, ...args, ...form);
        expect(text).not.toContain(TICKET);
        expect(text).not.toContain(BOOKING);
        expect(text).not.toContain(`${BOOKING.slice(0, 5)}9`);
      }
    }
  });
});
