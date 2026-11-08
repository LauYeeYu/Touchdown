import { describe, expect, it } from "vitest";
import { RefIndex } from "@touchdown/core";
import { refTables } from "../src/reftables.ts";

describe("the CLI's reference tables", () => {
  it("have the small airfields with the airports", () => {
    const ref = new RefIndex(refTables());
    expect(ref.airportByCode("LHR")?.id).toBe("ap_egll");
    expect(ref.airportByCode("EGLM")).toMatchObject({ name: "White Waltham Airfield", tz: "Europe/London" });
  });
});
