// Checks on a record that is still being typed: run the same rules on a scratch copy of the log with the
// draft in it, and keep the findings about the draft (docs/20-validation.md, "Field edited").

import { checkAll, normaliseFlight, normaliseSighting, resolveAirframes, Store, type Finding, type FlightValues, type SightingValues, type TableName } from "@touchdown/core";
import type { AppData } from "./app.ts";

const COPY: TableName[] = ["flights", "sightings", "airframes", "registration_periods", "field_provenance"];
const DRAFT_ID = "01DRAFT0000000000000000000";

export function draftFindings(app: AppData, table: "flights" | "sightings", values: Partial<FlightValues> | Partial<SightingValues>, id?: string): Finding[] {
  const scratch = new Store({ deviceId: "draft", validate: false });
  for (const t of COPY) scratch.load(t, app.store.allWithDeleted(t) as never);
  const v = table === "flights" ? normaliseFlight(values as Partial<FlightValues>, app.ref) : normaliseSighting(values as Partial<SightingValues>, app.ref);
  const rowId = id ?? DRAFT_ID;
  if (id && scratch.get(table, id)) scratch.update(table, id, v as never);
  else scratch.insert(table, v as never, rowId);
  const r = resolveAirframes(scratch, app.ref);
  return checkAll(scratch, app.ref, { overlaps: r.overlaps }).filter((f) => f.records.some((x) => x.table === table && x.id === rowId));
}
