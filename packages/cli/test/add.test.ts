import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { commitImport, matchCandidates, readInbox, RefIndex, SCHEMA_VERSION, Store } from "@touchdown/core";
import { JsonTablesBackend, MemoryFolder } from "@touchdown/storage";
import { refTables } from "../../core/test/fixtures.ts";
import { addFile, checkRecords, waitingIn } from "../src/add.ts";
import { NodeFolder } from "../src/folder.ts";
import { inboxPlace, writeInboxFile } from "../src/log.ts";
import { NoLog, openStorage, readLog } from "../src/storage.ts";

// Every flight, registration and date here is made up.
const TODAY = "2026-10-24";
const NOW = "2026-10-24T10:00Z";
const choice = { kind: "folder" as const, path: "/made-up" };

/** A log in a folder held in memory, as the web app would have synced it. */
async function syncedLog(rows: (store: Store) => void) {
  const store = new Store({ deviceId: "web" });
  rows(store);
  const files = new MemoryFolder();
  const backend = new JsonTablesBackend(files, "web");
  await backend.open();
  const tables = ["flights", "sightings", "operator_overrides"] as const;
  await backend.push(tables.flatMap((table) => store.all(table).map((row) => ({ table, row: row as Record<string, unknown>, replaces: [] }))));
  return files;
}

describe("the input of touchdown add", () => {
  it("becomes an inbox file: sightings in the spotting session's form, flights in the column mapping's", () => {
    const r = addFile(
      {
        flights: [{ date: "2026-10-18", flightNumber: "BA117", from: "EGLL", to: "KJFK", takeoff: "11:40", seat: 31, sources: { seat: "claude" } }],
        sightings: [{ date: "2026-10-20", registration: "G-ABCD", airport: "EGLL", airline: "BAW", phase: "Taking off", sources: { airline: "fr24" } }],
      },
      NOW,
    );
    if ("error" in r) throw new Error(r.error);
    expect(r.file).toMatchObject({ schema: "touchdown-inbox", version: 2, checker: null });
    expect(r.file.sightings[0]).toEqual({ values: { date: "2026-10-20", registration: "G-ABCD", airport: "EGLL", operator: "BAW", phase: "taking_off" }, sources: { operator: "fr24" }, open: [], missing: [], aircraft: null });
    expect(r.file.flights![0]).toEqual({ values: { date: "2026-10-18", flightNumber: "BA117", from: "EGLL", to: "KJFK", takeoff: "11:40", seat: "31" }, sources: { seat: "claude" }, open: [] });
  });

  it("refuses private fields, unknown fields, other date forms and unknown phases", () => {
    const err = (json: unknown) => {
      const r = addFile(json, NOW);
      return "error" in r ? r.error : null;
    };
    expect(err({ flights: [{ flightNumber: "BA117", ticketNumber: "0" }] })).toMatch(/private; add them in the web app/);
    expect(err({ flights: [{ flightNumber: "BA117", bookingRef: "X" }] })).toMatch(/private/);
    expect(err({ sightings: [{ registration: "G-ABCD", colour: "red" }] })).toMatch(/unknown field "colour"/);
    expect(err({ sightings: [{ registration: "G-ABCD", date: "20/10/2026" }] })).toMatch(/YYYY-MM-DD/);
    expect(err({ sightings: [{ registration: "G-ABCD", phase: "flying" }] })).toMatch(/phase "flying"/);
    expect(err({ sightings: [{ date: "2026-10-20" }] })).toMatch(/registration/);
    expect(err({ flights: [{ date: "2026-10-20" }] })).toMatch(/flight number, a route/);
    expect(err({ flight: [] })).toMatch(/Unexpected keys/);
    expect(err({ flights: [] })).toMatch(/no flights or sightings/);
    expect(err([])).toMatch(/JSON object/);
  });
});

