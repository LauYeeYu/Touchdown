// Figures of aircraft types from English Wikipedia, for the type pages: for each article in
// src/curated/type-specs.ts, the "Specifications" section's tables (or its list) are read by row label, converted to
// metric and written to data/type_specs.json, with the family's infobox facts in data/family_facts.json. Figures
// only, no prose. Each row keeps the article's title and revision, so a page links to the text the figure came from.
//
//   npx tsx packages/refdata/scripts/type-specs.ts                 build both tables (answers cached)
//   npx tsx packages/refdata/scripts/type-specs.ts --refresh       ask for each article's latest revision first
//   npx tsx packages/refdata/scripts/type-specs.ts --dump TITLE…   print what the parser reads in the articles' sections
//   npx tsx packages/refdata/scripts/type-specs.ts --dump-all TITLE…   print every table of the articles, by section
//
// The build prints what a reviewer should look at (cells with several figures, the seat counts and what they came
// from, headings not found) and the coverage of the families' designators.
//
// Answers from the MediaWiki API are cached in data/private/cache/wikipedia/ (git-ignored), one request a second
// at most. A section's text is asked for by revision, so a rerun without --refresh fetches nothing.

import fs from "node:fs";
import path from "node:path";
import { curatedFamilies } from "../src/curated/families.ts";
import {
  familyFactOverrides,
  typeSpecOverrides,
  typeSpecSources,
  type FamilyFactValues,
  type SpecSource,
  type Target,
  type TypeSpecValues,
} from "../src/curated/type-specs.ts";
import { compare, dataDir, packageDir, WIKI_USER_AGENT as USER_AGENT, writeTable } from "./lib.ts";

const API = "https://en.wikipedia.org/w/api.php";
const cacheDir = path.resolve(packageDir, "../../data/private/cache/wikipedia");
const SOURCE = "English Wikipedia (figures), linked from each type's page";

// ---------------------------------------------------------------------------------------------------------------
// MediaWiki API

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let lastRequest = 0;

/** An answer of the API, read field by field. */
type Json = any;

async function api(params: Record<string, string>, cacheName: string, refresh: boolean): Promise<Json> {
  const file = path.join(cacheDir, cacheName);
  if (!refresh && fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, "utf8"));
  const url = `${API}?${new URLSearchParams({ ...params, format: "json", formatversion: "2", maxlag: "5" })}`;
  for (let attempt = 0; ; attempt++) {
    const wait = lastRequest + 1000 - Date.now();
    if (wait > 0) await sleep(wait);
    lastRequest = Date.now();
    const res = await fetch(url, { headers: { "User-Agent": USER_AGENT, "Api-User-Agent": USER_AGENT } });
    if ((res.status === 429 || res.status >= 500) && attempt < 4) {
      await sleep(5000 * (attempt + 1));
      continue;
    }
    if (!res.ok) throw new Error(`${params.page ?? params.oldid}: the API answered ${res.status}`);
    const json = (await res.json()) as Json;
    if (json.error?.code === "maxlag" && attempt < 4) {
      await sleep(5000 * (attempt + 1));
      continue;
    }
    if (json.error) throw new Error(`${params.page ?? params.oldid}: ${json.error.code} (${json.error.info})`);
    fs.mkdirSync(cacheDir, { recursive: true });
    fs.writeFileSync(file, JSON.stringify(json));
    return json;
  }
}

const slug = (title: string) => title.replace(/[^A-Za-z0-9]+/g, "_").replace(/^_|_$/g, "");

interface Section {
  line: string;
  index: string;
}

interface Article {
  /** Title as the API resolves it (after redirects). */
  title: string;
  revid: number;
  sections: Section[];
}

async function getArticle(title: string, refresh: boolean): Promise<Article> {
  const json = await api({ action: "parse", page: title, prop: "tocdata|revid", redirects: "1" }, `${slug(title)}.toc.json`, refresh);
  const p = json.parse;
  const sections: Section[] = (p.tocdata?.sections ?? []).map((s: Json) => ({
    line: text(parseHtml(String(s.line))),
    index: String(s.index),
  }));
  return { title: p.title, revid: p.revid, sections };
}

/** A section's HTML at the article's revision; without `index`, the whole article. */
async function sectionHtml(a: Article, index?: string): Promise<string> {
  const params: Record<string, string> = { action: "parse", oldid: String(a.revid), prop: "text", disablelimitreport: "1", disableeditsection: "1" };
  if (index !== undefined) params.section = index;
  const json = await api(params, `${slug(a.title)}.${a.revid}.${index === undefined ? "full" : `s${index}`}.json`, false);
  return String(json.parse.text);
}

/** The section holding the figures: the first whose heading starts with "Specification" (or matches `pattern`). */
function specSection(a: Article, pattern?: string): Section | null {
  const re = pattern ? new RegExp(pattern, "i") : /^(aircraft |technical )?specifications?\b|^specs\b/i;
  return a.sections.find((s) => re.test(s.line)) ?? null;
}

// ---------------------------------------------------------------------------------------------------------------
// A small tolerant HTML parser: enough for MediaWiki's (already well-formed) output.

interface El {
  tag: string;
  attrs: Record<string, string>;
  children: Node[];
}
type Node = El | string;

const VOID = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr"]);
const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  ndash: "–",
  mdash: "—",
  minus: "−",
  times: "×",
  deg: "°",
  thinsp: " ",
  ensp: " ",
  emsp: " ",
  hairsp: " ",
  hellip: "…",
  frac12: "½",
  frac14: "¼",
  frac34: "¾",
  sup2: "²",
  middot: "·",
  prime: "′",
  Prime: "″",
  lsquo: "‘",
  rsquo: "’",
  ldquo: "“",
  rdquo: "”",
  zwj: "",
  zwnj: "",
  shy: "",
};

function decode(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+[0-9]?);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const code = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e] ?? ENTITIES[e.toLowerCase()] ?? m;
  });
}

/** Elements an opening tag closes when one is still open, up to the element that scopes them. */
const IMPLIED: Record<string, { closes: string[]; scope: string[] }> = {
  tr: { closes: ["tr", "td", "th"], scope: ["table", "thead", "tbody", "tfoot"] },
  td: { closes: ["td", "th"], scope: ["tr", "table"] },
  th: { closes: ["td", "th"], scope: ["tr", "table"] },
  li: { closes: ["li"], scope: ["ul", "ol"] },
  tbody: { closes: ["thead", "tbody", "tfoot", "tr", "td", "th"], scope: ["table"] },
  thead: { closes: ["thead", "tbody", "tfoot", "tr", "td", "th"], scope: ["table"] },
};

