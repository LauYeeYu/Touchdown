// Private data apart (docs/32-modes-and-sharing.md, "Private data"; docs/12, "Schema migrations"): a log written
// before version 7 keeps ticket numbers in tables/flights.json and its history in tables/. Devices that open it, at the
// same time and with their reads and writes interleaved, move both, and end with the same log and nothing lost.

import { describe, expect, it } from "vitest";
import { reconcile, RefIndex, settleOlder, settlePrivate, stringifyTableFile, Store, toTableFile, FILE_TABLES, type TableName } from "@touchdown/core";
import { loadRefTables } from "@touchdown/refdata";
import { MemoryFolder } from "../src/index.ts";
import { conflicts, device, random, reopen, snapshot, testClock, versions, type Device } from "./helpers.ts";

const ref = new RefIndex(loadRefTables());
const encoder = new TextEncoder();
const decoder = new TextDecoder();
// Made-up ticket numbers.
const TICKETS = ["0009990000101/1", "0009990000102/1", "0009990000103/1"];

/** A folder as version 6 wrote it: every table in tables/, the flights holding their ticket numbers. */
async function oldFolder() {
  const folder = new MemoryFolder();
  const old = new Store({ deviceId: "dev_old", now: () => Date.parse("2025-06-01T00:00:00Z") });
  const flights = TICKETS.map((t, i) => old.insert("flights", { flightNumber: `XY${700 + i}`, scheduledDate: "2025-05-01", ticketNumber: t, bookingRef: `ZZ${i}AAA` }));
  for (const f of flights) old.insert("record_history", { tableName: "flights", recordId: f.id, recordRev: 1, row: { ...f }, changedAt: "2025-06-01T00:00:00Z", reason: "edit" });
  const tables = FILE_TABLES.filter((t) => t !== "flight_private");
  const manifest = { schema: "touchdown", schemaVersion: 6, backend: "json_tables", tables: Object.fromEntries(tables.map((t) => [t, `tables/${t}.json`])), lastWriter: "dev_old" };
  await folder.write("manifest.json", encoder.encode(JSON.stringify(manifest)));
  for (const t of ["flights", "record_history", "sync_conflicts"] as TableName[]) await folder.write(`tables/${t}.json`, encoder.encode(stringifyTableFile({ ...toTableFile(old, t), schemaVersion: 6 })));
  return { folder, flights };
}

/** Sync, then settle as the app does after each sync. */
async function rounds(devices: Device[], n = 4) {
  for (let i = 0; i < n; i++)
    for (const d of devices) {
      await d.engine.sync();
      reconcile(d.store, ref);
    }
}

