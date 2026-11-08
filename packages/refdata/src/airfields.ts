// The small airfields (docs/13, "Airports"): airfields, seaplane bases and heliports with an ICAO code and no IATA
// code, which private flights use. Loaded only when a record or a typed code needs one, as an entry of its own
// (`@touchdown/refdata/airfields`), so loading the tables does not load it.

import { rowsToObjects, type Airport, type RefTableFile } from "../../core/src/ref/types.ts";

/** The small airfields, as reference airports. */
export async function loadAirfields(): Promise<Airport[]> {
  // Through a module that imports the file: a browser takes a JSON file imported at run time only as JSON, and the
  // build serves it as a script (as names.ts).
  const file = (await import("./airfields/table.ts")).default as RefTableFile;
  return rowsToObjects<Airport>(file);
}
