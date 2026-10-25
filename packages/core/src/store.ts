// In-memory row store over the schema tables. Every write sets the system columns (rev, updatedAt,
// updatedBy, deleted) and is validated; deletes are tombstones so they can sync (docs/10, docs/12).
// The CLI uses it directly; the web app persists it to IndexedDB.

import { allColumns, type TableDef } from "./schema/columns.ts";
import { TABLES, type Row, type TableName, type Values } from "./schema/tables.ts";
import { validateRow, type RowProblem } from "./schema/validate.ts";
import { ulid } from "./ids.ts";
import { toUtcIso } from "./time/index.ts";

export class RowValidationError extends Error {
  constructor(
    readonly table: string,
    readonly problems: RowProblem[],
  ) {
    super(`${table}: ${problems.map((p) => `${p.column} ${p.message}`).join("; ")}`);
  }
}

export interface Change {
  table: TableName;
  id: string; // row key (see rowKey)
  before: Row<TableName> | null;
  after: Row<TableName> | null; // null when a row was purged
  /** "sync" when the row came from the user's storage rather than an edit on this device. */
  origin?: "sync";
}

export type Listener = (changes: Change[]) => void;

/** Key of a row in the store: its id, or track id and sequence for track points (which have no id). */
export function rowKey(table: TableName, row: Record<string, unknown>): string {
  return TABLES[table].kind === "points" ? `${row.trackId}|${row.seq}` : String(row.id);
}

/** One string per version of a row: the same row edited twice, or on two devices, never shares one (docs/12). */
export function rowVersion(row: Record<string, unknown>): string {
  return `${String(row.updatedAt)}|${String(row.updatedBy)}|${String(row.rev)}`;
}

/** A row with every column present, missing values as null, in schema order. */
export function completeRow(def: TableDef, partial: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const col of allColumns(def)) out[col.name] = partial[col.name] ?? null;
  return out;
}

export interface StoreOptions {
  deviceId: string;
  now?: () => number;
  validate?: boolean;
}

export class Store {
  private tables = new Map<TableName, Map<string, Row<TableName>>>();
  private listeners = new Set<Listener>();
  private pending: Change[] | null = null;
  readonly deviceId: string;
  private now: () => number;
  private validate: boolean;

  constructor(opts: StoreOptions) {
    this.deviceId = opts.deviceId;
    this.now = opts.now ?? Date.now;
    this.validate = opts.validate ?? true;
    for (const name of Object.keys(TABLES) as TableName[]) this.tables.set(name, new Map());
  }

  private map<N extends TableName>(table: N): Map<string, Row<N>> {
    return this.tables.get(table) as unknown as Map<string, Row<N>>;
  }

  /** Live rows (tombstones left out). */
  all<N extends TableName>(table: N): Row<N>[] {
    const out: Row<N>[] = [];
    for (const r of this.map(table).values()) if (!(r as { deleted?: boolean }).deleted) out.push(r);
    return out;
  }

  /** Every row, tombstones included (for sync and export). */
  allWithDeleted<N extends TableName>(table: N): Row<N>[] {
    return [...this.map(table).values()];
  }

  /** A row by its key, tombstones included (sync). */
  peek<N extends TableName>(table: N, key: string): Row<N> | null {
    return this.map(table).get(key) ?? null;
  }

  get<N extends TableName>(table: N, id: string | null | undefined): Row<N> | null {
    if (!id) return null;
    const r = this.map(table).get(id);
    return r && !(r as { deleted?: boolean }).deleted ? r : null;
  }

  /** Create a row. Missing columns become null. */
  insert<N extends TableName>(table: N, values: Partial<Values<N>>, id: string = ulid(this.now())): Row<N> {
    const def = TABLES[table];
    const row = completeRow(def, {
      ...values,
      id,
      rev: 1,
      updatedAt: toUtcIso(this.now()),
      updatedBy: this.deviceId,
      basedOn: null,
      deleted: false,
    }) as Row<N>;
    return this.write(table, null, row);
  }

  /** Change some fields of a row. Fields not given keep their values. */
  update<N extends TableName>(table: N, id: string, values: Partial<Values<N>>): Row<N> {
    const before = this.map(table).get(id);
    if (!before) throw new Error(`${table}: no row ${id}`);
    const changed = Object.entries(values).some(([k, v]) => (before as Record<string, unknown>)[k] !== (v ?? null));
    if (!changed) return before;
    const after = {
      ...before,
      ...Object.fromEntries(Object.entries(values).map(([k, v]) => [k, v ?? null])),
      ...this.stamp(before as Record<string, unknown>),
    } as Row<N>;
    return this.write(table, before, after);
  }

