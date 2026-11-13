// Figures of aircraft types from Wikidata (CC0), for the type pages of the types without curated Wikipedia figures and
// to fill gaps in those (docs/13-reference-data.md, "Type figures"): for each ICAO type designator in
// data/aircraft_types.json, one Wikidata item and the figures it states, written to data/type_wikidata.json.
//
//   npm run build-type-wikidata -w @touchdown/refdata                build the table (answers cached)
//   npm run build-type-wikidata -w @touchdown/refdata -- --refresh   ask Wikidata again
//   npm run build-type-wikidata -w @touchdown/refdata -- --show D…   print each designator's candidates and values
//
// Answers from the query service (https://query.wikidata.org/sparql) are cached in data/private/cache/wikidata/
// (git-ignored): the candidate items once, each item's statements and classes in a file of its own. A rerun without
// --refresh asks only for items it has not seen. Requests are a few seconds apart, retried with back-off on 429 and
// 5xx.
//
// Matching. Wikidata has no property for ICAO aircraft type designators: no item states "B738" or "A20N". So a
// designator is matched by name, against the items that are aircraft models or families (P31 Q15056993, Q15056995),
// subclasses of aircraft (P279+ Q11436) or instances of those, through their English label and aliases:
//   1. itemOverrides in src/curated/type-wikidata.ts;
//   2. the designator's manufacturer and name ("Cessna" "425 Corsair") equal to an item's label or alias, alone or
//      after one of the item's manufacturers or developers (P176, P178), compared without case, accents, spaces or
//      punctuation, with Roman numerals as digits ("Thunderbolt 2" is "Thunderbolt II"). A name of several ("H125 /
//      AS350 Écureuil") tries each, a name ending in "series" also without it; a family's name goes before a bare
//      model number ("Learjet" "24");
//   3. else the name alone equal to an item's label or alias, when one of the item's manufacturers shares its name;
//   4. a designator whose curated Wikipedia article (src/curated/type-specs.ts) is about it alone also has that
//      article's item as a candidate.
// A name that is only the manufacturer's ("Berkut" "Berkut") is not tried alone: it would match any aircraft so named.
// Of several candidates: one matched through its label, then the curated article's item, then one matched only through
// an alias (aliases name variants and derivatives: "Boeing 737-200" is an alias of the T-43A); then the one with the
// most figures, the more specific one (fewer designators match it), the lower id. The build prints where the chosen
// item is not the curated article's item or linked to it (P31, P279, P361, P144, P179), for review. An item chosen for
// several designators is their family's, and its figures may be any one type's: those rows keep its role and engines
// only.
//
// Properties read (the normalised value, psn:, so Wikidata converts feet, pounds, knots and miles to SI; metres and
// metres a second are then given as km and km/h):
//   lengthM      P2043 length; a statement for a part (P518) other than the airframe or fuselage is left out
//   spanM        P2050 wingspan; for a helicopter (its role) P2386 diameter that "applies to part" (P518) rotor
//                (Q1343028)
//   heightM      P2048 height
//   mtowKg       P2067 mass, qualified (P3831, P1013, P1552, P518 or P642) as maximum takeoff weight (Q938476)
//   rangeKm      P2073 vehicle range, without a role or criterion qualifier (ferry range, combat radius left out)
//   cruiseKmh    P2217 cruise speed; P2052 speed qualified as cruise (Q2063640) or cruising speed (Q115155589)
//   seatsMax     P1083 maximum capacity in passengers (Q319604, as its unit or a qualifier)
//   engines      P516 powered by: the engine models' English labels (not kinds such as "turbofan", engineKinds), after
//                the engine count from aircraft_types.json
//   firstFlight  P606 first flight
//   introduced   P729 service entry
//   built        P1092 total produced
//   role         P31 instance of, P279 subclass of, P366 has use, then P279 upwards, through roleClasses
//   revision     the item's revision (schema:version)
//
// Several values. Deprecated statements are left out, and preferred ones win over the rest. A statement qualified for
// another aircraft item (a variant: "applies to part" A321 on the A320 family's item) or for a prototype is left out.
// Of what remains: the largest for MTOW, range, seats and number built (the item's maximum); the earliest date, as
// precise as the values that agree with it; for length, span, height and cruise speed one value when they agree
// within 1 %, else none (the item's variants differ, and which is which is not stated). Never derived.
//
// Checks: a value outside its plausible range (RANGES), a length and span whose ratio no aircraft has (SHAPE), an MTOW
// that does not fit the type's wake turbulence category (WAKE_MTOW) is dropped and printed, so a unit mix-up or a
// wrong value never reaches the app.

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { TypeRole, TypeWikidata } from "../../core/src/ref/types.ts";
import { engineKinds, itemOverrides, roleClasses, rolePriority, valueOverrides } from "../src/curated/type-wikidata.ts";
import { dataDir, makerForms, norm, packageDir, WIKI_USER_AGENT, writeTable } from "./lib.ts";