describe("a log from before private data had its own place", () => {
  for (const seed of [1, 2, 3, 4, 5]) {
    it(`is moved by two devices opening it at once (run ${seed})`, async () => {
      const { folder, flights } = await oldFolder();
      const rnd = random(seed);
      folder.pause = async () => {
        for (let i = Math.floor(rnd() * 4); i > 0; i--) await Promise.resolve();
      };
      const clock = testClock();
      const [a, b] = await Promise.all([device(folder, "dev_a", clock.now), device(folder, "dev_b", clock.now)]);
      // Each reads the log and settles it as the app does when it opens.
      await Promise.all([a, b].map(async (d) => {
        await d.engine.sync();
        settlePrivate(d.store);
        reconcile(d.store, ref);
      }));
      clock.tick();
      await Promise.all([a.engine.sync(), b.engine.sync()]);
      folder.pause = async () => {};
      await rounds([a, b]);

      expect(snapshot(b.store)).toEqual(snapshot(a.store));
      expect(conflicts(a.store)).toEqual([]);
      for (const [i, f] of flights.entries()) {
        expect(a.store.get("flights", f.id)).toMatchObject({ ticketNumber: null, bookingRef: null });
        expect(a.store.get("flight_private", f.id)).toMatchObject({ ticketNumber: TICKETS[i], bookingRef: `ZZ${i}AAA` });
      }
      expect(a.store.all("flight_private")).toHaveLength(flights.length);
      // The history is kept, now in private/.
      expect(a.store.all("record_history").filter((h) => h.reason === "edit")).toHaveLength(flights.length);

      // In the storage: no ticket number in a file a link reads, the private tables in private/ only.
      const text = (path: string) => decoder.decode(folder.files.get(path)?.data ?? new Uint8Array());
      for (const t of TICKETS) expect(text("tables/flights.json")).not.toContain(t);
      for (const t of TICKETS) expect(text("private/flight_private.json")).toContain(t);
      expect(folder.files.has("tables/record_history.json")).toBe(false);
      expect(folder.files.has("tables/sync_conflicts.json")).toBe(false);
      expect(folder.files.has("private/record_history.json")).toBe(true);
      for (const path of folder.files.keys()) if (path.startsWith("tables/")) for (const t of TICKETS) expect(text(path), path).not.toContain(t);
      expect(a.engine.waiting).toBe(0);
      expect(b.engine.waiting).toBe(0);
    });
  }

  it("takes a ticket number a device not yet updated changed on the flight, after another device moved them", async () => {
    const { folder, flights } = await oldFolder();
    const clock = testClock();
    const a = await device(folder, "dev_a", clock.now);
    const b = await device(folder, "dev_b", clock.now);
    await rounds([b]);
    // Device b changes a ticket number as version 6 did, on the flight; it is queued, not sent yet.
    clock.tick();
    b.store.update("flights", flights[0]!.id, { ticketNumber: "0009990000199/1" });
    // Device a opens the log and moves everything.
    await a.engine.sync();
    settlePrivate(a.store);
    reconcile(a.store, ref);
    await a.engine.sync();
    // Device b updates: it settles what it holds on opening, then syncs.
    clock.tick();
    settlePrivate(b.store);
    await rounds([b, a]);
    expect(snapshot(b.store)).toEqual(snapshot(a.store));
    expect(a.store.get("flight_private", flights[0]!.id)).toMatchObject({ ticketNumber: "0009990000199/1" });
    expect(a.store.get("flights", flights[0]!.id)).toMatchObject({ ticketNumber: null });
    for (const f of flights.slice(1)) expect(a.store.get("flight_private", f.id)?.ticketNumber).toBeTruthy();
    // Both devices moved the first flight's ticket on their own: the later value is kept and the other listed.
    expect(conflicts(a.store).every((c) => c.tableName === "flight_private" && c.field === "ticketNumber")).toBe(true);
  });

  it("brings back nothing and sends nothing when a device opens the update on a copy from before other devices' edits", async () => {
    const { folder, flights } = await oldFolder();
    const clock = testClock();
    // Device b reads the log as version 6 left it, then is closed for a while.
    const b = await device(folder, "dev_b", clock.now);
    await b.engine.sync();
    // Meanwhile device a updates, moves the private values and edits a flight and its notes.
    const a = await device(folder, "dev_a", clock.now);
    const settle = (d: Device) => ({ settle: () => settleOlder(d.store) });
    await a.engine.sync(settle(a));
    reconcile(a.store, ref);
    clock.tick(60);
    a.store.update("flights", flights[0]!.id, { seat: "14C", notes: "Window seat." });
    a.store.update("flights", flights[1]!.id, { seat: "2A" });
    for (let i = 0; i < 3; i++) await a.engine.sync(settle(a));
    const stored = versions(folder);

    // Device b opens the update on the copy it kept: it reads the log first and settles after, as the app does.
    clock.tick(3600);
    const b2 = await reopen(folder, b, clock.now);
    for (let i = 0; i < 3; i++) {
      await b2.engine.sync(settle(b2));
      reconcile(b2.store, ref);
    }
    expect(b2.store.get("flights", flights[0]!.id)).toMatchObject({ seat: "14C", notes: "Window seat.", ticketNumber: null });
    expect(b2.store.get("flights", flights[1]!.id)).toMatchObject({ seat: "2A" });
    for (const [i, f] of flights.entries()) expect(b2.store.get("flight_private", f.id)).toMatchObject({ ticketNumber: TICKETS[i] });
    expect(conflicts(b2.store)).toEqual([]);
    expect(b2.engine.waiting).toBe(0);
    // Nothing was written: the log already had all of it.
    expect(versions(folder)).toEqual(stored);
    expect(snapshot(b2.store)).toEqual(snapshot(a.store));
  });

  it("never replaces a newer row in private/ with the one left in tables/", async () => {
    const { folder } = await oldFolder();
    const clock = testClock();
    const a = await device(folder, "dev_a", clock.now);
    await rounds([a]);
    const h = a.store.all("record_history")[0]!;
    clock.tick();
    a.store.update("record_history", h.id, { reason: "migration" });
    await rounds([a]);
    // An older device's copy of the history comes back to tables/, as if it had stopped half way through the move.
    const stale = new Store({ deviceId: "dev_old" });
    stale.load("record_history", [{ ...h }] as never);
    await folder.write("tables/record_history.json", encoder.encode(stringifyTableFile(toTableFile(stale, "record_history"))));
    const b = await device(folder, "dev_b", clock.now);
    await rounds([a, b]);
    expect(folder.files.has("tables/record_history.json")).toBe(false);
    expect(b.store.get("record_history", h.id)).toMatchObject({ reason: "migration" });
    expect(snapshot(b.store)).toEqual(snapshot(a.store));
  });
});
