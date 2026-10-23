import { describe, expect, it } from "vitest";
import { completeLine } from "../src/spot.ts";

// Made-up registrations and airport codes.
const regs = ["G-ABCD", "G-ABCE", "D-ABCD"];
const airports = (prefix: string) => ["EGLL", "EGKK", "EDDF"].filter((c) => c.startsWith(prefix));

describe("Tab in a spotting session", () => {
  it("completes commands only at the start of a line", () => {
    expect(completeLine("li", regs, airports)).toEqual([["list"], "li"]);
    expect(completeLine("G-ABCD li", regs, airports)[0]).toEqual([]);
  });

  it("completes phases in the case typed, and registrations", () => {
    expect(completeLine("G-ABCD tak", regs, airports)).toEqual([["taking off"], "tak"]);
    expect(completeLine("G-AB", regs, airports)).toEqual([["G-ABCD", "G-ABCE"], "G-AB"]);
    expect(completeLine("g-abcd", regs, airports)[0]).toEqual([]);
    expect(completeLine("d-ab", regs, airports)).toEqual([["d-abcd"], "d-ab"]);
  });

  it("completes airport codes after at", () => {
    expect(completeLine("G-ABCD at EG", regs, airports)).toEqual([["EGKK", "EGLL"], "EG"]);
    expect(completeLine("G-ABCD ", regs, airports)).toEqual([[], ""]);
  });
});
