import { describe, expect, it } from "vitest";
import { RefIndex } from "@touchdown/core";
import { refTables } from "../../core/test/fixtures.ts";
import { mayShowAgent } from "../src/columns.ts";

const ref = new RefIndex(refTables);

describe("sample values the agent may see when it helps with columns", () => {
  it("never include what may be a ticket number or a booking reference", () => {
    // Made-up values in the shapes of a ticket number and a booking reference.
    expect(mayShowAgent("1234567890123", ref)).toBe(false);
    expect(mayShowAgent("123-4567890123/1", ref)).toBe(false);
    expect(mayShowAgent("XQ7K2P", ref)).toBe(false);
  });

  it("include registrations, codes and text", () => {
    expect(mayShowAgent("N1001X", ref)).toBe(true);
    expect(mayShowAgent("D-ABCD", ref)).toBe(true);
    expect(mayShowAgent("EGLL", ref)).toBe(true);
    expect(mayShowAgent("Too far", ref)).toBe(true);
  });
});
