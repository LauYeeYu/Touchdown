// Reading a spreadsheet in the terminal (docs/21, "Source: any spreadsheet"): the columns are worked out and shown;
// the ones that are unclear are settled by a layout confirmed before, --map, the agent (only when one is chosen)
// and the user. A layout the user confirms is remembered by its headers.

import { readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { createInterface } from "node:readline/promises";
import {
  COLUMN_FIELDS,
  FIELD_DEFS,
  fieldsOf,
  guessMapping,
  headerSignature,
  isFr24Export,
  mappingProblem,
  normaliseRegistration,
  parseSource,
  readMapped,
  unsureColumns,
  type ColumnField,
  type ParsedSource,
  type RefIndex,
  type RowKind,
  type SheetData,
  type SheetMapping,
} from "@touchdown/core";
import { runAgent, type Agent } from "./agents.ts";
import { savedMapping, saveMapping } from "./settings.ts";
import { readSheets } from "./sheets.ts";
import { bold, dim, fit, yellow } from "./term.ts";

const MAPPER_PROMPT = join(import.meta.dirname, "../../../prompts/mapper.md");

export interface ReadOptions {
  /** "Header=field" or "3=field" (column number), from --map. */
  maps: string[];
  /** The agent to ask about unclear columns; null for none. */
  agent: Agent | null;
  model?: string;
  /** Ask the user about unclear columns and to confirm a new layout (needs a terminal). */
  ask: boolean;
}

export type SheetRead = { source: ParsedSource; kind: RowKind | "fr24"; sheetName: string } | { error: string };

const label = (f: ColumnField) => FIELD_DEFS[f].label;

/** The fields a column can take for a kind of rows, as typed answers: "registration", "airline", … */
const choices = (kind: RowKind) => COLUMN_FIELDS.filter((f) => FIELD_DEFS[f].kinds.includes(kind));

// A value that may be a ticket number or a booking reference is never shown to the agent (AGENTS.md).
export function mayShowAgent(v: string, ref: RefIndex): boolean {
  // Ticket numbers: ten or more digits, often grouped ("123-4567890123/1").
  if (/^\d{10,}$/.test(v.replace(/[\s/-]/g, ""))) return false;
  // Booking references: six capitals and digits as written ("XQ7K2P"), unless it is a registration.
  const t = v.trim();
  if (/^[A-Z0-9]{6}$/.test(t) && !normaliseRegistration(t, ref)?.knownFormat) return false;
  return true;
}

/** Asks the agent what the unclear columns hold. Its answers are proposals the user confirms. */
async function askAgent(agent: Agent, model: string | undefined, sheet: SheetData, m: SheetMapping, ref: RefIndex): Promise<Map<number, { field: ColumnField; reason: string }>> {
  const unsure = unsureColumns(m);
  const allowed = choices(m.kind).filter((f) => !FIELD_DEFS[f].private);
  const payload = {
    kind: m.kind,
    headers: sheet.header,
    fields: allowed.map((f) => ({ field: f, label: label(f) })),
    columns: unsure.map((c) => ({ index: c.index, header: c.header, samples: c.samples.filter((v) => mayShowAgent(v, ref)).map((v) => v.slice(0, 60)) })),
  };
  const schema = {
    type: "object",
    additionalProperties: false,
    required: ["columns"],
    properties: {
      columns: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["index", "field", "reason"],
          properties: { index: { type: "integer" }, field: { type: "string", enum: allowed }, reason: { type: "string" } },
        },
      },
    },
  };
  const out = new Map<number, { field: ColumnField; reason: string }>();
  try {
    const run = await runAgent(agent, readFileSync(MAPPER_PROMPT, "utf8"), JSON.stringify(payload), schema, { timeoutMs: 120_000, model });
    const ids = new Set(unsure.map((c) => c.index));
    // A field one column holds already is not given to a second (text that can be joined aside).
    const held = new Set(m.columns.filter((c) => c.confidence !== "unsure" && c.field !== "ignore").map((c) => c.field));
    for (const a of ((run.answer as { columns?: unknown[] })?.columns ?? []) as { index: number; field: string; reason: string }[]) {
      if (!ids.has(a.index) || !(allowed as string[]).includes(a.field)) continue;
      const field = a.field as ColumnField;
      if (held.has(field) && !FIELD_DEFS[field].many) continue;
      held.add(field);
      out.set(a.index, { field, reason: String(a.reason ?? "").slice(0, 160) });
    }
  } catch (e) {
    console.log(yellow(`  The agent could not help with the columns: ${(e as Error).message}.`));
  }
  return out;
}