const ENDPOINT = "https://query.wikidata.org/sparql";
const cacheDir = path.resolve(packageDir, "../../data/private/cache/wikidata");
const SOURCE = "Wikidata (wikidata.org), CC0";
const PAUSE_MS = 3000;
const BATCH = 60;

const COLUMNS = [
  "designator",
  "item",
  "revision",
  "label",
  "role",
  "lengthM",
  "spanM",
  "heightM",
  "mtowKg",
  "rangeKm",
  "cruiseKmh",
  "seatsMax",
  "engines",
  "firstFlight",
  "introduced",
  "built",
] as const satisfies readonly (keyof TypeWikidata)[];

/** The figures counted when choosing between candidates. */
const FIGURES = [
  "lengthM", "spanM", "heightM", "mtowKg", "rangeKm", "cruiseKmh", "seatsMax", "engines", "firstFlight", "introduced", "built",
] as const;

const today = new Date().toISOString().slice(0, 10);

/** Plausible ranges; a value outside is dropped. */
const RANGES: Record<"lengthM" | "spanM" | "heightM" | "mtowKg" | "rangeKm" | "cruiseKmh" | "seatsMax" | "built", [number, number]> = {
  lengthM: [1, 120],
  spanM: [1, 120],
  heightM: [0.5, 40],
  mtowKg: [50, 700_000],
  rangeKm: [50, 45_000],
  cruiseKmh: [30, 3_700],
  seatsMax: [1, 1_000],
  built: [1, 200_000],
};
const EARLIEST = "1900";
/** Length to span (or rotor diameter): outside this, one of the two is wrong and both are dropped. */
const SHAPE: [number, number] = [0.2, 3.5];
/**
 * MTOW against the wake turbulence category of aircraft_types.json (L up to 7 t, M up to 136 t, H above, J the A380),
 * with a quarter's margin: outside, the mass is a mix-up and dropped.
 */
const WAKE_MTOW: Record<string, [number, number]> = { L: [0, 8_750], M: [5_250, 170_000], H: [100_000, 700_000], J: [400_000, 700_000] };

// Wikidata ids the build reads.
const Q = {
  aircraftFamily: "Q15056993",
  aircraftModel: "Q15056995",
  aircraft: "Q11436",
  metre: "Q11573",
  kilogram: "Q11570",
  metrePerSecond: "Q182429",
  passenger: "Q319604",
  mtow: "Q938476",
  rotor: "Q1343028",
  cruise: "Q2063640",
  cruisingSpeed: "Q115155589",
  prototype: "Q207977",
  airframe: "Q222946",
  fuselage: "Q1110579",
};
const PROPS = [
  ...["P2043", "P2050", "P2048", "P2386", "P2067", "P2073", "P2217", "P2052", "P1083", "P516", "P606", "P729", "P1092"],
  // What the item belongs to or derives from, for the check against the curated articles.
  ...["P31", "P279", "P361", "P144", "P179"],
];
/** Properties that link an item to its family or the type it derives from. */
const PARENT_PROPS = ["P31", "P279", "P361", "P144", "P179"];
/** Qualifiers that say what a value is of or for. */
const ROLE_QUALIFIERS = ["P3831", "P1013", "P1552", "P518", "P642", "P366"];

// ---------------------------------------------------------------------------------------------------------------
// Query service

interface Term {
  type: string;
  value: string;
  datatype?: string;
  "xml:lang"?: string;
}
type Binding = Record<string, Term | undefined>;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let lastRequest = 0;
let requests = 0;

async function ask(query: string, what: string): Promise<Binding[]> {
  for (let attempt = 0; ; attempt++) {
    const wait = lastRequest + PAUSE_MS - Date.now();
    if (wait > 0) await sleep(wait);
    lastRequest = Date.now();
    requests++;
    let res: Response;
    try {
      res = await fetch(ENDPOINT, {
        method: "POST",
        headers: { "User-Agent": WIKI_USER_AGENT, Accept: "application/sparql-results+json", "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ query }),
        signal: AbortSignal.timeout(120_000),
      });
    } catch (err) {
      if (attempt < 4) {
        await sleep(10_000 * 2 ** attempt);
        continue;
      }
      throw new Error(`${what}: ${(err as Error).message}`);
    }
    if ((res.status === 429 || res.status >= 500) && attempt < 4) {
      const after = Number(res.headers.get("retry-after"));
      await sleep(after > 0 ? after * 1000 : 10_000 * 2 ** attempt);
      continue;
    }
    if (!res.ok) throw new Error(`${what}: the query service answered ${res.status}`);
    const json = (await res.json()) as { results: { bindings: Binding[] } };
    return json.results.bindings;
  }
}

function readCache<T>(name: string): T | null {
  const file = path.join(cacheDir, name);
  return fs.existsSync(file) ? (JSON.parse(fs.readFileSync(file, "utf8")) as T) : null;
}

function writeCache(name: string, value: unknown): void {
  const file = path.join(cacheDir, name);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value));
}

