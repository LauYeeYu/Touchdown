// Figures of aircraft types from the specifications templates of English Wikipedia articles (docs/13-reference-data.md,
// "Type figures"), for the ICAO type designators of data/aircraft_types.json that neither the curated figures
// (data/type_specs.json) nor Wikidata (data/type_wikidata.json) give a length and a span: for each, one article and the
// figures its {{Aircraft specs}} template states, written to data/type_wikipedia.json.
//
//   npm run build-type-wikipedia -w @touchdown/refdata                build the table (answers cached)
//   npm run build-type-wikipedia -w @touchdown/refdata -- --refresh   ask Wikipedia and Wikidata again
//   npm run build-type-wikipedia -w @touchdown/refdata -- --show D…   print each designator's candidates and values
//   npm run build-type-wikipedia -w @touchdown/refdata -- --check     also read the articles of the codes that have
//                                                                      figures already, and compare
//
// Every answer of the APIs is cached in data/private/cache/wikipedia/type-wikipedia/ (git-ignored): one file a
// Wikidata item, a page asked for or a search. A rerun without --refresh makes no requests. Requests are a second apart
// at least, titles and items 50 to a request, retried with back-off on 429, 5xx and maxlag.
//
// The article of a designator:
//   1. articleOverrides in src/curated/type-wikipedia.ts, read as they are;
//   2. the English Wikipedia article of its Wikidata item (type_wikidata.json), redirects followed;
//   3. for a designator without an item, or whose item has no English article: a search of English Wikipedia for its
//      manufacturer and model. A result is taken only when its page has a specifications template and names the
//      manufacturer, in its infobox (manufacturer, designer) or in its title outside the model's name ("Ace" of "Super
//      Ace" is not the maker of the "Chrislea Super Ace"), and its title holds
//        a. the model's designation as whole words ("MB-339" in "Aermacchi MB-339"): "An-2" is not in "An-26",
//           "PA-28" not in "PA-28R". The words after it must not name another model ("MQ-1 Predator" is not the "MQ-1
//           Warrior") nor leave out the model's number ("Boeing 737 MAX" is not the "737 MAX 7"); or
//        b. without the designation, the rest of the model's name ("Belfast" of "SC-5 Belfast" in "Short Belfast"),
//           when no other designator of the manufacturer has that name ("Bonanza" is the 33's, 35's and 36's) and the
//           title holds no other designation or number ("T-34 Mentor" for the "T-34A Mentor", "Zlin Z 43" for the
//           "Zlin Z-50") and no other words after the name ("Eurofly Flash Light" for the "Flash"; "Aircraft" may
//           follow it).
//      Names are compared without case, accents, spaces or punctuation, with Roman numerals as digits; a manufacturer's
//      name of five letters or more may start a word ("Agusta" in "AgustaWestland"). Of several results, a title that
//      is the manufacturer and model goes first, then one matched by the designation, then by the name; two of the
//      same standing are ambiguous, and neither is taken. A replica ("Fokker Dr-1 Replica") takes only an article about
//      the replica.
// An article that several designators reach (a family's: several models' items lead to it), or that the curated
// figures read for other designators, states one model's figures without saying which designator's: none of them takes
// its figures. Likewise a redirect to a section of an article (a model's section in its family's article), and an
// article whose specifications' heading names another model of the series ("Specifications (KR-2)" in the article
// found for the KR-1); a model whose number starts with the designation's is a variant of it ("CP.605B" of the CP-60).
//
// Reading. The first {{Aircraft specs}} template of the article (or one of the names that redirect to it, such as
// {{aerospecs}} and {{Aircraft specifications}}), by its parameters:
//   lengthM   length m; else length ft and length in. A rotorcraft's length that its note says includes the rotors is
//             not the fuselage's, which the other tables give, and is not taken.
//   spanM     span m; else span ft and span in; a biplane's or triplane's largest of upper, mid and lower span. The main
//             rotor's diameter (rot dia, main rotor dia) without any span, or when it is wider than the stub wings: a
//             helicopter's or autogyro's
//   heightM   height m; else height ft and height in
//   mtowKg    max takeoff weight kg; else max takeoff weight lb
// Metric where the template has it, else converted exactly (1 ft = 0.3048 m, 1 in = 0.0254 m, 1 lb = 0.45359237 kg).
// A value is read only when it is a plain number, or inches with a fraction as the template takes them ("9+1/2"), once
// references, notes, thousands separators and its own unit are removed. A range, an approximation, a value with text
// or a stated metric value that cannot be read stays empty and is printed. Never derived.
//
// Checks: as in type-wikidata.ts, a value outside its plausible range, a length and span whose ratio no aircraft has,
// or an MTOW that does not fit the designator's wake turbulence category is dropped and printed.

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import type { TypeWikipedia } from "../../core/src/ref/types.ts";
import { articleOverrides } from "../src/curated/type-wikipedia.ts";
import { dataDir, makerForms, packageDir, WIKI_USER_AGENT, writeTable } from "./lib.ts";

const WIKIPEDIA = "https://en.wikipedia.org/w/api.php";
const WIKIDATA = "https://www.wikidata.org/w/api.php";
const cacheDir = path.resolve(packageDir, "../../data/private/cache/wikipedia/type-wikipedia");
const SOURCE = "English Wikipedia (en.wikipedia.org), figures from articles' specifications, CC BY-SA";
const PAUSE_MS = 1000;
const BATCH = 50;
const SEARCH_RESULTS = 10;

const COLUMNS = ["designator", "article", "revision", "lengthM", "spanM", "heightM", "mtowKg"] as const satisfies readonly (keyof TypeWikipedia)[];

const today = new Date().toISOString().slice(0, 10);

/** Plausible ranges; a value outside is dropped. */
const RANGES: Record<"lengthM" | "spanM" | "heightM" | "mtowKg", [number, number]> = {
  lengthM: [1, 120],
  spanM: [1, 120],
  heightM: [0.5, 40],
  mtowKg: [50, 700_000],
};
/** Length to span (or rotor diameter): outside this, one of the two is wrong and both are dropped. */
const SHAPE: [number, number] = [0.2, 3.5];
/** MTOW against the wake turbulence category, with a quarter's margin (as in type-wikidata.ts). */
const WAKE_MTOW: Record<string, [number, number]> = { L: [0, 8_750], M: [5_250, 170_000], H: [100_000, 700_000], J: [400_000, 700_000] };

