// A spotting session (`touchdown spot`, docs/21-import-export.md, "Spotting session"): each line the user types
// is read into a sighting's fields; lookups (fetched by the CLI) say what they know about the registration; the
// values are chosen from both, and what is still missing or doubtful is listed for the user.

import type { RefIndex } from "../ref/index.ts";
import { PHASES } from "../schema/tables.ts";
import { isValidDate } from "../schema/validate.ts";
import { normaliseRegistration } from "../normalise/registration.ts";
import { parseModel } from "../normalise/model.ts";
import { addDays, daysBetween, parseLooseDate } from "../time/index.ts";
import type { AirframeFacts } from "../identity/facts.ts";
import type { AgentEvidence, AgentSuggestion } from "../agent/check.ts";
import type { Store } from "../store.ts";
import { registrationMatchForm } from "../normalise/registration.ts";

export type Phase = (typeof PHASES)[number];

/** The fields of a sighting a session fills, named as in the agent check. */
export const SPOT_FIELDS = ["registration", "date", "airport", "typeCode", "model", "operator", "phase", "livery", "specialLivery", "notes"] as const;
export type SpotField = (typeof SPOT_FIELDS)[number];
export type SpotValues = Partial<Record<SpotField, string>>;

/** Fields a sighting should have. Whatever is still empty after the lookups is asked for. */
export const SPOT_WANTED: SpotField[] = ["date", "airport", "typeCode", "operator", "phase"];

export const SPOT_FIELD_LABEL: Record<SpotField, string> = {
  registration: "registration",
  date: "date",
  airport: "place",
  typeCode: "type code",
  model: "model",
  operator: "airline",
  phase: "phase",
  livery: "livery",
  specialLivery: "special livery",
  notes: "notes",
};

/** Where a value came from: typed by the user, a lookup, worked out from another field, or the agent. */
export type SpotSource = "you" | "your_log" | "opensky" | "adsbdb" | "fr24" | "derived" | "claude" | "codex";
export type LookupSource = "your_log" | "opensky" | "adsbdb" | "fr24";

export const SOURCE_NAME: Record<SpotSource, string> = {
  you: "you",
  your_log: "your log",
  opensky: "OpenSky",
  adsbdb: "adsbdb",
  fr24: "Flightradar24",
  derived: "worked out",
  claude: "Claude Code",
  codex: "Codex",
};

// ---------- reading a line ----------

export interface SpotSettings {
  airport?: string;
  date?: string;
  /** null clears the session's phase ("no phase"). */
  phase?: Phase | null;
}

export interface SpotLine {
  /** Fields read from the line. */
  typed: SpotValues;
  /** Words that are not a field value Touchdown recognises, for the agent to sort out (kept as notes without one). */
  text: string;
  /** A line with no registration and only a place, date or phase sets them for the lines after it. */
  setting: SpotSettings | null;
  problems: string[];
}

const PHASE_WORDS: Record<string, Phase> = {
  approaching: "approaching",
  approach: "approaching",
  finals: "approaching",
  landing: "landing",
  landed: "landing",
  touchdown: "landing",
  "touching down": "landing",
  "touching-down": "landing",
  "taking off": "taking_off",
  "taking-off": "taking_off",
  taking_off: "taking_off",
  takeoff: "taking_off",
  "take-off": "taking_off",
  "take off": "taking_off",
  departing: "taking_off",
  taxiing: "taxiing",
  taxying: "taxiing",
  taxi: "taxiing",
  parked: "parked",
  towing: "towing",
  towed: "towing",
  overflight: "overflight",
  overhead: "overflight",
};

/** A typed date: "today", "yesterday", 2025-03-15, 15/03/2025, 15-Mar-2025. */
export function spotDate(token: string, today: string): string | null {
  const t = token.toLowerCase();
  if (t === "today") return today;
  if (t === "yesterday") return addDays(today, -1);
  // Only written dates: a bare number would read as a spreadsheet serial.
  if (!/[-/]/.test(t)) return null;
  const d = parseLooseDate(token);
  return d && isValidDate(d) ? d : null;
}

