import { describe, expect, it } from "vitest";
import { SCHEMA_VERSION, Store, TABLES, type TableName } from "@touchdown/core";
import { JsonTablesBackend, MemoryFolder, MemorySyncState, SchemaTooNewError, SyncEngine, type StoredRow } from "../src/index.ts";
import { conflicts, device, FLIGHTS, race, settle, snapshot, testClock } from "./helpers.ts";

describe("sync between devices", () => {
  it("sends a log to empty storage and brings it to another device", async () => {
    const clock = testClock();
    const folder = new MemoryFolder();
    const a = await device(folder, "dev_a", clock.now);
    const b = await device(folder, "dev_b", clock.now);
    const f = a.store.insert("flights", { flightNumber: "XY100" });
    const tr = a.store.insert("tracks", { flightId: f.id, provider: "adsblol" });
    a.store.putRaw("track_points", [
      { trackId: tr.id, seq: 0, t: 0, lat: 51.47, lon: -0.45, altitudeFt: null, groundSpeedKt: null, headingDeg: null },
      { trackId: tr.id, seq: 1, t: 60, lat: 51.5, lon: -0.3, altitudeFt: 3000, groundSpeedKt: 180, headingDeg: 90 },
    ] as never);

    await settle([a, b]);

    expect(snapshot(b.store)).toEqual(snapshot(a.store));
    expect(b.store.get("flights", f.id)?.flightNumber).toBe("XY100");
    expect(b.store.all("track_points")).toHaveLength(2);
    expect(folder.files.has(FLIGHTS)).toBe(true);
    expect(folder.files.has(`tracks/${tr.id}.json`)).toBe(true);
    expect(a.engine.waiting).toBe(0);
    expect(b.engine.waiting).toBe(0);
  });

  it("brings edits and deletions to the other device", async () => {
    const clock = testClock();
    const folder = new MemoryFolder();
    const a = await device(folder, "dev_a", clock.now);
    const b = await device(folder, "dev_b", clock.now);
    const f = a.store.insert("flights", { flightNumber: "XY100" });
    const g = a.store.insert("flights", { flightNumber: "XY200" });
    await settle([a, b]);

    clock.tick();
    b.store.update("flights", f.id, { seat: "12A" });
    b.store.remove("flights", g.id);
    await settle([b, a]);

    expect(a.store.get("flights", f.id)?.seat).toBe("12A");
    expect(a.store.get("flights", g.id)).toBeNull();
    expect(snapshot(a.store)).toEqual(snapshot(b.store));
    expect(conflicts(a.store)).toHaveLength(0);
  });

  it("keeps the later of two edits to one row everywhere and lists the other for review", async () => {
    const clock = testClock();
    const folder = new MemoryFolder();
    const a = await device(folder, "dev_a", clock.now);
    const b = await device(folder, "dev_b", clock.now);
    const f = a.store.insert("flights", { flightNumber: "XY100" });
    await settle([a, b]);

    clock.tick();
    a.store.update("flights", f.id, { seat: "1A" });
    clock.tick();
    b.store.update("flights", f.id, { seat: "2B" });
    await settle([a, b]);

    expect(a.store.get("flights", f.id)?.seat).toBe("2B");
    expect(snapshot(a.store)).toEqual(snapshot(b.store));
    const kept = conflicts(a.store);
    expect(kept).toHaveLength(1);
    expect((kept[0]!.row as StoredRow).seat).toBe("1A");
  });

  it("sends a write again when another device's stale write overwrote it", async () => {
    const clock = testClock();
    const folder = new MemoryFolder();
    const a = await device(folder, "dev_a", clock.now);
    const b = await device(folder, "dev_b", clock.now);
    const f = a.store.insert("flights", { flightNumber: "XY100" });
    await settle([a, b]);
    const before = folder.files.get(FLIGHTS)!.data;

    clock.tick();
    a.store.update("flights", f.id, { seat: "3C" });
    await a.engine.sync();
    // A device that read the file before A's write now writes its copy back.
    await folder.write(FLIGHTS, before);
    await settle([a, b]);

    expect(b.store.get("flights", f.id)?.seat).toBe("3C");
    expect(conflicts(a.store)).toHaveLength(0);
  });

  it("finds a local edit whose queue entry was lost when it reads every table again", async () => {
    const clock = testClock();
    const folder = new MemoryFolder();
    const a = await device(folder, "dev_a", clock.now);
    const f = a.store.insert("flights", { flightNumber: "XY100" });
    await settle([a]);
    a.engine.stop();

    // The browser closed before the queue was saved: the edit is in the local copy only.
    clock.tick();
    const reopened = new Store({ deviceId: "dev_a", now: clock.now });
    for (const t of Object.keys(TABLES) as TableName[]) reopened.load(t, a.store.allWithDeleted(t) as never);
    reopened.load("flights", [{ ...a.store.peek("flights", f.id)!, seat: "4D", rev: 2, updatedAt: "2026-01-01T00:00:01Z" }] as never);
    const engine = new SyncEngine(reopened, new JsonTablesBackend(folder, "dev_a"), new MemorySyncState(), clock.now);
    await engine.start();
    await engine.sync({ full: true });
    await engine.sync();

    const b = await device(folder, "dev_b", clock.now);
    await settle([b]);
    expect(b.store.get("flights", f.id)?.seat).toBe("4D");
  });
});

describe("storage files", () => {
  it("leaves an invalid table file alone and reports it", async () => {
    const clock = testClock();
    const folder = new MemoryFolder();
    const a = await device(folder, "dev_a", clock.now);
    a.store.insert("flights", { flightNumber: "XY100" });
    await folder.write(FLIGHTS, new TextEncoder().encode("{ not json"));

    const report = await a.engine.sync();

    expect(report.problems.join(" ")).toMatch(/flights\.json/);
    expect(new TextDecoder().decode(folder.files.get(FLIGHTS)!.data)).toBe("{ not json");
    expect(a.store.all("flights")).toHaveLength(1);
    expect(a.engine.waiting).toBeGreaterThan(0);
  });

  it("refuses a log written by a newer version of the app", async () => {
    const folder = new MemoryFolder();
    await folder.write("manifest.json", new TextEncoder().encode(JSON.stringify({ schema: "touchdown", schemaVersion: SCHEMA_VERSION + 1, backend: "json_tables", tables: {}, lastWriter: "dev_x" })));
    await expect(new JsonTablesBackend(folder, "dev_a").open()).rejects.toBeInstanceOf(SchemaTooNewError);
  });

  it("keeps files in their area", async () => {
    const backend = new JsonTablesBackend(new MemoryFolder(), "dev_a");
    await backend.writeFile("inbox", "spot-2026-01-01-0900.json", new Uint8Array([1, 2]));
    expect((await backend.listFiles("inbox")).map((f) => f.name)).toEqual(["spot-2026-01-01-0900.json"]);
    await expect(backend.writeFile("inbox", "../manifest.json", new Uint8Array())).rejects.toThrow();
  });
});

describe("sync under races", () => {
  for (let seed = 1; seed <= 40; seed++) {
    it(`converges with no lost edit (seed ${seed})`, async () => {
      const folder = new MemoryFolder();
      await race(seed, {
        adapter: () => folder,
        setPause: (pause) => (folder.pause = pause),
        current: (path) => folder.files.get(path)?.data,
        overwrite: async (path, data) => void (await folder.write(path, data)),
      });
    });
  }
});
