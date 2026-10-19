import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { FILE_TABLES, manifestFor, stringifyTableFile, toTableFile, type Store } from "@touchdown/core";

/** Write the store as a JSON tables folder (manifest.json + tables/*.json). Returns the number of table files. */
export function writeJsonTables(store: Store, dir: string): number {
  mkdirSync(join(dir, "tables"), { recursive: true });
  for (const t of FILE_TABLES) writeFileSync(join(dir, "tables", `${t}.json`), stringifyTableFile(toTableFile(store, t)));
  writeFileSync(join(dir, "manifest.json"), JSON.stringify(manifestFor(store), null, 2) + "\n");
  return FILE_TABLES.length;
}