/** A typed phase: "landing", "taking off", "takeoff", "taxi", or the stored name. */
export function spotPhase(word: string): Phase | null {
  const w = word.trim().toLowerCase().replace(/\s+/g, " ");
  return PHASE_WORDS[w] ?? ((PHASES as readonly string[]).includes(w.replace(/ /g, "_")) ? (w.replace(/ /g, "_") as Phase) : null);
}

/** The airport code as stored and shown: ICAO when the airport has one. */
function airportCode(code: string, ref: RefIndex): string | null {
  const a = ref.airportByCode(code);
  return a ? (a.icao ?? a.iata ?? null) : null;
}

/** The field a word is a value of, or null when it is none Touchdown recognises. */
function classify(token: string, ref: RefIndex): { field: SpotField; value: string } | null {
  const u = token.toUpperCase();
  const digit = /\d/.test(u);
  if (u.includes("-")) {
    const reg = normaliseRegistration(u, ref);
    if (reg?.knownFormat) return { field: "registration", value: reg.display };
    const model = parseModel(u)?.standard;
    if (model && ref.typesForModel(model).length) return { field: "model", value: model };
    // A dashed word in no known format is most likely a registration Touchdown has no pattern for.
    if (/^[A-Z0-9]{1,3}-[A-Z0-9]{2,6}$/.test(u)) return { field: "registration", value: u };
    return null;
  }
  if (u.length === 4 && !digit && ref.airportByCode(u)) return { field: "airport", value: airportCode(u, ref)! };
  if (ref.type(u)) return { field: "typeCode", value: u };
  if (/^[A-Z]{3}$/.test(u)) {
    const op = ref.operatorByCode(u);
    if (op?.icao === u) return { field: "operator", value: u };
    if (ref.airportByCode(u)) return { field: "airport", value: airportCode(u, ref)! };
  }
  // Two-letter airline codes only as typed in capitals, so words like "to" or "in" stay words.
  if (/^[A-Z0-9]{2}$/.test(token)) {
    const op = ref.operatorByCode(token);
    if (op && op.iata === token) return { field: "operator", value: op.icao ?? token };
  }
  if (digit) {
    const model = parseModel(u)?.standard;
    if (model && model.length > 4 && ref.typesForModel(model).length) return { field: "model", value: model };
  }
  // A registration without its dash (DABCD, N1001X): words in capitals only, so "dream" is not D-REAM.
  if (token === u && u.length >= 4) {
    const reg = normaliseRegistration(u, ref);
    if (reg?.knownFormat) return { field: "registration", value: reg.display };
  }
  return null;
}

/**
 * Read one typed line: "G-ABCD landing", "D-ABCD at EDDF on 2025-03-15 DLH A20N", "N1001X \"Retro livery\"".
 * Registrations, airports (ICAO, or IATA after "at"), dates ("today", "yesterday", 2025-03-15, 15/03/2025),
 * phases, airline codes, type codes and models are recognised; the rest is left as text.
 */