const FT = 0.3048;
const IN = 0.0254;
const LB = 0.45359237;

// ---------------------------------------------------------------------------------------------------------------
// MediaWiki and Wikibase APIs

/** An answer of the APIs, read field by field. */
type Json = any;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let lastRequest = 0;
let requests = 0;

async function get(endpoint: string, params: Record<string, string>, what: string): Promise<Json> {
  const url = `${endpoint}?${new URLSearchParams({ ...params, format: "json", formatversion: "2", maxlag: "5" })}`;
  for (let attempt = 0; ; attempt++) {
    const wait = lastRequest + PAUSE_MS - Date.now();
    if (wait > 0) await sleep(wait);
    lastRequest = Date.now();
    requests++;
    let res: Response;
    try {
      res = await fetch(url, {
        headers: { "User-Agent": WIKI_USER_AGENT, "Api-User-Agent": WIKI_USER_AGENT },
        signal: AbortSignal.timeout(60_000),
      });
    } catch (err) {
      if (attempt < 4) {
        await sleep(5000 * 2 ** attempt);
        continue;
      }
      throw new Error(`${what}: ${(err as Error).message}`);
    }
    if ((res.status === 429 || res.status >= 500) && attempt < 4) {
      const after = Number(res.headers.get("retry-after"));
      await sleep(after > 0 ? after * 1000 : 5000 * 2 ** attempt);
      continue;
    }
    if (!res.ok) throw new Error(`${what}: the API answered ${res.status}`);
    const json = (await res.json()) as Json;
    if (json.error?.code === "maxlag" && attempt < 4) {
      await sleep(5000 * 2 ** attempt);
      continue;
    }
    if (json.error) throw new Error(`${what}: ${json.error.code} (${json.error.info})`);
    return json;
  }
}

/** A cache file's name for a title or query: readable, and unique by its hash. */
const fileKey = (s: string) =>
  `${s.replace(/[^A-Za-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 60)}-${crypto.createHash("sha1").update(s).digest("hex").slice(0, 8)}`;

function readCache<T>(name: string): T | undefined {
  const file = path.join(cacheDir, name);
  if (!fs.existsSync(file)) return undefined;
  const bytes = fs.readFileSync(file);
  return JSON.parse((name.endsWith(".gz") ? zlib.gunzipSync(bytes) : bytes).toString("utf8")) as T;
}

function writeCache(name: string, value: unknown): void {
  const file = path.join(cacheDir, name);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const text = JSON.stringify(value);
  fs.writeFileSync(file, name.endsWith(".gz") ? zlib.gzipSync(text) : text);
}

/** Each Wikidata item's English Wikipedia article, null where it has none. */
async function sitelinks(ids: string[], refresh: boolean): Promise<Map<string, string | null>> {
  const out = new Map<string, string | null>();
  const missing: string[] = [];
  for (const id of new Set(ids)) {
    const hit = refresh ? undefined : readCache<Json>(`items/${id}.json`);
    if (hit) out.set(id, hit.sitelinks?.enwiki?.title ?? null);
    else missing.push(id);
  }
  for (let i = 0; i < missing.length; i += BATCH) {
    const batch = missing.slice(i, i + BATCH);
    console.log(`ask Wikidata for the articles of ${batch.length} items (${i + batch.length}/${missing.length})`);
    const json = await get(WIKIDATA, { action: "wbgetentities", ids: batch.join("|"), props: "sitelinks", sitefilter: "enwiki" }, "sitelinks");
    const entities = Object.values((json.entities ?? {}) as Record<string, Json>);
    for (const id of batch) {
      // A merged item answers as the item it redirects to.
      const e = entities.find((x) => x.id === id || x.redirects?.from === id) ?? { id, missing: true };
      writeCache(`items/${id}.json`, e);
      out.set(id, e.sitelinks?.enwiki?.title ?? null);
    }
  }
  return out;
}

interface Page {
  /** The title asked for. */
  asked: string;
  /** The page's title, normalised and after a redirect; null when there is no such page. */
  title: string | null;
  /** The section a redirect leads to. */
  fragment: string | null;
  revid: number | null;
  content: string | null;
}

/** Each title's page: its latest revision's wikitext, redirects followed. */
async function pages(titles: string[], refresh: boolean): Promise<Map<string, Page>> {
  const out = new Map<string, Page>();
  const missing: string[] = [];
  for (const t of new Set(titles)) {
    const hit = refresh ? undefined : readCache<Page>(`pages/${fileKey(t)}.json.gz`);
    if (hit && hit.asked === t) out.set(t, hit);
    else missing.push(t);
  }
  for (let i = 0; i < missing.length; i += BATCH) {
    const batch = missing.slice(i, i + BATCH);
    console.log(`ask Wikipedia for ${batch.length} pages (${i + batch.length}/${missing.length})`);
    const normalized = new Map<string, string>();
    const redirects = new Map<string, { to: string; fragment: string | null }>();
    const got = new Map<string, { revid: number | null; content: string | null }>();
    let cont: Record<string, string> = {};
    for (;;) {
      const json = await get(
        WIKIPEDIA,
        { action: "query", prop: "revisions", rvprop: "content|ids", rvslots: "main", redirects: "1", titles: batch.join("|"), ...cont },
        "pages",
      );
      for (const n of json.query?.normalized ?? []) normalized.set(String(n.from), String(n.to));
      for (const r of json.query?.redirects ?? []) redirects.set(String(r.from), { to: String(r.to), fragment: r.tofragment ? String(r.tofragment) : null });
      for (const p of json.query?.pages ?? []) {
        const rev = p.revisions?.[0];
        if (p.missing || p.invalid) got.set(String(p.title), { revid: null, content: null });
        else if (rev) got.set(String(p.title), { revid: Number(rev.revid), content: String(rev.slots?.main?.content ?? "") });
      }
      if (!json.continue) break;
      cont = json.continue as Record<string, string>;
    }
    for (const asked of batch) {
      const n = normalized.get(asked) ?? asked;
      const r = redirects.get(n);
      const final = r?.to ?? n;
      const g = got.get(final);
      const page: Page = {
        asked,
        title: g?.content != null ? final : null,
        fragment: r?.fragment ?? null,
        revid: g?.revid ?? null,
        content: g?.content ?? null,
      };
      writeCache(`pages/${fileKey(asked)}.json.gz`, page);
      out.set(asked, page);
    }
  }
  return out;
}