async function cachedQuery(name: string, query: string, refresh: boolean): Promise<Binding[]> {
  const hit = refresh ? null : readCache<Binding[]>(`${name}.json`);
  if (hit) return hit;
  console.log(`ask ${name}`);
  const rows = await ask(query, name);
  writeCache(`${name}.json`, rows);
  return rows;
}

const ENTITY = "http://www.wikidata.org/entity/";
const qid = (t: Term | undefined): string | null => (t && t.value.startsWith(ENTITY) ? t.value.slice(ENTITY.length) : null);
const str = (t: Term | undefined): string | null => t?.value ?? null;

// ---------------------------------------------------------------------------------------------------------------
// Candidate items: aircraft models and families, subclasses of aircraft, and instances of those.

const POOLS: Record<string, string> = {
  models: `?item wdt:P31 ?c . VALUES ?c { wd:${Q.aircraftFamily} wd:${Q.aircraftModel} }`,
  classes: `?item wdt:P279+ wd:${Q.aircraft} .`,
  instances: `?item wdt:P31/wdt:P279* wd:${Q.aircraft} .
  FILTER NOT EXISTS { ?item wdt:P31 ?c0 . VALUES ?c0 { wd:${Q.aircraftFamily} wd:${Q.aircraftModel} } }`,
};

interface Candidate {
  qid: string;
  label: string | null;
  article: string | null;
  /** The English label and aliases. */
  names: Set<string>;
  makers: Set<string>;
}