function printColumns(m: SheetMapping, fields: ColumnField[], fromAgent: Set<number>) {
  for (const c of m.columns) {
    if (!c.header && !c.samples.length) continue;
    const f = fields[c.index]!;
    const sample = c.samples.slice(0, 3).join(", ");
    const tone = c.confidence === "unsure" && f === "ignore" ? yellow : (s: string) => s;
    const note = fromAgent.has(c.index) ? dim(" (the agent's reading)") : "";
    console.log(`  ${dim(String(c.index + 1).padStart(2))}  ${fit(c.header || "(no header)", 22)} ${tone(fit(label(f), 26))} ${dim(fit(sample, 40))}${note}`);
  }
}

/** Reads `path` as rows of sightings or flights, settling its columns first. */
export async function readSheetFile(path: string, ref: RefIndex, o: ReadOptions): Promise<SheetRead> {
  let sheets: SheetData[];
  try {
    sheets = readSheets(path);
  } catch (e) {
    return { error: `${basename(path)} could not be read: ${(e as Error).message}` };
  }
  for (const sheet of sheets) {
    if (isFr24Export(sheet.header)) return { source: parseSource(sheet, basename(path), ref)!, kind: "fr24", sheetName: sheet.name };
  }
  // The first sheet (tab) whose columns hold enough to read rows.
  const pick = sheets.map((sheet) => ({ sheet, m: guessMapping(sheet, ref) })).find((x) => !mappingProblem(fieldsOf(x.m)));
  if (!pick) return { error: `${basename(path)}: no sheet has a column Touchdown can read as the registration (sightings) or the date and flight number (flights). Name the columns, or use the Import page to choose them.` };
  const { sheet, m } = pick;
  const signature = headerSignature(sheet.header);
  const saved = savedMapping(signature);
  if (saved) {
    console.log(dim(`  Columns as you confirmed them for this layout before (${saved.kind}).`));
    return { source: readMapped(sheet, saved, basename(path), ref), kind: saved.kind, sheetName: sheet.name };
  }

  const fields = m.columns.map((c) => c.field);
  for (const spec of o.maps) {
    const [k, v] = spec.split("=").map((x) => x.trim());
    const col = /^\d+$/.test(k ?? "") ? Number(k) - 1 : sheet.header.findIndex((h) => h.trim().toLowerCase() === (k ?? "").toLowerCase());
    if (col < 0 || col >= fields.length || !(COLUMN_FIELDS as readonly string[]).includes(v ?? "")) return { error: `--map ${spec}: give a column (its header or number) and one of: ${choices(m.kind).join(", ")}.` };
    fields[col] = v as ColumnField;
    m.columns[col]!.confidence = "sure";
  }

  console.log(`\n${bold(`Columns of ${basename(path)}${sheets.length > 1 ? ` (tab "${sheet.name}")` : ""}`)}: read as ${m.kind}`);
  const unsure = unsureColumns(m);
  const proposals = unsure.length && o.agent ? await askAgent(o.agent, o.model, sheet, m, ref) : new Map<number, { field: ColumnField; reason: string }>();
  for (const [i, p] of proposals) fields[i] = p.field;
  printColumns(m, fields, new Set(proposals.keys()));

  if (o.ask && process.stdin.isTTY) {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    try {
      if (unsure.length) console.log(`\n${bold("Unclear columns.")} ${dim(`Press Enter to accept, or type a field: ${choices(m.kind).join(", ")}.`)}`);
      for (const c of unsure) {
        const p = proposals.get(c.index);
        const now = fields[c.index]!;
        const hint = p ? `the agent says ${label(p.field).toLowerCase()}: ${p.reason}` : c.why;
        for (;;) {
          const a = (await rl.question(`  ${dim(String(c.index + 1).padStart(2))}  ${c.header || "(no header)"} ${dim(`(${hint})`)} [${now}]: `)).trim();
          if (!a) break;
          if ((choices(m.kind) as string[]).includes(a)) {
            fields[c.index] = a as ColumnField;
            break;
          }
          console.log(dim(`      Type one of: ${choices(m.kind).join(", ")}.`));
        }
      }
      const problem = mappingProblem({ kind: m.kind, fields });
      if (problem) return { error: problem };
      const ok = (await rl.question(`Read the rows with these columns, and remember them for files laid out like this? [Y/n] `)).trim();
      if (/^no?$/i.test(ok)) return { error: "Stopped. Run again with --map \"Header=field\" to set a column, or choose the columns on the Import page." };
      saveMapping(signature, { kind: m.kind, fields });
    } finally {
      rl.close();
    }
  } else if (unsure.some((c) => fields[c.index] === "ignore")) {
    console.log(dim(`  Unclear columns are not used. Set one with --map "Header=field".`));
  }
  const problem = mappingProblem({ kind: m.kind, fields });
  if (problem) return { error: problem };
  return { source: readMapped(sheet, { kind: m.kind, fields }, basename(path), ref), kind: m.kind, sheetName: sheet.name };
}
