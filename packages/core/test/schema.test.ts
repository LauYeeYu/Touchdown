import { describe, expect, it } from "vitest";
import { createTableSql, flights, PRIVATE_FIELDS, rowJsonSchema, schemaSql, TABLES, validateRow, ulid, completeRow } from "../src/index.ts";

describe("schema", () => {
  const base = completeRow(flights, {
    id: ulid(),
    rev: 1,
    updatedAt: "2026-01-01T00:00:00Z",
    updatedBy: "dev_a",
    deleted: false,
  });

  it("accepts a row with every field empty", () => {
    expect(validateRow("flights", base)).toEqual([]);
  });

  it("rejects bad values and unknown columns", () => {
    expect(validateRow("flights", { ...base, takeoffAt: "10:40" })[0]?.column).toBe("takeoffAt");
    expect(validateRow("flights", { ...base, scheduledDate: "2025-02-30" })[0]?.column).toBe("scheduledDate");
    expect(validateRow("flights", { ...base, cabinClass: "steerage" })[0]?.column).toBe("cabinClass");
    expect(validateRow("flights", { ...base, extra: 1 }).length).toBe(1);
  });

  it("generates SQL with an indexed instant for every date-time", () => {
    const sql = createTableSql(flights, "sqlite");
    expect(sql).toContain("takeoff_at TEXT");
    expect(sql).toContain("takeoff_at_utc INTEGER GENERATED ALWAYS AS (unixepoch(takeoff_at)) STORED");
    expect(sql).toContain("CHECK (cabin_class IN ('economy'");
    const pg = schemaSql(Object.values(TABLES), "postgres");
    expect(pg).toContain("touchdown_instant(takeoff_at)");
  });

  it("generates a JSON Schema with every column", () => {
    const s = rowJsonSchema(flights) as { required: string[] };
    expect(s.required).toContain("takeoffAt");
    expect(s.required).toContain("id");
  });

  it("marks the private fields", () => {
    expect(PRIVATE_FIELDS).toEqual(["flights.ticketNumber", "flights.bookingRef"]);
  });
});

import { backupZip, readBackup, tableCsv } from "../src/index.ts";
import { newStore } from "./fixtures.ts";

describe("backups", () => {
  it("round-trips every table through a zip", () => {
    const store = newStore();
    const f = store.insert("flights", { flightNumber: "XY1", ticketNumber: "0000000000009/1", notes: "=1+1" });
    const t = store.insert("tracks", { flightId: f.id, provider: "fr24_csv" });
    store.load("track_points", [{ trackId: t.id, seq: 0, t: 1, lat: 1, lon: 2, altitudeFt: null, groundSpeedKt: null, headingDeg: null }]);
    store.remove("flights", store.insert("flights", { flightNumber: "XY2" }).id);
    const back = readBackup(backupZip(store));
    expect(back.problems).toEqual([]);
    expect(back.tables.get("flights")).toHaveLength(2); // the tombstone is kept so deletes sync
    expect(back.tables.get("track_points")).toHaveLength(1);
  });

  it("leaves private fields out of CSV unless asked, and guards formulas", () => {
    const store = newStore();
    store.insert("flights", { flightNumber: "XY1", ticketNumber: "0000000000009/1", notes: "=1+1" });
    const csv = tableCsv(store, "flights");
    expect(csv).not.toContain("ticketNumber");
    expect(csv).toContain("'=1+1");
    expect(tableCsv(store, "flights", true)).toContain("0000000000009/1");
  });
});
