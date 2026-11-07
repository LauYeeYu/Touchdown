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
// "mul" is the label for every language that has none of its own: many items keep their English name only there.
const LABEL_LANGS = [...CHINESE, "de", "en", "mul"];

const toSimplifiedNow = OpenCC.Converter({ from: "tw", to: "cn" });
const simplifiedOf = new Map<string, string>();
const toSimplified = (s: string) => simplifiedOf.get(s) ?? simplifiedOf.set(s, toSimplifiedNow(s)).get(s)!;
const toTaiwan = OpenCC.Converter({ from: "cn", to: "twp" });
const hkToTaiwan = OpenCC.Converter({ from: "hk", to: "twp" });
const han = /[㐀-䶿一-鿿]/;
/** Words in a Chinese name of an airfield: without one, a label is a place's name, often with a code ("布里斯托尔（BRS）"). */
const AIRFIELD = /机场|基地|站|飞行场|空港|航空中心|飞行中心|飞行公园|空军|海军|水上|跑道|起降场/;
/** Words that make an English name a civil airport's or a military airfield's, and a Chinese name an airport's. */
const CIVIL = /\b(airport|aerodrome|airfield|airpark|air ?park|sunport|jetport)\b/i;
const MILITARY = /\b(base|airbase|air force|naval|navy|army|military|guard|raf|nas|naf|afb)\b/i;
const CIVIL_ZH = /机场|空港/;

type Labels = Partial<Record<string, string>>;
const TAGS = ["zh-CN", "zh-TW", "de-DE"] as const;

/** An item's English name: its English label, else the one for every language. */
const englishOf = (labels: Labels): string | null => labels.en ?? labels.mul ?? null;

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

/**
 * A name in each language, or none: Chinese ones must be written in Chinese, German ones differ from English, and an
 * airport's label that is only the name of the `place` it serves is not its name. A Chinese label must fit one of
 * `fits`, tried in turn, in its Simplified form.
 */
export function namesIn(labels: Labels, english: string | null, place: Labels = {}, fits: RegExp[] = [/(?:)/]): { "zh-CN"?: string; "zh-TW"?: string; "de-DE"?: string } {
  const out: { "zh-CN"?: string; "zh-TW"?: string; "de-DE"?: string } = {};
  const placeNames = new Set(CHINESE.flatMap((l) => (place[l] ? [toSimplified(place[l])] : [])));
  const usable = (v: string | undefined, fit: RegExp) => !!v && han.test(v) && !placeNames.has(toSimplified(v)) && fit.test(toSimplified(v));
  const pick = (langs: string[]) => fits.map((fit) => langs.map((l) => [l, labels[l]] as const).find(([, v]) => usable(v, fit))).find((f) => f);
  const simplified = pick(["zh-cn", "zh-hans", "zh-sg", "zh"]);
  const traditional = pick(["zh-tw", "zh-hant"]) ?? pick(["zh-hk", "zh-mo"]);
  if (simplified) out["zh-CN"] = toSimplified(simplified[1]!);
  else if (traditional) out["zh-CN"] = toSimplified(traditional[1]!);
  if (traditional) out["zh-TW"] = traditional[0] === "zh-hk" || traditional[0] === "zh-mo" ? hkToTaiwan(traditional[1]!) : traditional[1];
  else if (simplified) out["zh-TW"] = toTaiwan(simplified[1]!);
  const de = labels.de?.trim();
  if (de && de !== english?.trim() && de !== place.de?.trim()) out["de-DE"] = de;
  return out;
}

/** Words that do not tell one airline, airport or place from another. */
const AIRLINE_WORDS = new Set(["air", "airline", "airlines", "airways", "aviation", "aviacion", "aviacao", "aero", "aerea", "aereas", "aereo", "aereos", "aerolinea", "aerolineas", "aerovias", "lineas", "linhas", "linee", "transportes", "compania", "compagnie", "express", "cargo", "the", "of", "de", "del", "do", "da", "la", "ltd", "limited", "inc", "co", "company", "corporation", "sa", "s", "a", "llc", "gmbh", "ag", "jsc", "pjsc", "plc", "pt", "pvt", "group"]);
const AIRPORT_WORDS = new Set(["airport", "international", "intl", "regional", "municipal", "county", "national", "domestic", "air", "airfield", "aerodrome", "field", "base", "airbase", "station", "naval", "force", "army", "military", "the", "of", "de", "da", "do", "del", "la", "le", "el", "and"]);
const PLACE_WORDS = new Set(["city", "county", "municipality", "district", "town", "village", "prefecture", "province", "region", "the", "of", "de", "da", "do", "la"]);

