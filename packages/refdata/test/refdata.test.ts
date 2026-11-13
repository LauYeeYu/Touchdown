import { describe, expect, it } from "vitest";
import type { RefTableFile, RegistrationPrefix } from "../../core/src/ref/types.ts";
import { RefIndex } from "../../core/src/ref/index.ts";
import { loadRefTables, refSources } from "../src/index.ts";
import { loadAirfields } from "../src/airfields.ts";
import { familyOrder } from "../src/curated/type-order.ts";
import { genericShape } from "../src/curated/silhouettes.ts";
import { loadTypeWikidata, typeWikidataSource } from "../src/typeinfo.ts";
import airportsFile from "../data/airports.json" with { type: "json" };
import airfieldsFile from "../data/airfields.json" with { type: "json" };
import operatorsFile from "../data/operators.json" with { type: "json" };
import aircraftTypesFile from "../data/aircraft_types.json" with { type: "json" };
import familiesFile from "../data/families.json" with { type: "json" };
import modelPatternsFile from "../data/model_patterns.json" with { type: "json" };
import registrationPrefixesFile from "../data/registration_prefixes.json" with { type: "json" };
import typeWikidataFile from "../data/type_wikidata.json" with { type: "json" };

const ref = loadRefTables();

const expectedColumns: [RefTableFile, string, string[]][] = [
  [airportsFile, "airports", ["id", "icao", "iata", "name", "city", "country", "lat", "lon", "elevationFt", "tz"]],
  [airfieldsFile, "airfields", ["id", "icao", "iata", "name", "city", "country", "lat", "lon", "elevationFt", "tz"]],
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

describe("type figures from Wikidata", () => {
  const rows = loadTypeWikidata();
  const roles = ["airliner", "business", "light", "helicopter", "military", "other"];
  const date = /^\d{4}(-\d{2}(-\d{2})?)?$/;

  it("has the expected header", () => {
    const file = typeWikidataFile as RefTableFile;
    expect(file.table).toBe("type_wikidata");
    expect(file.version).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(file.sources).toEqual(["Wikidata (wikidata.org), CC0"]);
    expect(file.columns).toEqual([
      "designator", "item", "revision", "label", "role", "lengthM", "spanM", "heightM", "mtowKg", "rangeKm", "cruiseKmh",
      "seatsMax", "engines", "firstFlight", "introduced", "built",
    ]);
    for (const row of file.rows) expect(row).toHaveLength(file.columns.length);
    expect(typeWikidataSource.sources).toEqual(file.sources);
  });

  it("has rows only for known designators, once each, in their order", () => {
    const order = new Map(ref.aircraftTypes.map((t, i) => [t.designator, i]));
    expect(rows.length).toBeGreaterThan(500);
    for (const r of rows) expect(order.has(r.designator), r.designator).toBe(true);
    const at = rows.map((r) => order.get(r.designator)!);
    expect(at).toEqual([...at].sort((a, b) => a - b));
    expect(new Set(at).size).toBe(at.length);
  });

  it("names an item and its revision, and a role from the set", () => {
    for (const r of rows) {
      expect(r.item, r.designator).toMatch(/^Q[1-9]\d*$/);
      expect(Number.isInteger(r.revision) && r.revision > 0, r.designator).toBe(true);
      if (r.role !== null) expect(roles, r.designator).toContain(r.role);
    }
  });

  it("has figures within plausible ranges", () => {
    const within = (v: number | null, lo: number, hi: number, what: string) => {
      if (v !== null) expect(v >= lo && v <= hi, `${what} ${v}`).toBe(true);
    };
    for (const r of rows) {
      within(r.lengthM, 1, 120, `${r.designator} length`);
      within(r.spanM, 1, 120, `${r.designator} span`);
      within(r.heightM, 0.5, 40, `${r.designator} height`);
      within(r.mtowKg, 50, 700_000, `${r.designator} MTOW`);
      within(r.rangeKm, 10, 45_000, `${r.designator} range`);
      within(r.cruiseKmh, 30, 3_700, `${r.designator} cruise`);
      within(r.seatsMax, 1, 1_000, `${r.designator} seats`);
      within(r.built, 1, 200_000, `${r.designator} built`);
      if (r.seatsMax !== null) expect(Number.isInteger(r.seatsMax), r.designator).toBe(true);
      if (r.built !== null) expect(Number.isInteger(r.built), r.designator).toBe(true);
    }
  });

  it("has dates as precise as known, from 1900", () => {
    for (const r of rows) {
      for (const d of [r.firstFlight, r.introduced]) {
        if (d === null) continue;
        expect(d, r.designator).toMatch(date);
        expect(d >= "1900", `${r.designator} ${d}`).toBe(true);
      }
    }
  });
});

describe("type codes by generation, then model", () => {
  const index = new RefIndex(ref);
  const codesOf = (familyId: string) => [...index.types.values()].filter((x) => x.familyId === familyId).map((x) => x.designator);

  it("lists every family with more than one code, each code once", () => {
    for (const fam of index.families.values()) {
      const codes = codesOf(fam.id);
      if (codes.length < 2) continue;
      expect(familyOrder[fam.id], fam.id).toBeDefined();
      expect([...familyOrder[fam.id]!].sort(), fam.id).toEqual([...codes].sort());
    }
  });

  it("names only families the reference data has", () => {
    for (const id of Object.keys(familyOrder)) expect(index.families.has(id), id).toBe(true);
  });
});

describe("a type without a family's shape", () => {
  const kind = (engineType: string, engineCount: number, wtc: string, role: string | null = null) => ({ engineType, engineCount, wtc, role });

  it("is drawn as its kind: engines, their count, its size and its role", () => {
    expect(genericShape(kind("turboshaft", 2, "M", "helicopter"))?.kind).toBe("helicopter");
    expect(genericShape(kind("jet", 2, "M", "military"))?.engines).toBeUndefined();
    expect(genericShape(kind("jet", 4, "H"))?.engines?.wing).toHaveLength(2);
    expect(genericShape(kind("jet", 2, "L", "business"))?.engines?.rear).toBe(2);
    expect(genericShape(kind("piston", 4, "M", "military"))?.engines?.wing).toHaveLength(2);
    expect(genericShape(kind("piston", 1, "L"))?.engines).toBeUndefined();
    expect(genericShape(kind("piston", 1, "L", "other"))).toBeNull();
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

describe("airfields", () => {
  it("have an ICAO code, no IATA code and a valid time zone", async () => {
    const fields = await loadAirfields();
    expect(fields.length).toBeGreaterThan(5000);
    const zones = new Set(fields.map((a) => a.tz));
    for (const tz of zones) expect(() => new Intl.DateTimeFormat(undefined, { timeZone: tz }), tz).not.toThrow();
    for (const a of fields) {
      expect(a.icao, a.id).toMatch(/^[A-Z0-9]{4}$/);
      expect(a.id).toBe(`ap_${a.icao!.toLowerCase()}`);
      expect(a.iata).toBeNull();
      expect(Number.isFinite(a.lat) && Number.isFinite(a.lon), a.id).toBe(true);
    }
  });

  it("share no id or ICAO code with the airports", async () => {
    const fields = await loadAirfields();
    const taken = new Set(ref.airports.flatMap((a) => [a.id, a.icao]));
    expect(fields.filter((a) => taken.has(a.id) || taken.has(a.icao)).map((a) => a.id)).toEqual([]);
    expect(new Set(fields.map((a) => a.icao)).size).toBe(fields.length);
  });

  it("include small airfields that private flights use", async () => {
    const index = new RefIndex(ref);
    expect(index.airportByCode("EGLM")).toBeNull();
    index.addReferenceAirports(await loadAirfields());
    expect(index.airportByCode("EGLM")).toMatchObject({ id: "ap_eglm", country: "GB", tz: "Europe/London" });
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

  it("give a reused code to the airline that held it on the day", () => {
    const index = new RefIndex(ref);
    const on = (code: string, day?: string) => index.operatorByCode(code, day)?.icao;
    expect([on("KA", "2012-05-01"), on("KA", "2024-05-01"), on("KA")]).toEqual(["HDA", "ANK", "ANK"]);
    expect([on("4U", "2015-05-01"), on("MI", "2015-05-01")]).toEqual(["GWI", "SLK"]);
    // Shared with an airline dated in between: the curated start dates and codes keep these right.
    expect([on("9E", "2010-05-01"), on("JM", "2014-06-01"), on("PT", "2010-05-01")]).toEqual(["EDV", "JMA", "PDT"]);
    // One Blue Air for 0B, with a date or without.
    expect([on("0B", "2015-05-01"), on("0B")]).toEqual(["BLA", "BLA"]);
  });

  it("give a code two airlines hold at once to the one from the route's countries", () => {
    const index = new RefIndex(ref);
    const rv = (countries?: string[]) => index.operatorByCode("RV", "2024-06-10", countries)?.icao;
    // Montréal to Toronto is Air Canada Rouge, Tehran to Mashhad Caspian Airlines. Without a route, as before.
    expect([rv(["CA"]), rv(["IR"]), rv(["CA", "US"]), rv()]).toEqual(["ROU", "CPN", "ROU", "CPN"]);
    // A date before Rouge began still gives Caspian, wherever.
    expect(index.operatorByCode("RV", "2010-05-01", ["CA"])?.icao).toBe("CPN");
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
