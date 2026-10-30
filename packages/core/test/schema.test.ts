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
    expect(PRIVATE_FIELDS).toEqual(["flights.ticketNumber", "flights.bookingRef", "flight_private.ticketNumber", "flight_private.bookingRef"]);
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

import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { rowVersion, SCHEMA_VERSION, Store } from "../src/index.ts";

describe("schema versions", () => {
  it("reads a backup written before basedOn existed", () => {
    const store = newStore();
    store.insert("flights", { flightNumber: "XY1" });
    // Rewrite the backup as version 1 wrote it: no basedOn column, schema version 1.
    const files = unzipSync(backupZip(store));
    for (const [path, data] of Object.entries(files)) {
      const json = JSON.parse(strFromU8(data));
      json.schemaVersion = 1;
      if (Array.isArray(json.columns)) {
        json.columns = json.columns.filter((c: string) => c !== "basedOn");
        for (const r of json.rows) delete r.basedOn;
      }
      files[path] = strToU8(JSON.stringify(json));
    }
    const back = readBackup(zipSync(files));
    expect(SCHEMA_VERSION).toBeGreaterThan(1);
    expect(back.problems).toEqual([]);
    expect(back.tables.get("flights")?.[0]).toMatchObject({ flightNumber: "XY1", basedOn: null });
  });

  it("reads a version 3 backup, leaving out the agent settings that moved to the CLI", () => {
    const store = new Store({ deviceId: "dev_a" });
    store.insert("settings", { theme: "dark" }, "settings");
    // Rewrite the backup as version 3 wrote it: the agent settings in settings, and an agent_rules table.
    const files = unzipSync(backupZip(store));
    for (const [path, data] of Object.entries(files)) {
      const json = JSON.parse(strFromU8(data));
      json.schemaVersion = 3;
      if (json.table === "settings") {
        json.columns.push("agentChecker", "sendNotesToAgent");
        for (const r of json.rows) Object.assign(r, { agentChecker: "codex", sendNotesToAgent: true });
      }
      files[path] = strToU8(JSON.stringify(json));
    }
    files["Touchdown/tables/agent_rules.json"] = strToU8(JSON.stringify({ schema: "touchdown", schemaVersion: 3, table: "agent_rules", columns: ["id", "seq", "text"], rows: [{ id: "r1", seq: 1, text: "A rule." }] }));
    const back = readBackup(zipSync(files));
    expect(back.problems).toEqual([]);
    const settings = back.tables.get("settings")?.[0];
    expect(settings).toMatchObject({ theme: "dark" });
    expect(settings).not.toHaveProperty("agentChecker");
    expect(back.tables.has("agent_rules" as never)).toBe(false);
  });

  it("records which other device's version an edit was based on, through later edits", () => {
    const a = new Store({ deviceId: "dev_a", now: () => Date.parse("2026-01-01T00:00:00Z") });
    const b = new Store({ deviceId: "dev_b", now: () => Date.parse("2026-01-01T00:00:05Z") });
    const f = a.insert("flights", { flightNumber: "XY1" });
    expect(f.basedOn).toBeNull();
    expect(a.update("flights", f.id, { seat: "1A" }).basedOn).toBeNull();
    b.applyRemote("flights", [a.peek("flights", f.id)!]);
    const fromA = rowVersion(a.peek("flights", f.id)!);
    expect(b.update("flights", f.id, { seat: "2B" }).basedOn).toBe(fromA);
    expect(b.update("flights", f.id, { seat: "3C" }).basedOn).toBe(fromA);
    b.remove("flights", f.id);
    expect(b.peek("flights", f.id)?.basedOn).toBe(fromA);
  });
});
