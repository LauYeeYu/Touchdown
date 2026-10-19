// JSON Schema for one table file of the JSON tables backend (docs/12-storage-and-sync.md) and for the
// agent check hand-off files.

import { allColumns, type ColumnDef, type TableDef } from "./columns.ts";
import { DATE_RE, DATETIME_RE } from "./validate.ts";
import { SCHEMA_NAME } from "./tables.ts";

type Json = Record<string, unknown>;

function columnJsonSchema(col: ColumnDef): Json {
  let s: Json;
  switch (col.type) {
    case "id":
    case "ref":
    case "text":
      s = { type: "string" };
      break;
    case "integer":
      s = { type: "integer" };
      break;
    case "real":
      s = { type: "number" };
      break;
    case "boolean":
      s = { type: "boolean" };
      break;
    case "date":
      s = { type: "string", pattern: DATE_RE.source };
      break;
    case "datetime":
      s = { type: "string", pattern: DATETIME_RE.source };
      break;
    case "enum":
      s = { type: "string", enum: [...col.values!] };
      break;
    case "json":
      s = { type: "object" };
      break;
  }
  if (col.required) return s;
  return { anyOf: [s, { type: "null" }] };
}

export function rowJsonSchema(t: TableDef): Json {
  const cols = allColumns(t);
  return {
    type: "object",
    additionalProperties: false,
    required: cols.map((c) => c.name),
    properties: Object.fromEntries(cols.map((c) => [c.name, columnJsonSchema(c)])),
  };
}

export function tableFileJsonSchema(t: TableDef, schemaVersion: number): Json {
  return {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    title: `${SCHEMA_NAME} table file: ${t.name}`,
    type: "object",
    additionalProperties: false,
    required: ["schema", "schemaVersion", "table", "columns", "rows"],
    properties: {
      schema: { const: SCHEMA_NAME },
      schemaVersion: { const: schemaVersion },
      table: { const: t.name },
      columns: { const: allColumns(t).map((c) => c.name) },
      rows: { type: "array", items: rowJsonSchema(t) },
    },
  };
}