export function parseSpotLine(line: string, ref: RefIndex, today: string): SpotLine {
  const out: SpotLine = { typed: {}, text: "", setting: null, problems: [] };
  if (/^\s*no phase\s*$/i.test(line)) {
    out.setting = { phase: null };
    return out;
  }
  const quoted: string[] = [];
  const bare = line.replace(/["“”]([^"“”]*)["“”]/g, (_, q: string) => {
    if (q.trim()) quoted.push(q.trim());
    return " ";
  });
  const tokens = bare.split(/[\s,;]+/).filter(Boolean);
  const rest: string[] = [];
  const set = (field: SpotField, value: string) => {
    const cur = out.typed[field];
    if (cur && cur !== value) out.problems.push(`Two values for the ${SPOT_FIELD_LABEL[field]}: ${cur} and ${value}; ${cur} kept.`);
    else out.typed[field] = value;
  };
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]!;
    const lower = t.toLowerCase();
    const next = tokens[i + 1];
    const pair = next ? `${lower} ${next.toLowerCase()}` : "";
    if (PHASE_WORDS[pair]) {
      set("phase", PHASE_WORDS[pair]!);
      i++;
      continue;
    }
    if (PHASE_WORDS[lower]) {
      set("phase", PHASE_WORDS[lower]!);
      continue;
    }
    if ((lower === "at" && next) || t.startsWith("@")) {
      const code = t.startsWith("@") ? t.slice(1) : next!;
      const ap = airportCode(code, ref);
      if (ap) {
        set("airport", ap);
        if (!t.startsWith("@")) i++;
        continue;
      }
      if (t.startsWith("@") || /^[A-Za-z0-9]{3,4}$/.test(code)) {
        out.problems.push(`No airport has the code ${code.toUpperCase()}.`);
        if (!t.startsWith("@")) i++;
        continue;
      }
    }
    if (lower === "on" && next) {
      const d = spotDate(next, today);
      if (d) {
        set("date", d);
        i++;
        continue;
      }
    }
    const d = spotDate(t, today);
    if (d) {
      set("date", d);
      continue;
    }
    const hit = classify(t, ref);
    if (hit) {
      set(hit.field, hit.value);
      continue;
    }
    rest.push(t);
  }
  out.text = [...quoted, rest.join(" ")].filter(Boolean).join("; ");
  if (out.typed.date && out.typed.date > today) out.problems.push(`${out.typed.date} is in the future.`);
  if (!out.typed.registration) {
    const keys = Object.keys(out.typed);
    if (!out.text && keys.length && keys.every((k) => k === "airport" || k === "date" || k === "phase")) {
      out.setting = { ...(out.typed as SpotSettings) };
      out.typed = {};
    } else if (keys.length || out.text) out.problems.push("No registration on this line.");
  }
  return out;
}

/** The line's fields with the session's place, date and phase where the line gives none. */
export function withSettings(typed: SpotValues, s: SpotSettings): SpotValues {
  return { ...typed, date: typed.date ?? s.date, airport: typed.airport ?? s.airport, phase: typed.phase ?? s.phase ?? undefined };
}

// ---------- what the sources say ----------

/** What one source says about a registration. */
export interface Evidence {
  source: LookupSource;
  typeCode: string | null;
  /** In the standard form, and only when it fits the type. */
  model: string | null;
  /** ICAO code where known, else IATA. */
  operator: string | null;
  operatorName: string | null;
  /** The day the source describes the aircraft as of (YYYY-MM-DD), when known. */
  asOf: string | null;
  note: string | null;
  /** Serial number and other facts about the airframe, stored on it when they fit the user's records. */
  facts: AirframeFacts | null;
  /** The source's page for this aircraft. */
  url: string | null;
}

/**
 * A model as a lookup writes it ("A320 232", "Airbus A321-271NX", "Boeing 787-9 Dreamliner") in the standard
 * form, or null when it is not a full model of the type.
 */
export function modelFromSource(text: string | null | undefined, typeCode: string | null, ref: RefIndex): string | null {
  if (!text) return null;
  let t = text.trim().replace(/\s+/g, " ");
  // A base model and a variant written apart: "A320 232", "737 8K5".
  if (!t.includes("-")) t = t.replace(/(\d) (\d)/, "$1-$2");
  // A marketing name after the model: "787-9 Dreamliner".
  t = t.replace(/^(.*\d[^ ]*-[^ ]+) [A-Za-z]{5,}$/, "$1");
  const std = parseModel(t)?.standard;
  if (!std || !/\d/.test(std)) return null;
  const types = ref.typesForModel(std);
  if (typeCode) {
    const fits = ref.modelMatchesType(std, typeCode);
    if (fits === false) return null;
    if (fits === null && !types.includes(typeCode.toUpperCase()) && !std.includes("-")) return null;
  } else if (!types.length) return null;
  return std;
}

