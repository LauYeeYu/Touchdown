// Operators merged from Mictronics operators.json, Wikidata and VRS standing-data airlines, by ICAO code.

import type { Operator, OperatorKind } from "../../core/src/ref/types.ts";
import { operatorFixes } from "../src/curated/fixes.ts";
import { compare, parseCsvRecords } from "./lib.ts";

const ICAO_RE = /^[A-Z]{3}$/;
const IATA_RE = /^[A-Z0-9]{2}$/;

/** Wikidata query: every item with an ICAO airline designator (P230), one row per item and code. */
export const WIKIDATA_QUERY = `
SELECT ?item ?icao (SAMPLE(?enLabel) AS ?name) (SAMPLE(?mulLabel) AS ?altName)
  (GROUP_CONCAT(DISTINCT ?iata; separator="|") AS ?iatas)
  (MIN(?inception) AS ?from) (MAX(?dissolved) AS ?to)
  (GROUP_CONCAT(DISTINCT ?iso; separator="|") AS ?countries)
  (MAX(?sl) AS ?sitelinks)
  (GROUP_CONCAT(DISTINCT STRAFTER(STR(?class), "entity/"); separator="|") AS ?classes)
WHERE {
  ?item wdt:P230 ?icao .
  OPTIONAL { ?item rdfs:label ?enLabel FILTER(LANG(?enLabel) = "en") }
  OPTIONAL { ?item rdfs:label ?mulLabel FILTER(LANG(?mulLabel) = "mul") }
  OPTIONAL { ?item wdt:P229 ?iata }
  OPTIONAL { ?item wdt:P571 ?inception FILTER(isLiteral(?inception)) }
  OPTIONAL { ?item wdt:P576 ?dissolved FILTER(isLiteral(?dissolved)) }
  OPTIONAL { ?item wdt:P17 ?c . ?c wdt:P297 ?iso }
  OPTIONAL { ?item wikibase:sitelinks ?sl }
  OPTIONAL { ?item wdt:P31 ?class }
}
GROUP BY ?item ?icao`;

// Wikidata classes (P31) that say more than "airline".
const CLASS_KIND: Record<string, OperatorKind> = {
  Q61883: "military", // air force
  Q4508: "military", // navy
  Q176799: "military", // military unit
  Q781132: "military", // military branch
  Q627716: "military", // military aviation
  Q133505337: "military", // aerospace force
  Q2659904: "government", // government organisation
  Q327333: "government", // government agency
  Q1057026: "cargo", // cargo airline
  Q607958: "charter", // charter airline
  Q936518: "manufacturer", // aerospace manufacturer
  Q153476: "lessor", // aircraft lease
};
const KIND_PRIORITY: OperatorKind[] = ["military", "government", "manufacturer", "cargo", "charter", "lessor"];

// Name keywords, for operators without a helpful Wikidata class.
const NAME_KIND: [RegExp, OperatorKind][] = [
  [/\b(air force|navy|naval|army|marine corps|armed forces|military|fuerza a[eé]rea|luftwaffe|air corps|coast ?guard)\b/i, "military"],
  [/\b(police|government|ministry|presidential|gendarmerie|customs|border guard)\b/i, "government"],
  [/\b(cargo|freight|freighter)\b/i, "cargo"],
];

// Region subtags Intl.DisplayNames knows that are not ISO 3166-1 country codes.
const NOT_ISO_3166 = new Set(["AC", "CP", "CQ", "DG", "EA", "EU", "EZ", "IC", "QO", "TA", "UN", "XA", "XB", "ZZ"]);

// Mictronics country names that Intl.DisplayNames spells differently.
const COUNTRY_ALIASES: Record<string, string | null> = {
  "congo (brazzaville)": "CG",
  "congo (kinshasa)": "CD",
  "cote d'ivoire": "CI",
  "czech republic": "CZ",
  macedonia: "MK",
  myanmar: "MM",
  turkey: "TR",
  "viet nam": "VN",
  "saint vincent and the grenadines": "VC",
  "hong kong": "HK",
  macau: "MO",
  macao: "MO",
  "unknown or unassigned country": null,
};

interface WikidataItem {
  item: string;
  name: string | null;
  iata: string | null;
  from: string | null;
  to: string | null;
  country: string | null;
  sitelinks: number;
  kind: OperatorKind | null;
}

interface MictronicsOperator {
  n: string;
  c: string;
  r: string;
}

export interface OperatorBuild {
  rows: Operator[];
  notes: string[];
}

