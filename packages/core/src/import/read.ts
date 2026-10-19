// Reading import files into header + rows of cell values. CSV through Papa Parse; xlsx unzipped with
// fflate and read from the sheet XML (values only: dates stay serial numbers and are converted exactly).

import Papa from "papaparse";
import { strFromU8, unzipSync } from "fflate";

export type Cell = string | number | boolean | null;

export interface SheetData {
  name: string;
  header: string[];
  rows: Cell[][]; // data rows, each aligned to header
  firstRow: number; // 1-based row number of the first data row in the file
}

export function readCsv(text: string, name = "CSV"): SheetData {
  // Some exports (myFR24) start with an empty line before the header.
  const lines = text.replace(/^﻿/, "").split(/\r?\n/);
  let skip = 0;
  while (skip < lines.length && lines[skip]!.trim() === "") skip++;
  const parsed = Papa.parse<string[]>(lines.slice(skip).join("\n"), { skipEmptyLines: "greedy" });
  const all = parsed.data;
  const header = (all[0] ?? []).map((h) => h.trim());
  const rows = all.slice(1).map((r) => header.map((_, i) => (r[i] ?? "").trim() || null));
  return { name, header, rows, firstRow: skip + 2 };
}

const XML_ENTITIES: Record<string, string> = { "&lt;": "<", "&gt;": ">", "&amp;": "&", "&quot;": '"', "&apos;": "'" };

function decodeXml(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&(lt|gt|amp|quot|apos);/g, (m) => XML_ENTITIES[m]!);
}

function columnIndex(ref: string): number {
  const letters = /^[A-Z]+/.exec(ref)![0];
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

function textOf(xml: string): string {
  let out = "";
  for (const m of xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)) out += m[1];
  return decodeXml(out);
}

/** Read every sheet of an xlsx workbook. */
export function readXlsx(data: Uint8Array): SheetData[] {
  const files = unzipSync(data);
  const get = (p: string) => (files[p] ? strFromU8(files[p]!) : null);
  const shared: string[] = [];
  const sst = get("xl/sharedStrings.xml");
  if (sst) for (const m of sst.matchAll(/<si>([\s\S]*?)<\/si>/g)) shared.push(textOf(m[1]!));

  const workbook = get("xl/workbook.xml") ?? "";
  const rels = get("xl/_rels/workbook.xml.rels") ?? "";
  const target = new Map<string, string>();
  for (const m of rels.matchAll(/<Relationship\b[^>]*>/g)) {
    const id = /\bId="([^"]+)"/.exec(m[0])?.[1];
    const t = /\bTarget="([^"]+)"/.exec(m[0])?.[1];
    if (id && t) target.set(id, t.replace(/^\/?(xl\/)?/, "xl/"));
  }
  const sheets: SheetData[] = [];
  for (const m of workbook.matchAll(/<sheet\b[^>]*>/g)) {
    const name = decodeXml(/\bname="([^"]*)"/.exec(m[0])?.[1] ?? "");
    const rid = /\br:id="([^"]+)"/.exec(m[0])?.[1];
    const xml = rid ? get(target.get(rid) ?? "") : null;
    if (!xml) continue;
    const grid: { row: number; cells: Cell[] }[] = [];
    for (const rm of xml.matchAll(/<row\b([^>]*)>([\s\S]*?)<\/row>/g)) {
      const rowNum = Number(/\br="(\d+)"/.exec(rm[1]!)?.[1] ?? grid.length + 1);
      const cells: Cell[] = [];
      for (const cm of rm[2]!.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const attrs = cm[1]!;
        const ref = /\br="([A-Z]+\d+)"/.exec(attrs)?.[1];
        const type = /\bt="([^"]+)"/.exec(attrs)?.[1];
        const body = cm[2] ?? "";
        const v = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1];
        let value: Cell = null;
        if (type === "s" && v !== undefined) value = shared[Number(v)] ?? null;
        else if (type === "inlineStr") value = textOf(body);
        else if (type === "str" && v !== undefined) value = decodeXml(v);
        else if (type === "b" && v !== undefined) value = v === "1";
        else if (v !== undefined) value = Number(v);
        if (typeof value === "string") value = value.trim() || null;
        const idx = ref ? columnIndex(ref) : cells.length;
        cells[idx] = value;
      }
      grid.push({ row: rowNum, cells });
    }
    const headerRow = grid.find((g) => g.cells.some((c) => c !== null && c !== undefined));
    if (!headerRow) {
      sheets.push({ name, header: [], rows: [], firstRow: 1 });
      continue;
    }
    const header = Array.from(headerRow.cells, (c) => (c === null || c === undefined ? "" : String(c).trim()));
    const rows = grid
      .filter((g) => g.row > headerRow.row && g.cells.some((c) => c !== null && c !== undefined))
      .map((g) => header.map((_, i) => g.cells[i] ?? null));
    sheets.push({ name, header, rows, firstRow: headerRow.row + 1 });
  }
  return sheets;
}

/** Cell as trimmed text; numbers keep their plain form. */
export function cellText(c: Cell | undefined): string | null {
  if (c === null || c === undefined) return null;
  if (typeof c === "number") return Number.isInteger(c) ? String(c) : String(c);
  if (typeof c === "boolean") return c ? "TRUE" : "FALSE";
  const t = c.trim();
  return t || null;
}
