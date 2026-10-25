import { describe, expect, it } from "vitest";
import { commitImport, matchCandidates, parseSource, reconcile, RefIndex, saveFlight, SCHEMA_VERSION, Store, TABLES, updateSettings, type TableName } from "@touchdown/core";
import { loadRefTables } from "@touchdown/refdata";
import { JsonTablesBackend, MemoryFolder, MemorySyncState, mergeText, SchemaTooNewError, SyncEngine } from "../src/index.ts";
import { conflicts, device, FLIGHTS, race, settle, snapshot, testClock, type Device } from "./helpers.ts";

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

  it("keeps both edits when two devices change different fields of one row", async () => {
    const clock = testClock();
    const folder = new MemoryFolder();
    const a = await device(folder, "dev_a", clock.now);
    const b = await device(folder, "dev_b", clock.now);
    const f = a.store.insert("flights", { flightNumber: "XY100" });
    await settle([a, b]);

    clock.tick();
    a.store.update("flights", f.id, { seat: "1A" });
    clock.tick();
    b.store.update("flights", f.id, { departureGate: "B7", cabinClass: "business" });
    await settle([a, b]);

    expect(a.store.get("flights", f.id)).toMatchObject({ seat: "1A", departureGate: "B7", cabinClass: "business" });
    expect(snapshot(a.store)).toEqual(snapshot(b.store));
    expect(conflicts(a.store)).toHaveLength(0);
  });

  it("keeps the later of two edits to one field everywhere and lists the other once for review", async () => {
    const clock = testClock();
    const folder = new MemoryFolder();
    const a = await device(folder, "dev_a", clock.now);
    const b = await device(folder, "dev_b", clock.now);
    const f = a.store.insert("flights", { flightNumber: "XY100" });
    await settle([a, b]);

    clock.tick();
    a.store.update("flights", f.id, { seat: "1A", departureGate: "C1" });
    clock.tick();
    b.store.update("flights", f.id, { seat: "2B" });
    await settle([a, b]);

    expect(a.store.get("flights", f.id)).toMatchObject({ seat: "2B", departureGate: "C1" });
    expect(snapshot(a.store)).toEqual(snapshot(b.store));
    const listed = conflicts(a.store);
    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({ tableName: "flights", recordId: f.id, field: "seat", keptValue: '"2B"', otherValue: '"1A"', keptBy: "dev_b", otherBy: "dev_a", resolvedAt: null });
  });

  it("merges notes changed in different places, and lists notes changed in the same place", async () => {
    const clock = testClock();
    const folder = new MemoryFolder();
    const a = await device(folder, "dev_a", clock.now);
    const b = await device(folder, "dev_b", clock.now);
    const s = a.store.insert("sightings", { registration: "G-XYZA", notes: "Taxiing to runway 27L in the rain" });
    await settle([a, b]);

    clock.tick();
    a.store.update("sightings", s.id, { notes: "Taxiing to runway 27R in the rain" });
    b.store.update("sightings", s.id, { notes: "Taxiing to runway 27L in heavy rain" });
    await settle([a, b]);
    expect(a.store.get("sightings", s.id)?.notes).toBe("Taxiing to runway 27R in heavy rain");
    expect(conflicts(a.store)).toHaveLength(0);

    clock.tick();
    a.store.update("sightings", s.id, { notes: "Lined up on runway 27R" });
    b.store.update("sightings", s.id, { notes: "Took off from runway 27R" });
    await settle([a, b]);
    expect(conflicts(b.store).map((c) => c.field)).toEqual(["notes"]);
    expect(snapshot(a.store)).toEqual(snapshot(b.store));
  });

  it("keeps an entry deleted on one device and edited on the other, and lists the deletion", async () => {
    const clock = testClock();
    const folder = new MemoryFolder();
    const a = await device(folder, "dev_a", clock.now);
    const b = await device(folder, "dev_b", clock.now);
    const f = a.store.insert("flights", { flightNumber: "XY100" });
    await settle([a, b]);

    clock.tick();
    a.store.remove("flights", f.id);
    clock.tick();
    b.store.update("flights", f.id, { seat: "5E" });
    await settle([a, b]);

    expect(a.store.get("flights", f.id)?.seat).toBe("5E");
    expect(conflicts(a.store)).toMatchObject([{ field: "deleted", keptValue: "false", otherValue: "true", otherBy: "dev_a" }]);
    expect(snapshot(a.store)).toEqual(snapshot(b.store));
  });

  it("takes edits made in turn on other devices without listing a conflict, however long a device was away", async () => {
    const clock = testClock();
    const folder = new MemoryFolder();
    const a = await device(folder, "dev_a", clock.now);
    const b = await device(folder, "dev_b", clock.now);
    const c = await device(folder, "dev_c", clock.now);
    const f = a.store.insert("flights", { flightNumber: "XY100" });
    await settle([a, b, c]);

    // A is away while B edits, then C edits B's version.
    clock.tick();
    b.store.update("flights", f.id, { seat: "7A" });
    await settle([b, c]);
    clock.tick();
    c.store.update("flights", f.id, { seat: "8B" });
    await settle([c]);
    await settle([a, b, c]);

    expect(a.store.get("flights", f.id)?.seat).toBe("8B");
    expect(conflicts(a.store)).toHaveLength(0);
  });

  it("merges edits to a row written before version vectors, as an existing log has", async () => {
    const clock = testClock();
    const folder = new MemoryFolder();
    const a = await device(folder, "dev_a", clock.now);
    const b = await device(folder, "dev_b", clock.now);
    const f = a.store.insert("flights", { flightNumber: "XY100" });
    // As an older version of the app wrote it.
    a.store.load("flights", [{ ...a.store.peek("flights", f.id)!, versionVector: null }]);
    await settle([a, b]);
    expect(b.store.get("flights", f.id)?.versionVector).toBeNull();

    clock.tick();
    a.store.update("flights", f.id, { seat: "1A" });
    b.store.update("flights", f.id, { departureGate: "B7" });
    await settle([a, b]);
    expect(a.store.get("flights", f.id)).toMatchObject({ seat: "1A", departureGate: "B7" });
    expect(conflicts(a.store)).toHaveLength(0);

    clock.tick();
    a.store.update("flights", f.id, { seat: "2B" });
    await settle([a, b]);
    expect(b.store.get("flights", f.id)?.seat).toBe("2B");
    expect(snapshot(a.store)).toEqual(snapshot(b.store));
  });

  it("lists a setting changed on two devices", async () => {
    const clock = testClock();
    const folder = new MemoryFolder();
    const a = await device(folder, "dev_a", clock.now);
    const b = await device(folder, "dev_b", clock.now);
    updateSettings(a.store, { theme: "light" });
    await settle([a, b]);

    clock.tick();
    updateSettings(a.store, { theme: "dark", distanceUnit: "mi" });
    clock.tick();
    updateSettings(b.store, { theme: "system" });
    await settle([a, b]);

    expect(a.store.get("settings", "settings")).toMatchObject({ theme: "system", distanceUnit: "mi" });
    expect(conflicts(b.store)).toMatchObject([{ tableName: "settings", recordId: "settings", field: "theme", keptValue: '"system"', otherValue: '"dark"' }]);
  });

  it("keeps a conflict resolved on one device resolved everywhere", async () => {
    const clock = testClock();
    const folder = new MemoryFolder();
    const a = await device(folder, "dev_a", clock.now);
    const b = await device(folder, "dev_b", clock.now);
    const f = a.store.insert("flights", { flightNumber: "XY100" });
    await settle([a, b]);
    clock.tick();
    a.store.update("flights", f.id, { seat: "1A" });
    b.store.update("flights", f.id, { seat: "2B" });
    await settle([a, b]);
    const id = conflicts(a.store)[0]!.id;

    clock.tick();
    a.store.update("sync_conflicts", id, { resolvedAt: "2026-01-01T00:00:03Z", resolution: "kept" });
    // B touches its copy later without having seen the resolution.
    clock.tick(5);
    b.store.update("sync_conflicts", id, { detectedAt: "2026-01-01T00:00:08Z" });
    await settle([b, a]);

    expect(a.store.get("sync_conflicts", id)?.resolution).toBe("kept");
    expect(b.store.get("sync_conflicts", id)?.resolution).toBe("kept");
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
    reopened.load("flights", [{ ...a.store.peek("flights", f.id)!, seat: "4D", rev: 2, updatedAt: "2026-01-01T00:00:01Z", versionVector: "dev_a=2" }] as never);
    const engine = new SyncEngine(reopened, new JsonTablesBackend(folder, "dev_a"), new MemorySyncState(), clock.now);
    await engine.start();
    await engine.sync({ full: true });
    await engine.sync();

    const b = await device(folder, "dev_b", clock.now);
    await settle([b]);
    expect(b.store.get("flights", f.id)?.seat).toBe("4D");
  });
});