/** A name's words, lower case, without accents or doubled letters (Kastellorizo, Kastelorizo), those in `common` left out. */
function words(s: string, common: Set<string> = new Set()): Set<string> {
  const all = s.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().split(/[^a-z0-9]+/);
  return new Set(all.filter((w) => w && !common.has(w)).map((w) => w.replace(/(.)\1+/g, "$1")));
}

/** Whether two names of an airline are the same company's: the words that tell airlines apart overlap. */
export function sameAirline(a: string, b: string): boolean {
  const x = words(a, AIRLINE_WORDS);
  const y = words(b, AIRLINE_WORDS);
  if (!x.size || !y.size) return a.trim().toLowerCase() === b.trim().toLowerCase();
  const shared = [...x].filter((w) => y.has(w)).length;
  return shared / Math.min(x.size, y.size) >= 0.5;
}

/** How alike two names are: the share of the words that tell them apart they have in common, then of all their words. */
export function likeness(a: string, b: string, common: Set<string>): [number, number] {
  const share = (x: Set<string>, y: Set<string>) => {
    const all = new Set([...x, ...y]).size;
    return all ? [...x].filter((w) => y.has(w)).length / all : 0;
  };
  return [share(words(a, common), words(b, common)), share(words(a), words(b))];
}

/**
 * The item that is ours, of several with the same code (an airport and the air base beside it, a city and its
 * district): of those named at least half as like ours as the likest, the one `wanted` most (named in the language
 * wanted, say), the one named most like ours, then the oldest. The same every time, whatever order Wikidata answers in.
 */
