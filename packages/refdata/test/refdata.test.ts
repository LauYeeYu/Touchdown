import { describe, expect, it } from "vitest";
import type { RefTableFile, RegistrationPrefix } from "../../core/src/ref/types.ts";
import { loadRefTables, refSources } from "../src/index.ts";
import airportsFile from "../data/airports.json" with { type: "json" };
import operatorsFile from "../data/operators.json" with { type: "json" };
import aircraftTypesFile from "../data/aircraft_types.json" with { type: "json" };
import familiesFile from "../data/families.json" with { type: "json" };
import modelPatternsFile from "../data/model_patterns.json" with { type: "json" };
import registrationPrefixesFile from "../data/registration_prefixes.json" with { type: "json" };

const ref = loadRefTables();

const expectedColumns: [RefTableFile, string, string[]][] = [
  [airportsFile, "airports", ["id", "icao", "iata", "name", "city", "country", "lat", "lon", "elevationFt", "tz"]],
  [operatorsFile, "operators", ["id", "icao", "iata", "name", "callsign", "country", "kind", "validFrom", "validTo"]],
  [aircraftTypesFile, "aircraft_types", ["designator", "manufacturer", "name", "familyId", "engineType", "engineCount", "wtc"]],
  [familiesFile, "families", ["id", "name", "manufacturer"]],
  [modelPatternsFile, "model_patterns", ["designator", "pattern", "example"]],
  [registrationPrefixesFile, "registration_prefixes", ["prefix", "country", "pattern"]],
];

describe("table files", () => {
  it.each(expectedColumns)("%# has the expected header", (file, table, columns) => {
    expect(file.table).toBe(table);
    expect(file.version).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(file.sources.length).toBeGreaterThan(0);
    expect(file.columns).toEqual(columns);
    for (const row of file.rows) expect(row).toHaveLength(columns.length);
  });

  it("lists the ODC-By attribution", () => {
    expect(refSources().some((s) => s.includes("Mictronics") && s.includes("ODC-By"))).toBe(true);
  });
});

describe("model patterns", () => {
  const compiled = ref.modelPatterns.map((p) => ({ ...p, re: new RegExp(p.pattern) }));

  it("compile and match their own example", () => {
    for (const p of compiled) expect(p.re.test(p.example), `${p.designator} ${p.pattern} vs ${p.example}`).toBe(true);
  });

  it("match each example to one designator only", () => {
    for (const p of compiled) {
      const designators = [...new Set(compiled.filter((q) => q.re.test(p.example)).map((q) => q.designator))];
      expect(designators, `example ${p.example}`).toEqual([p.designator]);
    }
  });

  it("refer to known aircraft types", () => {
    const types = new Set(ref.aircraftTypes.map((t) => t.designator));
    for (const p of ref.modelPatterns) expect(types.has(p.designator), p.designator).toBe(true);
  });

  it("cover the common airliner types", () => {
    const covered = new Set(ref.modelPatterns.map((p) => p.designator));
    const airliners = [
      "A318", "A319", "A320", "A321", "A19N", "A20N", "A21N", "BCS1", "BCS3", "A306", "A310", "A332", "A333", "A338", "A339",
      "A343", "A346", "A359", "A35K", "A388", "B712", "B733", "B738", "B739", "B38M", "B39M", "B744", "B748", "B752", "B763",
      "B772", "B77W", "B779", "B788", "B789", "B78X", "E170", "E75L", "E75S", "E190", "E195", "E290", "E295", "CRJ2", "CRJ7",
      "CRJ9", "CRJX", "AT45", "AT76", "DH8D", "MD82", "MD90", "MD11",
    ];
    for (const d of airliners) expect(covered.has(d), d).toBe(true);
  });

  it("match model designations in the forms people write them", () => {
    const cases: [string, string][] = [
      ["A321-271NX", "A21N"],
      ["A321-273NY(XLR)", "A21N"],
      ["A330-343", "A333"],
      ["A350-941", "A359"],
      ["737-86N", "B738"],
      ["737-800", "B738"],
      ["737-8AS", "B738"],
      ["737-8K5", "B738"],
      ["737-900(ER)", "B739"],
      ["737-8", "B38M"],
      ["737-8200", "B38M"],
      ["777-36N(ER)", "B77W"],
      ["777-300(ER)", "B77W"],
      ["777-3FX(ER)", "B77W"],
      ["777F", "B77L"],
      ["767-300(ER)-BDSF", "B763"],
      ["787-9", "B789"],
      ["E175LR", "E75L"],
      ["E175LR", "E75S"],
      ["ERJ170-200LR", "E75L"],
      ["CRJ-900NG", "CRJ9"],
      ["DHC-8-402", "DH8D"],
    ];
    for (const [model, designator] of cases) {
      const res = ref.modelPatterns.filter((p) => p.designator === designator).map((p) => new RegExp(p.pattern));
      expect(res.some((re) => re.test(model)), `${model} -> ${designator}`).toBe(true);
    }
  });
});