/** A field's value in a source, in the form a session stores. */
export function evidenceValue(e: Evidence, field: SpotField): string | null {
  return field === "typeCode" ? e.typeCode : field === "model" ? e.model : field === "operator" ? e.operator : null;
}

/** The evidence as the agent is sent it: no facts or links. */
export function evidenceForAgent(list: Evidence[]): AgentEvidence[] {
  return list.map((e) => ({ source: e.source, typeCode: e.typeCode, model: e.model, operator: e.operator, asOf: e.asOf, note: e.note }));
}

/**
 * What the user's own records say about a registration: the type, model and airline of the record nearest the
 * date, and how often the aircraft is in the log. null when it is not. `self` is the sighting being checked
 * (its date and place), left out so a row already in the log does not vouch for itself.
 */
export function logEvidence(store: Store, ref: RefIndex, registration: string, date: string, self?: { date?: string | null; airport?: string | null }): Evidence | null {
  const key = registrationMatchForm(registration);
  const selfAirport = ref.airportByCode(self?.airport)?.id ?? null;
  const isSelf = (s: { seenOn: string | null; airportId: string | null }) => !!self && (s.seenOn ?? null) === (self.date ?? null) && s.airportId === selfAirport;
  const recs = [
    ...store
      .all("sightings")
      .filter((s) => s.registration && registrationMatchForm(s.registration) === key && !isSelf(s))
      .map((s) => ({ date: s.seenOn, typeCode: s.typeCode, model: s.model, op: s.operatorId, flown: false })),
    ...store.all("flights").filter((f) => f.registration && registrationMatchForm(f.registration) === key).map((f) => ({ date: f.scheduledDate, typeCode: f.typeCode, model: f.model, op: f.airlineId, flown: true })),
  ];
  if (!recs.length) return null;
  const dated = recs.filter((r): r is typeof r & { date: string } => !!r.date).sort((a, b) => a.date.localeCompare(b.date));
  const near = [...dated].sort((a, b) => Math.abs(daysBetween(a.date, date)) - Math.abs(daysBetween(b.date, date)))[0] ?? recs[0]!;
  // The nearest record may lack the type; another record of the same aircraft has it.
  const typeCode = near.typeCode ?? recs.find((r) => r.typeCode)?.typeCode ?? null;
  const op = ref.operator(near.op);
  const seen = recs.filter((r) => !r.flown).length;
  const flown = recs.length - seen;
  const span = dated.length > 1 ? ` (${dated[0]!.date} to ${dated.at(-1)!.date})` : dated.length ? ` (${dated[0]!.date})` : "";
  const parts = [seen && `seen ${seen === 1 ? "once" : `${seen} times`}`, flown && `flown on ${flown === 1 ? "once" : `${flown} times`}`].filter(Boolean);
  return {
    source: "your_log",
    typeCode: typeCode && ref.type(typeCode) ? typeCode : null,
    model: near.model ?? recs.find((r) => r.model && r.typeCode === typeCode)?.model ?? null,
    operator: op ? (op.icao ?? op.iata ?? null) : null,
    operatorName: op?.name ?? null,
    asOf: near.date ?? null,
    note: `${parts.join(", ")}${span}`,
    facts: null,
    url: null,
  };
}

// ---------- choosing the values ----------

export interface Disagreement {
  field: SpotField;
  kept: string;
  keptFrom: SpotSource;
  others: { value: string; source: LookupSource }[];
  /** The type differs by family: the source probably describes another aircraft with this registration. */
  otherAircraft?: boolean;
}

export interface SpotChoice {
  values: SpotValues;
  sources: Partial<Record<SpotField, SpotSource>>;
  disagreements: Disagreement[];
  facts: AirframeFacts | null;
}