export function best(items: Iterable<string>, labels: Map<string, Labels>, ours: string, common: Set<string>, wanted: (item: string) => number = () => 0): string | undefined {
  const alike = [...items].map((item) => {
    const english = englishOf(labels.get(item) ?? {});
    return { item, like: english ? likeness(english, ours, common) : [0, 0] };
  });
  const likest = Math.max(0, ...alike.map((a) => a.like[0]!));
  const keyed = alike.map(({ item, like: [telling, all] }) => ({
    item,
    key: [telling! > 0 && telling! >= likest / 2 ? 1 : 0, wanted(item), telling!, all!, -Number(item.split("/Q").pop())],
  }));
  keyed.sort((a, b) => {
    for (let i = 0; i < a.key.length; i++) if (a.key[i] !== b.key[i]) return b.key[i]! - a.key[i]!;
    return 0;
  });
  return keyed[0]?.item;
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

  // Airports: the items with the airport's ICAO code, else those with its IATA code (an IATA code can belong to an
  // airport that closed and another that took it).
  const [aId, aIcao, aIata, aName, aCity] = ["id", "icao", "iata", "name", "city"].map((c) => col(airports, c)) as [number, number, number, number, number];
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
  const found = new Map<unknown[], { icao: Set<string>; iata: Set<string> }>();
  const placesOf = new Map<string, Set<string>>();
  for (const r of airportRows) {
    if (r.city) placesOf.set(r.item!, (placesOf.get(r.item!) ?? new Set()).add(r.city));
    const row = r.icao ? byIcao.get(r.icao) : r.iata ? byIata.get(r.iata) : undefined;
    if (!row) continue;
    const items = found.get(row) ?? { icao: new Set<string>(), iata: new Set<string>() };
    items[r.icao ? "icao" : "iata"].add(r.item!);
    found.set(row, items);
  }
  for (const [row, items] of found) {
    const ours = String(row[aName] ?? "");
    // The place as the app shows it (cityName in core): "Manchester, Greater Manchester" is Manchester.
    const ourCity = String(row[aCity] ?? "").replace(/\s*\(.*\)\s*$/, "").replace(/,.*$/, "").trim();
    const civil = CIVIL.test(ours);
    const fits = civil ? [CIVIL_ZH, AIRFIELD] : [AIRFIELD];
    const candidates = [...(items.icao.size ? items.icao : items.iata)];
    const served = new Set(candidates.flatMap((item) => [...(placesOf.get(item) ?? [])]));
    const plausible = (city: string) => likeness(englishOf(cities.get(city) ?? {}) ?? "", ourCity, PLACE_WORDS)[0]! >= 0.5;
    for (const tag of TAGS) {
      const placeIn = (city: string) => namesIn(cities.get(city) ?? {}, englishOf(cities.get(city) ?? {}))[tag];
      // Each item's name and place: our table's place, of those the item serves, else of those another of the items
      // serves (an airport that moved, an air base with no place of its own), else the one the item serves with a name.
      const shown = new Map(
        candidates.map((item) => {
          const own = [...(placesOf.get(item) ?? [])];
          const ourPlace = own.filter(plausible).length ? own.filter(plausible) : [...served].filter(plausible);
          const city = ourPlace.length ? best(ourPlace, cities, ourCity, PLACE_WORDS, (c) => (placeIn(c) ? 1 : 0)) : best(own, cities, "", PLACE_WORDS, (c) => (placeIn(c) ? 1 : 0));
          const place = (city && placeIn(city)) || null;
          const name = namesIn(airportLabels.get(item) ?? {}, ours, city ? cities.get(city) : undefined, fits)[tag] ?? null;
          return [item, { name: name !== place ? name : null, place }] as const;
        }),
      );
      // One with a name, an airport for everyone where ours is.
      const isCivil = (item: string) => {
        const english = englishOf(airportLabels.get(item) ?? {}) ?? "";
        return CIVIL.test(english) && !MILITARY.test(english);
      };
      const item = best(candidates, airportLabels, ours, AIRPORT_WORDS, (i) => (shown.get(i)!.name ? 2 : 0) + (civil && isCivil(i) ? 1 : 0))!;
      const { name, place } = shown.get(item)!;
      if (name || place) out[tag].airports[String(row[aId])] = [name, place];
    }
  }
  console.log(`${found.size} of ${airports.rows.length} airports found on Wikidata`);

  // Airlines: by ICAO, when Wikidata's English name is the same company's (an ICAO code passes between airlines).
  const [oId, oIcao, oName] = ["id", "icao", "name"].map((c) => col(operators, c)) as [number, number, number];
  const opsByIcao = new Map<string, unknown[][]>();
  for (const r of operators.rows) if (r[oIcao]) opsByIcao.set(String(r[oIcao]), [...(opsByIcao.get(String(r[oIcao])) ?? []), r]);
  console.log("Asking Wikidata for airlines' codes and names…");
  const opRows = await query(`SELECT ?item ?icao WHERE { ?item wdt:P230 ?icao }`);
  const opLabels = await labelsWhere("?item wdt:P230 [] .");
  const airlines = new Map<unknown[], Set<string>>();
  for (const r of opRows) {
    const english = englishOf(opLabels.get(r.item!) ?? {});
    for (const op of opsByIcao.get(r.icao ?? "") ?? []) {
      if (english && sameAirline(english, String(op[oName] ?? ""))) airlines.set(op, (airlines.get(op) ?? new Set()).add(r.item!));
    }
  }
  for (const [op, items] of airlines) {
    const ours = String(op[oName] ?? "");
    for (const tag of TAGS) {
      const name = namesIn(opLabels.get(best(items, opLabels, ours, AIRLINE_WORDS, (i) => (namesIn(opLabels.get(i) ?? {}, ours)[tag] ? 1 : 0))!) ?? {}, ours)[tag];
      if (name) out[tag].operators[String(op[oId])] = name;
    }
  }
  console.log(`${airlines.size} airlines matched on Wikidata`);

  mkdirSync(join(root, "data/names"), { recursive: true });
  for (const [tag, names] of Object.entries(out)) {
    const sorted = { airports: Object.fromEntries(Object.entries(names.airports).sort(([a], [b]) => a.localeCompare(b))), operators: Object.fromEntries(Object.entries(names.operators).sort(([a], [b]) => a.localeCompare(b))) };
    const file = { language: tag, source: "Wikidata (wikidata.org), CC0", built: new Date().toISOString().slice(0, 10), ...sorted };
    writeFileSync(join(root, `data/names/${tag}.json`), JSON.stringify(file) + "\n");
    console.log(`${tag}: ${Object.keys(names.airports).length} airports, ${Object.keys(names.operators).length} airlines`);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) await main();