describe("families and aircraft types", () => {
  it("every familyId exists in families", () => {
    const ids = new Set(ref.families.map((f) => f.id));
    for (const t of ref.aircraftTypes) if (t.familyId) expect(ids.has(t.familyId), `${t.designator} -> ${t.familyId}`).toBe(true);
  });

  it("every family has at least one type", () => {
    const used = new Set(ref.aircraftTypes.map((t) => t.familyId));
    for (const f of ref.families) expect(used.has(f.id), f.id).toBe(true);
  });

  it("uses the default grouping", () => {
    const family = (d: string) => ref.aircraftTypes.find((t) => t.designator === d)?.familyId;
    expect(family("A21N")).toBe("A320");
    expect(family("BCS3")).toBe("A220");
    expect(family("B38M")).toBe("B737");
    expect(family("E170")).toBe("E170");
    expect(family("E75L")).toBe("E175");
    expect(family("E295")).toBe("E195");
  });

  it("has unique designators and readable airliner names", () => {
    const designators = ref.aircraftTypes.map((t) => t.designator);
    expect(new Set(designators).size).toBe(designators.length);
    const a21n = ref.aircraftTypes.find((t) => t.designator === "A21N");
    expect(a21n).toMatchObject({ manufacturer: "Airbus", name: "A321neo", engineType: "jet", engineCount: 2, wtc: "M" });
    expect(ref.aircraftTypes.find((t) => t.designator === "A388")?.wtc).toBe("J");
  });
});

describe("airports", () => {
  it("have valid IANA time zones", () => {
    const zones = new Set(ref.airports.map((a) => a.tz));
    for (const tz of zones) expect(() => new Intl.DateTimeFormat(undefined, { timeZone: tz }), tz).not.toThrow();
  });

  it("have unique ids, ICAO codes and IATA codes", () => {
    const unique = (values: (string | null)[]) => {
      const present = values.filter((v): v is string => !!v);
      return new Set(present).size === present.length;
    };
    expect(unique(ref.airports.map((a) => a.id))).toBe(true);
    expect(unique(ref.airports.map((a) => a.icao))).toBe(true);
    expect(unique(ref.airports.map((a) => a.iata))).toBe(true);
  });

  it("include major airports with coordinates", () => {
    const lhr = ref.airports.find((a) => a.iata === "LHR");
    expect(lhr).toMatchObject({ id: "ap_egll", icao: "EGLL", country: "GB", tz: "Europe/London" });
    expect(lhr!.lat).toBeCloseTo(51.47, 1);
    for (const a of ref.airports) expect(Number.isFinite(a.lat) && Number.isFinite(a.lon), a.id).toBe(true);
  });
});

describe("operators", () => {
  it("include the generic private owner", () => {
    expect(ref.operators.find((o) => o.id === "op_private")).toMatchObject({ kind: "private", icao: null, iata: null });
  });

  it("resolve common airlines by both codes", () => {
    const pairs = [
      "DL/DAL", "UA/UAL", "AA/AAL", "AS/ASA", "B6/JBU", "WN/SWA", "LH/DLH", "NH/ANA", "CA/CCA", "MU/CES", "CZ/CSN", "HU/CHH",
      "HO/DKH", "NS/HBH", "BA/BAW", "AF/AFR", "KL/KLM", "SQ/SIA", "CX/CPA", "EK/UAE", "QR/QTR", "AC/ACA", "EI/EIN", "HA/HAL",
      "OO/SKW", "YX/RPA", "MQ/ENY", "9E/EDV", "PT/PDT",
    ];
    for (const pair of pairs) {
      const [iata, icao] = pair.split("/");
      const active = ref.operators.filter((o) => o.iata === iata && !o.validTo);
      expect(active.map((o) => o.icao), pair).toEqual([icao]);
      expect(ref.operators.filter((o) => o.icao === icao), pair).toHaveLength(1);
    }
    expect(ref.operators.find((o) => o.icao === "EJA")?.kind).toBe("business");
  });

  it("have unique ids and valid codes", () => {
    const ids = ref.operators.map((o) => o.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const o of ref.operators) {
      if (o.icao) expect(o.icao).toMatch(/^[A-Z]{3}$/);
      if (o.iata) expect(o.iata).toMatch(/^[A-Z0-9]{2}$/);
      if (o.country) expect(o.country).toMatch(/^[A-Z]{2}$/);
      if (o.validFrom && o.validTo) expect(o.validFrom <= o.validTo, o.id).toBe(true);
    }
  });
});