// For the type and the model, a source that is kept up to date wins over a snapshot or the user's own records.
const RANK: Record<LookupSource, number> = { fr24: 0, adsbdb: 1, opensky: 2, your_log: 3 };

/**
 * Do two models name the same aircraft as far as a lookup can tell? Sources often give only the series
 * ("777-300(ER)" for a 777-31H(ER), "717-200" for a 717-22A), leave out "(ER)", or use the type certificate's
 * name ("BD-500-1A11" for an A220-300, "ERJ170-200LR" for an E175LR). Different customer codes of one series
 * ("A320-214" and "A320-232") do not agree.
 */
export function modelsAgree(a: string, b: string): boolean {
  // Suffixes for range ("(ER)", "LR"), freighter conversions ("(BDSF)", "SF", "BCF") and upgrades ("A330-343E").
  const SUFFIX = /(\((ER|LR|XLR|BDSF|BCF|PCF|SF|P2F|F)\)|(?<=\w)(ERF|ER|LR|BDSF|BCF|PCF|SF|P2F)|(?<=\d)[XEF])$/;
  const norm = (m: string) => {
    let v = m.toUpperCase().trim();
    while (SUFFIX.test(v)) v = v.replace(SUFFIX, "");
    return v;
  };
  const x = norm(a);
  const y = norm(b);
  if (x === y) return true;
  const [bx, vx = ""] = x.split(/-(.*)/s);
  const [by, vy = ""] = y.split(/-(.*)/s);
  // Named in different systems: nothing to compare.
  if (bx !== by) return true;
  const series = (v: string) => /^\d00/.test(v);
  if (series(vx) || series(vy)) return vx[0] === vy[0];
  return false;
}

function same(field: SpotField, a: string, b: string, ref: RefIndex): boolean {
  if (field === "model") return modelsAgree(a, b);
  if (field === "operator") {
    const x = ref.operatorByCode(a);
    return x ? x.id === ref.operatorByCode(b)?.id : a.toUpperCase() === b.toUpperCase();
  }
  return a.toUpperCase() === b.toUpperCase();
}

/**
 * The values for a sighting: what the user typed wins; an empty field takes the sources' value (the type and
 * model from the source kept most up to date, the airline from the source nearest the sighting's date, since
 * aircraft change hands). Every source that says something else is listed as a disagreement.
 */
