import { describe, expect, it } from "vitest";
import { assertSameRows, groupTrackPoints, hasTrackKey } from "./trackPoints.ts";

const point = (trackId: string, seq: number, extra: Record<string, unknown> = {}) => ({ trackId, seq, t: 1741940000 + seq * 10, lat: 51.47, lon: -0.45 - seq / 100, altitudeFt: seq * 100, groundSpeedKt: null, headingDeg: 270, ...extra });

describe("track points in the browser copy", () => {
  it("groups points by track, in sequence order", () => {
    const rows = [point("T2", 0), point("T1", 2), point("T1", 0), point("T1", 10), point("T1", 1)];
    const records = groupTrackPoints(rows);
    expect(records.map((r) => [r.trackId, r.rows.map((p) => p.seq)])).toEqual([
      ["T2", [0]],
      ["T1", [0, 1, 2, 10]],
    ]);
    expect(() => assertSameRows(rows, records)).not.toThrow();
  });

  it("keeps every row exactly, the same objects with the same values", () => {
    const rows = [point("T1", 0), point("T1", 1, { altitudeFt: null }), point("T2", 0)];
    const records = groupTrackPoints(rows);
    expect(records.flatMap((r) => r.rows)).toHaveLength(3);
    for (const r of rows) expect(records.some((t) => t.rows.includes(r))).toBe(true);
  });

  it("refuses a copy that lost, added, changed or misfiled a row", () => {
    const rows = [point("T1", 0), point("T1", 1), point("T2", 0)];
    const lost = groupTrackPoints(rows.slice(0, 2));
    expect(() => assertSameRows(rows, lost)).toThrow(/does not match/);
    const added = groupTrackPoints([...rows, point("T2", 1)]);
    expect(() => assertSameRows(rows, added)).toThrow(/does not match/);
    const changed = groupTrackPoints([rows[0]!, { ...rows[1]!, lat: 51.48 }, rows[2]!]);
    expect(() => assertSameRows(rows, changed)).toThrow(/does not match/);
    const reordered = groupTrackPoints([rows[0]!, { seq: 1, trackId: "T1", t: rows[1]!.t, lat: 51.47, lon: rows[1]!.lon, altitudeFt: 100, groundSpeedKt: null, headingDeg: 270 }, rows[2]!]);
    expect(() => assertSameRows(rows, reordered)).toThrow(/does not match/);
    const misfiled = [{ trackId: "T1", rows: [rows[0]!, rows[1]!, rows[2]!] }];
    expect(() => assertSameRows(rows, misfiled)).toThrow(/does not match/);
  });

  it("tells apart values that JSON would merge", () => {
    const a = [point("T1", 0, { altitudeFt: 0 })];
    const b = [point("T1", 0, { altitudeFt: -0 })];
    expect(() => assertSameRows(a, groupTrackPoints(b))).toThrow();
    const c = [point("T1", 0, { headingDeg: undefined })];
    const d = [point("T1", 0, { headingDeg: null })];
    expect(() => assertSameRows(c, groupTrackPoints(d))).toThrow();
  });

  it("only moves rows whose track id can be a record key", () => {
    expect(hasTrackKey(point("T1", 0))).toBe(true);
    expect(hasTrackKey({ seq: 0 })).toBe(false);
    expect(hasTrackKey({ trackId: "", seq: 0 })).toBe(false);
  });
});
