// Names of airports, the places they serve and airlines in the interface's other languages (docs/13, "Names in other
// languages"): Wikidata's labels (CC0), matched to the reference tables by ICAO and IATA codes. zh-TW takes a
// Traditional label where Wikidata has one, else the Simplified one converted with Taiwan's wording (OpenCC, only
// here, when the data is built). Written to data/names/<tag>.json, which the app loads only when the language is
// chosen; a name not there is shown in English. Run with `npm run build-names -w @touchdown/refdata` after
// `build-data`, since it reads the tables that writes.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import OpenCC from "opencc-js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const SPARQL = "https://query.wikidata.org/sparql";
const AGENT = "TouchdownRefdata/0.1 (reference data build)";

/** Wikidata's language codes for each of the app's languages, best first. */
const CHINESE = ["zh-cn", "zh-hans", "zh-sg", "zh", "zh-tw", "zh-hant", "zh-hk", "zh-mo"];
const LABEL_LANGS = [...CHINESE, "de", "en"];

const toSimplified = OpenCC.Converter({ from: "tw", to: "cn" });
const toTaiwan = OpenCC.Converter({ from: "cn", to: "twp" });
const hkToTaiwan = OpenCC.Converter({ from: "hk", to: "twp" });
const han = /[㐀-䶿一-鿿]/;

type Labels = Partial<Record<string, string>>;

async function query(sparql: string, tries = 0): Promise<Record<string, string>[]> {
  const res = await fetch(SPARQL, {
    method: "POST",
    body: new URLSearchParams({ query: sparql }),
    headers: { Accept: "application/sparql-results+json", "Content-Type": "application/x-www-form-urlencoded", "User-Agent": AGENT },
  });
  if (!res.ok) {
    if (res.status >= 500 && tries < 3) {
      await new Promise((r) => setTimeout(r, 5000 * (tries + 1)));
      return query(sparql, tries + 1);
    }
    throw new Error(`Wikidata answered ${res.status}`);
  }
  const json = (await res.json()) as { results: { bindings: Record<string, { value: string }>[] } };
  return json.results.bindings.map((b) => Object.fromEntries(Object.entries(b).map(([k, v]) => [k, v.value])));
}

/** The labels of the items `where` finds (it binds ?item), one row each: lighter for Wikidata than a column each. */
async function labelsWhere(where: string): Promise<Map<string, Labels>> {
  const langs = LABEL_LANGS.map((l) => `"${l}"`).join(", ");
  const rows = await query(`SELECT ?item ?label (LANG(?label) AS ?lang) WHERE { ${where} ?item rdfs:label ?label FILTER(LANG(?label) IN (${langs})) }`);
  const out = new Map<string, Labels>();
  for (const r of rows) out.set(r.item!, { ...out.get(r.item!), [r.lang!]: r.label! });
  return out;
}

/** A name in each language, or none: Chinese ones must be written in Chinese, German ones differ from English. */
export function namesIn(labels: Labels, english: string | null): { "zh-CN"?: string; "zh-TW"?: string; "de-DE"?: string } {
  const out: { "zh-CN"?: string; "zh-TW"?: string; "de-DE"?: string } = {};
  const pick = (langs: string[]) => langs.map((l) => [l, labels[l]] as const).find(([, v]) => v && han.test(v));
  const simplified = pick(["zh-cn", "zh-hans", "zh-sg", "zh"]);
  const traditional = pick(["zh-tw", "zh-hant"]) ?? pick(["zh-hk", "zh-mo"]);
  if (simplified) out["zh-CN"] = toSimplified(simplified[1]!);
  else if (traditional) out["zh-CN"] = toSimplified(traditional[1]!);
  if (traditional) out["zh-TW"] = traditional[0] === "zh-hk" || traditional[0] === "zh-mo" ? hkToTaiwan(traditional[1]!) : traditional[1];
  else if (simplified) out["zh-TW"] = toTaiwan(simplified[1]!);
  const de = labels.de?.trim();
  if (de && de !== english?.trim()) out["de-DE"] = de;
  return out;
}

/** Whether two names of an airline are the same company's: the words that tell airlines apart overlap. */
export function sameAirline(a: string, b: string): boolean {
  const COMMON = new Set(["air", "airline", "airlines", "airways", "aviation", "aviacion", "aviação", "aero", "express", "cargo", "the", "of", "de", "do", "la", "ltd", "limited", "inc", "co", "company", "corporation", "sa", "s", "a", "llc", "gmbh", "ag", "jsc", "pjsc", "plc", "pt", "pvt", "group"]);
  const words = (s: string) => new Set(s.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().split(/[^a-z0-9]+/).filter((w) => w && !COMMON.has(w)));
  const x = words(a);
  const y = words(b);
  if (!x.size || !y.size) return a.trim().toLowerCase() === b.trim().toLowerCase();
  const shared = [...x].filter((w) => y.has(w)).length;
  return shared / Math.min(x.size, y.size) >= 0.5;
}

interface Table {
  columns: string[];
  rows: unknown[][];
}

