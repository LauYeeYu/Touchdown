import { describe, expect, it } from "vitest";
import { RefIndex } from "@touchdown/core";
import { refTables } from "../../core/test/fixtures.ts";
import { openSkyCandidates, openSkyEvidence, openSkyFacts, parseOpenSkyRow, splitOpenSkyLine } from "../src/providers/opensky.ts";

const ref = new RefIndex(refTables);

// Made-up rows in the snapshot's layout (32 fields).
const aligned = `'a00001','2024-01-01 00:00:00',0,0,'2019-01-01',Medium,United States,'2x CFM LEAP',,,L2J,'5001',AIRBUS,Airbus,A321 271NX,0,'','',Delta Air Lines,DELTA,DL,DAL,Delta Air Lines,'',,'2019-06-03',N1001X,'','99001','',A21N,0`;
// An unquoted comma in the operator name pushes the middle fields out of place.
const shifted = `'a00002','2024-01-01 00:00:00',0,0,,'',United States,'',,,L2J,'',BOEING,Boeing,757 232,0,'','',Example Air, Inc.,'','',EXA,Example Air,'',,,N2002X,'','29001','',B752,0`;

describe("OpenSky snapshot rows", () => {
  it("splits quoted and bare fields", () => {
    expect(splitOpenSkyLine(`'a','b,c',,d,'it''s'`)).toEqual(["a", "b,c", "", "d", "it's"]);
  });

  it("reads an aligned row", () => {
    const r = parseOpenSkyRow(aligned)!;
    expect(r).toMatchObject({ registration: "N1001X", serialNumber: "99001", typecode: "A21N", registered: "2019-06-03", lineNumber: "5001", model: "A321 271NX" });
    const f = openSkyFacts(r, ref);
    expect(f).toMatchObject({ msn: "99001", typeCode: "A21N", manufacturer: "Airbus", notBefore: "2019-01-01", lineNumber: "5001", icaoHex: "a00001" });
    expect(f.registrations).toEqual([{ registration: "N1001X", from: "2019-06-03", to: null, operator: null }]);
  });

  it("offers a row without a serial number only for its transponder address, and only when no row has one", () => {
    const withMsn = parseOpenSkyRow(aligned)!;
    const bare = { ...withMsn, serialNumber: "", icao24: "a00009", lineNumber: "" };
    expect(openSkyCandidates([bare, withMsn], ref).map((f) => [f.msn, f.icaoHex])).toEqual([["99001", "a00001"]]);
    expect(openSkyCandidates([bare], ref)).toMatchObject([{ msn: null, lineNumber: null, icaoHex: "a00009" }]);
    expect(openSkyCandidates([{ ...bare, icao24: "" }], ref)).toEqual([]);
  });

  it("reads the end of a row whose middle has an extra comma", () => {
    const r = parseOpenSkyRow(shifted)!;
    expect(r).toMatchObject({ registration: "N2002X", serialNumber: "29001", typecode: "B752", lineNumber: "", model: "" });
  });

  it("gives a spotting session the type, model and operator, the operator only from a row that splits cleanly", () => {
    expect(openSkyEvidence(parseOpenSkyRow(aligned)!, ref)).toMatchObject({ source: "opensky", typeCode: "A21N", model: "A321-271NX", operator: "DAL", operatorName: "Delta Air Lines", asOf: "2024-01-01" });
    expect(openSkyEvidence(parseOpenSkyRow(shifted)!, ref)).toMatchObject({ typeCode: "B752", operator: null });
  });
});