describe("settling what two devices made side by side", () => {
  const ref = new RefIndex(loadRefTables());
  /** As the web app does: sync, then settle what arrived (core reconcile.ts). */
  async function settleAndReconcile(devices: Device[], rounds = 4) {
    for (let i = 0; i < rounds; i++) {
      for (const d of devices) {
        const report = await d.engine.sync();
        if (report.received) reconcile(d.store, ref);
      }
    }
  }

  it("ends with one aircraft when both devices log a new registration, and it stays", async () => {
    const clock = testClock();
    const folder = new MemoryFolder();
    const a = await device(folder, "dev_a", clock.now);
    const b = await device(folder, "dev_b", clock.now);
    saveFlight(a.store, ref, { scheduledDate: "2026-03-14", flightNumber: "BA9001", airlineRaw: "BA", fromRaw: "EGLL", toRaw: "KJFK", registrationRaw: "G-ZZZQ", typeCodeRaw: "B77W" });
    clock.tick();
    saveFlight(b.store, ref, { scheduledDate: "2026-03-20", flightNumber: "BA9002", airlineRaw: "BA", fromRaw: "KJFK", toRaw: "EGLL", registrationRaw: "G-ZZZQ", typeCodeRaw: "B77W" });
    await settleAndReconcile([a, b]);

    for (const d of [a, b]) {
      expect(d.store.all("airframes")).toHaveLength(1);
      const id = d.store.all("airframes")[0]!.id;
      expect(d.store.all("flights").map((f) => f.airframeId)).toEqual([id, id]);
    }
    expect(snapshot(a.store)).toEqual(snapshot(b.store));
    expect(conflicts(a.store)).toHaveLength(0);

    // Later edits on either device leave the one aircraft alone.
    clock.tick();
    saveFlight(a.store, ref, { scheduledDate: "2026-04-01", flightNumber: "BA9003", airlineRaw: "BA", fromRaw: "EGLL", toRaw: "KJFK" });
    saveFlight(b.store, ref, { scheduledDate: "2026-04-02", flightNumber: "BA9004", airlineRaw: "BA", fromRaw: "KJFK", toRaw: "EGLL" });
    await settleAndReconcile([a, b]);
    expect(a.store.all("airframes")).toHaveLength(1);
    expect(snapshot(a.store)).toEqual(snapshot(b.store));
  });

  it("keeps one copy of a file both devices imported, and lists no aircraft link edited on both", async () => {
    const clock = testClock();
    const folder = new MemoryFolder();
    const a = await device(folder, "dev_a", clock.now);
    const b = await device(folder, "dev_b", clock.now);
    const sheet = { name: "Sheet1", header: ["Date", "Registration", "Airport"], rows: [["2026-04-02", "N905ZZ", "KBOS"], ["2026-04-02", "N906ZZ", "KBOS"]], firstRow: 2 };
    for (const d of [a, b]) {
      const source = parseSource(sheet as never, "spotting.csv", ref)!;
      commitImport(d.store, ref, source, matchCandidates(d.store, source.candidates));
      clock.tick();
    }
    await settleAndReconcile([a, b]);

    for (const d of [a, b]) {
      expect(d.store.all("sightings")).toHaveLength(2);
      expect(d.store.all("airframes")).toHaveLength(2);
    }
    expect(snapshot(a.store)).toEqual(snapshot(b.store));
    expect(conflicts(a.store)).toHaveLength(0);
  });
});