describe("registration prefixes", () => {
  const prefixes = ref.registrationPrefixes.map((p) => ({ ...p, re: new RegExp(p.pattern), bare: p.prefix.replace(/-/g, "") }));

  // Same rule as the core: try prefixes from the longest to the shortest, take the first whose
  // pattern matches the registration with the prefix's dash.
  function classify(input: string): RegistrationPrefix | null {
    const bare = input.toUpperCase().replace(/-/g, "");
    for (const p of [...prefixes].sort((a, b) => b.bare.length - a.bare.length)) {
      if (!bare.startsWith(p.bare)) continue;
      const dashAt = p.prefix.indexOf("-");
      const display = dashAt >= 0 ? bare.slice(0, dashAt) + "-" + bare.slice(dashAt) : bare;
      if (p.re.test(input.toUpperCase()) || p.re.test(display)) return p;
    }
    return null;
  }

  it("have patterns that compile and unique prefixes", () => {
    expect(prefixes.length).toBeGreaterThanOrEqual(120);
    expect(new Set(prefixes.map((p) => p.prefix)).size).toBe(prefixes.length);
    for (const p of prefixes) {
      expect(p.pattern.startsWith("^") && p.pattern.endsWith("$"), p.prefix).toBe(true);
      expect(p.country).toMatch(/^[A-Z]{2}$/);
    }
  });

  it("classify sample registrations, with or without the dash", () => {
    const samples: [string, string][] = [
      ["N123AB", "US"], ["B-1234", "CN"], ["B-18901", "TW"], ["B-HNR", "HK"], ["B-MAB", "MO"], ["D-ABCD", "DE"],
      ["G-EUPT", "GB"], ["JA801A", "JP"], ["HL7782", "KR"], ["C-FIVQ", "CA"], ["VH-OQA", "AU"], ["9V-SMA", "SG"],
      ["EI-DEI", "IE"], ["F-GSPA", "FR"], ["PH-BVA", "NL"], ["HB-JNA", "CH"], ["A6-EDA", "AE"], ["VT-ANA", "IN"],
      ["9M-MNA", "MY"], ["HS-TGA", "TH"], ["RP-C7772", "PH"], ["PK-GIA", "ID"], ["OE-LBA", "AT"], ["EC-MXV", "ES"],
      ["I-ADJM", "IT"], ["TC-JJA", "TR"], ["LN-RKF", "NO"], ["SE-RES", "SE"], ["OY-KBA", "DK"], ["OH-LWA", "FI"],
      ["SP-LRA", "PL"], ["CS-TUA", "PT"], ["XA-AMX", "MX"], ["PR-AXA", "BR"], ["LV-FNI", "AR"], ["CC-BGA", "CL"],
      ["ZS-SNA", "ZA"], ["ET-AOA", "ET"], ["4X-EKA", "IL"], ["SU-GCA", "EG"], ["RA-89001", "RU"], ["UR-PSA", "UA"],
      ["B-21QZ", "CN"], ["B-605K", "CN"], ["B-58201", "TW"], ["B-KPA", "HK"], ["VP-BJA", "BM"],
    ];
    for (const [reg, country] of samples) {
      expect(classify(reg)?.country, reg).toBe(country);
      expect(classify(reg.replace("-", ""))?.country, reg.replace("-", "")).toBe(country);
    }
  });

  it("reject malformed registrations", () => {
    for (const reg of ["N0123", "NI23AB", "N123456", "B-12345678", "C-ABCD", "D-ABC"]) expect(classify(reg), reg).toBeNull();
  });
});