  /**
   * Put back an earlier version of a row (undoing an import): its values as a new version, live again even if the
   * row was deleted since. A row the store never had is created with them.
   */
  restore<N extends TableName>(table: N, id: string, earlier: Record<string, unknown>): Row<N> {
    const before = this.map(table).get(id) ?? null;
    const values = Object.fromEntries(Object.entries(earlier).filter(([k]) => !["id", "rev", "updatedAt", "updatedBy", "basedOn", "deleted"].includes(k)));
    if (!before) return this.insert(table, values as Partial<Values<N>>, id);
    const after = { ...before, ...values, deleted: false, ...this.stamp(before as Record<string, unknown>) } as Row<N>;
    return this.write(table, before, after);
  }

  /** Tombstone a row. */
  remove(table: TableName, id: string): void {
    const before = this.map(table).get(id);
    if (!before || (before as { deleted?: boolean }).deleted) return;
    this.write(table, before, { ...before, deleted: true, ...this.stamp(before as Record<string, unknown>) } as Row<TableName>);
  }

  /** System columns of a new version of `before`, edited on this device. */
  private stamp(before: Record<string, unknown>) {
    return {
      rev: (before.rev as number) + 1,
      updatedAt: toUtcIso(this.now()),
      updatedBy: this.deviceId,
      basedOn: before.updatedBy === this.deviceId ? (before.basedOn ?? null) : rowVersion(before),
    };
  }

  /** Put rows exactly as given (loading from storage, sync merges). Validated, not re-stamped. */
  load<N extends TableName>(table: N, rows: Row<N>[]): void {
    for (const row of rows) {
      const full = completeRow(TABLES[table], row as Record<string, unknown>) as Row<N>;
      if (this.validate) {
        const problems = validateRow(table, full);
        if (problems.length) throw new RowValidationError(table, problems);
      }
      this.map(table).set(rowKey(table, full as Record<string, unknown>), full);
    }
  }

  /** Put rows from the user's storage exactly as given and tell listeners, marked as coming from sync. */
  applyRemote<N extends TableName>(table: N, rows: Row<N>[]): void {
    const changes: Change[] = [];
    for (const row of rows) {
      const full = completeRow(TABLES[table], row as Record<string, unknown>) as Row<N>;
      if (this.validate) {
        const problems = validateRow(table, full);
        if (problems.length) throw new RowValidationError(table, problems);
      }
      const key = rowKey(table, full as Record<string, unknown>);
      const before = this.map(table).get(key) ?? null;
      this.map(table).set(key, full);
      changes.push({ table, id: key, before, after: full, origin: "sync" } as Change);
    }
    this.emitAll(changes);
  }

  /** Add rows exactly as given and tell listeners (track points, which carry no system columns). */
  putRaw<N extends TableName>(table: N, rows: Row<N>[], origin?: "sync"): void {
    const changes: Change[] = [];
    for (const row of rows) {
      const full = completeRow(TABLES[table], row as Record<string, unknown>) as Row<N>;
      if (this.validate) {
        const problems = validateRow(table, full);
        if (problems.length) throw new RowValidationError(table, problems);
      }
      const key = rowKey(table, full as Record<string, unknown>);
      const before = this.map(table).get(key) ?? null;
      this.map(table).set(key, full);
      changes.push({ table, id: key, before, after: full, ...(origin && { origin }) } as Change);
    }
    this.emitAll(changes);
  }

  /** Remove rows outright (track points are replaced with their track; they have no tombstones). */
  purge(table: TableName, keys: string[], origin?: "sync"): void {
    const changes: Change[] = [];
    for (const k of keys) {
      const before = this.map(table).get(k);
      if (!before) continue;
      this.map(table).delete(k);
      changes.push({ table, id: k, before, after: null, ...(origin && { origin }) } as unknown as Change);
    }
    this.emitAll(changes);
  }

  private emitAll(changes: Change[]) {
    if (!changes.length) return;
    if (this.pending) this.pending.push(...changes);
    else this.emit(changes);
  }

  private write<N extends TableName>(table: N, before: Row<N> | null, after: Row<N>): Row<N> {
    if (this.validate) {
      const problems = validateRow(table, after);
      if (problems.length) throw new RowValidationError(table, problems);
    }
    const id = rowKey(table, after as Record<string, unknown>);
    this.map(table).set(id, after);
    const change = { table, id, before, after } as Change;
    if (this.pending) this.pending.push(change);
    else this.emit([change]);
    return after;
  }

  /** Group writes so listeners see them once. */
  batch<T>(fn: () => T): T {
    if (this.pending) return fn();
    this.pending = [];
    try {
      return fn();
    } finally {
      const changes = this.pending;
      this.pending = null;
      if (changes.length) this.emit(changes);
    }
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(changes: Change[]) {
    for (const l of this.listeners) l(changes);
  }

  count(table: TableName): number {
    return this.all(table).length;
  }
}