describe("checking what is added", () => {
  const ref = () => new RefIndex(refTables);

  it("reports each record against the log: new, already there, and the rules' errors", async () => {
    const files = await syncedLog((s) => s.insert("sightings", { registrationRaw: "G-ABCD", registration: "G-ABCD", seenOn: "2026-10-20", airportRaw: "EGLL", airportId: "ap_egll", sourceKind: "manual" } as never));
    const r = ref();
    const { store } = await readLog(await openStorage(choice, files), r);
    const made = addFile(
      {
        sightings: [
          { date: "2026-10-20", registration: "G-ABCD", airport: "EGLL" },
          { date: "2026-10-21", registration: "G-ABCE", airport: "ZZZZ" },
        ],
        flights: [{ date: "2026-10-18", flightNumber: "BA117", airline: "BAW", from: "EGLL", to: "KJFK", takeoff: "11:40", landing: "14:35" }],
      },
      NOW,
    );
    if ("error" in made) throw new Error(made.error);
    const report = checkRecords(made.file, store, r, TODAY);
    if ("error" in report) throw new Error(report.error);
    expect(report.map((x) => [x.kind, x.n, x.status])).toEqual([
      ["sighting", 1, "identical"],
      ["sighting", 2, "new"],
      ["flight", 1, "new"],
    ]);
    expect(report[1]!.problems).toContainEqual({ severity: "error", rule: "V-AIRPORT-KNOWN", message: expect.stringContaining("ZZZZ") });
    expect(report[2]!.problems.filter((p) => p.severity === "error")).toEqual([]);
    expect(report[2]!.read).toMatchObject({ from: "LHR", to: "JFK", takeoff: "2026-10-18T11:40+01:00", landing: "2026-10-18T14:35-04:00", airlineName: "British Airways" });
  });

  it("finds overlapping flights with the log, which only a check over the whole log can", async () => {
    const files = await syncedLog((s) =>
      s.insert("flights", { scheduledDate: "2026-10-18", flightNumber: "DL1", fromRaw: "KJFK", toRaw: "KATL", fromAirportId: "ap_kjfk", toAirportId: "ap_katl", takeoffAt: "2026-10-18T12:00-04:00", landingAt: "2026-10-18T14:30-04:00", sourceKind: "manual" } as never),
    );
    const r = ref();
    const { store } = await readLog(await openStorage(choice, files), r);
    const made = addFile({ flights: [{ date: "2026-10-18", flightNumber: "UA2", from: "KBOS", to: "KJFK", takeoff: "12:30", landing: "13:40" }] }, NOW);
    if ("error" in made) throw new Error(made.error);
    const report = checkRecords(made.file, store, r, TODAY);
    if ("error" in report) throw new Error(report.error);
    expect(report[0]!.problems.map((p) => p.rule)).toContain("C-FLIGHT-OVERLAP");
  });

  it("goes to the storage's inbox, reads back, is left out when added again, and imports as the web app would", async () => {
    const files = await syncedLog(() => undefined);
    const r = ref();
    const storage = await openStorage(choice, files);
    const place = inboxPlace(storage);
    const made = addFile({ sightings: [{ date: "2026-10-20", registration: "G-ABCD", airport: "EGLL", airline: "BAW" }] }, NOW);
    if ("error" in made) throw new Error(made.error);
    await writeInboxFile(place, "add-2026-10-24-100000.json", made.file, r);
    expect(await place.list()).toEqual(["add-2026-10-24-100000.json"]);
    expect([...files.files.keys()]).toContain("inbox/add-2026-10-24-100000.json");

    const again = checkRecords(made.file, (await readLog(storage, r)).store, r, TODAY, await waitingIn(place, r));
    if ("error" in again) throw new Error(again.error);
    expect(again[0]).toMatchObject({ status: "waiting", statusText: "already waiting in the inbox (add-2026-10-24-100000.json), left out" });

    // The web app's side: read the file from the inbox and import it.
    const data = (await storage.backend.readFile("inbox", "add-2026-10-24-100000.json"))!;
    const read = readInbox(JSON.parse(new TextDecoder().decode(data)), "add-2026-10-24-100000.json", r);
    if ("error" in read) throw new Error(read.error);
    const web = new Store({ deviceId: "web" });
    expect(commitImport(web, r, read.source, matchCandidates(web, read.source.candidates)).created).toBe(1);
    expect(web.all("sightings")[0]).toMatchObject({ registration: "G-ABCD", seenOn: "2026-10-20", airportId: "ap_egll", operatorId: "op_baw", sourceKind: "manual" });
  });
});

describe("the storage the CLI reads", () => {
  it("must hold a log it can read, and is never written by reading", async () => {
    await expect(openStorage(choice, new MemoryFolder())).rejects.toBeInstanceOf(NoLog);
    const newer = new MemoryFolder();
    await newer.write("manifest.json", new TextEncoder().encode(JSON.stringify({ schema: "touchdown", backend: "json_tables", schemaVersion: SCHEMA_VERSION + 1 })));
    await expect(openStorage(choice, newer)).rejects.toThrow(/reads up to/);
    const files = await syncedLog((s) => s.insert("sightings", { registrationRaw: "G-ABCD", registration: "G-ABCD", sourceKind: "manual" } as never));
    const before = new Map([...files.files].map(([k, v]) => [k, v.version]));
    const { store } = await readLog(await openStorage(choice, files), new RefIndex(refTables));
    expect(store.all("sightings")).toHaveLength(1);
    expect(new Map([...files.files].map(([k, v]) => [k, v.version]))).toEqual(before);
  });
});

describe("a folder on this computer", () => {
  const dir = mkdtempSync(join(tmpdir(), "touchdown-folder-"));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it("reads, writes, lists and removes files, and stays inside the folder", async () => {
    const f = new NodeFolder(dir);
    expect(await f.list("inbox")).toEqual([]);
    expect(await f.read("inbox/a.json")).toBeNull();
    const { version } = await f.write("inbox/a.json", new TextEncoder().encode("{}"));
    expect(await f.list("inbox")).toEqual([{ name: "a.json", version }]);
    expect(new TextDecoder().decode((await f.read("inbox/a.json"))!.data)).toBe("{}");
    await f.remove("inbox/a.json");
    expect(await f.list("inbox")).toEqual([]);
    await expect(f.read("../outside.json")).rejects.toThrow(/Not a path in the Touchdown folder/);
  });
});
