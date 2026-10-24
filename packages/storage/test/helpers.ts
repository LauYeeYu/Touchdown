// Devices for sync tests, and the race run shared by every file adapter.

import { expect } from "vitest";
import { Store, TABLES, type TableName } from "@touchdown/core";
import { JsonTablesBackend, MemorySyncState, SyncEngine, versionOf, type FileAdapter, type StoredRow } from "../src/index.ts";

export const FLIGHTS = "tables/flights.json";

export function testClock() {
  let t = Date.parse("2026-01-01T00:00:00Z");
  return {
    now: () => t,
    tick: (seconds = 1) => {
      t += seconds * 1000;
    },
  };
}

export type Device = Awaited<ReturnType<typeof device>>;

export async function device(files: FileAdapter, id: string, now: () => number) {
  const store = new Store({ deviceId: id, now });
  const backend = new JsonTablesBackend(files, id);
  await backend.open();
  const engine = new SyncEngine(store, backend, new MemorySyncState(), now);
  await engine.start();
  return { id, store, engine };
}

/** Every row of every table, tombstones included, in a fixed order. */
export function snapshot(store: Store) {
  return Object.fromEntries(
    (Object.keys(TABLES) as TableName[]).map((t) => [t, store.allWithDeleted(t).map((r) => JSON.stringify(r)).sort()]),
  );
}

export async function settle(devices: Device[], rounds = 4) {
  for (let i = 0; i < rounds; i++) for (const d of devices) await d.engine.sync();
}

export function conflicts(store: Store) {
  return store.all("record_history").filter((h) => h.reason === "sync_conflict");
}

export function random(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let x = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

/** One storage seen by several devices, for `race`. */
export interface RaceStorage {
  /** The adapter a device uses: shared, or its own with its own caches. */
  adapter(deviceId: string): FileAdapter;
  /** Awaited before every storage operation. */
  setPause(pause: () => Promise<void>): void;
  /** A file's content as stored now. */
  current(path: string): Uint8Array | undefined;
  /** Write a file behind every device's back. */
  overwrite(path: string, data: Uint8Array): Promise<void>;
}

/**
 * Several devices edit, sync at the same time with their file reads and writes interleaved, and sometimes write a
 * stale copy back. Afterwards every device holds the same log, and every edit either is the row's final version,
 * was edited further by a device that had it, or is kept in record_history as a sync conflict.
 */
export async function race(seed: number, storage: RaceStorage, steps = 60) {
  const rnd = random(seed);
  const pick = <T>(list: T[]) => list[Math.floor(rnd() * list.length)]!;
  const clock = testClock();
  storage.setPause(async () => {
    for (let i = Math.floor(rnd() * 4); i > 0; i--) await Promise.resolve();
  });
  const devices: Device[] = [];
  for (const id of ["dev_a", "dev_b", "dev_c"]) devices.push(await device(storage.adapter(id), id, clock.now));
  const edits: { key: string; version: string; base: string | null }[] = [];
  const old: Uint8Array[] = [];

  for (let step = 0; step < steps; step++) {
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
    const file = storage.current(FLIGHTS);
    if (file) old.push(file);
    if (old.length && rnd() < 0.08) await storage.overwrite(FLIGHTS, pick(old));
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
}
