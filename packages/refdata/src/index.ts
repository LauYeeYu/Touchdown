// Reference tables shipped with the app (docs/10-domain-model.md, "Reference tables").
// The JSON files in ../data are written by scripts/build.ts.

// Relative import: @touchdown/core only exports its src/index.ts, which is still being written.
// Switch to "@touchdown/core" once it re-exports the ref types.
import { rowsToObjects, type RefTableFile, type RefTables } from "../../core/src/ref/types.ts";
import airports from "../data/airports.json" with { type: "json" };
import operators from "../data/operators.json" with { type: "json" };
import aircraftTypes from "../data/aircraft_types.json" with { type: "json" };
import families from "../data/families.json" with { type: "json" };
import modelPatterns from "../data/model_patterns.json" with { type: "json" };
import registrationPrefixes from "../data/registration_prefixes.json" with { type: "json" };

export function loadRefTables(): RefTables {
  return {
    airports: rowsToObjects(airports as RefTableFile),
    operators: rowsToObjects(operators as RefTableFile),
    aircraftTypes: rowsToObjects(aircraftTypes as RefTableFile),
    families: rowsToObjects(families as RefTableFile),
    modelPatterns: rowsToObjects(modelPatterns as RefTableFile),
    registrationPrefixes: rowsToObjects(registrationPrefixes as RefTableFile),
  };
}

/** Attribution lines of every table, for the About page and for exports that contain derived data. */
export function refSources(): string[] {
  const files = [airports, operators, aircraftTypes, families, modelPatterns, registrationPrefixes] as RefTableFile[];
  return [...new Set(files.flatMap((f) => f.sources))];
}

/** Build date of the reference data (YYYY-MM-DD). */
export const refVersion: string = (airports as RefTableFile).version;
