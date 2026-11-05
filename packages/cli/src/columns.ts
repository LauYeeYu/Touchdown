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
import { t } from "@touchdown/i18n/cli";
import { runAgent, type Agent } from "./agents.ts";
import { savedMapping, saveMapping } from "./settings.ts";
import { readSheets } from "./sheets.ts";
import { bold, dim, fit, tc, yellow } from "./term.ts";

const MAPPER_PROMPT = join(import.meta.dirname, "../../../prompts/mapper.md");

export interface ReadOptions {
  /** "Header=field" or "3=field" (column number), from --map. */
  maps: string[];
  /** The agent to ask about unclear columns; null for none. */
  agent: Agent | null;
  model?: string;
  /** Ask the user about unclear columns and to confirm a new layout (needs a terminal). */
  ask: boolean;
  /** Where the columns are shown; standard output when not given. */
  say?: (line: string) => void;
}

export type SheetRead =
  | {
      source: ParsedSource;
      kind: RowKind | "fr24";
      sheetName: string;
      /** The sheet read, and its columns as settled: null for the Flightradar24 export. */
      sheet: SheetData;
      mapping: { kind: RowKind; fields: ColumnField[] } | null;
    }
  | { error: string };

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
async function askAgent(agent: Agent, model: string | undefined, sheet: SheetData, m: SheetMapping, ref: RefIndex, say: (line: string) => void): Promise<Map<number, { field: ColumnField; reason: string }>> {
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
    say(yellow(`  ${t("cliRead.columns.agentFailed", { error: (e as Error).message })}`));
  }
  return out;
}

function printColumns(m: SheetMapping, fields: ColumnField[], fromAgent: Set<number>, say: (line: string) => void) {
  for (const c of m.columns) {
    if (!c.header && !c.samples.length) continue;
    const f = fields[c.index]!;
    const sample = c.samples.slice(0, 3).join(", ");
    const tone = c.confidence === "unsure" && f === "ignore" ? yellow : (s: string) => s;
    const note = fromAgent.has(c.index) ? dim(` ${t("cliRead.columns.agentReading")}`) : "";
    say(`  ${dim(String(c.index + 1).padStart(2))}  ${fit(c.header || t("cliRead.columns.noHeader"), 22)} ${tone(fit(label(f), 26))} ${dim(fit(sample, 40))}${note}`);
  }
}

/** Reads `path` as rows of sightings or flights, settling its columns first. */
export async function readSheetFile(path: string, ref: RefIndex, o: ReadOptions): Promise<SheetRead> {
  const say = o.say ?? ((line: string) => console.log(line));
  let sheets: SheetData[];
  try {
    sheets = readSheets(path);
  } catch (e) {
    return { error: t("cliRead.columns.unreadable", { file: basename(path), error: (e as Error).message }) };
  }
  for (const sheet of sheets) {
    if (isFr24Export(sheet.header)) return { source: parseSource(sheet, basename(path), ref)!, kind: "fr24", sheetName: sheet.name, sheet, mapping: null };
  }
  // The first sheet (tab) whose columns hold enough to read rows.
  const pick = sheets.map((sheet) => ({ sheet, m: guessMapping(sheet, ref) })).find((x) => !mappingProblem(fieldsOf(x.m)));
  if (!pick) return { error: t("cliRead.columns.noSheet", { file: basename(path) }) };
  const { sheet, m } = pick;
  const signature = headerSignature(sheet.header);
  const saved = savedMapping(signature);
  if (saved) {
    say(dim(`  ${t("cliRead.columns.saved", { kind: saved.kind })}`));
    return { source: readMapped(sheet, saved, basename(path), ref), kind: saved.kind, sheetName: sheet.name, sheet, mapping: saved };
  }

  const fields = m.columns.map((c) => c.field);
  for (const spec of o.maps) {
    const [k, v] = spec.split("=").map((x) => x.trim());
    const col = /^\d+$/.test(k ?? "") ? Number(k) - 1 : sheet.header.findIndex((h) => h.trim().toLowerCase() === (k ?? "").toLowerCase());
    if (col < 0 || col >= fields.length || !(COLUMN_FIELDS as readonly string[]).includes(v ?? "")) return { error: t("cliRead.columns.badMap", { spec, fields: choices(m.kind).join(", ") }) };
    fields[col] = v as ColumnField;
    m.columns[col]!.confidence = "sure";
  }

  say(`\n${sheets.length > 1 ? tc("cliRead.columns.titleTab", { file: basename(path), tab: sheet.name, kind: m.kind }, { b: bold }) : tc("cliRead.columns.title", { file: basename(path), kind: m.kind }, { b: bold })}`);
  const unsure = unsureColumns(m);
  const proposals = unsure.length && o.agent ? await askAgent(o.agent, o.model, sheet, m, ref, say) : new Map<number, { field: ColumnField; reason: string }>();
  for (const [i, p] of proposals) fields[i] = p.field;
  printColumns(m, fields, new Set(proposals.keys()), say);

  if (o.ask && process.stdin.isTTY) {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    try {
      if (unsure.length) console.log(`\n${tc("cliRead.columns.unclear", { fields: choices(m.kind).join(", ") }, { b: bold, dim })}`);
      for (const c of unsure) {
        const p = proposals.get(c.index);
        const now = fields[c.index]!;
        const hint = p ? t("cliRead.columns.agentSays", { field: label(p.field).toLowerCase(), reason: p.reason }) : c.why;
        for (;;) {
          const a = (await rl.question(`  ${dim(String(c.index + 1).padStart(2))}  ${c.header || t("cliRead.columns.noHeader")} ${dim(`(${hint})`)} [${now}]: `)).trim();
          if (!a) break;
          if ((choices(m.kind) as string[]).includes(a)) {
            fields[c.index] = a as ColumnField;
            break;
          }
          console.log(dim(`      ${t("cliRead.columns.typeOne", { fields: choices(m.kind).join(", ") })}`));
        }
      }
      const problem = mappingProblem({ kind: m.kind, fields });
      if (problem) return { error: problem };
      const ok = (await rl.question(`${t("cliRead.columns.confirm")} [Y/n] `)).trim();
      if (/^no?$/i.test(ok)) return { error: t("cliRead.columns.stopped") };
      saveMapping(signature, { kind: m.kind, fields });
    } finally {
      rl.close();
    }
  } else if (unsure.some((c) => fields[c.index] === "ignore")) {
    say(dim(`  ${t("cliRead.columns.unclearUnused")}`));
  }
  const problem = mappingProblem({ kind: m.kind, fields });
  if (problem) return { error: problem };
  return { source: readMapped(sheet, { kind: m.kind, fields }, basename(path), ref), kind: m.kind, sheetName: sheet.name, sheet, mapping: { kind: m.kind, fields } };
}
