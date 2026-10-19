// Runtime validators generated from the table definitions. Every backend validates rows on read and
// write (docs/12-storage-and-sync.md); rows that fail are rejected, never stored.

import { z } from "zod";
import { allColumns, type ColumnDef, type TableDef } from "./columns.ts";
import { TABLES, type TableName } from "./tables.ts";

export const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
export const DATETIME_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/;
const ULID_RE = /^[0-9A-HJKMNP-TV-Z]{26}$/;

export function isValidDate(s: string): boolean {
  const m = DATE_RE.exec(s);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const t = new Date(Date.UTC(y, mo - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === mo - 1 && t.getUTCDate() === d;
}

export function isValidDateTime(s: string): boolean {
  const m = DATETIME_RE.exec(s);
  if (!m) return false;
  if (!isValidDate(`${m[1]}-${m[2]}-${m[3]}`)) return false;
  const [h, mi, se] = [Number(m[4]), Number(m[5]), Number(m[6] ?? 0)];
  if (h > 23 || mi > 59 || se > 59) return false;
  const off = m[7]!;
  if (off !== "Z") {
    const oh = Number(off.slice(1, 3));
    const om = Number(off.slice(4, 6));
    if (oh > 14 || om > 59) return false;
  }
  return true;
}

function columnSchema(col: ColumnDef): z.ZodType {
  let s: z.ZodType;
  switch (col.type) {
    case "id":
      // Settings uses the fixed id "settings"; every other id is a ULID.
      s = z.string().refine((v) => ULID_RE.test(v) || v === "settings", "not a ULID");
      break;
    case "ref":
      s = z.string().min(1);
      break;
    case "text":
      s = z.string();
      break;
    case "integer":
      s = z.number().int();
      break;
    case "real":
      s = z.number().finite();
      break;
    case "boolean":
      s = z.boolean();
      break;
    case "date":
      s = z.string().refine(isValidDate, "not a YYYY-MM-DD date");
      break;
    case "datetime":
      s = z.string().refine(isValidDateTime, "not an ISO 8601 date-time with UTC offset");
      break;
    case "enum":
      s = z.enum(col.values as [string, ...string[]]);
      break;
    case "json":
      s = z.record(z.string(), z.unknown());
      break;
  }
  return col.required ? s : s.nullable();
}

export function zodFor(t: TableDef) {
  const shape: Record<string, z.ZodType> = {};
  for (const col of allColumns(t)) shape[col.name] = columnSchema(col);
  return z.strictObject(shape);
}

const cache = new Map<string, ReturnType<typeof zodFor>>();

export function validatorFor(name: TableName) {
  let v = cache.get(name);
  if (!v) {
    v = zodFor(TABLES[name]);
    cache.set(name, v);
  }
  return v;
}

export interface RowProblem {
  column: string;
  message: string;
}

export function validateRow(name: TableName, row: unknown): RowProblem[] {
  const r = validatorFor(name).safeParse(row);
  if (r.success) return [];
  return r.error.issues.map((i) => ({ column: i.path.join(".") || "(row)", message: i.message }));
}