describe("merging text", () => {
  it("applies both edits when they change different words, and gives up when they overlap", () => {
    expect(mergeText("a quiet morning at the fence", "a quiet sunny morning at the fence", "a quiet morning at the north fence")).toBe("a quiet sunny morning at the north fence");
    expect(mergeText("seen on short final", "seen on long final", "seen on very short final")).toBeNull();
    expect(mergeText("", "first", "second")).toBeNull();
    expect(mergeText("same change", "same edit", "same edit")).toBe("same edit");
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

  it("stops syncing at a table file written by a newer version of the app, keeping local edits and the file", async () => {
    const clock = testClock();
    const folder = new MemoryFolder();
    const a = await device(folder, "dev_a", clock.now);
    a.store.insert("flights", { flightNumber: "XY100" });
    await settle([a]);
    const newer = JSON.parse(new TextDecoder().decode(folder.files.get(FLIGHTS)!.data));
    const written = new TextEncoder().encode(JSON.stringify({ ...newer, schemaVersion: SCHEMA_VERSION + 1 }));
    await folder.write(FLIGHTS, written);

    clock.tick();
    a.store.insert("flights", { flightNumber: "XY200" });
    await expect(a.engine.sync({ full: true })).rejects.toBeInstanceOf(SchemaTooNewError);
    expect(folder.files.get(FLIGHTS)!.data).toEqual(written);
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
