// Reading the spreadsheets the importers understand, from a file path.

import { readFileSync } from "node:fs";
import { basename, extname } from "node:path";
import { readCsv, readXlsx, type SheetData } from "@touchdown/core";

export function readSheets(path: string): SheetData[] {
  const ext = extname(path).toLowerCase();
  if (ext === ".xlsx") return readXlsx(new Uint8Array(readFileSync(path)));
  return [readCsv(readFileSync(path, "utf8"), basename(path))];
}