export function chooseValues(typed: SpotValues, evidence: Evidence[], ref: RefIndex, today: string): SpotChoice {
  const values: SpotValues = {};
  const sources: Partial<Record<SpotField, SpotSource>> = {};
  const disagreements: Disagreement[] = [];
  for (const f of SPOT_FIELDS) {
    const v = typed[f]?.trim();
    if (v) {
      values[f] = v;
      sources[f] = "you";
    }
  }
  if (values.registration) values.registration = normaliseRegistration(values.registration, ref)?.display ?? values.registration;
  const day = values.date ?? today;

  // Sources the user's own airline is not compared with: OpenSky and adsbdb give the company that operates the
  // aircraft, where the user writes the airline whose colours it wears (Q-SPOT-AIRLINE).
  const operatorOnly = new Set<LookupSource>(["opensky", "adsbdb"]);
  let usable = evidence;
  const pick = (field: SpotField, order: (a: Evidence, b: Evidence) => number, accept: (v: string) => boolean = () => true) => {
    const told = usable
      .map((e) => ({ e, value: evidenceValue(e, field) }))
      .filter((x): x is { e: Evidence; value: string } => !!x.value && accept(x.value))
      .sort((a, b) => order(a.e, b.e));
    let kept = values[field];
    if (!kept && told.length) {
      kept = told[0]!.value;
      values[field] = kept;
      sources[field] = told[0]!.e.source;
    }
    if (!kept) return;
    const others = told
      .filter((x) => !same(field, x.value, kept!, ref))
      .filter((x) => !(field === "operator" && sources.operator === "you" && operatorOnly.has(x.e.source)))
      .map((x) => ({ value: x.value, source: x.e.source }));
    if (others.length) disagreements.push({ field, kept, keptFrom: sources[field]!, others });
  };

  // A model the user typed names its type.
  if (!values.typeCode && values.model) {
    const types = ref.typesForModel(parseModel(values.model)?.standard ?? values.model);
    if (types.length === 1) {
      values.typeCode = types[0]!;
      sources.typeCode = "derived";
    }
  }
  const byRank = (a: Evidence, b: Evidence) => RANK[a.source] - RANK[b.source];
  pick("typeCode", byRank, (v) => !!ref.type(v));
  // A source whose type is of another family probably describes another aircraft that carried the registration
  // (or the type was mistyped): it is shown, but its model, airline and serial number are not used.
  const family = (t: string) => ref.familyIdOf(t) ?? t;
  const foreign = (e: Evidence) => !!values.typeCode && !!e.typeCode && family(e.typeCode) !== family(values.typeCode);
  const typeDiff = disagreements.find((d) => d.field === "typeCode");
  if (typeDiff && evidence.some(foreign)) typeDiff.otherAircraft = true;
  usable = evidence.filter((e) => !foreign(e));
  pick("model", byRank, (v) => !values.typeCode || ref.modelMatchesType(v, values.typeCode) !== false);
  const far = (e: Evidence) => (e.asOf ? Math.abs(daysBetween(e.asOf, day)) : 100_000);
  pick("operator", (a, b) => far(a) - far(b) || byRank(a, b));

  const facts = [...usable].filter((e) => e.facts?.msn).sort((a, b) => factRank(a) - factRank(b))[0]?.facts ?? null;
  return { values, sources, disagreements, facts };
}

// For serial numbers, a source that shows them on a page the user can check comes first.
const factRank = (e: Evidence) => ({ fr24: 0, opensky: 1, adsbdb: 2, your_log: 3 })[e.source];

/** "airline: Flightradar24 says BAW, OpenSky says SHT; BAW kept". */
export function describeDisagreement(d: Disagreement): string {
  const others = d.others.map((o) => `${SOURCE_NAME[o.source]} says ${o.value}`).join(", ");
  const kept = d.keptFrom === "you" ? `you typed ${d.kept}` : `${SOURCE_NAME[d.keptFrom]} says ${d.kept}`;
  const why = d.otherAircraft ? " That is another kind of aircraft: the registration may have been reused, or the type mistyped." : "";
  return `${SPOT_FIELD_LABEL[d.field]}: ${kept}, ${others}; ${d.kept} kept.${why}`;
}

/** Fields the user should supply: wanted and still empty. */
export function missingFields(values: SpotValues): SpotField[] {
  return SPOT_WANTED.filter((f) => !values[f]);
}

// ---------- the agent's suggestions ----------

/**
 * Whether an agent's suggestion is used straight away or asked about. Asked: a change to what the user typed,
 * anything from the agent's own knowledge, a "lookup" value no source gave, and anything not sure.
 */
export function useOrAsk(s: Pick<AgentSuggestion, "field" | "suggested" | "basis" | "confidence">, choice: SpotChoice, evidence: Evidence[], ref: RefIndex): "use" | "ask" {
  const field = s.field as SpotField;
  // Sorting the user's own words into fields is used, unless it changes a field the user gave on its own.
  if (s.basis === "typed") return field === "notes" || choice.sources[field] !== "you" ? "use" : "ask";
  if (choice.sources[field] === "you") return "ask";
  switch (s.basis) {
    case "lookup_data":
      return evidence.some((e) => {
        const v = evidenceValue(e, field);
        return !!v && same(field, v, s.suggested, ref);
      })
        ? "use"
        : "ask";
    case "reference_data":
    case "consistency":
      return s.confidence === "high" ? "use" : "ask";
    default:
      return "ask";
  }
}