function countryResolver(): (name: string) => string | null | undefined {
  const display = new Intl.DisplayNames(["en"], { type: "region" });
  const byName = new Map<string, string>();
  const norm = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/&/g, "and").replace(/\u2019/g, "'");
  for (let a = 65; a <= 90; a++) {
    for (let b = 65; b <= 90; b++) {
      const code = String.fromCharCode(a, b);
      // Skip deprecated codes (SU, UK, ...), which Intl maps to the current country's name.
      if (NOT_ISO_3166.has(code) || Intl.getCanonicalLocales(`und-${code}`)[0] !== `und-${code}`) continue;
      let name: string | undefined;
      try {
        name = display.of(code);
      } catch {
        continue;
      }
      if (name && name !== code && !byName.has(norm(name))) byName.set(norm(name), code);
    }
  }
  return (name: string) => {
    const key = norm(name.trim());
    if (key in COUNTRY_ALIASES) return COUNTRY_ALIASES[key];
    return byName.get(key);
  };
}

function date(value: string | undefined): string | null {
  const m = /^(\d{4}-\d{2}-\d{2})T/.exec(value ?? "");
  return m ? m[1]! : null;
}

function kindFromClasses(classes: string): OperatorKind | null {
  const kinds = classes.split("|").map((c) => CLASS_KIND[c]).filter((k): k is OperatorKind => !!k);
  return KIND_PRIORITY.find((k) => kinds.includes(k)) ?? null;
}

function kindFromName(name: string): OperatorKind | null {
  for (const [re, kind] of NAME_KIND) if (re.test(name)) return kind;
  return null;
}

// Words that say nothing about which airline a name refers to.
const GENERIC_WORDS = new Set(["air", "airline", "airlines", "airways", "aviation", "the", "of", "de", "and", "company", "limited", "ltd", "inc", "express", "jet", "international", "group", "aero", "aerea", "aereo", "aereas", "lineas"]);

function significantWords(name: string): Set<string> {
  return new Set(
    name
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length > 1 && !GENERIC_WORDS.has(w)),
  );
}

/** Do two names refer to the same airline? True when they share a distinctive word. */
function sameAirline(a: string, b: string): boolean {
  const wa = significantWords(a);
  const wb = significantWords(b);
  for (const w of wb) if (wa.has(w)) return true;
  // Names written together or apart ("Tayaranjet", "Tayaran Jet").
  const compact = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
  const [ca, cb] = [compact(a), compact(b)];
  return [...wa, ...wb].some((w) => w.length >= 4 && ca.includes(w) && cb.includes(w));
}

/**
 * Picks the Wikidata item for an ICAO code. An item still operating wins, the best known first.
 * When every item is defunct, the one whose name matches the other sources is used; when none
 * matches, the code has probably been reassigned and Wikidata only knows earlier holders (null).
 */
function pickItem(items: WikidataItem[], otherNames: string[]): WikidataItem | null {
  const sorted = [...items].sort(
    (a, b) => (a.to ? 1 : 0) - (b.to ? 1 : 0) || b.sitelinks - a.sitelinks || compare(b.to ?? "", a.to ?? "") || compare(a.item, b.item),
  );
  const best = sorted[0]!;
  if (!best.to || !otherNames.length) return best;
  return sorted.find((i) => i.name && otherNames.some((n) => sameAirline(i.name!, n))) ?? null;
}

