// Daily copies in the user's storage (docs/12, "Daily copies"). Made-up flights in an in-memory folder.

import { describe, expect, it } from "vitest";
import { addDays, attachTrack, readBackup, Store } from "@touchdown/core";
import { JsonTablesBackend, listDailyCopies, makeDailyCopy, MemoryFolder } from "../src/index.ts";

async function setup() {
  const folder = new MemoryFolder();
  const backend = new JsonTablesBackend(folder, "dev_a");
  await backend.open();
  const store = new Store({ deviceId: "dev_a" });
  return { folder, backend, store };
}

describe("daily copies", () => {
  it("are made once a day, of the whole log, and only when it changed", async () => {
    const { backend, store } = await setup();
    expect((await makeDailyCopy(backend, store, "2026-11-01")).made).toBeNull();

    const f = store.insert("flights", { flightNumber: "XY1", scheduledDate: "2026-10-30", fromRaw: "BOS", toRaw: "SEA" });
    attachTrack(store, f.id, [{ t: 1, lat: 42, lon: -71, altitudeFt: 0, groundSpeedKt: 0, headingDeg: 0 }, { t: 61, lat: 42.1, lon: -71.1, altitudeFt: 900, groundSpeedKt: 150, headingDeg: 0 }], { provider: "fr24_csv", attribution: "test", coverage: "partial" });
    const first = await makeDailyCopy(backend, store, "2026-11-01");
    expect(first.made).toMatch(/^touchdown-backup-2026-11-01-[0-9a-f]{8}\.zip$/);
    // The copy is a backup like any other: every table, the track's positions included.
    const back = readBackup((await backend.readFile("backups", first.made!))!);
    expect(back.problems).toEqual([]);
    expect(back.tables.get("flights")).toHaveLength(1);
    expect(back.tables.get("track_points")).toHaveLength(2);

    // Today has one; tomorrow, nothing changed, none.
    store.update("flights", f.id, { seat: "1A" });
    expect((await makeDailyCopy(backend, store, "2026-11-01")).made).toBeNull();
    store.update("flights", f.id, { seat: null });
    // The seat set and cleared again is a new version of the row: the log changed.
    expect((await makeDailyCopy(backend, store, "2026-11-02")).made).not.toBeNull();
    expect((await makeDailyCopy(backend, store, "2026-11-03")).made).toBeNull();
    expect((await listDailyCopies(backend)).map((c) => c.day)).toEqual(["2026-11-02", "2026-11-01"]);
  });

  it("remove the copies no longer kept, and leave other files in the directory", async () => {
    const { backend, store } = await setup();
    const f = store.insert("flights", { flightNumber: "XY1", scheduledDate: "2026-01-01" });
    await backend.writeFile("backups", "notes.txt", new TextEncoder().encode("mine"));
    let day = "2026-01-01";
    for (let i = 0; i < 120; i++, day = addDays(day, 1)) {
      store.update("flights", f.id, { notes: `day ${i}` });
      await makeDailyCopy(backend, store, day);
    }
    const days = (await listDailyCopies(backend)).map((c) => c.day);
    expect(days.length).toBeLessThan(25);
    // The log as it was at the end of January, and today's.
    expect(days).toContain("2026-01-31");
    expect(days).toContain(addDays(day, -1));
    expect((await backend.listFiles("backups")).map((x) => x.name)).toContain("notes.txt");
  });
});
