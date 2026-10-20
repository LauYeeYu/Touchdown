// Track points in the browser copy: one IndexedDB record per track, holding that track's point rows, instead
// of one record per point (docs/12-storage-and-sync.md, "Local store"). A track's points are always written and
// replaced together (docs/10), and IndexedDB pays a fixed cost per record, so reading and writing the log is
// several times faster. The rows themselves are unchanged.

export interface TrackPointsRecord {
  trackId: string;
  rows: Record<string, unknown>[];
}

/** A row can go into a track record when its track id can be the record's key. */
export function hasTrackKey(row: Record<string, unknown>): boolean {
  return typeof row.trackId === "string" && row.trackId !== "";
}

/** Group point rows into one record per track, each track's points in sequence order. */
export function groupTrackPoints(rows: Record<string, unknown>[]): TrackPointsRecord[] {
  const byTrack = new Map<string, Record<string, unknown>[]>();
  for (const r of rows) {
    const id = r.trackId as string;
    const list = byTrack.get(id);
    if (list) list.push(r);
    else byTrack.set(id, [r]);
  }
  return [...byTrack].map(([trackId, list]) => ({ trackId, rows: list.sort((a, b) => Number(a.seq) - Number(b.seq)) }));
}

// JSON, but telling apart what JSON would merge: undefined, NaN, the infinities and -0.
const exact = (row: unknown) =>
  JSON.stringify(row, (_k, v: unknown) => (v === undefined ? "\u0000undefined" : typeof v === "number" && (!Number.isFinite(v) || Object.is(v, -0)) ? `\u0000${Object.is(v, -0) ? "-0" : String(v)}` : v));

/**
 * Throw unless the records hold exactly these rows: every row once, with the same columns in the same order and
 * the same values, in the record of its own track. Nothing lost, nothing added, nothing changed.
 */
export function assertSameRows(rows: Record<string, unknown>[], records: TrackPointsRecord[]): void {
  const misfiled = records.some((t) => t.rows.some((r) => r.trackId !== t.trackId));
  const a = rows.map(exact).sort();
  const b = records.flatMap((t) => t.rows.map(exact)).sort();
  if (misfiled || a.length !== b.length || a.some((x, i) => x !== b[i])) {
    throw new Error(`Track points: the grouped copy does not match the ${a.length} original rows, so nothing was changed.`);
  }
}