export function buildOperators(mictronicsJson: string, wikidataCsv: string | null, vrsAirlinesCsv: string): OperatorBuild {
  const notes: string[] = [];
  const toCountry = countryResolver();
  const unknownCountries = new Set<string>();

  const mic = JSON.parse(mictronicsJson) as Record<string, MictronicsOperator>;

  const wikidata = new Map<string, WikidataItem[]>();
  if (wikidataCsv) {
    for (const r of parseCsvRecords(wikidataCsv)) {
      const icao = (r.icao ?? "").trim().toUpperCase();
      if (!ICAO_RE.test(icao)) continue;
      const iata = (r.iatas ?? "").split("|").map((s) => s.trim().toUpperCase()).filter((s) => IATA_RE.test(s)).sort()[0] ?? null;
      const label = (r.name || r.altName || "").trim();
      const from = date(r.from);
      let to = date(r.to);
      if (from && to && to < from) to = null;
      const item: WikidataItem = {
        item: (r.item ?? "").replace(/^.*\//, ""),
        name: label && !/^Q\d+$/.test(label) ? label : null,
        iata,
        from,
        to,
        country: (r.countries ?? "").split("|").filter(Boolean).sort()[0] ?? null,
        sitelinks: Number(r.sitelinks) || 0,
        kind: kindFromClasses(r.classes ?? ""),
      };
      wikidata.set(icao, [...(wikidata.get(icao) ?? []), item]);
    }
  }

  const vrs = new Map<string, { name: string; iata: string | null }>();
  for (const r of parseCsvRecords(vrsAirlinesCsv)) {
    const icao = (r.ICAO ?? "").trim().toUpperCase();
    if (!ICAO_RE.test(icao)) continue;
    const iata = (r.IATA ?? "").trim().toUpperCase();
    vrs.set(icao, { name: (r.Name ?? "").trim(), iata: IATA_RE.test(iata) ? iata : null });
  }

  const codes = new Set<string>([...Object.keys(mic).filter((c) => ICAO_RE.test(c)), ...wikidata.keys(), ...vrs.keys(), ...Object.keys(operatorFixes)]);
  let staleWikidata = 0;
  const rows: Operator[] = [];
  // How strongly each operator's IATA code is backed, for settling codes shared by several operators.
  const iataWeight = new Map<string, number>();
  for (const icao of codes) {
    const m = mic[icao];
    // VRS rows are user submissions. When VRS and Mictronics name different airlines for a code, the
    // VRS row (name and IATA code) is not used.
    let v = vrs.get(icao);
    if (v && m && !sameAirline(v.name, m.n)) v = undefined;
    const items = wikidata.get(icao);
    const w = items ? pickItem(items, [m?.n, v?.name].filter((n): n is string => !!n)) : null;
    if (items && !w) staleWikidata++;

    let country: string | null = null;
    if (m?.c) {
      const c = toCountry(m.c);
      if (c === undefined) unknownCountries.add(m.c);
      country = c ?? null;
    }
    country ??= w?.country ?? null;

    const name = w?.name || v?.name || m?.n || icao;
    const op: Operator = {
      id: `op_${icao.toLowerCase()}`,
      icao,
      iata: w?.iata ?? v?.iata ?? null,
      name,
      callsign: m?.r?.trim().toUpperCase() || null,
      country,
      kind: w?.kind ?? kindFromName(name) ?? kindFromName(m?.n ?? "") ?? "airline",
      validFrom: w?.from ?? null,
      validTo: w?.to ?? null,
    };
    const fix = operatorFixes[icao];
    rows.push(fix ? { ...op, ...fix } : op);
    iataWeight.set(op.id, fix?.iata ? Number.MAX_SAFE_INTEGER : w?.iata ? 1 + w.sitelinks : 0);
  }

  rows.push({ id: "op_private", icao: null, iata: null, name: "Private owner", callsign: null, country: null, kind: "private", validFrom: null, validTo: null });
  rows.sort((a, b) => compare(a.id, b.id));

  // An IATA code held by several operators still flying is ambiguous without a date. Subsidiaries
  // often carry the parent's code (Air China Cargo and CA). Keep the code on the best-backed holder:
  // a curated fix, then the Wikidata item with the most sitelinks, then VRS.
  const activeByIata = new Map<string, Operator[]>();
  for (const o of rows) if (o.iata && !o.validTo) activeByIata.set(o.iata, [...(activeByIata.get(o.iata) ?? []), o]);
  let iataCleared = 0;
  for (const holders of activeByIata.values()) {
    if (holders.length < 2) continue;
    holders.sort((a, b) => iataWeight.get(b.id)! - iataWeight.get(a.id)! || compare(a.id, b.id));
    for (const o of holders.slice(1)) {
      o.iata = null;
      iataCleared++;
    }
  }

  notes.push(`operators: ${rows.length} rows; ${rows.filter((o) => o.iata).length} with an IATA code; ${rows.filter((o) => o.validTo).length} with an end date`);
  notes.push(`operators: ${staleWikidata} Wikidata entries ignored because they describe an earlier holder of the code`);
  notes.push(`operators: ${iataCleared} IATA codes removed from operators that share them with a better-backed operator still flying`);
  if (!wikidataCsv) notes.push("operators: Wikidata was not available; IATA codes come from VRS only and there are no validity dates");
  if (unknownCountries.size) notes.push(`operators: country names not mapped to ISO codes: ${[...unknownCountries].sort().join(", ")}`);
  return { rows, notes };
}
