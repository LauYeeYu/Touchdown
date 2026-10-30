// Column and table definitions. Every stored table is declared once with these builders
// (docs/10-domain-model.md); types, validators, JSON Schema and SQL are generated from them.

export type LogicalType = "id" | "text" | "integer" | "real" | "boolean" | "date" | "datetime" | "enum" | "ref" | "json";

export interface ColumnDef {
  readonly name: string;
  readonly type: LogicalType;
  readonly values?: readonly string[]; // enum members
  readonly ref?: string; // referenced table, for "ref"
  readonly required?: boolean; // only system columns and child-table parent references
  readonly private?: boolean; // ticket number, booking reference
  readonly unique?: boolean;
}

export type TableKind = "user" | "child" | "settings" | "points";

export interface TableDef {
  readonly name: string; // snake_case table name
  readonly kind: TableKind;
  readonly columns: readonly ColumnDef[];
  // Its rows can hold private data: kept apart from the tables a share link reads (the JSON tables' private/ folder)
  // and never read for a link (docs/32, "Private data").
  readonly private?: boolean;
}

type Opts = { required?: boolean; private?: boolean; unique?: boolean };

const col = <N extends string, T extends LogicalType, O extends Opts>(name: N, type: T, opts?: O) =>
  ({ name, type, ...(opts ?? {}) }) as { name: N; type: T } & O;

export const c = {
  id: <N extends string, O extends Opts = {}>(name: N, opts?: O) => col(name, "id", opts),
  text: <N extends string, O extends Opts = {}>(name: N, opts?: O) => col(name, "text", opts),
  integer: <N extends string, O extends Opts = {}>(name: N, opts?: O) => col(name, "integer", opts),
  real: <N extends string, O extends Opts = {}>(name: N, opts?: O) => col(name, "real", opts),
  boolean: <N extends string, O extends Opts = {}>(name: N, opts?: O) => col(name, "boolean", opts),
  date: <N extends string, O extends Opts = {}>(name: N, opts?: O) => col(name, "date", opts),
  datetime: <N extends string, O extends Opts = {}>(name: N, opts?: O) => col(name, "datetime", opts),
  json: <N extends string, O extends Opts = {}>(name: N, opts?: O) => col(name, "json", opts),
  enum: <N extends string, const V extends readonly string[], O extends Opts = {}>(name: N, values: V, opts?: O) =>
    ({ name, type: "enum", values, ...(opts ?? {}) }) as { name: N; type: "enum"; values: V } & O,
  ref: <N extends string, const R extends string, O extends Opts = {}>(name: N, ref: R, opts?: O) =>
    ({ name, type: "ref", ref, ...(opts ?? {}) }) as { name: N; type: "ref"; ref: R } & O,
};

// System columns on every user, child and settings table (not on track points).
export const systemColumns = [
  c.id("id", { required: true }),
  c.integer("rev", { required: true }),
  c.datetime("updatedAt", { required: true }),
  c.text("updatedBy", { required: true }),
  // The version of another device's row this one was edited from, kept through later edits on this device, so sync
  // can tell an edit made on top of a version from one made beside it (docs/12, "Sync algorithm").
  c.text("basedOn"),
  // For each device, how many of its edits this version includes ("dev_a=3,cli_b=1"; versionVector.ts), so sync can
  // tell versions made on top of each other from versions made side by side without relying on clocks.
  c.text("versionVector"),
  c.boolean("deleted", { required: true }),
] as const;

export const table = <const N extends string, const K extends TableKind, const C extends readonly ColumnDef[]>(
  name: N,
  kind: K,
  columns: C,
  opts: { private?: boolean } = {},
) => ({ name, kind, columns, ...(opts.private ? { private: true } : {}) }) as { readonly name: N; readonly kind: K; readonly columns: C; readonly private?: boolean };

// ---- Types derived from definitions ----

// Columns arrive intersected with ColumnDef, so `values` is `readonly string[] & readonly ["a", "b"]`.
// Indexing that by number keeps the literal members, where `infer V` would widen to string.
type ScalarOf<C> = C extends { type: "enum"; values: infer VS }
  ? VS extends readonly unknown[]
    ? VS[number]
    : string
  : C extends { type: "integer" | "real" }
    ? number
    : C extends { type: "boolean" }
      ? boolean
      : C extends { type: "json" }
        ? Record<string, unknown>
        : string;

type ValueOf<C> = C extends { required: true } ? ScalarOf<C> : ScalarOf<C> | null;

type ColumnsOf<T extends { columns: readonly ColumnDef[] }> = {
  -readonly [C in T["columns"][number] as C["name"]]: ValueOf<C>;
};

export type SystemFields = ColumnsOf<{ columns: typeof systemColumns }>;

export type RowOf<T extends { kind: TableKind; columns: readonly ColumnDef[] }> = T["kind"] extends "points"
  ? ColumnsOf<T>
  : SystemFields & ColumnsOf<T>;

// Field values without system columns: what forms and importers produce.
export type ValuesOf<T extends { columns: readonly ColumnDef[] }> = ColumnsOf<T>;

export function allColumns(t: TableDef): readonly ColumnDef[] {
  return t.kind === "points" ? t.columns : [...systemColumns, ...t.columns];
}

export function snakeCase(name: string): string {
  return name.replace(/[A-Z]/g, (m) => "_" + m.toLowerCase());
}