async function loadPool(refresh: boolean): Promise<Map<string, Candidate>> {
  const items = new Map<string, Candidate>();
  const get = (id: string) => {
    let c = items.get(id);
    if (!c) items.set(id, (c = { qid: id, label: null, article: null, names: new Set(), makers: new Set() }));
    return c;
  };
  for (const [name, where] of Object.entries(POOLS)) {
    const labels = await cachedQuery(
      `pool-${name}-labels`,
      `SELECT ?item ?label ?article WHERE { ${where}
  OPTIONAL { ?item rdfs:label ?label FILTER(LANG(?label) = "en") }
  OPTIONAL { ?article schema:about ?item ; schema:isPartOf <https://en.wikipedia.org/> } }`,
      refresh,
    );
    for (const b of labels) {
      const id = qid(b.item);
      if (!id) continue;
      const c = get(id);
      const label = str(b.label);
      if (label) {
        c.label = label;
        c.names.add(label);
      }
      const article = str(b.article);
      if (article) c.article = decodeURIComponent(article.replace(/^https:\/\/en\.wikipedia\.org\/wiki\//, "")).replace(/_/g, " ");
    }
    const aliases = await cachedQuery(
      `pool-${name}-aliases`,
      `SELECT ?item ?alias WHERE { ${where} ?item skos:altLabel ?alias FILTER(LANG(?alias) = "en") }`,
      refresh,
    );
    for (const b of aliases) {
      const id = qid(b.item);
      const alias = str(b.alias);
      if (id && alias) get(id).names.add(alias);
    }
    const makers = await cachedQuery(
      `pool-${name}-makers`,
      `SELECT ?item ?makerLabel WHERE { ${where} ?item wdt:P176|wdt:P178 ?maker . ?maker rdfs:label ?makerLabel FILTER(LANG(?makerLabel) = "en") }`,
      refresh,
    );
    for (const b of makers) {
      const id = qid(b.item);
      const maker = str(b.makerLabel);
      if (id && maker) get(id).makers.add(maker);
    }
  }
  return items;
}

// ---------------------------------------------------------------------------------------------------------------
// Names

/** Item ids by name key; `label`: the ids whose key comes from their label rather than an alias. */
interface NameIndex {
  ids: Map<string, Set<string>>;
  label: Map<string, Set<string>>;
}

/** Each item's names as keys, alone (`bare`) and also after each of its manufacturers' names (`full`). */
function indexNames(items: Map<string, Candidate>): { full: NameIndex; bare: NameIndex } {
  const full: NameIndex = { ids: new Map(), label: new Map() };
  const bare: NameIndex = { ids: new Map(), label: new Map() };
  const add = (m: NameIndex, key: string, id: string, isLabel: boolean) => {
    if (key.length < 2) return;
    for (const map of isLabel ? [m.ids, m.label] : [m.ids]) {
      let s = map.get(key);
      if (!s) map.set(key, (s = new Set()));
      s.add(id);
    }
  };
  for (const c of items.values()) {
    const forms = [...c.makers].flatMap(makerForms);
    for (const name of c.names) {
      const n = norm(name);
      const isLabel = name === c.label;
      add(full, n, c.qid, isLabel);
      add(bare, n, c.qid, isLabel);
      for (const f of forms) if (!n.startsWith(f)) add(full, f + n, c.qid, isLabel);
    }
  }
  return { full, bare };
}

interface TypeRow {
  designator: string;
  manufacturer: string;
  name: string;
  familyId: string | null;
  engineCount: number | null;
  wtc: string | null;
}

/**
 * The names a designator's model is known by: "H125 / AS350 Écureuil" is "H125" or "AS350 Écureuil", "TBM 900
 * series" also "TBM 900".
 */
function nameParts(name: string): string[] {
  const parts = [name, ...name.split(/\s+\/\s+/)].map((p) => p.trim()).filter(Boolean);
  return [...new Set(parts.flatMap((p) => [p, p.replace(/\s+series$/i, "")]))];
}

interface Match {
  ids: Set<string>;
  /** The ids matched through their label, not only an alias. */
  byLabel: Set<string>;
  how: string;
}

/**
 * The items whose name is the designator's manufacturer and model. A name that already starts with the manufacturer's
 * ("Saab" "Saab 340") is also tried alone, unless it is only the manufacturer's name ("Berkut" "Berkut"), which would
 * match any aircraft of that name.
 */
function matchByName(t: TypeRow, familyName: string | null, idx: ReturnType<typeof indexNames>, items: Map<string, Candidate>): Match {
  const makers = makerForms(t.manufacturer);
  const m: Match = { ids: new Set(), byLabel: new Set(), how: "" };
  const take = (index: NameIndex, key: string, accept: (id: string) => boolean = () => true) => {
    for (const id of index.ids.get(key) ?? []) {
      if (!accept(id)) continue;
      m.ids.add(id);
      if (index.label.get(key)?.has(id)) m.byLabel.add(id);
    }
  };
  const prefixes = familyName ? [...makers, norm(familyName)] : makers;
  for (const part of nameParts(t.name)) {
    const n = norm(part);
    const keys = new Set<string>();
    for (const p of prefixes) {
      keys.add(p + n);
      if (n.startsWith(p) && n.length > p.length) keys.add(n);
    }
    for (const k of keys) take(idx.full, k);
  }
  if (m.ids.size) return { ...m, how: "name" };
  for (const part of nameParts(t.name)) {
    const n = norm(part);
    if (n.length < 3 || !/[a-z]/.test(n)) continue;
    take(idx.bare, n, (id) => {
      const theirs = [...items.get(id)!.makers].flatMap(makerForms);
      return theirs.some((a) => makers.some((b) => a.includes(b) || b.includes(a)));
    });
  }
  return { ...m, how: m.ids.size ? "name, maker" : "" };
}

// ---------------------------------------------------------------------------------------------------------------
// Each item's statements and role classes, cached one file an item.

interface Statement {
  prop: string;
  rank: "preferred" | "normal" | "deprecated";
  /** Normalised (SI) amount and unit, when the property has them. */
  amount: number | null;
  unit: string | null;
  /** The amount and unit as stated. */
  rawAmount: number | null;
  rawUnit: string | null;
  time: string | null;
  precision: number | null;
  entity: string | null;
  entityLabel: string | null;
  qualifiers: { prop: string; value: string }[];
}

interface ItemData {
  revision: number;
  label: string | null;
  statements: Statement[];
}

function statementsOf(rows: Binding[]): Map<string, ItemData> {
  const out = new Map<string, ItemData>();
  const byStatement = new Map<string, Statement>();
  for (const b of rows) {
    const id = qid(b.item);
    if (!id) continue;
    let item = out.get(id);
    if (!item) out.set(id, (item = { revision: Number(str(b.rev)), label: str(b.label), statements: [] }));
    const st = str(b.st);
    const prop = qid(b.prop as Term | undefined) ?? str(b.prop)?.split("/").pop() ?? null;
    if (!st || !prop) continue;
    let s = byStatement.get(st);
    if (!s) {
      const rank = (str(b.rank) ?? "").split("#").pop()!.replace("Rank", "").toLowerCase();
      s = {
        prop,
        rank: rank === "preferred" ? "preferred" : rank === "deprecated" ? "deprecated" : "normal",
        amount: b.namount ? Number(b.namount.value) : null,
        unit: qid(b.nunit),
        rawAmount: b.amount ? Number(b.amount.value) : null,
        rawUnit: qid(b.unit),
        time: str(b.time),
        precision: b.prec ? Number(b.prec.value) : null,
        entity: qid(b.ent),
        entityLabel: str(b.entLabel),
        qualifiers: [],
      };
      byStatement.set(st, s);
      item.statements.push(s);
    }
    const qp = str(b.qprop)?.split("/").pop();
    const qv = qid(b.qval);
    if (qp && qv && !s.qualifiers.some((q) => q.prop === qp && q.value === qv)) s.qualifiers.push({ prop: qp, value: qv });
  }
  return out;
}

const values = (ids: string[]) => ids.map((id) => `wd:${id}`).join(" ");

function figuresQuery(ids: string[]): string {
  return `SELECT ?item ?rev ?label ?prop ?st ?rank ?amount ?unit ?namount ?nunit ?time ?prec ?ent ?entLabel ?qprop ?qval WHERE {
  VALUES ?item { ${values(ids)} }
  ?item schema:version ?rev .
  OPTIONAL { ?item rdfs:label ?label . FILTER(LANG(?label) = "en") }
  OPTIONAL {
    VALUES ?prop { ${values(PROPS)} }
    ?prop wikibase:claim ?p ; wikibase:statementProperty ?ps .
    ?item ?p ?st .
    ?st wikibase:rank ?rank .
    OPTIONAL { ?prop wikibase:statementValue ?psv . ?st ?psv ?vn .
      OPTIONAL { ?vn wikibase:quantityAmount ?amount ; wikibase:quantityUnit ?unit . }
      OPTIONAL { ?vn wikibase:timeValue ?time ; wikibase:timePrecision ?prec . } }
    OPTIONAL { ?prop wikibase:statementValueNormalized ?psn . ?st ?psn ?nn . ?nn wikibase:quantityAmount ?namount ; wikibase:quantityUnit ?nunit . }
    OPTIONAL { ?st ?ps ?ent . FILTER(STRSTARTS(STR(?ent), "${ENTITY}Q")) OPTIONAL { ?ent rdfs:label ?entLabel . FILTER(LANG(?entLabel) = "en") } }
    OPTIONAL { ?st ?pq ?qval . ?qprop wikibase:qualifier ?pq . FILTER(STRSTARTS(STR(?qval), "${ENTITY}Q")) }
  }
}`;
}

function rolesQuery(ids: string[]): string {
  return `SELECT ?item ?cls WHERE {
  VALUES ?item { ${values(ids)} }
  VALUES ?cls { ${values(Object.keys(roleClasses))} }
  ?item (wdt:P31|wdt:P279|wdt:P366)/wdt:P279* ?cls .
}`;
}

const hash = (s: string) => crypto.createHash("sha1").update(s).digest("hex").slice(0, 10);
/** Cache folders named by what their answers depend on, so a changed query asks again. */
const itemsDir = `items-${hash(PROPS.join(" "))}`;
const rolesDir = `roles-${hash(Object.keys(roleClasses).sort().join(" "))}`;

async function loadItems(ids: string[], refresh: boolean): Promise<{ data: Map<string, ItemData>; classes: Map<string, string[]> }> {
  const data = new Map<string, ItemData>();
  const classes = new Map<string, string[]>();
  const missingData: string[] = [];
  const missingRoles: string[] = [];
  for (const id of ids) {
    const d = refresh ? null : readCache<ItemData>(`${itemsDir}/${id}.json`);
    if (d) data.set(id, d);
    else missingData.push(id);
    const r = refresh ? null : readCache<string[]>(`${rolesDir}/${id}.json`);
    if (r) classes.set(id, r);
    else missingRoles.push(id);
  }
  for (let i = 0; i < missingData.length; i += BATCH) {
    const batch = missingData.slice(i, i + BATCH);
    console.log(`ask statements of ${batch.length} items (${i + batch.length}/${missingData.length})`);
    const got = statementsOf(await ask(figuresQuery(batch), "statements"));
    for (const id of batch) {
      const d = got.get(id) ?? { revision: 0, label: null, statements: [] };
      writeCache(`${itemsDir}/${id}.json`, d);
      data.set(id, d);
    }
  }
  for (let i = 0; i < missingRoles.length; i += BATCH) {
    const batch = missingRoles.slice(i, i + BATCH);
    console.log(`ask classes of ${batch.length} items (${i + batch.length}/${missingRoles.length})`);
    const rows = await ask(rolesQuery(batch), "classes");
    const got = new Map<string, Set<string>>(batch.map((id) => [id, new Set()]));
    for (const b of rows) {
      const id = qid(b.item);
      const cls = qid(b.cls);
      if (id && cls) got.get(id)?.add(cls);
    }
    for (const [id, set] of got) {
      writeCache(`${rolesDir}/${id}.json`, [...set].sort());
      classes.set(id, [...set].sort());
    }
  }
  return { data, classes };
}

// ---------------------------------------------------------------------------------------------------------------
// Values

type Values = Omit<TypeWikidata, "designator" | "item" | "revision" | "label">;

const EMPTY: Values = {
  role: null,
  lengthM: null,
  spanM: null,
  heightM: null,
  mtowKg: null,
  rangeKm: null,
  cruiseKmh: null,
  seatsMax: null,
  engines: null,
  firstFlight: null,
  introduced: null,
  built: null,
};

function roleOf(classes: string[]): TypeRole | null {
  const roles = new Set(classes.map((c) => roleClasses[c]).filter((r): r is TypeRole => !!r));
  return rolePriority.find((r) => roles.has(r)) ?? null;
}

const qualifierValues = (s: Statement, props = ROLE_QUALIFIERS) => s.qualifiers.filter((q) => props.includes(q.prop)).map((q) => q.value);

/**
 * The statements that hold for this item: not deprecated, not qualified for another aircraft (a variant) or a
 * prototype, preferred ones only when there are any.
 */
function usable(statements: Statement[], self: string, aircraft: Set<string>): Statement[] {
  const kept = statements.filter(
    (s) => s.rank !== "deprecated" && !s.qualifiers.some((q) => q.value === Q.prototype || (q.value !== self && aircraft.has(q.value))),
  );
  return kept.some((s) => s.rank === "preferred") ? kept.filter((s) => s.rank === "preferred") : kept;
}

function amounts(statements: Statement[], unit: string, notes: string[], what: string): number[] {
  const out: number[] = [];
  for (const s of statements) {
    if (s.amount === null || s.unit !== unit) {
      if (s.rawAmount !== null) notes.push(`${what}: ${s.rawAmount} ${s.rawUnit ?? ""} has no ${unit === Q.metre ? "metric length" : "SI value"}`);
      continue;
    }
    out.push(s.amount);
  }
  return out;
}

/** One value when they agree within 1 %, else null (and a note). */
function agreeing(list: number[], notes: string[], what: string): number | null {
  if (!list.length) return null;
  const max = Math.max(...list);
  const min = Math.min(...list);
  if (max - min <= 0.01 * max) return max;
  notes.push(`${what}: several values (${[...new Set(list.map((v) => round(v, 2)))].join(", ")}), none taken`);
  return null;
}

const largest = (list: number[]): number | null => (list.length ? Math.max(...list) : null);

function round(v: number, digits: number): number {
  const f = 10 ** digits;
  return Math.round(v * f) / f;
}

function formatDate(time: string, precision: number): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(time);
  if (!m) return null;
  if (precision >= 11) return `${m[1]}-${m[2]}-${m[3]}`;
  if (precision === 10) return `${m[1]}-${m[2]}`;
  if (precision === 9) return m[1]!;
  return null;
}

/** The earliest date, as precise as the values that agree with it ("1987" and "1987-02-22" give "1987-02-22"). */
function earliest(statements: Statement[]): string | null {
  const dates = statements.flatMap((s) => (s.time && s.precision !== null ? [formatDate(s.time, s.precision)] : [])).filter((d): d is string => !!d);
  if (!dates.length) return null;
  const first = dates.reduce((a, b) => (b < a ? b : a));
  return dates.filter((d) => d.startsWith(first)).reduce((a, b) => (b.length > a.length ? b : a));
}

function valuesOf(id: string, item: ItemData, classes: string[], engineCount: number | null, aircraft: Set<string>, notes: string[]): Values {
  const of = (prop: string) => usable(item.statements.filter((s) => s.prop === prop), id, aircraft);
  const parts = (s: Statement) => qualifierValues(s, ["P518"]);
  const roles = (s: Statement) => qualifierValues(s);
  const v: Values = { ...EMPTY, role: roleOf(classes) };

  const lengths = of("P2043").filter((s) => parts(s).every((p) => p === Q.airframe || p === Q.fuselage));
  const length = agreeing(amounts(lengths, Q.metre, notes, "length"), notes, "length");
  const span = agreeing(amounts(of("P2050").filter((s) => !parts(s).length), Q.metre, notes, "span"), notes, "span");
  const rotors = of("P2386").filter((s) => roles(s).includes(Q.rotor));
  const rotor = agreeing(amounts(rotors, Q.metre, notes, "rotor"), notes, "rotor diameter");
  const heights = of("P2048").filter((s) => parts(s).every((p) => p === Q.airframe || p === Q.fuselage));
  const height = agreeing(amounts(heights, Q.metre, notes, "height"), notes, "height");
  v.lengthM = length === null ? null : round(length, 2);
  v.spanM = v.role === "helicopter" && rotor !== null ? round(rotor, 2) : span === null ? null : round(span, 2);
  v.heightM = height === null ? null : round(height, 2);

  const mtow = largest(amounts(of("P2067").filter((s) => roles(s).includes(Q.mtow)), Q.kilogram, notes, "MTOW"));
  v.mtowKg = mtow === null ? null : Math.round(mtow);
  const range = largest(amounts(of("P2073").filter((s) => !roles(s).length), Q.metre, notes, "range"));
  v.rangeKm = range === null ? null : Math.round(range / 1000);
  const cruiseStatements = [...of("P2217"), ...of("P2052").filter((s) => roles(s).some((r) => r === Q.cruise || r === Q.cruisingSpeed))];
  const cruise = agreeing(amounts(cruiseStatements, Q.metrePerSecond, notes, "cruise"), notes, "cruise speed");
  v.cruiseKmh = cruise === null ? null : Math.round(cruise * 3.6);

  const seats = of("P1083")
    .filter((s) => s.rawUnit === Q.passenger || roles(s).includes(Q.passenger))
    .flatMap((s) => (s.rawAmount !== null && Number.isInteger(s.rawAmount) ? [s.rawAmount] : []));
  v.seatsMax = largest(seats);
  const built = of("P1092").flatMap((s) => (s.rawAmount !== null && Number.isInteger(s.rawAmount) ? [s.rawAmount] : []));
  v.built = largest(built);

  const engines = [...new Set(of("P516").flatMap((s) => (s.entityLabel && !engineKinds.has(s.entity ?? "") ? [s.entityLabel] : [])))].sort();
  if (engines.length) v.engines = `${engineCount && engineCount > 0 ? `${engineCount} × ` : ""}${engines.join(" or ")}`;

  v.firstFlight = earliest(of("P606"));
  v.introduced = earliest(of("P729"));
  return v;
}

/** Drops values outside the plausible ranges, or that disagree with each other, with a note for each. */
function sane(v: Values, wtc: string | null, notes: string[]): Values {
  const out = { ...v };
  for (const [k, [lo, hi]] of Object.entries(RANGES) as [keyof typeof RANGES, [number, number]][]) {
    const x = out[k];
    if (x !== null && (x < lo || x > hi)) {
      notes.push(`${k} ${x} is outside ${lo}–${hi}, dropped`);
      out[k] = null;
    }
  }
  for (const k of ["firstFlight", "introduced"] as const) {
    const d = out[k];
    if (d !== null && (d < EARLIEST || d.slice(0, 10) > today)) {
      notes.push(`${k} ${d} is before ${EARLIEST} or after today, dropped`);
      out[k] = null;
    }
  }
  if (out.lengthM !== null && out.spanM !== null) {
    const ratio = out.lengthM / out.spanM;
    if (ratio < SHAPE[0] || ratio > SHAPE[1]) {
      notes.push(`length ${out.lengthM} and span ${out.spanM} cannot both be right, dropped`);
      out.lengthM = out.spanM = null;
    }
  }
  const wake = wtc ? WAKE_MTOW[wtc] : undefined;
  if (out.mtowKg !== null && wake && (out.mtowKg < wake[0] || out.mtowKg > wake[1])) {
    notes.push(`MTOW ${out.mtowKg} does not fit wake category ${wtc}, dropped`);
    out.mtowKg = null;
  }
  return out;
}

const figureCount = (v: Values) => FIGURES.filter((k) => v[k] !== null).length;

interface Scored {
  id: string;
  item: ItemData;
  v: Values;
  notes: string[];
  /** 2: matched through its label; 1: the curated article's item; 0: matched only through an alias. */
  tier: number;
  figures: number;
  /** How many designators have this item as a candidate. */
  shared: number;
}

// ---------------------------------------------------------------------------------------------------------------

async function main() {
  const args = process.argv.slice(2);
  const refresh = args.includes("--refresh");
  const show = args.includes("--show") ? new Set(args.filter((a) => !a.startsWith("--"))) : null;
  const version = today;

  const typesFile = JSON.parse(fs.readFileSync(path.join(dataDir, "aircraft_types.json"), "utf8")) as { columns: string[]; rows: unknown[][] };
  const col = (name: string) => typesFile.columns.indexOf(name);
  const types: TypeRow[] = typesFile.rows.map((r) => ({
    designator: String(r[col("designator")]),
    manufacturer: String(r[col("manufacturer")]),
    name: String(r[col("name")]),
    familyId: (r[col("familyId")] as string | null) ?? null,
    engineCount: (r[col("engineCount")] as number | null) ?? null,
    wtc: (r[col("wtc")] as string | null) ?? null,
  }));
  const familiesFile = JSON.parse(fs.readFileSync(path.join(dataDir, "families.json"), "utf8")) as { rows: [string, string, string][] };
  const familyNames = new Map(familiesFile.rows.map(([id, name]) => [id, name]));
  const specsFile = JSON.parse(fs.readFileSync(path.join(dataDir, "type_specs.json"), "utf8")) as { columns: string[]; rows: unknown[][] };
  const curatedArticle = new Map(specsFile.rows.map((r) => [String(r[0]), String(r[1])]));
  const articleUse = new Map<string, number>();
  for (const a of curatedArticle.values()) articleUse.set(a, (articleUse.get(a) ?? 0) + 1);

  const pool = await loadPool(refresh);
  const aircraft = new Set(pool.keys());
  const byArticle = new Map<string, string>();
  for (const c of pool.values()) if (c.article) byArticle.set(c.article, c.qid);
  const idx = indexNames(pool);

  // Candidates of each designator.
  const candidates = new Map<string, { ids: string[]; tier: (id: string) => number; how: string }>();
  for (const t of types) {
    if (t.designator in itemOverrides) {
      const id = itemOverrides[t.designator];
      candidates.set(t.designator, { ids: id ? [id] : [], tier: () => 2, how: "override" });
      continue;
    }
    const { ids, byLabel, how } = matchByName(t, t.familyId ? (familyNames.get(t.familyId) ?? null) : null, idx, pool);
    const article = curatedArticle.get(t.designator);
    const bridged = article && articleUse.get(article) === 1 ? byArticle.get(article) : undefined;
    if (bridged) ids.add(bridged);
    const tier = (id: string) => (byLabel.has(id) ? 2 : id === bridged ? 1 : 0);
    candidates.set(t.designator, { ids: [...ids].sort(byQid), tier, how: bridged && ids.size === 1 && !how ? "article" : how });
  }
  const designatorsOf = new Map<string, number>();
  for (const { ids } of candidates.values()) for (const id of ids) designatorsOf.set(id, (designatorsOf.get(id) ?? 0) + 1);

  const allIds = [...new Set([...candidates.values()].flatMap((c) => c.ids))].sort(byQid);
  const { data, classes } = await loadItems(allIds, refresh);

  // Each designator's item: a label match, then the curated article's item, then an alias match; then the most
  // figures, the item fewer designators match, the lower id.
  const chosen = new Map<string, { best: Scored; scored: Scored[]; how: string }>();
  for (const t of types) {
    const { ids, tier, how } = candidates.get(t.designator)!;
    if (!ids.length) continue;
    const scored = ids.map((id): Scored => {
      const notes: string[] = [];
      const item = data.get(id)!;
      const v = sane(valuesOf(id, item, classes.get(id) ?? [], t.engineCount, aircraft, notes), t.wtc, notes);
      return { id, item, v, notes, tier: tier(id), figures: figureCount(v), shared: designatorsOf.get(id) ?? 1 };
    });
    scored.sort((a, b) => b.tier - a.tier || b.figures - a.figures || a.shared - b.shared || byQid(a.id, b.id));
    chosen.set(t.designator, { best: scored[0]!, scored, how });
  }
  const chosenFor = new Map<string, string[]>();
  for (const [d, { best }] of chosen) chosenFor.set(best.id, [...(chosenFor.get(best.id) ?? []), d]);

  const rows: TypeWikidata[] = [];
  const report: string[] = [];
  const unmatched: string[] = [];
  for (const t of types) {
    const c = chosen.get(t.designator);
    if (!c) {
      unmatched.push(t.designator);
      continue;
    }
    const { best, scored, how } = c;
    const notes = [...best.notes];
    const values: Values = { ...best.v };
    // An item chosen for several designators is their family's: its figures and dates may be any one type's, or
    // the family's as a whole. Its role and engines hold for each.
    const others = chosenFor.get(best.id)!.filter((d) => d !== t.designator);
    if (others.length) {
      notes.push(`${best.id} is also ${others.join(", ")}'s item: its role and engines only`);
      Object.assign(values, { ...EMPTY, role: values.role, engines: values.engines });
    }
    Object.assign(values, valueOverrides[t.designator] ?? {});
    rows.push({ designator: t.designator, item: best.id, revision: best.item.revision, label: best.item.label, ...values });

    if (scored.length > 1) {
      const list = scored.map(
        (s) => `${s.id} ${s.item.label ?? "?"} (${["alias", "article", "label"][s.tier]}, ${s.figures} figures, ${s.shared} designators)`,
      );
      notes.push(`chosen from ${list.join("; ")}`);
    }
    const article = curatedArticle.get(t.designator);
    if (article && how !== "override") {
      const expected = byArticle.get(article);
      const parents = new Set(best.item.statements.filter((s) => PARENT_PROPS.includes(s.prop) && s.entity).map((s) => s.entity!));
      if (expected && expected !== best.id && !parents.has(expected)) notes.push(`not the curated article's item (${article}: ${expected})`);
    }
    if (show?.has(t.designator)) {
      console.log(`\n=== ${t.designator} ${t.manufacturer} ${t.name} (${how})`);
      for (const s of scored) {
        console.log(`  ${s.id} ${s.item.label} [${(classes.get(s.id) ?? []).join(" ")}]`);
        console.log(`    ${[JSON.stringify(s.v), ...s.notes].join("\n    ")}`);
      }
    }
    if (notes.length) {
      report.push(`${t.designator} ${t.manufacturer} ${t.name} → ${best.id} ${best.item.label ?? ""} (${how}):\n  ${notes.join("\n  ")}`);
    }
  }
  for (const d of [...Object.keys(itemOverrides), ...Object.keys(valueOverrides)]) {
    if (!types.some((t) => t.designator === d)) report.push(`override for ${d}, which aircraft_types.json does not have`);
  }

  if (!show) writeTable("type_wikidata", version, [SOURCE], COLUMNS, rows);

  const has = (test: (r: TypeWikidata) => boolean) => rows.filter(test).length;
  console.log(report.join("\n"));
  console.log(
    [
      `\n${requests} requests`,
      `type_wikidata: ${rows.length} of ${types.length} designators matched`,
      [
        `length+span ${has((r) => r.lengthM !== null && r.spanM !== null)}`,
        `MTOW ${has((r) => r.mtowKg !== null)}`,
        `first flight ${has((r) => r.firstFlight !== null)}`,
        `role ${has((r) => r.role !== null)}`,
        `engines ${has((r) => r.engines !== null)}`,
        `seats ${has((r) => r.seatsMax !== null)}`,
      ].join(", "),
      `not matched (${unmatched.length}): ${unmatched.join(" ")}`,
    ].join("\n"),
  );
}

function byQid(a: string, b: string): number {
  return Number(a.slice(1)) - Number(b.slice(1));
}

await main();