/** The titles English Wikipedia's search gives for a query, best first. */
async function search(query: string, refresh: boolean): Promise<string[]> {
  const name = `search/${fileKey(query)}.json`;
  let hit = refresh ? undefined : readCache<{ query: string; answer: Json }>(name);
  if (hit?.query !== query) hit = undefined;
  if (!hit) {
    const answer = await get(
      WIKIPEDIA,
      { action: "query", list: "search", srsearch: query, srnamespace: "0", srlimit: String(SEARCH_RESULTS), srprop: "", srinfo: "" },
      `search ${query}`,
    );
    hit = { query, answer };
    writeCache(name, hit);
  }
  return ((hit.answer.query?.search ?? []) as Json[]).map((r) => String(r.title));
}

/** "Aircraft specs" and the template names that redirect to it ("Aerospecs", "Aircraft specifications", …). */
async function specTemplateNames(refresh: boolean): Promise<Set<string>> {
  const name = "template-names.json";
  let json = refresh ? undefined : readCache<Json>(name);
  if (!json) {
    json = await get(
      WIKIPEDIA,
      { action: "query", list: "backlinks", bltitle: "Template:Aircraft specs", blfilterredir: "redirects", blnamespace: "10", bllimit: "max" },
      "template names",
    );
    writeCache(name, json);
  }
  const titles = ((json.query?.backlinks ?? []) as Json[]).map((b) => String(b.title).replace(/^Template:/, ""));
  return new Set(["Aircraft specs", ...titles].map(templateKey));
}

// ---------------------------------------------------------------------------------------------------------------
// Wikitext

/** A template's name as MediaWiki compares it: the first letter in any case, underscores as spaces. */
function templateKey(name: string): string {
  const t = name.replace(/_/g, " ").replace(/\s+/g, " ").trim();
  return t.charAt(0).toUpperCase() + t.slice(1);
}

/** Wikitext without comments and references, which may hold anything. */
function stripNoise(text: string): string {
  return text
    .replace(/<!--[\s\S]*?(?:-->|$)/g, "")
    .replace(/<ref\b[^>]*\/>/gi, "")
    .replace(/<ref\b[^>]*>[\s\S]*?<\/ref\s*>/gi, "");
}

interface Template {
  name: string;
  params: Map<string, string>;
  start: number;
  end: number;
}

/** The template that starts at `start` ("{{"), its parameters split at its own bars, not those of templates or links in it. */
function templateAt(text: string, start: number): Template | null {
  const parts: string[] = [];
  let cur = "";
  let braces = 0;
  let links = 0;
  for (let i = start + 2; i < text.length; ) {
    if (text.startsWith("{{", i)) {
      braces++;
      cur += "{{";
      i += 2;
    } else if (text.startsWith("}}", i)) {
      if (braces === 0) {
        parts.push(cur);
        const params = new Map<string, string>();
        parts.slice(1).forEach((p, n) => {
          const eq = p.indexOf("=");
          if (eq < 0) params.set(String(n + 1), p.trim());
          else params.set(p.slice(0, eq).trim(), p.slice(eq + 1).trim());
        });
        return { name: templateKey(parts[0]!), params, start, end: i + 2 };
      }
      braces--;
      cur += "}}";
      i += 2;
    } else if (text.startsWith("[[", i)) {
      links++;
      cur += "[[";
      i += 2;
    } else if (text.startsWith("]]", i) && links > 0) {
      links--;
      cur += "]]";
      i += 2;
    } else if (text[i] === "|" && braces === 0 && links === 0) {
      parts.push(cur);
      cur = "";
      i++;
    } else {
      cur += text[i];
      i++;
    }
  }
  return null;
}

/** The templates of the given names, in the order they appear. */
function findTemplates(text: string, accept: (name: string) => boolean, first = false): Template[] {
  const out: Template[] = [];
  for (const m of text.matchAll(/\{\{\s*([^{}|\n]+?)\s*(?=\||\}\}|\n)/g)) {
    if (!accept(templateKey(m[1]!))) continue;
    const t = templateAt(text, m.index);
    if (t) {
      out.push(t);
      if (first) break;
    }
  }
  return out;
}

/** The heading of the section the text at `at` is in ("Specifications (Mk II)"). */
function headingBefore(text: string, at: number): string | null {
  let heading: string | null = null;
  for (const m of text.slice(0, at).matchAll(/^={2,6}\s*(.+?)\s*={2,6}\s*$/gm)) heading = m[1]!;
  return heading;
}

/** Templates in a value that only add a note or a reference: removed before the value is read. */
const NOTE_TEMPLATES = new Set(
  [
    "efn", "efn-ua", "efn-la", "efn-lr", "efn-ur", "efn-lg", "sfn", "sfnp", "sfnm", "harvnb", "harvp", "refn", "r", "rp",
    "ref label", "note label", "cn", "fact", "citation needed", "clarify", "clarification needed", "dubious", "verify",
    "verification needed", "failed verification", "better source needed", "according to whom", "by whom", "when",
    "which", "unreliable source?", "page needed", "nbsp", "-",
  ].map(templateKey),
);

type Unit = "m" | "ft" | "in" | "kg" | "lb";

