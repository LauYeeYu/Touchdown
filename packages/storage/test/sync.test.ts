import { describe, expect, it } from "vitest";
import { SCHEMA_VERSION, Store, TABLES, type TableName } from "@touchdown/core";
import { JsonTablesBackend, MemoryFolder, MemorySyncState, SchemaTooNewError, SyncEngine, versionOf, type StoredRow } from "../src/index.ts";

const FLIGHTS = "tables/flights.json";

function testClock() {
  let t = Date.parse("2026-01-01T00:00:00Z");
  return {
    now: () => t,
    tick: (seconds = 1) => {
      t += seconds * 1000;
    },
  };
}

type Device = Awaited<ReturnType<typeof device>>;

async function device(folder: MemoryFolder, id: string, now: () => number) {
  const store = new Store({ deviceId: id, now });
  const backend = new JsonTablesBackend(folder, id);
  await backend.open();
  const engine = new SyncEngine(store, backend, new MemorySyncState(), now);
  await engine.start();
  return { id, store, engine };
}

/** Every row of every table, tombstones included, in a fixed order. */
function snapshot(store: Store) {
  return Object.fromEntries(
    (Object.keys(TABLES) as TableName[]).map((t) => [t, store.allWithDeleted(t).map((r) => JSON.stringify(r)).sort()]),
  );
}

async function settle(devices: Device[], rounds = 4) {
  for (let i = 0; i < rounds; i++) for (const d of devices) await d.engine.sync();
}

function conflicts(store: Store) {
  return store.all("record_history").filter((h) => h.reason === "sync_conflict");
}

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

// Several devices edit, sync at the same time with their file reads and writes interleaved, and sometimes write a
// stale copy back. Afterwards every device holds the same log, and every edit either is the row's final version,
// was edited further by a device that had it, or is kept in record_history as a sync conflict.
describe("sync under races", () => {
  function random(seed: number) {
    return () => {
      seed = (seed + 0x6d2b79f5) | 0;
      let x = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
      return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
    };
  }

  for (let seed = 1; seed <= 40; seed++) {
    it(`converges with no lost edit (seed ${seed})`, async () => {
      const rnd = random(seed);
      const pick = <T>(list: T[]) => list[Math.floor(rnd() * list.length)]!;
      const clock = testClock();
      const folder = new MemoryFolder();
      folder.pause = async () => {
        for (let i = Math.floor(rnd() * 4); i > 0; i--) await Promise.resolve();
      };
      const devices = [await device(folder, "dev_a", clock.now), await device(folder, "dev_b", clock.now), await device(folder, "dev_c", clock.now)];
      const edits: { key: string; version: string; base: string | null }[] = [];
      const old: Uint8Array[] = [];

      for (let step = 0; step < 60; step++) {
        const d = pick(devices);
        const live = d.store.all("flights");
        const r = rnd();
        if (r < 0.3 || !live.length) {
          const row = d.store.insert("flights", { flightNumber: `XY${step}` });
          edits.push({ key: row.id, version: versionOf(row as unknown as StoredRow), base: null });
        } else if (r < 0.75) {
          const target = pick(live);
          const row = d.store.update("flights", target.id, { seat: `${step}${d.id.slice(-1)}` });
          edits.push({ key: row.id, version: versionOf(row as unknown as StoredRow), base: versionOf(target as unknown as StoredRow) });
        } else if (r < 0.85) {
          const target = pick(live);
          d.store.remove("flights", target.id);
          const row = d.store.peek("flights", target.id)!;
          edits.push({ key: row.id, version: versionOf(row as unknown as StoredRow), base: versionOf(target as unknown as StoredRow) });
        } else {
          await Promise.all(devices.filter(() => rnd() < 0.7).map((x) => x.engine.sync()));
        }
        if (rnd() < 0.5) clock.tick();
        const file = folder.files.get(FLIGHTS);
        if (file) old.push(file.data);
        if (old.length && rnd() < 0.08) await folder.write(FLIGHTS, pick(old));
      }

      for (let round = 0; round < 8; round++) for (const d of devices) await d.engine.sync();

      const [first, ...rest] = devices;
      for (const d of rest) expect(snapshot(d.store)).toEqual(snapshot(first!.store));
      for (const d of devices) expect(d.engine.waiting).toBe(0);

      const final = first!.store;
      const superseded = new Set(edits.map((e) => e.base));
      const kept = new Set(conflicts(final).map((h) => versionOf(h.row as StoredRow)));
      for (const e of edits) {
        const now = versionOf(final.peek("flights", e.key) as unknown as StoredRow);
        expect(now === e.version || superseded.has(e.version) || kept.has(e.version), `edit ${e.version} lost`).toBe(true);
      }
    });
  }
});
