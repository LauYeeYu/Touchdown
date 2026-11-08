// The reference tables for the CLI: the ones the app ships with and the small airfields, which the web app loads only
// when a record needs one (docs/13, "Airports"). Read from disk, both cost nothing worth saving.

import { rowsToObjects, type Airport, type RefTableFile, type RefTables } from "@touchdown/core";
import { loadRefTables } from "@touchdown/refdata";
import airfields from "@touchdown/refdata/data/airfields.json" with { type: "json" };

export function refTables(): RefTables {
  const tables = loadRefTables();
  return { ...tables, airports: [...tables.airports, ...rowsToObjects<Airport>(airfields as RefTableFile)] };
}