/** The unit words a value may end with, by the parameter's unit. */
const UNIT_WORDS: Record<Unit, RegExp> = {
  m: /\s*(?:m|metres?|meters?)\.?$/i,
  ft: /\s*(?:ft|feet|foot|′|')\.?$/i,
  in: /\s*(?:in|inch|inches|″|")\.?$/i,
  kg: /\s*(?:kg|kgs|kilograms?)\.?$/i,
  lb: /\s*(?:lb|lbs|pounds?)\.?$/i,
};

/** Notes, spaces and the value's own unit removed; what stays is the value as written. */
function cleanValue(raw: string, unit: Unit): string {
  let s = raw;
  // Note templates first, innermost out.
  for (let n = 0; n < 5; n++) {
    const before = s;
    s = s.replace(/\{\{\s*([^{}|]+?)\s*(\|[^{}]*)?\}\}/g, (m, name: string, args?: string) => {
      const key = templateKey(name);
      if (key === "Nbsp") return " ";
      if (key === "Nowrap" || key === "Nobr") return (args ?? "").slice(1);
      return NOTE_TEMPLATES.has(key) ? "" : m;
    });
    if (s === before) break;
  }
  s = s.replace(/&nbsp;|&#160;|&thinsp;|&#8201;| | | /g, " ").trim();
  // Bold or italic around the whole value.
  s = s.replace(/^'{2,3}(.*?)'{2,3}$/, "$1").trim();
  s = s.replace(UNIT_WORDS[unit], "").trim();
  return s;
}

const PLAIN_NUMBER = /^(?:\d{1,3}(?:,\d{3})+|\d+)?(?:\.\d+)?$/;
/** A whole number and a fraction, as the template takes inches ("9+1/2", "1/8"): it computes the sum. */
const FRACTION = /^(?:(\d+)\s*\+\s*)?(\d+)\/(\d+)$/;

/** A parameter's value: undefined when absent or empty, null when it is not a plain number, else the number. */
function readValue(params: Map<string, string>, name: string, unit: Unit, notes: string[]): number | null | undefined {
  const raw = params.get(name);
  if (raw === undefined || raw.trim() === "") return undefined;
  const s = cleanValue(raw, unit);
  if (s === "") return undefined;
  const fraction = FRACTION.exec(s);
  if (fraction && Number(fraction[3]) > 0) return Number(fraction[1] ?? 0) + Number(fraction[2]) / Number(fraction[3]);
  if (!PLAIN_NUMBER.test(s) || !/\d/.test(s)) {
    notes.push(`${name} "${raw.replace(/\s+/g, " ").slice(0, 60)}" not read`);
    return null;
  }
  return Number(s.replace(/,/g, ""));
}

/** A length in metres: `base m`, else `base ft` and `base in`. `stated`: the template gives it, read or not. */
function lengthOf(params: Map<string, string>, base: string, notes: string[]): { value: number | null; stated: boolean } {
  const m = readValue(params, `${base} m`, "m", notes);
  if (m !== undefined) return { value: m, stated: true };
  const ft = readValue(params, `${base} ft`, "ft", notes);
  const inch = readValue(params, `${base} in`, "in", notes);
  if (ft === undefined && inch === undefined) return { value: null, stated: false };
  if (ft === null || inch === null) return { value: null, stated: true };
  return { value: (ft ?? 0) * FT + (inch ?? 0) * IN, stated: true };
}

function massOf(params: Map<string, string>, base: string, notes: string[]): number | null {
  const kg = readValue(params, `${base} kg`, "kg", notes);
  if (kg !== undefined) return kg;
  const lb = readValue(params, `${base} lb`, "lb", notes);
  return lb == null ? null : lb * LB;
}

type Values = Omit<TypeWikipedia, "designator" | "article" | "revision">;

const round = (v: number | null, digits: number) => (v === null ? null : Math.round(v * 10 ** digits) / 10 ** digits);

/** The figures a specifications template states. */
function figuresOf(t: Template, notes: string[]): Values {
  const p = t.params;
  const length = lengthOf(p, "length", notes);
  // A rotorcraft's length over its turning rotors is not its fuselage's, which the other tables give.
  const lengthNote = (p.get("length note") ?? "").toLowerCase().split(/\n|<br/)[0]!;
  if (length.value !== null && /rotor/.test(lengthNote) && !/fuselage|exclud|without|folded/.test(lengthNote)) {
    notes.push(`length ${round(length.value, 2)} includes the rotors, not taken`);
    length.value = null;
  }
  let span = lengthOf(p, "span", notes);
  if (!span.stated) {
    const tiers = ["upper span", "mid span", "lower span"].map((b) => lengthOf(p, b, notes));
    if (tiers.some((x) => x.stated)) {
      const read = tiers.filter((x) => x.stated);
      // A tier stated but not read could be the largest: then the span is not known.
      span = read.every((x) => x.value !== null) ? { value: Math.max(...read.map((x) => x.value!)), stated: true } : { value: null, stated: true };
    }
  }
  // A rotorcraft's main rotor: without a span, or wider than its stub wings (a helicopter's, an autogyro's).
  let rotor = lengthOf(p, "rot dia", notes);
  if (!rotor.stated) rotor = lengthOf(p, "main rotor dia", notes);
  if (rotor.stated && (!span.stated || (rotor.value !== null && span.value !== null && rotor.value > span.value))) span = rotor;
  const height = lengthOf(p, "height", notes);
  return {
    lengthM: round(length.value, 2),
    spanM: round(span.value, 2),
    heightM: round(height.value, 2),
    mtowKg: round(massOf(p, "max takeoff weight", notes), 0),
  };
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

/** The infobox's manufacturer and designer, as one string to look for a maker's name in. */
function infoboxMakers(content: string): string {
  const boxes = findTemplates(content, (n) => /^Infobox aircraft/i.test(n));
  return boxes
    .flatMap((b) => ["manufacturer", "manufacturers", "designer", "designers", "design group", "built by"].map((k) => b.params.get(k) ?? ""))
    .join(" ");
}

// ---------------------------------------------------------------------------------------------------------------
// Names

const ROMAN: Record<string, string> = { i: "1", ii: "2", iii: "3", iv: "4", v: "5", vi: "6", vii: "7", viii: "8", ix: "9" };

/**
 * A name's words, without case or accents, with Roman numerals as digits. Hyphens, dots and apostrophes join ("An-26",
 * "G.46" and "Van's" are one word each); spaces, slashes and brackets part.
 */
function words(s: string): string[] {
  return s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[-‐‑.'’`]/g, "")
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .map((w) => ROMAN[w] ?? w);
}

const fold = (s: string) => words(s).join("");

/** Where `part` (folded) is among the words, as whole words: the first word it takes and the word after its end. */
function wordsAt(ws: string[], part: string): { start: number; end: number } | null {
  if (!part) return null;
  for (let i = 0; i < ws.length; i++) {
    let s = "";
    for (let j = i; j < ws.length && s.length < part.length; j++) {
      s += ws[j];
      if (s === part) return { start: i, end: j + 1 };
    }
  }
  return null;
}

/** The numbers in a name's words ("G-159 Gulfstream 1": 159 and 1). */
const numbers = (ws: string[]) => new Set(ws.flatMap((w) => (w.match(/\d+/g) ?? []).map(Number)));

/** A model's name: its designation ("MB-339", "172") and its other words ("Skyhawk"), folded. */
interface ModelName {
  whole: string;
  designation: string | null;
  rest: string[];
}

/** The names a model is known by: "H125 / AS350 Ecureuil" is "H125" or "AS350 Ecureuil"; "TBM 900 series" also "TBM 900". */
function modelNames(name: string, makers: string[]): ModelName[] {
  const alts = [...new Set([name, ...name.split(/\s+\/\s+/)].map((p) => p.replace(/\s+series$/i, "").trim()).filter(Boolean))];
  return alts.map((alt) => {
    const tokens = alt.split(/\s+/);
    // The designation: the first word with a digit that also has a letter ("MB-339", "J160") or comes first ("172").
    // A number after a word is part of the name ("Gulfstream 1", "Arrow 3").
    const at = tokens.findIndex((t, i) => /\d/.test(t) && (/[a-z]/i.test(t) || i === 0));
    const rest = tokens
      .filter((_, i) => i !== at)
      .map(fold)
      .filter(Boolean);
    // The manufacturer's name before the model's ("Jabiru J160") is not part of it. Elsewhere it is ("Super Ace").
    while (rest.length && makers.includes(rest[0]!)) rest.shift();
    return { whole: fold(alt), designation: at >= 0 ? fold(tokens[at]!) : null, rest };
  });
}

// ---------------------------------------------------------------------------------------------------------------

interface TypeRow {
  designator: string;
  manufacturer: string;
  name: string;
  wtc: string | null;
}

interface Found {
  page: Page;
  how: "override" | "item" | "search";
  /** For a search: how the title matched. */
  match?: string;
}

/** How a search result's title matches a model, and which of its words the match takes. */
interface Standing {
  /** 3: the title is the manufacturer and model; 2: it holds the designation; 1: the rest of the name; 0: no match. */
  tier: 0 | 1 | 2 | 3;
  why: string;
  start: number;
  end: number;
}

/** Words for a kind of aircraft, which a title may add to a model's name ("Shuttle Carrier Aircraft"). */
const KINDS = new Set(["aircraft", "airplane", "aeroplane", "helicopter", "gyroplane", "autogyro", "glider", "sailplane"]);

/** Two spellings of one name ("Woongbi", "Woong-Bee"): the same first four letters. */
const alike = (a: string, b: string) => a === b || (a.length >= 4 && b.length >= 4 && a.slice(0, 4) === b.slice(0, 4));

/** The words of a title without its disambiguation ("Eta (glider)"). */
const titleWords = (title: string) => words(title.replace(/\s*\([^)]*\)\s*$/, ""));

function standing(title: string, names: ModelName[], makers: string[], uniqueRest: (rest: string) => boolean): Standing {
  const bare = titleWords(title);
  const joined = bare.join("");
  let best: Standing = { tier: 0, why: "", start: 0, end: 0 };
  const better = (tier: Standing["tier"], why: string, at: { start: number; end: number }) => {
    if (tier > best.tier) best = { tier, why, ...at };
  };
  for (const n of names) {
    if (n.whole.length >= 3 && /[a-z]/.test(n.whole) && (joined === n.whole || makers.some((m) => joined === m + n.whole))) {
      better(3, "title is the model", wordsAt(bare, n.whole) ?? { start: 0, end: bare.length });
      continue;
    }
    const at = n.designation ? wordsAt(bare, n.designation) : null;
    if (at) {
      // The words after the designation must not name another model ("MQ-1 Predator" is not the "MQ-1 Warrior",
      // "M.2 Hawk Trainer" not the "M-2 Hawk Major")...
      const after = bare.slice(at.end).filter((w) => w.length > 1 || /\d/.test(w));
      const named = !n.rest.length || after.every((w) => n.rest.some((r) => alike(r, w)));
      // ... nor leave out its number ("Boeing 737 MAX" is not the "737 MAX 7").
      const numbered = n.rest.every(
        (w, i) => !/^\d+$/.test(w) || i === 0 || !wordsAt(bare, n.rest[i - 1]!) || !!wordsAt(bare, n.rest[i - 1]! + w),
      );
      if (named && numbered) better(2, `designation ${n.designation}`, at);
      continue;
    }
    const rest = n.rest.join("");
    const restAt = rest.length >= 4 ? wordsAt(bare, rest) : null;
    // Without the designation, the title must not hold another ("Robin DR.200" for the "DR-253 Regent", "T-34 Mentor"
    // for the "T-34A Mentor") or another number ("Zlin Z 43" for the "Zlin Z-50").
    const ours = numbers(words(n.whole));
    const otherDesignation = bare.some((w) => /\d/.test(w) && /[a-z]/.test(w) && w !== n.designation);
    // Nor another model's name after it ("Eurofly Flash Light" for the "Flash").
    const longer =
      !!restAt && bare.slice(restAt.end).some((w) => w.length > 1 && !KINDS.has(w) && !(/^\d+$/.test(w) && ours.has(Number(w))));
    if (restAt && !longer && uniqueRest(rest) && !otherDesignation && [...numbers(bare)].every((x) => ours.has(x))) better(1, `name ${rest}`, restAt);
  }
  return best;
}

/**
 * Whether one of a manufacturer's names is among the words: as whole words, or a name of five letters or more as the
 * start of a word ("Westland" in "AgustaWestland" is not, "Agusta" is).
 */
const makerIn = (ws: string[], makers: string[]) =>
  makers.some((m) => !!wordsAt(ws, m) || (m.length >= 5 && ws.some((_, i) => ws.slice(i).join("").startsWith(m))));

/** Words of a heading that count or describe ("Mk II", "Series 4", "Block 3"): the number after them is not a model's. */
const COUNTING = new Set(["mk", "mark", "series", "srs", "block", "no", "batch", "phase", "stage", "version", "lot", "flight", "with"]);
/** Units after a number: an engine's power or a size, not a model. */
const UNIT_AFTER = /^(hp|kw|ps|cv|shp|lbf|kn|m|metres?|meters?|ft|kg|lb|seats?)$/;

/**
 * Another model of the designation's series that the specifications' heading names ("Specifications (KR-2)" in the
 * article read for the KR-1, "(Model 185 Skyranger)" for the 175): the figures are that model's. A model whose number
 * begins with the designation's, or the other way round, is taken for a variant of it ("CP.605B" of the CP-60, "SE
 * 313B" of the SE-3130).
 */
function otherModel(heading: string | null, designation: string | null): string | null {
  if (!heading || !designation) return null;
  const ours = /^([a-z]*)(\d+)/.exec(designation);
  if (!ours) return null;
  const tokens = heading
    .replace(/^\s*(?:aircraft |technical )?(?:specifications?|specs)\b/i, "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .split(/[\s,;:/()\[\]"]+/)
    .filter(Boolean);
  const named: string[] = [];
  for (let i = 0; i < tokens.length; i++) {
    let token = tokens[i]!.replace(/[-.'’]/g, "");
    // A series and its number apart ("MD 315", "Model 185").
    if (/^[a-z]+$/.test(token) && /^\d/.test(tokens[i + 1] ?? "")) token += tokens[++i]!.replace(/[-.'’]/g, "");
    const m = /^([a-z]*)(\d+)/.exec(token);
    if (!m) continue;
    let letters = m[1]!;
    if (COUNTING.has(letters)) continue;
    if (letters === "model" || letters === "type") letters = "";
    if (UNIT_AFTER.test(tokens[i + 1] ?? "") || /\d(hp|kw|m|ft|kg|lb)$/.test(token)) continue;
    // A year.
    if (letters === "" && /^(19|20)\d\d$/.test(m[2]!) && m[2] !== ours[2]) continue;
    if (letters !== ours[1]) continue;
    named.push(token.slice(m[1]!.length - letters.length));
  }
  const digits = (t: string) => /\d+/.exec(t)![0];
  const variant = (t: string) => digits(t).startsWith(ours[2]!) || ours[2]!.startsWith(digits(t));
  if (!named.length || named.some(variant)) return null;
  return named.join(", ");
}

async function main() {
  const args = process.argv.slice(2);
  const refresh = args.includes("--refresh");
  const check = args.includes("--check");
  const show = args.includes("--show") ? new Set(args.filter((a) => !a.startsWith("--"))) : null;

  const readTable = (file: string) => {
    const t = JSON.parse(fs.readFileSync(path.join(dataDir, file), "utf8")) as { columns: string[]; rows: unknown[][] };
    return t.rows.map((r) => Object.fromEntries(t.columns.map((c, i) => [c, r[i] ?? null])) as Record<string, any>);
  };
  const types: TypeRow[] = readTable("aircraft_types.json").map((r) => ({
    designator: String(r.designator),
    manufacturer: String(r.manufacturer ?? ""),
    name: String(r.name ?? ""),
    wtc: r.wtc ?? null,
  }));
  const specs = new Map(readTable("type_specs.json").map((r) => [String(r.designator), r]));
  const wikidata = new Map(readTable("type_wikidata.json").map((r) => [String(r.designator), r]));

  // The designators to read: a manufacturer (not an ICAO group code such as ZZZZ), and no length or no span yet.
  const known = (d: string, k: "lengthM" | "spanM") => (specs.get(d)?.[k] ?? wikidata.get(d)?.[k] ?? null) !== null;
  const withMaker = types.filter((t) => t.manufacturer);
  const work = withMaker.filter((t) => !known(t.designator, "lengthM") || !known(t.designator, "spanM"));
  const workSet = new Set(work.map((t) => t.designator));
  const typeOf = new Map(types.map((t) => [t.designator, t]));

  const templates = await specTemplateNames(refresh);
  const isSpecs = (name: string) => templates.has(name);

  // 1, 2: overrides and the items' articles.
  const found = new Map<string, Found>();
  const checkOnly = check ? withMaker.filter((t) => !workSet.has(t.designator)) : [];
  const itemOf = (d: string) => (d in articleOverrides ? null : ((wikidata.get(d)?.item as string | undefined) ?? null));
  // Every item's article: those of the designators outside the work too, to know which articles they have.
  const links = await sitelinks(withMaker.flatMap((t) => itemOf(t.designator) ?? []), refresh);
  const asked = new Map<string, string>();
  for (const t of [...work, ...checkOnly]) {
    if (t.designator in articleOverrides) {
      const a = articleOverrides[t.designator];
      if (a) asked.set(t.designator, a);
      continue;
    }
    const item = itemOf(t.designator);
    const title = item ? links.get(item) : null;
    if (title) asked.set(t.designator, title);
  }
  const itemPages = await pages([...asked.values()], refresh);
  for (const [d, title] of asked) {
    found.set(d, { page: itemPages.get(title)!, how: d in articleOverrides ? "override" : "item" });
  }

  // 3: a search for the others.
  const restCount = new Map<string, number>();
  const makerKey = (t: TypeRow) => makerForms(t.manufacturer).join(" ");
  for (const t of withMaker) {
    const makers = makerForms(t.manufacturer);
    for (const rest of new Set(modelNames(t.name, makers).map((n) => n.rest.join("")))) {
      if (rest) restCount.set(`${makerKey(t)}|${rest}`, (restCount.get(`${makerKey(t)}|${rest}`) ?? 0) + 1);
    }
  }
  // With --show, only the designators shown are searched for.
  const toSearch = work.filter((t) => !(t.designator in articleOverrides) && !asked.has(t.designator) && (!show || show.has(t.designator)));
  const searchCandidates = new Map<string, ({ title: string } & Standing)[]>();
  let searched = 0;
  for (const t of toSearch) {
    const makers = makerForms(t.manufacturer);
    const maker = t.manufacturer.replace(/\s*\(.*?\)\s*/g, " ").trim();
    const query = fold(t.name).startsWith(fold(maker)) ? t.name : `${maker} ${t.name}`;
    if (++searched % 100 === 0) console.log(`searched ${searched}/${toSearch.length}`);
    const results = await search(query.replace(/\s+\/\s+/g, " "), refresh);
    const names = modelNames(t.name, makers);
    const unique = (rest: string) => (restCount.get(`${makerKey(t)}|${rest}`) ?? 0) <= 1;
    const list = results
      .map((title) => ({ title, ...standing(title, names, makers, unique) }))
      .filter((c) => c.tier > 0);
    searchCandidates.set(t.designator, list);
  }
  const searchPages = await pages([...new Set([...searchCandidates.values()].flatMap((l) => l.map((c) => c.title)))], refresh);

  const report: string[] = [];
  const nearMisses: string[] = [];
  const ambiguous: string[] = [];
  for (const t of toSearch) {
    const makers = makerForms(t.manufacturer).filter((m) => m.length >= 3);
    const ok: ({ title: string; page: Page } & Standing)[] = [];
    for (const c of searchCandidates.get(t.designator) ?? []) {
      const page = searchPages.get(c.title);
      if (!page?.content || !page.title) continue;
      const text = stripNoise(page.content);
      if (!findTemplates(text, isSpecs, true).length) continue;
      // The manufacturer in the title, outside the model's name ("Ace" of "Super Ace" is not the maker of the
      // "Chrislea Super Ace"), or in the infobox.
      const ws = titleWords(page.title);
      if (!makerIn(ws.slice(0, c.start), makers) && !makerIn(ws.slice(c.end), makers) && !makerIn(words(infoboxMakers(text)), makers)) {
        nearMisses.push(`${t.designator} ${t.manufacturer} ${t.name} ~ ${page.title} (${c.why}, no ${t.manufacturer} in its title or infobox)`);
        continue;
      }
      // A replica's figures are not the original's: its own article, or none.
      if (/\breplica\b/i.test(t.name) && !/\breplica\b/i.test(page.title)) {
        nearMisses.push(`${t.designator} ${t.manufacturer} ${t.name} ~ ${page.title} (${c.why}, the original, not the replica)`);
        continue;
      }
      ok.push({ ...c, page });
    }
    if (!ok.length) continue;
    const top = Math.max(...ok.map((c) => c.tier));
    const best = [...new Map(ok.filter((c) => c.tier === top).map((c) => [c.page.title, c])).values()];
    if (best.length > 1) {
      ambiguous.push(`${t.designator} ${t.manufacturer} ${t.name}: ${best.map((c) => `${c.page.title} (${c.why})`).join("; ")}`);
      continue;
    }
    found.set(t.designator, { page: best[0]!.page, how: "search", match: best[0]!.why });
  }

  // Articles several designators reach: the curated figures' articles count for their designators.
  const users = new Map<string, Set<string>>();
  const use = (title: string, d: string) => {
    let s = users.get(title);
    if (!s) users.set(title, (s = new Set()));
    s.add(d);
  };
  for (const [d, f] of found) if (f.page.title) use(f.page.title, d);
  for (const [d, r] of specs) use(String(r.article), d);
  for (const t of withMaker) {
    if (found.has(t.designator)) continue;
    const item = itemOf(t.designator);
    const title = item ? links.get(item) : null;
    if (title) use(title, t.designator);
  }

  const rows: TypeWikipedia[] = [];
  const checkRows = new Map<string, Values>();
  const counts = { item: 0, search: 0, override: 0 };
  const dropped = { shared: 0, section: 0, otherModel: 0, noTemplate: 0, noArticle: 0, noFigures: 0 };
  const searchRows: string[] = [];
  for (const t of [...work, ...checkOnly]) {
    const inWork = workSet.has(t.designator);
    const f = found.get(t.designator);
    const notes: string[] = [];
    const head = `${t.designator} ${t.manufacturer} ${t.name}`;
    const shown = (why: string) => {
      if (show?.has(t.designator)) console.log(`\n=== ${head} (${f?.how ?? "no article"}) → ${f?.page.title ?? f?.page.asked ?? "-"}: ${why}`);
    };
    if (!f) {
      if (inWork) dropped.noArticle++;
      continue;
    }
    const { page } = f;
    if (!page.title || !page.content) {
      shown("no page");
      if (inWork) {
        dropped.noArticle++;
        report.push(`${head}: ${page.asked} has no page`);
      }
      continue;
    }
    const others = [...(users.get(page.title) ?? [])].filter((d) => d !== t.designator);
    if (f.how !== "override" && others.length) {
      shown(`also ${others.join(", ")}'s article`);
      if (inWork) {
        dropped.shared++;
        report.push(`${head} → ${page.title}: also ${others.join(", ")}'s article, none taken`);
      }
      continue;
    }
    if (f.how !== "override" && page.fragment) {
      shown(`a section, #${page.fragment}`);
      if (inWork) {
        dropped.section++;
        report.push(`${head} → ${page.title}#${page.fragment}: a section of the article, none taken`);
      }
      continue;
    }
    const text = stripNoise(page.content);
    const tpl = findTemplates(text, isSpecs, true)[0];
    if (!tpl) {
      if (inWork) dropped.noTemplate++;
      shown("no specifications template");
      continue;
    }
    const heading = headingBefore(text, tpl.start);
    if (f.how === "item" && /\breplica\b/i.test(t.name) && !/\breplica\b/i.test(page.title)) {
      shown("the original's article, not the replica's");
      if (inWork) report.push(`${head} → ${page.title}: the original's article, not the replica's, none taken`);
      continue;
    }
    if (f.how !== "override") {
      const other = modelNames(t.name, []).map((n) => otherModel(heading, n.designation)).find((x) => x !== null);
      if (other) {
        shown(`the specifications are ${other}'s (${heading})`);
        if (inWork) {
          dropped.otherModel++;
          report.push(`${head} → ${page.title}: the specifications are ${other}'s ("${heading}"), none taken`);
        }
        continue;
      }
    }
    const values = sane(figuresOf(tpl, notes), t.wtc, notes);
    if (show?.has(t.designator)) {
      console.log(`\n=== ${head} (${f.how}${f.match ? `, ${f.match}` : ""}) → ${page.title} rev ${page.revid}`);
      console.log(`  heading: ${heading ?? "-"}`);
      for (const [k, v] of tpl.params) if (/length|span|height|weight|dia/.test(k) && v) console.log(`  ${k} = ${v.slice(0, 80)}`);
      console.log(`  ${JSON.stringify(values)}${notes.length ? `\n  ${notes.join("\n  ")}` : ""}`);
      for (const c of searchCandidates.get(t.designator) ?? []) console.log(`  candidate ${c.title} (${c.why})`);
    }
    if (!inWork) {
      checkRows.set(t.designator, values);
      continue;
    }
    if (values.lengthM === null && values.spanM === null) {
      dropped.noFigures++;
      if (notes.length) report.push(`${head} → ${page.title}:\n  ${notes.join("\n  ")}`);
      continue;
    }
    if (notes.length) report.push(`${head} → ${page.title}:\n  ${notes.join("\n  ")}`);
    counts[f.how]++;
    rows.push({ designator: t.designator, article: page.title, revision: page.revid!, ...values });
    if (f.how === "search") {
      searchRows.push(`${head} → ${page.title} [${heading ?? "-"}] (${f.match})`);
    }
  }
  for (const d of Object.keys(articleOverrides)) {
    if (!typeOf.has(d)) report.push(`override for ${d}, which aircraft_types.json does not have`);
  }
  if (show) {
    for (const d of show) {
      const c = searchCandidates.get(d);
      if (c && !found.has(d)) console.log(`\n=== ${d}: candidates ${c.map((x) => `${x.title} (${x.why})`).join("; ") || "none"}`);
    }
    return;
  }

  // Rows in aircraft_types.json order.
  const order = new Map(types.map((t, i) => [t.designator, i]));
  rows.sort((a, b) => order.get(a.designator)! - order.get(b.designator)!);
  writeTable("type_wikipedia", today, [SOURCE], COLUMNS, rows);

  console.log(report.join("\n"));
  console.log(`\nsearch matches (${searchRows.length}):\n  ${searchRows.join("\n  ")}`);
  console.log(`\nambiguous search results, none taken (${ambiguous.length}):\n  ${ambiguous.join("\n  ")}`);
  console.log(`\nsearch results without the manufacturer, not taken (${nearMisses.length}):\n  ${nearMisses.join("\n  ")}`);

  // Agreement with the other tables, where both have a figure.
  const agreement = (label: string, pairs: [string, Values][], other: Map<string, Record<string, any>>) => {
    const out: string[] = [];
    for (const k of ["lengthM", "spanM", "heightM", "mtowKg"] as const) {
      let same = 0;
      let both = 0;
      const off: string[] = [];
      for (const [d, v] of pairs) {
        const a = v[k];
        const b = other.get(d)?.[k] as number | null | undefined;
        if (a == null || b == null) continue;
        both++;
        if (Math.abs(a - b) <= 0.02 * Math.max(a, b)) same++;
        else off.push(`${d} ${a}/${b}`);
      }
      if (both) out.push(`  ${k}: ${same} of ${both} within 2 %${off.length ? `; differ: ${off.slice(0, 40).join(", ")}${off.length > 40 ? " …" : ""}` : ""}`);
    }
    console.log(`\nagreement with ${label}:\n${out.join("\n") || "  no figures in common"}`);
  };
  const written: [string, Values][] = rows.map((r) => [r.designator, r]);
  agreement("type_specs (this table's rows)", written, specs);
  agreement("type_wikidata (this table's rows)", written, wikidata);
  if (check) {
    agreement("type_specs (designators with figures, by their items' articles)", [...checkRows], specs);
    agreement("type_wikidata (designators with figures, by their items' articles)", [...checkRows], wikidata);
  }

  const has = (k: keyof Values) => rows.filter((r) => r[k] !== null).length;
  const both = rows.filter((r) => r.lengthM !== null && r.spanM !== null);
  const fillsBoth = work.filter((t) => {
    const r = rows.find((x) => x.designator === t.designator);
    const len = known(t.designator, "lengthM") || r?.lengthM != null;
    const span = known(t.designator, "spanM") || r?.spanM != null;
    return len && span;
  }).length;
  console.log(
    [
      `\n${requests} requests`,
      `type_wikipedia: ${rows.length} of ${work.length} designators without a length or a span (by item ${counts.item}, by search ${counts.search}, by override ${counts.override})`,
      `length+span ${both.length} (by item ${both.filter((r) => found.get(r.designator)?.how === "item").length}, by search ${both.filter((r) => found.get(r.designator)?.how === "search").length}), length ${has("lengthM")}, span ${has("spanM")}, height ${has("heightM")}, MTOW ${has("mtowKg")}`,
      `with the other tables, ${fillsBoth} of ${work.length} now have a length and a span`,
      `not taken: no article ${dropped.noArticle}, article shared ${dropped.shared}, a section ${dropped.section}, another model's specifications ${dropped.otherModel}, no template ${dropped.noTemplate}, no figures read ${dropped.noFigures}`,
    ].join("\n"),
  );
}

await main();