async function main() {
  const airports = JSON.parse(readFileSync(join(root, "data/airports.json"), "utf8")) as Table;
  const operators = JSON.parse(readFileSync(join(root, "data/operators.json"), "utf8")) as Table;
  const col = (t: Table, name: string) => {
    const i = t.columns.indexOf(name);
    if (i < 0) throw new Error(`no column ${name}`);
    return i;
  };

  // Airports: by ICAO, else by IATA.
  const [aId, aIcao, aIata, aName] = ["id", "icao", "iata", "name"].map((c) => col(airports, c)) as [number, number, number, number];
  const byIcao = new Map<string, unknown[]>();
  const byIata = new Map<string, unknown[]>();
  for (const r of airports.rows) {
    if (r[aIcao]) byIcao.set(String(r[aIcao]), r);
    if (r[aIata]) byIata.set(String(r[aIata]), r);
  }
  console.log("Asking Wikidata for airports' codes and the places they serve…");
  const airportRows = await query(`SELECT ?item ?icao ?iata ?city WHERE { { ?item wdt:P239 ?icao } UNION { ?item wdt:P238 ?iata } OPTIONAL { ?item wdt:P931 ?city } }`);
  console.log("Asking Wikidata for airports' names…");
  const airportLabels = await labelsWhere("{ ?item wdt:P239 [] } UNION { ?item wdt:P238 [] }");
  // The places they serve, in batches of their ids.
  const places = [...new Set(airportRows.map((r) => r.city).filter((c): c is string => !!c))];
  const cities = new Map<string, Labels>();
  for (let i = 0; i < places.length; i += 2000) {
    console.log(`Asking Wikidata for the places they serve (${i + 1}–${Math.min(i + 2000, places.length)} of ${places.length})…`);
    const values = places.slice(i, i + 2000).map((uri) => `wd:${uri.split("/").pop()}`).join(" ");
    for (const [k, v] of await labelsWhere(`VALUES ?item { ${values} }`)) cities.set(k, v);
  }

  const out: Record<"zh-CN" | "zh-TW" | "de-DE", { airports: Record<string, [string | null, string | null]>; operators: Record<string, string> }> = {
    "zh-CN": { airports: {}, operators: {} },
    "zh-TW": { airports: {}, operators: {} },
    "de-DE": { airports: {}, operators: {} },
  };
  // An item matched by ICAO first: an IATA code can belong to an airport that closed and another that took it.
  airportRows.sort((a, b) => Number(!a.icao) - Number(!b.icao));
  const matched = new Set<string>();
  for (const r of airportRows) {
    const row = (r.icao && byIcao.get(r.icao)) || (r.iata && byIata.get(r.iata));
    if (!row) continue;
    const id = String(row[aId]);
    if (out["zh-CN"].airports[id] || out["de-DE"].airports[id]) continue; // the first item for an airport, by ICAO
    matched.add(id);
    const names = namesIn(airportLabels.get(r.item!) ?? {}, String(row[aName] ?? ""));
    const city = r.city ? namesIn(cities.get(r.city) ?? {}, (cities.get(r.city) ?? {}).en ?? null) : {};
    for (const tag of ["zh-CN", "zh-TW", "de-DE"] as const) {
      const name = names[tag] ?? null;
      const place = city[tag] ?? null;
      if (name || place) out[tag].airports[id] = [name, place];
    }
  }
  console.log(`${matched.size} of ${airports.rows.length} airports found on Wikidata`);

  // Airlines: by ICAO, when Wikidata's English name is the same company's (an ICAO code passes between airlines).
  const [oId, oIcao, oName] = ["id", "icao", "name"].map((c) => col(operators, c)) as [number, number, number];
  const opsByIcao = new Map<string, unknown[][]>();
  for (const r of operators.rows) if (r[oIcao]) opsByIcao.set(String(r[oIcao]), [...(opsByIcao.get(String(r[oIcao])) ?? []), r]);
  console.log("Asking Wikidata for airlines' codes and names…");
  const opRows = await query(`SELECT ?item ?icao WHERE { ?item wdt:P230 ?icao }`);
  const opLabels = await labelsWhere("?item wdt:P230 [] .");
  let named = 0;
  for (const r of opRows) {
    const labels = opLabels.get(r.item!) ?? {};
    const english = labels.en;
    for (const op of opsByIcao.get(r.icao ?? "") ?? []) {
      const id = String(op[oId]);
      if (!english || !sameAirline(english, String(op[oName] ?? "")) || out["zh-CN"].operators[id]) continue;
      const names = namesIn(labels, String(op[oName] ?? ""));
      for (const tag of ["zh-CN", "zh-TW", "de-DE"] as const) if (names[tag]) out[tag].operators[id] = names[tag]!;
      named++;
    }
  }
  console.log(`${named} airlines matched on Wikidata`);

  mkdirSync(join(root, "data/names"), { recursive: true });
  for (const [tag, names] of Object.entries(out)) {
    const sorted = { airports: Object.fromEntries(Object.entries(names.airports).sort(([a], [b]) => a.localeCompare(b))), operators: Object.fromEntries(Object.entries(names.operators).sort(([a], [b]) => a.localeCompare(b))) };
    const file = { language: tag, source: "Wikidata (wikidata.org), CC0", built: new Date().toISOString().slice(0, 10), ...sorted };
    writeFileSync(join(root, `data/names/${tag}.json`), JSON.stringify(file) + "\n");
    console.log(`${tag}: ${Object.keys(names.airports).length} airports, ${Object.keys(names.operators).length} airlines`);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) await main();
