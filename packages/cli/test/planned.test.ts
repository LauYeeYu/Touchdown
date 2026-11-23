// Planned flights from the command line (docs/34, "Reading"): listed and marked, never counted while still to come.
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { backupZip, RefIndex, saveFlight, Store } from "@touchdown/core";
import { loadRefTables } from "@touchdown/refdata";

// The command line keeps its files in data/private/; here, in a folder of the test's own.
const dir = mkdtempSync(join(tmpdir(), "touchdown-planned-"));
process.env.TOUCHDOWN_PRIVATE_DIR = dir;
const { flightCommand, flightsCommand } = await import("../src/records.ts");
const { statsCommand } = await import("../src/stats.ts");
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const LOG = join(dir, "log.zip");

// Made-up flights: one flown, one planned years ahead, one planned and due long ago.
beforeAll(() => {
  const ref = new RefIndex(loadRefTables());
  const store = new Store({ deviceId: "test" });
  saveFlight(store, ref, { scheduledDate: "2025-03-14", flightNumber: "BA9001", airlineRaw: "BA", fromRaw: "EGLL", toRaw: "KJFK", registrationRaw: "G-ZZZA" });
  const ahead = saveFlight(store, ref, { scheduledDate: "2099-06-01", flightNumber: "BA9002", airlineRaw: "BA", fromRaw: "EGLL", toRaw: "LFPG", departureScheduledAt: "2099-06-01T09:00+01:00" }).row;
  store.update("flights", ahead.id, { planned: true });
  const due = saveFlight(store, ref, { scheduledDate: "2025-05-02", flightNumber: "BA9003", airlineRaw: "BA", fromRaw: "LFPG", toRaw: "EGLL" }).row;
  store.update("flights", due.id, { planned: true });
  writeFileSync(LOG, backupZip(store));
});

class Exit extends Error {
  constructor(readonly code: number) {
    super(`exit ${code}`);
  }
}

async function run(command: (args: string[]) => Promise<void>, ...args: string[]) {
  const out: string[] = [];
  vi.spyOn(console, "log").mockImplementation((...a: unknown[]) => void out.push(a.join(" ")));
  vi.spyOn(console, "error").mockImplementation((...a: unknown[]) => void out.push(a.join(" ")));
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
  vi.restoreAllMocks();
  const text = out.join("\n");
  return { text, code, json: () => JSON.parse(text) };
}
afterEach(() => vi.restoreAllMocks());

describe("planned flights from the command line", () => {
  it("lists them marked, and counts only those whose time has passed", async () => {
    const all = (await run(flightsCommand, "--json")).json();
    expect(all.count).toBe(2);
    expect(all.flights.map((f: { flightNumber: string; status: string }) => `${f.flightNumber} ${f.status}`)).toEqual(["BA9002 upcoming", "BA9003 due", "BA9001 flown"]);
    const text = (await run(flightsCommand)).text;
    expect(text).toMatch(/LHR → CDG \(planned\)/);
    expect(text).toMatch(/CDG → LHR \(to confirm\)/);
  });

  it("lists only the planned ones, soonest first, with --planned", async () => {
    const planned = (await run(flightsCommand, "--planned", "--json")).json();
    expect(planned.flights.map((f: { flightNumber: string }) => f.flightNumber)).toEqual(["BA9003", "BA9002"]);
  });

  it("says which a flight is, and how to confirm one whose time has passed", async () => {
    expect((await run(flightCommand, "BA9002@2099-06-01")).text).toMatch(/Planned, still to come/);
    expect((await run(flightCommand, "BA9003@2025-05-02")).text).toMatch(/--clear planned/);
  });

  it("leaves a planned flight still to come out of the figures", async () => {
    const stats = (await run(statsCommand, "--year", "all", "--json")).json();
    expect(stats.flights.flights).toBe(2);
  });
});
