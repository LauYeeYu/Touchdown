import { describe, expect, it } from "vitest";
import { strFromU8, unzipSync } from "fflate";
import { readXlsx, saveFlight, tableRows, writeXlsx } from "../src/index.ts";
import { newStore, ref } from "./fixtures.ts";

describe("writing a workbook", () => {
  it("reads back as the tables it was written from, one sheet each", () => {
    const file = writeXlsx([
      { name: "Flights", rows: [["Date", "Flight", "Distance", "Note"], ["2025-03-14", "DL9001", 5555.5, 'Tea & "biscuits" <3'], ["2025-03-15", null, 12, "=1+1"]] },
      { name: "Sightings: 2025/03", rows: [["Registration"], ["N901DX"]] },
    ]);
    const sheets = readXlsx(file);
    expect(sheets.map((s) => s.name)).toEqual(["Flights", "Sightings  2025 03"]);
    expect(sheets[0]!.header).toEqual(["Date", "Flight", "Distance", "Note"]);
    expect(sheets[0]!.rows).toEqual([
      ["2025-03-14", "DL9001", 5555.5, 'Tea & "biscuits" <3'],
      // Text that looks like a formula stays text: the workbook has no formulas.
      ["2025-03-15", null, 12, "=1+1"],
    ]);
    expect(sheets[1]!.rows).toEqual([["N901DX"]]);
    const sheet = strFromU8(unzipSync(file)["xl/worksheets/sheet1.xml"]!);
    expect(sheet).not.toContain("<f>");
    expect(sheet).toContain('state="frozen"');
  });

  it("holds a table as its CSV does, private fields only when asked", () => {
    const store = newStore();
    saveFlight(store, ref, { scheduledDate: "2025-03-14", flightNumber: "DL9001", fromRaw: "LHR", toRaw: "JFK", ticketNumber: "0000000000000" });
    const plain = tableRows(store, "flights");
    expect(plain[0]).toContain("flightNumber");
    expect(plain[0]).not.toContain("ticketNumber");
    const full = tableRows(store, "flights", true);
    const at = full[0]!.indexOf("ticketNumber");
    expect(full[1]![at]).toBe("0000000000000");
    const back = readXlsx(writeXlsx([{ name: "Flights", rows: plain as never }]))[0]!;
    expect(back.header).toEqual(plain[0]);
    expect(back.rows[0]![back.header.indexOf("flightNumber")]).toBe("DL9001");
  });
});
