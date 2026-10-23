import { describe, expect, it } from "vitest";
import { RefIndex } from "@touchdown/core";
import { refTables } from "../../core/test/fixtures.ts";
import { adsbdbEvidence } from "../src/providers/adsbdb.ts";

const ref = new RefIndex(refTables);

describe("adsbdb answers", () => {
  it("give the type, the model in the standard form and the owner's airline code", () => {
    // Made-up aircraft in adsbdb's shape.
    const e = adsbdbEvidence({ type: "A321 271NX", icao_type: "A21N", manufacturer: "Airbus", registration: "G-ABCD", registered_owner: "British Airways", registered_owner_operator_flag_code: "BAW" }, "2026-10-20T10:00:00Z", ref);
    expect(e).toMatchObject({ source: "adsbdb", typeCode: "A21N", model: "A321-271NX", operator: "BAW", operatorName: "British Airways", asOf: "2026-10-20" });
  });

  it("leave out codes Touchdown does not know, and give nothing when nothing is usable", () => {
    expect(adsbdbEvidence({ type: "A321 271NX", icao_type: "A21N", manufacturer: "Airbus", registered_owner_operator_flag_code: "QQQ" }, "2026-10-20T10:00:00Z", ref)?.operator).toBeNull();
    expect(adsbdbEvidence({ type: "Unknown", icao_type: "ZZZZ" }, "2026-10-20T10:00:00Z", ref)).toBeNull();
  });
});