function parseHtml(html: string): El {
  const root: El = { tag: "#root", attrs: {}, children: [] };
  const stack: El[] = [root];
  const re = /<!--[\s\S]*?-->|<(\/?)([a-zA-Z][a-zA-Z0-9]*)((?:\s+[^\s"'>/=]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?)*)\s*(\/?)>|[^<]+|</g;
  for (const m of html.matchAll(re)) {
    const top = stack[stack.length - 1]!;
    if (m[0].startsWith("<!--")) continue;
    if (!m[2]) {
      top.children.push(decode(m[0]));
      continue;
    }
    const tag = m[2].toLowerCase();
    if (m[1]) {
      const at = stack.map((e) => e.tag).lastIndexOf(tag);
      if (at > 0) stack.length = at;
      continue;
    }
    const implied = IMPLIED[tag];
    if (implied) {
      for (let i = stack.length - 1; i > 0; i--) {
        const t = stack[i]!.tag;
        if (implied.scope.includes(t)) break;
        if (implied.closes.includes(t)) {
          stack.length = i;
          break;
        }
      }
    }
    const attrs: Record<string, string> = {};
    for (const a of (m[3] ?? "").matchAll(/([^\s"'>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g)) {
      attrs[a[1]!.toLowerCase()] = decode(a[2] ?? a[3] ?? a[4] ?? "");
    }
    const el: El = { tag, attrs, children: [] };
    stack[stack.length - 1]!.children.push(el);
    if (!VOID.has(tag) && !m[4]) stack.push(el);
  }
  return root;
}

const SKIP_CLASS = /\b(reference|noprint|mw-editsection|sortkey|mw-cite-backlink|Inline-Template|mw-ref)\b/;
const BLOCK = new Set(["p", "div", "li", "ul", "ol", "dl", "dt", "dd", "tr", "table", "h1", "h2", "h3", "h4", "h5", "h6", "caption"]);

function collectText(node: Node, out: string[]): void {
  if (typeof node === "string") {
    out.push(node);
    return;
  }
  if (node.tag === "style" || node.tag === "script") return;
  if (SKIP_CLASS.test(node.attrs.class ?? "")) return;
  if (/display:\s*none/i.test(node.attrs.style ?? "")) return;
  if (node.tag === "br") {
    out.push("\n");
    return;
  }
  const block = BLOCK.has(node.tag);
  if (block) out.push("\n");
  for (const c of node.children) collectText(c, out);
  if (block) out.push("\n");
}

/** Visible text: references, hidden spans and sort keys left out, one line per block or <br>. */
function text(node: Node): string {
  const out: string[] = [];
  collectText(node, out);
  return out
    .join("")
    .replace(/[     ]/g, " ")
    .replace(/[​-‍­]/g, "")
    .replace(/\[(?:\d+|[a-z]|[A-Z]|note \d+|[a-z]+ \d+|N \d+|citation needed|nb \d+)\]/g, "")
    .split("\n")
    .map((l) => l.replace(/[ \t]+/g, " ").trim())
    .filter((l) => l !== "")
    .join("\n");
}

function* walk(node: El, into: (el: El) => boolean = () => true): Generator<El> {
  for (const c of node.children) {
    if (typeof c === "string") continue;
    yield c;
    if (into(c)) yield* walk(c, into);
  }
}

const classOf = (el: El) => el.attrs.class ?? "";

// ---------------------------------------------------------------------------------------------------------------
// Tables and lists

interface Cell {
  text: string;
  header: boolean;
  id: number;
}

/** A table as a grid: a cell spanning several rows or columns fills each place it covers. */
function tableGrid(table: El): Cell[][] {
  const rows: El[] = [];
  for (const el of walk(table, (e) => e.tag !== "table")) if (el.tag === "tr") rows.push(el);
  const grid: Cell[][] = rows.map(() => []);
  let id = 0;
  rows.forEach((tr, r) => {
    let c = 0;
    for (const td of tr.children) {
      if (typeof td === "string" || (td.tag !== "td" && td.tag !== "th")) continue;
      while (grid[r]![c]) c++;
      const colspan = Math.min(Math.max(parseInt(td.attrs.colspan ?? "1", 10) || 1, 1), 50);
      const rowspan = Math.min(Math.max(parseInt(td.attrs.rowspan ?? "1", 10) || 1, 1), rows.length - r);
      const cell: Cell = { text: text(td), header: td.tag === "th", id: id++ };
      for (let dr = 0; dr < rowspan; dr++) for (let dc = 0; dc < colspan; dc++) grid[r + dr]![c + dc] = cell;
      c += colspan;
    }
  });
  const width = Math.max(0, ...grid.map((row) => row.length));
  return grid.map((row) => Array.from({ length: width }, (_, c) => row[c] ?? { text: "", header: false, id: id++ }));
}

interface Pair {
  label: string;
  value: string;
}

/** Normalised heading or label: lower case, letters and digits only. */
const norm = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

/**
 * Reads a table by variant: a row whose cells name variants of `keys` starts a block, and each row below it gives
 * one label (the cells left of the first variant's column) and a value for each variant. A table with one variant a
 * row (the variant in its first columns, labels in the heading row) is read the other way round.
 */
function readTable(grid: Cell[][], keys: Map<string, string>, out: Map<string, Pair[]>, found: Set<string>): void {
  let columns: Map<number, string> | null = null;
  let firstCol = 0;
  let headingRow: Cell[] = [];
  for (const row of grid) {
    const heading = new Map<number, string>();
    row.forEach((cell, c) => {
      const key = keys.get(norm(cell.text));
      if (key && !(row[c - 1]?.id === cell.id && heading.has(c - 1))) heading.set(c, key);
    });
    if (heading.size > 0 && (heading.size >= 2 || keys.size === 1) && [...heading.keys()].every((c) => row[c]!.header || heading.size >= 2)) {
      columns = heading;
      firstCol = Math.min(...heading.keys());
      headingRow = row;
      for (const k of heading.values()) found.add(k);
      continue;
    }
    if (!columns || firstCol === 0) continue;
    // The label: the cells under the heading row's first cell (other variants' columns may stand between it and ours).
    const labelCells: Cell[] = [];
    for (let c = 0; c < firstCol; c++) {
      if (c > 0 && headingRow[c]!.id !== headingRow[0]!.id) continue;
      if (!labelCells.some((x) => x.id === row[c]!.id)) labelCells.push(row[c]!);
    }
    const label = labelCells.map((x) => x.text).join(" ").trim();
    if (!label) continue;
    for (const [c, key] of columns) {
      const cell = row[c]!;
      if (labelCells.some((x) => x.id === cell.id)) continue; // a heading across the whole row
      if (!out.has(key)) out.set(key, []);
      out.get(key)!.push({ label, value: cell.text });
    }
  }
  if (found.size > 0 || grid.length < 2) return;
  // One variant a row.
  const head = grid[0]!;
  for (const row of grid.slice(1)) {
    for (let k = 0; k < Math.min(2, row.length); k++) {
      const key = keys.get(norm(row[k]!.text));
      if (!key) continue;
      found.add(key);
      if (!out.has(key)) out.set(key, []);
      row.forEach((cell, c) => {
        if (c <= k || cell.id === row[k]!.id) return;
        out.get(key)!.push({ label: head[c]!.text, value: cell.text });
      });
      break;
    }
  }
}

const NOT_CONTENT = /\b(references|reflist|mw-references-wrap|navbox|metadata|sidebar|thumb|hatnote)\b/;

/**
 * "Label: value" items of the section's lists (the "Aircraft specs" template), by the sub-heading above them
 * ("" before the first): an article may give one list for each variant, under its own heading.
 */
function listGroups(section: El): Map<string, Pair[]> {
  const groups = new Map<string, Pair[]>([["", []]]);
  let heading = "";
  const visit = (el: El): void => {
    for (const c of el.children) {
      if (typeof c === "string" || c.tag === "table" || NOT_CONTENT.test(classOf(c))) continue;
      if (/^h[3-6]$/.test(c.tag)) {
        heading = text(c);
        if (!groups.has(heading)) groups.set(heading, []);
        continue;
      }
      if (c.tag !== "li") {
        visit(c);
        continue;
      }
      const own: El = { ...c, children: c.children.filter((n) => typeof n === "string" || (n.tag !== "ul" && n.tag !== "ol")) };
      const line = text(own).replace(/\n/g, " ");
      const nested = c.children.filter((n): n is El => typeof n !== "string" && (n.tag === "ul" || n.tag === "ol"));
      const m = line.match(/^([^:]{1,60}):\s*(.*)$/);
      if (!m) continue;
      const value = [m[2]!, ...nested.map((n) => text(n).replace(/\n/g, " ; "))].filter(Boolean).join(" ; ");
      groups.get(heading)!.push({ label: m[1]!.trim(), value: value.trim() });
    }
  };
  visit(section);
  return groups;
}

/** Every "Label: value" item of the section's lists, in order. */
function listItems(section: El): Pair[] {
  return [...listGroups(section).values()].flat();
}

/** The section's one list, else its two-column tables (label, value). */
function readList(section: El): Pair[] {
  const pairs = listItems(section);
  if (pairs.length > 0) return pairs;
  for (const t of walk(section)) {
    if (t.tag !== "table" || /\b(navbox|infobox|metadata|sidebar)\b/.test(classOf(t))) continue;
    for (const row of tableGrid(t)) {
      if (row.length >= 2 && row[0]!.id !== row[1]!.id) pairs.push({ label: row[0]!.text, value: row[1]!.text });
    }
  }
  return pairs;
}

// ---------------------------------------------------------------------------------------------------------------
// Values

const NUM = String.raw`(\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?)`;
const num = (s: string) => Number(s.replace(/,/g, ""));
const round = (v: number, places: number) => Math.round(v * 10 ** places) / 10 ** places;

/** The first value with one of the metric units, else the first with an imperial one, converted; rounded to `places`. */
function measure(s: string, metric: [RegExp, number][], imperial: [RegExp, number][], places: number): number | null {
  const first = (units: [RegExp, number][]): { at: number; v: number } | null => {
    let best: { at: number; v: number } | null = null;
    for (const [re, factor] of units) {
      const m = new RegExp(re.source, "gi").exec(s);
      if (m && (!best || m.index < best.at)) best = { at: m.index, v: num(m[1]!) * factor };
    }
    return best;
  };
  const m = first(metric);
  if (m) return round(m.v, places);
  const i = first(imperial);
  return i ? round(i.v, places) : null;
}

/** A number and its unit; in a range ("98,000–100,000 kg", "800 to 870 km/h") the first number. */
const u = (unit: string) => new RegExp(`${NUM}(?:\\s*(?:–|-|to)\\s*${NUM.replace("(", "(?:")})?\\s*(?:${unit})(?![a-z0-9²³])`, "i");

function lengthM(s: string): number | null {
  const metric = measure(s, [[u("m|metres|meters"), 1], [u("cm"), 0.01]], [], 2);
  if (metric !== null) return metric;
  const ftIn = new RegExp(`${NUM}\\s*(?:ft|feet|foot|′|')(?:\\s*(\\d+(?:\\.\\d+)?)(?:\\+(\\d+)⁄(\\d+))?\\s*(?:in|inches|″|"))?`, "i").exec(s);
  if (ftIn) {
    const inches = ftIn[2] ? Number(ftIn[2]) + (ftIn[3] && ftIn[4] ? Number(ftIn[3]) / Number(ftIn[4]) : 0) : 0;
    return round(num(ftIn[1]!) * 0.3048 + inches * 0.0254, 2);
  }
  const inch = u("in|inches").exec(s);
  return inch ? round(num(inch[1]!) * 0.0254, 2) : null;
}

const massKg = (s: string) => {
  const v = measure(s, [[u("kg|kilograms?"), 1], [u("t|tonnes?|metric tons?"), 1000]], [[u("lb|lbs|pounds?"), 0.45359237]], 0);
  return v === null ? null : Math.round(v);
};
const rangeKm = (s: string) => {
  const v = measure(s, [[u("km|kilometres|kilometers"), 1]], [[u("nmi|nm|nautical miles?"), 1.852], [u("mi|miles?|statute miles?"), 1.609344]], 0);
  return v === null ? null : Math.round(v);
};
const speedKmh = (s: string) => {
  const v = measure(s, [[u("km/h|kph|km/hr"), 1]], [[u("kn|kt|kts|knots?|KTAS|KIAS"), 1.852], [u("mph"), 1.609344]], 0);
  return v === null ? null : Math.round(v);
};
const areaM2 = (s: string) => measure(s, [[u("m2|m²|sq m|square metres"), 1]], [[u("sq ft|ft2|ft²|square feet"), 0.09290304]], 1);
function mach(s: string): number | null {
  const m = /\b(?:Mach|M)\s*(\d?\.\d+|\d(?:\.\d+)?)/.exec(s);
  return m ? Number(m[1]) : null;
}
function angle(s: string): number | null {
  const m = new RegExp(`${NUM}\\s*(?:°|degrees?\\b|deg\\b)`, "i").exec(s);
  return m ? num(m[1]!) : null;
}

/** Exterior fuselage width in a cell that may also give the height and the cabin's width ("4.14 m height, 3.95 m width"). */
function fuselageWidthM(s: string): number | null {
  const parts = s.split(/\n|;|,\s|\//);
  const named = parts.filter((p) => /width|diameter|wide|\bdia\b/i.test(p) && !/cabin|interior|inside|internal|aisle|floor/i.test(p));
  if (named.length) return lengthM(named[0]!);
  if (parts.some((p) => /height|cabin|interior/i.test(p))) return null;
  return lengthM(s);
}

interface FieldRule {
  /** Label tests, best first. */
  tests: RegExp[];
  exclude?: RegExp;
}

const RULES = {
  length: { tests: [/^(overall |exterior )?length( overall)?$/, /\blength\b/], exclude: /cabin|cargo|hold|runway|take ?off|landing|field|deck|interior|wheel|rotor|nose|blade|tfol|lfl|fuselage|ramp/ },
  span: { tests: [/^(wing ?span|span)$/, /wing ?span|\bspan\b/], exclude: /tail|stabili[sz]er|tailplane|horizontal|rotor|cabin|life/ },
  height: { tests: [/^(overall )?height$/, /\bheight\b/], exclude: /cabin|interior|door|cargo|deck|sill|hold|ceiling|cockpit|aisle|max height|operating|fuselage|width|ramp/ },
  fuselageWidth: {
    tests: [
      /fuselage (max(imum)? |external |exterior )?(width|diameter)|(exterior|external|outside|outer) (fuselage )?(width|diameter)|(width|diameter) (of )?fuselage|^fuselage width/,
      /^fuselage$|^width$|^diameter$/,
    ],
    exclude: /cabin|interior|inside|internal|cargo|deck|aisle|seat|length|height/,
  },
  wingArea: { tests: [/wing area|^area$/, /^wings?$|^wing (data|dimensions)$/] },
  sweep: { tests: [/sweep/] },
  mtow: {
    tests: [/max(imum)? take ?off (weight|mass|wt)|\bmtow\b|^max(imum)? take ?off$|take ?off weight max/, /max(imum)? gross (weight|mass)|^gross weight/, /take ?off (weight|mass)/],
    exclude: /zero|landing|ramp|taxi|empty|payload|operating|fuel weight|mlw|mzfw/,
  },
  range: {
    tests: [/^range$/, /^range (typical|pax|passengers?|with|\d+ (pax|passengers|seats))|typical range|range typical|range with passengers/, /\brange\b/],
    exclude: /ferry|combat|radius|altitude|endurance|cruise|freighter|cargo|mtow|max(imum)? fuel|empty/,
  },
  cruise: {
    tests: [
      /(long range|typical|economic|economy|normal|econ|lrc) cruis|cruis\w* (speed )?(long range|typical|economic|economy|normal|lrc)/,
      /^cruis(e|ing)( speed)?$|^(speed )?cruise( speed)?$|cruise speed|cruising speed/,
      /cruis/,
      /^speeds?$/,
    ],
    exclude: /altitude|ceiling|^range\b|thrust|fuel|power|height|level|max(imum)?|high/,
  },
  engines: {
    tests: [
      /^engines?( \d| x ?\d| \d ?x)?$|^engines? (model|type|options?|s)\b|^engines? \d|^powerplants?\b|^engines? \(|^(\d ?x? ?)?(turbofans?|turboprops?|turbojets?)( \d| x ?\d| \d ?x)?$/,
      /\bengines?\b|powerplant|^(turbofans?|turboprops?|turbojets?)\b/,
    ],
    exclude: /thrust|\bpower\b|output|rating|bypass|fuel|nacelle|rpm|weight|bpr|pressure/,
  },
} satisfies Record<string, FieldRule>;

const SEAT_TYPICAL: FieldRule = {
  tests: [
    /typical|2 class|two class|seating 2|seats 2|seats two|dual class/,
    /^(seating|seats|passengers|capacity|seating capacity|passenger capacity|pax|passengers seats|seats passengers)$/,
    /seat|passeng|capacity|\bpax\b/,
  ],
  exclude: /max|exit|1 class|one class|single class|high density|limit|cargo|freight|crew|fuel|payload|abreast|width|pitch|volume|lav|weight|containers?|pallets?|ld3|3 class|three class|row|cruis|speed|range|mach|thrust|oew|empty/,
};
const SEAT_THREE: FieldRule = { tests: [/3 class|three class/], exclude: /cargo|freight|fuel|payload|width|pitch|volume/ };
const SEAT_MAX: FieldRule = {
  tests: [/exit limit|max(imum)? (seating|seats|pax|passengers|capacity|passenger capacity)|1 class|one class|single class|high density|certified|seating max|seats max|passengers max|^max(imum)?$/],
  exclude: /cargo|freight|fuel|payload|weight|width|pitch|volume|containers?|pallets?|range|cruis|speed/,
};

function candidates(pairs: Pair[], rule: FieldRule): Pair[] {
  const scored: { pair: Pair; rank: number; at: number }[] = [];
  pairs.forEach((pair, at) => {
    const l = norm(pair.label);
    if (rule.exclude?.test(l)) return;
    const rank = rule.tests.findIndex((t) => t.test(l));
    if (rank >= 0) scored.push({ pair, rank, at });
  });
  return scored.sort((a, b) => a.rank - b.rank || a.at - b.at).map((s) => s.pair);
}

function firstOf<T>(pairs: Pair[], rule: FieldRule, read: (s: string) => T | null): { value: T; from: Pair } | null {
  for (const pair of candidates(pairs, rule)) {
    const value = read(pair.value);
    if (value !== null) return { value, from: pair };
  }
  return null;
}

/** Parts of a seating cell that count cargo, troops or weights rather than passengers. */
const NOT_SEATS =
  /\b(kg|lb|lbs|tonnes?|t|m3|m³|cu ft|ft3|pallets?|containers?|LD\d|stretchers?|litters?|troops?|paratroop\w*|soldiers|vehicles?|cargo|payload|kN|crew|patients|ambulatory|attendants)\b/i;
/** Words that say a part of a seating cell counts people. */
const SEAT_WORDS = /passeng|seat|\bpax\b|class|occupants|economy|layout/i;

/** The first number in a part that is not a seat pitch ("at 81 cm", "@ 32 in", "30–33 in"). */
function seatNumber(raw: string): number | null {
  // A part that is a bracket of its own ("(max 172)") is read without the brackets; inside a part, a bracket describes.
  const part = /^\s*\(/.test(raw) ? raw.replace(/^\s*\(/, "").replace(/\)\s*$/, "") : raw;
  for (const m of part.matchAll(/\d{1,3}(?:,\d{3})?/g)) {
    const before = part.slice(0, m.index);
    const after = part.slice(m.index + m[0].length);
    if ((before.match(/\(/g) ?? []).length > (before.match(/\)/g) ?? []).length) continue;
    if (/(@|\bat|[–-])\s*$/.test(before) || /^\.?\d/.test(after) || /^-?\s*class/i.test(after)) continue;
    if (/^\s*([–-]\s*\d+\s*)?(cm|in\b(?!\s+([a-z]|\d))|mm|″|"|inch)/.test(after)) continue;
    return num(m[0]);
  }
  return null;
}

/** Seats in a cell: "150 (2-class)", "180 (exit limit)", "106 in two classes or 117 in one class". */
function seatParts(s: string): { typical: number | null; three: number | null; max: number | null; plain: number | null } {
  const out = { typical: null as number | null, three: null as number | null, max: null as number | null, plain: null as number | null };
  // "(128 in high-density layout)" is a figure of its own; "(36J @ 150 cm + 210Y @ 80 cm)" describes the one before it.
  const parts = s
    .replace(/\((?=\s*(?:max\.?|maximum|up to|exit limit)?\s*\d+\s*(?:\)|[a-z]{3,}|in\s+[a-z]))/gi, "\n(")
    // "158 (8J + 150Y) to 192 (1-class HD)", "97 in 2-class to 122 max.": two figures, the second qualified.
    .replace(/(?<!up)\s+to\s+(?=\d+[^;,\n]*?(max|class|exit|\bHD\b|high))/gi, "\n")
    // "4 or 5 passengers" is a range.
    .replace(/(\d)\s+or\s+(?=\d)/g, "$1–")
    .split(/\n|;|,(?!\d{3})|\/(?!\d)|\band\b|\bor\b/);
  // In a cell that names what it counts ("467 passengers … 12 full-width containers"), a part that does not is no seat count.
  const named = parts.some((p) => SEAT_WORDS.test(p.replace(/\([^)]*\)/g, "")) && seatNumber(p) !== null);
  for (const part of parts) {
    const n = seatNumber(part);
    if (n === null) continue;
    if (named && !SEAT_WORDS.test(part) && !/exit|max|limit|typical/i.test(part)) continue;
    // Judge the part without its brackets and seat pitch ("48 at 30 in pitch", "50@30–33\"").
    const bare = part.replace(/\([^)]*\)/g, " ").replace(/(@|\bat\b)\s*\d.*$/, " ");
    if (NOT_SEATS.test(bare.replace(String(n), ""))) continue;
    if (n > 1000) continue;
    const p = norm(part);
    if (/exit|max|1 class|one class|single class|high density|all economy|limit|up to|certified/.test(p)) out.max ??= n;
    else if (/3 class|three class/.test(p)) out.three ??= n;
    else if (/2 class|two class|typical|dual class|mixed class/.test(p)) out.typical ??= n;
    else out.plain ??= n;
  }
  return out;
}

/** Words that describe an engine rather than name it ("turbofans", "6-cylinder air-cooled piston engine"). */
const ENGINE_WORDS =
  /\s+(?:\d+[- ]cyl(?:inder|\.)?|(?:two|three|four|five|six|seven|nine|single|twin)[- ]cylinder|cylinder|air-cooled|liquid-cooled|water-cooled|horizontally[- ]opposed|opposed|flat[- ]\w+|naturally aspirated|[Tt]urbo(?:fan|prop|shaft|jet)s?|[Tt]urbines?|piston|coupled|engines?|aero-engine|aircraft engine|high[- ]bypass|low[- ]bypass|turbocharged|supercharged|fuel[- ]injected|geared|inverted|radial|two[- ]row|two-stage|centrifugal|each|with|auxiliary|and subvariants)\b.*$/;

/** One engine's name, short: its first part, without thrust or power figures and describing words. */
function engineName(s: string): string {
  const first = s.replace(/\([^)]*\)/g, "").split(/,\s+|\s+\*\s+/)[0]!;
  return first.replace(ENGINE_WORDS, "").replace(/\s+/g, " ").replace(/[\s,;:.]+$/, "").replace(/\s+or$/, "").trim();
}

/** Engine names of one or more cells: the count, then the names, alternatives joined with "or". */
function engineText(cells: string[], count: number | null): string | null {
  let n: number | null = null;
  const names: string[] = [];
  for (const cell of cells) {
    for (const line of cell.split("\n")) {
      // An auxiliary power unit is not one of the engines.
      if (/auxiliary power|\bAPU\b/i.test(line)) continue;
      let l = line.trim().replace(/\([^)]*\)/g, "");
      const lead = /^(\d)\s*[×x]\s*/i.exec(l);
      if (lead) {
        n ??= Number(lead[1]);
        l = l.slice(lead[0].length);
      }
      l = l.replace(/\s+or$/, "").replace(/^[\d,.–-]+\s*(lbf|kN)\s*/, "");
      if (!l || /^[\d(]/.test(l)) continue;
      for (const alt of l.split(/\s+or\s+|\s+\/\s+/)) {
        const name = engineName(alt.replace(/^\d\s*[×x]\s*/i, ""));
        if (name && !names.includes(name)) names.push(name);
      }
    }
  }
  if (!names.length) return null;
  n ??= count;
  return n ? `${n} × ${names.join(" or ")}` : names.join(" or ");
}

// ---------------------------------------------------------------------------------------------------------------
// Infobox

function infobox(html: string): Map<string, El> {
  const root = parseHtml(html);
  const rows = new Map<string, El>();
  for (const t of walk(root)) {
    if (t.tag !== "table" || !/\binfobox\b/.test(classOf(t))) continue;
    for (const tr of walk(t, (e) => e.tag !== "table")) {
      if (tr.tag !== "tr") continue;
      const th = tr.children.find((c): c is El => typeof c !== "string" && c.tag === "th");
      const td = tr.children.find((c): c is El => typeof c !== "string" && c.tag === "td");
      if (th && td) {
        const label = norm(text(th));
        if (!rows.has(label)) rows.set(label, td);
      }
    }
    break;
  }
  return rows;
}

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
const pad = (n: number) => String(n).padStart(2, "0");

/**
 * The earliest date in a value (an infobox may give one for each model): ISO dates a "Start date" template hides, and
 * "22 February 1987", "February 22, 1987", "Sept. 2015", "1987". Null for a date to come ("2027 (expected)").
 */
function dateOf(td: El): string | null {
  const s = text(td);
  if (/expected|planned|scheduled|projected/i.test(s)) return null;
  const found: { at: number; end: number; v: string }[] = [];
  for (const el of walk(td)) {
    if (/\b(dtstart|bday|published)\b/.test(classOf(el))) {
      const iso = text({ ...el, attrs: {} }).trim();
      if (/^\d{4}(-\d{2}(-\d{2})?)?$/.test(iso)) found.push({ at: -1, end: -1, v: iso });
    }
  }
  const month = `(${MONTHS.join("|")}|sept|${MONTHS.map((m) => m.slice(0, 3)).join("|")})\\.?`;
  const mi = (name: string) => pad(MONTHS.findIndex((x) => x.startsWith(name.toLowerCase().slice(0, 3))) + 1);
  const patterns: [RegExp, (m: RegExpExecArray) => string][] = [
    [new RegExp(`(\\d{1,2})\\s+${month}\\s+(\\d{4})`, "gi"), (m) => `${m[3]}-${mi(m[2]!)}-${pad(Number(m[1]))}`],
    [new RegExp(`${month}\\s+(\\d{1,2}),?\\s+(\\d{4})`, "gi"), (m) => `${m[3]}-${mi(m[1]!)}-${pad(Number(m[2]))}`],
    [new RegExp(`${month}\\s+(\\d{4})`, "gi"), (m) => `${m[2]}-${mi(m[1]!)}`],
    [/\b(1[89]\d{2}|20\d{2})\b/g, (m) => m[1]!],
  ];
  for (const [re, f] of patterns) {
    for (const m of s.matchAll(re)) {
      const at = m.index;
      const end = at + m[0].length;
      if (found.some((x) => at < x.end && end > x.at)) continue;
      found.push({ at, end, v: f(m as RegExpExecArray) });
    }
  }
  // "1987-02-22" before "1987": a year alone sorts after the dates in it.
  const key = (v: string) => (v.length === 4 ? `${v}~` : v);
  return found.map((x) => x.v).sort((a, b) => compare(key(a), key(b)))[0] ?? null;
}

function familyFacts(html: string): FamilyFactValues {
  const box = infobox(html);
  const get = (...labels: string[]) => labels.map((l) => box.get(l)).find(Boolean) ?? null;
  const first = get("first flight");
  const intro = get("introduction", "introduced", "introduction date", "entry into service", "in service");
  const builtEl = get("number built", "built", "produced number");
  const statusEl = get("status");
  let built: number | null = null;
  let builtAsOf: string | null = null;
  if (builtEl) {
    const s = text(builtEl).replace(/\n/g, " ");
    const asOf = /(?:as of|through|at (?:the )?end of|by)\s+(?:(\d{1,2})\s+)?([A-Za-z]+\.?)?\s*(\d{1,2},?\s+)?(\d{4})/i.exec(s);
    // The count, not a number of the "as of" date.
    const m = /(?<![A-Za-z-])(\d{1,3}(?:,\d{3})+|\d+)/.exec(asOf ? s.replace(asOf[0], " ") : s);
    if (m) built = num(m[1]!);
    if (asOf) {
      const mi = asOf[2] ? MONTHS.findIndex((x) => x.startsWith(asOf[2]!.toLowerCase().slice(0, 3))) : -1;
      builtAsOf = mi >= 0 ? `${asOf[4]}-${pad(mi + 1)}` : asOf[4]!;
    }
  }
  return {
    firstFlight: first ? dateOf(first) : null,
    introduced: intro ? dateOf(intro) : null,
    built,
    builtAsOf,
    status: statusEl
      ? text(statusEl)
          .split("\n")
          .map((l) => l.replace(/\s*\(.*$/, "").trim())
          .filter(Boolean)
          .join(", ") || null
      : null,
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Reading one article

interface TypeSpec extends TypeSpecValues {
  designator: string;
  article: string;
  revision: number;
}

const TYPE_COLUMNS = [
  "designator",
  "article",
  "revision",
  "lengthM",
  "spanM",
  "heightM",
  "fuselageWidthM",
  "wingAreaM2",
  "sweepDeg",
  "mtowKg",
  "rangeKm",
  "cruiseKmh",
  "cruiseMach",
  "seatsTypical",
  "seatsMax",
  "engines",
] as const satisfies readonly (keyof TypeSpec)[];

interface FamilyFact extends FamilyFactValues {
  familyId: string;
  article: string;
  revision: number;
}
const FACT_COLUMNS = ["familyId", "article", "revision", "firstFlight", "introduced", "built", "builtAsOf", "status"] as const satisfies readonly (keyof FamilyFact)[];

const EMPTY: TypeSpecValues = {
  lengthM: null,
  spanM: null,
  heightM: null,
  fuselageWidthM: null,
  wingAreaM2: null,
  sweepDeg: null,
  mtowKg: null,
  rangeKm: null,
  cruiseKmh: null,
  cruiseMach: null,
  seatsTypical: null,
  seatsMax: null,
  engines: null,
};

/** Units and filler left out of a part of a cell to find the words that name it ("35.1 m (115 ft) span" → "span"). */
const UNIT_WORDS = /\([^)]*\)|\b(mach|m2|m²|sq|ft|ft2|in|m|km|nmi|mi|kg|t|lb|lbs|kn|mph|km\/h|at|with|of|and|a|the|approx|about|up|to)\b|[\d.,%°~–-]+|×|\bx\b/gi;

/**
 * More pairs from the parts of a cell: "Cruise: Mach 0.78" lines under the row's label ("Speed Cruise"), and parts
 * named by a word ("35.1 m span, 112.3 m2 area" in a "Wing" row → "Wing span", "Wing area").
 */
function withSubLabels(pairs: Pair[]): Pair[] {
  const out: Pair[] = [];
  for (const p of pairs) {
    out.push(p);
    const parts = p.value.split(/\n|;\s(?![^(]*\))|,\s(?![^(]*\))/);
    if (parts.length < 2 && !p.value.includes(":")) continue;
    for (const part of parts) {
      const m = /^\s*([A-Za-z][A-Za-z .()/-]{0,40}?):\s*(.+)$/.exec(part);
      if (m) {
        out.push({ label: `${p.label} ${m[1]}`, value: m[2]! });
        continue;
      }
      if (!/\d/.test(part)) continue;
      const words = part.replace(UNIT_WORDS, " ").replace(/\s+/g, " ").trim();
      if (words && words.split(" ").length <= 3) out.push({ label: `${p.label} ${words}`, value: part.trim() });
    }
  }
  return out;
}

const ROTOR = {
  span: { tests: [/main rotor diameter|^rotor diameter|^main rotor$|^diameter main rotor/] },
  length: { tests: [/fuselage length|length fuselage|^length \(?fuselage/, /^(overall )?length$|^length overall/, /\blength\b/], exclude: /cabin|cargo|interior|blade|tail rotor|chord/ },
} satisfies Record<string, FieldRule>;

/** A rotorcraft's fuselage length, when a "Length" cell gives it beside the length with rotors turning. */
function fuselageLengthM(s: string): number | null {
  const part = s.split(/\n|;|,\s|\//).find((p) => /fuselage/i.test(p));
  return lengthM(part ?? s);
}

/** The figures in one variant's label/value pairs. `notes` gets what a reviewer should look at. */
function readValues(rawPairs: Pair[], engineCount: number | null, src: SpecSource, notes: string[]): TypeSpecValues {
  const rotorcraft = src.rotorcraft === true;
  const pairs = withSubLabels(rawPairs);
  const v: TypeSpecValues = { ...EMPTY };
  const take = <T>(rule: FieldRule, read: (s: string) => T | null, field: string, always = false): T | null => {
    const got = firstOf(pairs, rule, read);
    if (got && (always || /\n|\/|\bor\b/.test(got.from.value))) notes.push(`${field} from "${got.from.label}": ${got.from.value.replace(/\n/g, " | ")}`);
    return got?.value ?? null;
  };
  if (rotorcraft) {
    v.lengthM = take(ROTOR.length, fuselageLengthM, "length", true);
    v.spanM = take(ROTOR.span, lengthM, "rotor diameter");
  } else {
    v.lengthM = take(RULES.length, lengthM, "length");
    v.spanM = take(RULES.span, lengthM, "span");
  }
  v.heightM = take(RULES.height, lengthM, "height");
  const widthRule = rotorcraft ? { ...RULES.fuselageWidth, tests: RULES.fuselageWidth.tests.slice(0, 1) } : RULES.fuselageWidth;
  v.fuselageWidthM = take(widthRule, fuselageWidthM, "fuselageWidth");
  v.wingAreaM2 = rotorcraft ? null : take(RULES.wingArea, areaM2, "wingArea");
  v.sweepDeg = take(RULES.sweep, angle, "sweep");
  v.mtowKg = take(RULES.mtow, massKg, "mtow");
  v.rangeKm = take(RULES.range, rangeKm, "range");
  // Cruise: the part of the cell that says cruise or typical, else the first that is not a maximum.
  const cruisePart = (s: string): string | null => {
    const parts = s.split(/\n|;\s(?![^(]*\))|,\s(?![^(]*\))/).filter((p) => speedKmh(p) !== null || mach(p) !== null);
    const notMax = (p: string) => !/\b(mmo|vmo|max|maximum|dash|high.speed)\b/i.test(p);
    return (
      parts.find((p) => /typical|long.range|econ|\blrc\b|normal/i.test(p)) ??
      parts.find((p) => /cruis/i.test(p) && notMax(p)) ??
      parts.find(notMax) ??
      null
    );
  };
  // A maximum or high-speed cruise is not taken: without a typical one, the figure stays empty.
  const cruise = firstOf(pairs, RULES.cruise, cruisePart);
  if (cruise) {
    v.cruiseKmh = speedKmh(cruise.value);
    v.cruiseMach = mach(cruise.value);
    if (cruise.value !== cruise.from.value || /max/i.test(cruise.from.label)) notes.push(`cruise "${cruise.value}" from "${cruise.from.label}": ${cruise.from.value.replace(/\n/g, " | ")}`);
  }
  // Seats: a row for typical seating and one for the maximum, or both in one cell.
  const typical = candidates(pairs, SEAT_TYPICAL).map((p) => ({ p, s: seatParts(p.value) }));
  const three = candidates(pairs, SEAT_THREE).map((p) => ({ p, s: seatParts(p.value) }));
  const max = candidates(pairs, SEAT_MAX).map((p) => ({ p, s: seatParts(p.value) }));
  for (const { s } of typical) {
    // An unqualified count ("Passenger capacity 149") is the most the source's table seats.
    if (src.capacity === "max") v.seatsMax ??= s.max ?? s.plain;
    v.seatsTypical ??= s.typical ?? (src.capacity === "max" ? null : s.plain);
    v.seatsMax ??= s.max;
  }
  for (const { s } of max) v.seatsMax ??= s.max ?? s.plain ?? s.typical;
  for (const { s } of three) v.seatsTypical ??= s.three ?? s.plain;
  if (v.seatsTypical === null) for (const { s } of typical) v.seatsTypical ??= s.three;
  const seatCells = [...typical, ...three, ...max].map((x) => x.p);
  if (seatCells.length) notes.push(`seats ${v.seatsTypical}/${v.seatsMax} from ${seatCells.map((p) => `"${p.label}": ${p.value.replace(/\n/g, " | ")}`).join(" ; ")}`);
  // Engines: every row with the best label ("Engines (×2)" twice, one row a maker).
  const engineRows = candidates(pairs, RULES.engines);
  if (engineRows.length) {
    const best = norm(engineRows[0]!.label);
    const rows = engineRows.filter((p) => norm(p.label) === best);
    const countInLabel = /[×x]\s*(\d)\b|\b(\d)\s*[×x]/.exec(rows[0]!.label);
    v.engines = engineText(
      rows.map((p) => p.value),
      countInLabel ? Number(countInLabel[1] ?? countInLabel[2]) : engineCount,
    );
  }
  return v;
}

/**
 * The part of a cell for one variant: from "-81: 140,000 lb\n-82: 149,500 lb" the "-82" line for part "82" (or for
 * "82|Super 82", either name). Parts are named by a prefix with a digit ("-83/88:", "30:") or by the part itself
 * ("LR:"). A cell without them stays whole; one that has them but not this variant's gives its unnamed lines, if
 * any, else stays whole.
 */
function partOf(value: string, part: string): string {
  const wants = part.split("|").map((p) => norm(p.replace(/^-/, "")));
  const segs = value.split(/\n|;\s(?![^(]*\))|,\s(?=[-A-Za-z0-9 /.]{1,20}:)/).map((seg) => {
    const m = /^\s*([-A-Za-z0-9 /.]{1,20}?):\s*(.*)$/.exec(seg);
    const tokens = m ? m[1]!.split("/").map((t) => norm(t.replace(/^\s*-/, ""))) : [];
    const mine = tokens.some((t) => wants.includes(t));
    return { seg, mine, variant: m !== null && (mine || /\d/.test(m[1]!)), text: m ? m[2]! : seg };
  });
  if (!segs.some((s) => s.variant)) return value;
  const hit = segs.find((s) => s.mine);
  if (hit) return hit.text;
  const base = segs.filter((s) => !s.variant).map((s) => s.seg);
  return base.length ? base.join("\n") : value;
}

async function readSource(src: SpecSource, refresh: boolean): Promise<{ article: Article; values: Map<string, Pair[]>; notes: string[] }> {
  const article = await getArticle(src.article, refresh);
  const notes: string[] = [];
  if (article.title !== src.article) notes.push(`"${src.article}" is now "${article.title}"`);
  const section = specSection(article, src.section);
  const values = new Map<string, Pair[]>();
  if (!section) {
    notes.push(`no specifications section (${article.sections.map((s) => s.line).join(", ")})`);
    return { article, values, notes };
  }
  const root = parseHtml(await sectionHtml(article, section.index));
  const keys = new Map<string, string>();
  const targetsOf = new Map<string, Target[]>();
  for (const [heading, d] of Object.entries(src.columns)) {
    keys.set(norm(heading), heading);
    targetsOf.set(heading, Array.isArray(d) ? d : [d]);
  }
  const byHeading = new Map<string, Pair[]>();
  if (keys.has("")) {
    // "*": the section's one list or column.
    byHeading.set("*", readList(root));
  } else {
    const found = new Set<string>();
    for (const t of walk(root)) {
      if (t.tag !== "table" || /\b(navbox|infobox|metadata|sidebar)\b/.test(classOf(t))) continue;
      readTable(tableGrid(t), keys, byHeading, found);
    }
    // A list for each variant, under its own sub-heading.
    for (const [heading, pairs] of listGroups(root)) {
      const key = keys.get(norm(heading));
      if (key && !found.has(key) && pairs.length) {
        byHeading.set(key, pairs);
        found.add(key);
      }
    }
    for (const heading of Object.keys(src.columns)) if (!found.has(heading)) notes.push(`no column "${heading}"`);
  }
  for (const [heading, pairs] of byHeading) {
    for (const t of targetsOf.get(heading) ?? []) {
      if (typeof t === "string") values.set(t, pairs);
      else values.set(t.type, pairs.map((p) => ({ label: p.label, value: partOf(p.value, t.part) })));
    }
  }
  return { article, values, notes };
}

// ---------------------------------------------------------------------------------------------------------------

function printTable(t: El, n: number): void {
  console.log(`--- table ${n} (${classOf(t)})`);
  for (const row of tableGrid(t)) console.log(row.map((c) => (c.header ? "*" : "") + c.text.replace(/\n/g, " ¦ ")).join(" | "));
}

/** Prints what the parser reads: the specifications section's tables and list, or with `all` every table of the article. */
async function dump(titles: string[], all: boolean, refresh: boolean): Promise<void> {
  for (const title of titles) {
    let article: Article;
    try {
      article = await getArticle(title, refresh);
    } catch (err) {
      console.log(`\n=== ${title}: ${(err as Error).message}`);
      continue;
    }
    console.log(`\n=== ${article.title} (revision ${article.revid})`);
    if (all) {
      let n = 0;
      const visit = (el: El): void => {
        for (const c of el.children) {
          if (typeof c === "string") continue;
          if (/^h[2-4]$/.test(c.tag)) console.log(`## ${text(c)}`);
          else if (c.tag === "table" && /\bwikitable\b/.test(classOf(c))) printTable(c, n++);
          else visit(c);
        }
      };
      visit(parseHtml(await sectionHtml(article)));
      continue;
    }
    const section = specSection(article);
    if (!section) {
      console.log(`no specifications section: ${article.sections.map((s) => `${s.index} ${s.line}`).join(" | ")}`);
      continue;
    }
    console.log(`section ${section.index} "${section.line}"`);
    const root = parseHtml(await sectionHtml(article, section.index));
    let n = 0;
    for (const t of walk(root)) if (t.tag === "table" && !/\b(navbox|metadata|sidebar)\b/.test(classOf(t))) printTable(t, n++);
    const list = listItems(root);
    if (list.length) {
      console.log("--- list");
      for (const p of list) console.log(`${p.label}: ${p.value}`);
    }
  }
}

async function main() {
  const args = process.argv.slice(2);
  const refresh = args.includes("--refresh");
  if (args.includes("--dump") || args.includes("--dump-all")) {
    await dump(args.filter((a) => !a.startsWith("--")), args.includes("--dump-all"), refresh);
    return;
  }
  const version = new Date().toISOString().slice(0, 10);
  const engineCounts = new Map<string, number | null>();
  const typesFile = JSON.parse(fs.readFileSync(path.join(dataDir, "aircraft_types.json"), "utf8")) as { columns: string[]; rows: unknown[][] };
  const di = typesFile.columns.indexOf("designator");
  const ei = typesFile.columns.indexOf("engineCount");
  for (const r of typesFile.rows) engineCounts.set(String(r[di]), (r[ei] as number | null) ?? null);

  const familyTypes = new Map(curatedFamilies.map((f) => [f.id, f.types]));
  const specs = new Map<string, TypeSpec>();
  const facts: FamilyFact[] = [];
  const report: string[] = [];
  for (const family of typeSpecSources) {
    const types = familyTypes.get(family.familyId);
    if (!types) report.push(`${family.familyId}: not a family in families.ts`);
    for (const src of family.sources) {
      const { article, values, notes } = await readSource(src, refresh);
      for (const d of [...values.keys(), ...(src.linkOnly ?? [])]) {
        if (types && !types.includes(d)) notes.push(`${d} is not a type of ${family.familyId}`);
        if (specs.has(d) && values.has(d) && specs.get(d)!.article !== article.title) notes.push(`${d} is mapped twice`);
      }
      for (const [d, pairs] of values) {
        const typeNotes: string[] = [];
        const v = readValues(pairs, engineCounts.get(d) ?? null, src, typeNotes);
        const before = specs.get(d);
        if (before && before.article === article.title) {
          // A second source in the same article (its specifications list after a comparison table) fills what is still empty.
          for (const k of Object.keys(v) as (keyof TypeSpecValues)[]) if (before[k] === null && v[k] !== null) Object.assign(before, { [k]: v[k] });
        } else specs.set(d, { designator: d, article: article.title, revision: article.revid, ...v });
        for (const n of typeNotes) notes.push(`${d}: ${n}`);
      }
      for (const d of src.linkOnly ?? []) {
        if (!specs.has(d)) specs.set(d, { designator: d, article: article.title, revision: article.revid, ...EMPTY });
      }
      if (notes.length) report.push(`${family.familyId} / ${article.title}:\n  ${notes.join("\n  ")}`);
    }
    if (!family.main) continue;
    const main = await getArticle(family.main, refresh);
    if (main.title !== family.main) report.push(`${family.familyId}: "${family.main}" is now "${main.title}"`);
    const fact = { familyId: family.familyId, article: main.title, revision: main.revid, ...familyFacts(await sectionHtml(main, "0")) };
    Object.assign(fact, familyFactOverrides[family.familyId] ?? {});
    facts.push(fact);
  }
  for (const [d, o] of Object.entries(typeSpecOverrides)) {
    const s = specs.get(d);
    if (!s) report.push(`override for ${d}, which no article gives`);
    else Object.assign(s, o);
  }

  const rows = [...specs.values()].sort((a, b) => compare(a.designator, b.designator));
  writeTable("type_specs", version, [SOURCE], TYPE_COLUMNS, rows);
  writeTable("family_facts", version, [SOURCE], FACT_COLUMNS, facts.sort((a, b) => compare(a.familyId, b.familyId)));

  // Coverage of the families' type designators.
  const all = curatedFamilies.flatMap((f) => f.types);
  const has = (test: (s: TypeSpec) => boolean) => all.filter((d) => specs.has(d) && test(specs.get(d)!)).length;
  const missing = all.filter((d) => !specs.has(d) || TYPE_COLUMNS.slice(3).every((c) => specs.get(d)![c] === null));
  console.log(report.join("\n"));
  console.log(
    [
      `type_specs: ${rows.length} rows; family_facts: ${facts.length} rows`,
      `of ${all.length} designators: length+span ${has((s) => s.lengthM !== null && s.spanM !== null)}, MTOW ${has((s) => s.mtowKg !== null)}, range ${has((s) => s.rangeKm !== null)}, seats ${has((s) => s.seatsTypical !== null)}, fuselage width ${has((s) => s.fuselageWidthM !== null)}, sweep ${has((s) => s.sweepDeg !== null)}`,
      `no figures: ${missing.join(" ")}`,
    ].join("\n"),
  );
}

await main();
