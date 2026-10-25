// Facts about an airframe from a lookup (serial number, line number, first flight, delivery, status), checked
// against the user's records and stored on the airframe (docs/13-reference-data.md, "Airframe facts").
// Fetching happens outside core (the CLI); this module only checks and stores what came back.

import type { RefIndex } from "../ref/index.ts";
import { AIRFRAME_STATUSES, type Airframe } from "../schema/tables.ts";
import type { Store } from "../store.ts";
import { recordDate } from "../derive.ts";
import { registrationMatchForm } from "../normalise/registration.ts";
import { addDays } from "../time/index.ts";
import { parsePastedFacts, type PastedFacts } from "./paste.ts";

export type AirframeStatus = (typeof AIRFRAME_STATUSES)[number];

export interface RegistrationSpan {
  registration: string;
  from: string | null; // YYYY-MM-DD
  to: string | null;
  operator: string | null;
}

export interface AirframeFacts {
  provider: string; // "airfleets", "planespotters", …
  url: string | null;
  fetchedAt: string; // ISO date-time with offset
  registration: string;
  manufacturer: string | null;
  msn: string | null;
  lineNumber: string | null;
  typeText: string | null; // as the source writes it, e.g. "Airbus A321-271NX"
  typeCode: string | null; // ICAO designator, when the source gives one or it follows from the model
  firstFlightDate: string | null; // YYYY-MM-DD; null when the source gives only a month or a year
  deliveryDate: string | null;
  status: AirframeStatus | null;
  /** A date the airframe cannot have flown before (e.g. the start of its build year), for checking only. */
  notBefore?: string | null;
  /** How the source dates it, for the message when a record is earlier: "was built in 2019". */
  notBeforeLabel?: string | null;
  registrations: RegistrationSpan[];
}

export interface FactsOutcome {
  airframeId: string;
  applied: { field: string; from: string | null; to: string }[];
  /** Values the user entered that differ from the lookup; the user's value is kept. */
  differs: { field: string; yours: string; lookup: string }[];
  /** Why nothing was used, when the source does not fit the user's records. */
  rejected: string | null;
  /** The airframe this one was merged into, when the serial number showed they are one aircraft. */
  mergedInto: string | null;
}

export interface ApplyOptions {
  /** Replace values that came from an imported file (provenance `user` with a file name), not ones typed in the app. */
  overwriteImported?: boolean;
}

const FACT_FIELDS = ["msn", "lineNumber", "firstFlightDate", "deliveryDate", "status"] as const;
type FactField = (typeof FACT_FIELDS)[number];

// Registration dates on these sites are often the delivery or the first sighting, so allow a month either side.
const SPAN_SLACK_DAYS = 31;

/** Serial numbers compare without padding: FR24 writes "038" where the maker writes "38". */
export function normaliseMsn(msn: string): string {
  const v = msn.trim().toUpperCase();
  return /^\d+$/.test(v) ? v.replace(/^0+(?=\d)/, "") : v;
}

const makerCache = new WeakMap<RefIndex, string[]>();

/**
 * A maker's name as the reference data writes it, so identities and addresses agree: "Airbus SAS" → "Airbus",
 * "Embraer S A" → "Embraer", "Cessna 560" → "Cessna". The longest reference name whose words start the given
 * name wins; an unknown maker is kept as given.
 */
export function canonicalMaker(name: string, ref: RefIndex): string {
  const words = (s: string) => s.toLowerCase().replace(/[^a-z0-9\s]/g, " ").trim().split(/\s+/);
  let makers = makerCache.get(ref);
  if (!makers) {
    makers = [...new Set([...ref.types.values()].map((t) => t.manufacturer).filter((m): m is string => !!m))];
    makerCache.set(ref, makers);
  }
  const given = words(name);
  let best: string | null = null;
  let bestLen = 0;
  for (const m of makers) {
    const mw = words(m);
    if (mw.length > bestLen && mw.length <= given.length && mw.every((w, i) => w === given[i])) {
      best = m;
      bestLen = mw.length;
    }
  }
  return best ?? name.trim();
}

export function identityKeyFor(manufacturer: string, msn: string): string {
  return `msn:${manufacturer.toLowerCase().replace(/\s+/g, "-")}:${normaliseMsn(msn)}`;
}

/** Dates of the user's flights and sightings on an airframe, oldest first. */
export function recordDatesOf(store: Store, airframeId: string): string[] {
  const out: string[] = [];
  for (const f of store.all("flights")) if (f.airframeId === airframeId) out.push(recordDate("flights", f) ?? "");
  for (const s of store.all("sightings")) if (s.airframeId === airframeId) out.push(recordDate("sightings", s) ?? "");
  return out.filter(Boolean).sort();
}

/** Why the source cannot be about the aircraft in the user's records, or null when it fits. */
export function factsMismatch(store: Store, ref: RefIndex, a: Airframe, facts: AirframeFacts): string | null {
  if (facts.typeCode && a.typeCode && facts.typeCode !== a.typeCode) {
    const fa = ref.familyIdOf(facts.typeCode);
    const fb = ref.familyIdOf(a.typeCode);
    if (!fa || !fb || fa !== fb) return `the source says ${facts.typeText ?? facts.typeCode}, but your records say ${a.typeCode}`;
  }
  if (facts.manufacturer && a.manufacturer && !sameMaker(facts.manufacturer, a.manufacturer)) {
    return `the source says ${facts.manufacturer}, but your records say ${a.manufacturer}`;
  }
  const dates = recordDatesOf(store, a.id);
  const first = dates[0];
  if (first && facts.firstFlightDate && first < facts.firstFlightDate) {
    return `that aircraft first flew on ${facts.firstFlightDate}, after your record of ${first}; the registration probably belonged to another aircraft then`;
  }
  if (first && facts.notBefore && first < facts.notBefore) {
    const after = facts.notBeforeLabel?.endsWith(" after") ? "" : ", after";
    return `that aircraft ${facts.notBeforeLabel ?? `dates from ${facts.notBefore}`}${after} your record of ${first}; the registration probably belonged to another aircraft then`;
  }
  const key = registrationMatchForm(facts.registration);
  const spans = facts.registrations.filter((s) => registrationMatchForm(s.registration) === key && (s.from || s.to));
  if (spans.length) {
    const fits = (d: string) => spans.some((s) => (!s.from || addDays(s.from, -SPAN_SLACK_DAYS) <= d) && (!s.to || d <= addDays(s.to, SPAN_SLACK_DAYS)));
    const outside = dates.find((d) => !fits(d));
    if (outside) {
      const held = spans.map((s) => `${s.from ?? "…"} to ${s.to ?? "now"}`).join(", ");
      return `that aircraft carried ${facts.registration} ${held}, which does not include your record of ${outside}`;
    }
  }
  return null;
}

/** "Airbus SAS" and "Airbus", "Embraer S A" and "Embraer": the same maker when the first word agrees. */
function sameMaker(a: string, b: string): boolean {
  const first = (s: string) => s.toLowerCase().replace(/[^a-z\s]/g, " ").trim().split(/\s+/)[0] ?? "";
  return first(a) === first(b);
}

/** Fields of an airframe the user set: typed in the app (detail null) or imported from their own file. */
function userValues(store: Store, airframeId: string): Map<string, "typed" | "imported"> {
  const out = new Map<string, "typed" | "imported">();
  for (const p of store.all("field_provenance")) {
    if (p.ownerTable !== "airframes" || p.ownerId !== airframeId || p.source !== "user" || !p.field) continue;
    if (!p.detail || p.detail === "merge") out.set(p.field, "typed");
    else if (out.get(p.field) !== "typed") out.set(p.field, "imported");
  }
  return out;
}

/**
 * Check a lookup result against the airframe's records and store its facts. A value the user entered wins
 * (it is reported in `differs` when the lookup disagrees). A serial number confirms the airframe; if another
 * airframe already has that serial number, the two are merged. Run `resolveAirframes` afterwards.
 */
export function applyAirframeFacts(store: Store, ref: RefIndex, airframeId: string, facts: AirframeFacts, opts: ApplyOptions = {}): FactsOutcome {
  return store.batch(() => {
    const out: FactsOutcome = { airframeId, applied: [], differs: [], rejected: null, mergedInto: null };
    let a = store.get("airframes", airframeId);
    if (!a) {
      out.rejected = "the aircraft is no longer in the log";
      return out;
    }
    const why = factsMismatch(store, ref, a, facts);
    if (why) {
      out.rejected = why;
      return out;
    }
    const manufacturer = makerFor(ref, a, facts);
    const locked = lockedFields(store, a.id, opts);

    // The serial number first: it can show that this airframe is one already in the log.
    const other = sameAircraft(store, a, facts, manufacturer, locked);
    if (other) {
      mergeAirframeInto(store, other.id, a.id);
      out.mergedInto = other.id;
      out.airframeId = other.id;
      a = store.get("airframes", other.id)!;
    }

    const patch = factPatch(a, facts, manufacturer, locked, out);
    const msn = patch.msn ?? a.msn;
    const maker = patch.manufacturer ?? a.manufacturer;
    if (msn && maker && (a.provisional || !a.identityKey?.startsWith("msn:"))) {
      patch.provisional = false;
      patch.identityKey = identityKeyFor(maker, msn);
    }
    patch.factsProvider = facts.provider;
    patch.factsFetchedAt = facts.fetchedAt;
    store.update("airframes", a.id, patch);
    for (const x of out.applied) {
      store.insert("field_provenance", { ownerTable: "airframes", ownerId: a.id, field: x.field, source: "lookup", detail: facts.provider, recordedAt: facts.fetchedAt });
    }
    if (facts.url) {
      for (const e of store.all("external_ids")) {
        if (e.ownerTable === "airframes" && e.ownerId === a.id && e.system === facts.provider) store.remove("external_ids", e.id);
      }
      store.insert("external_ids", { ownerTable: "airframes", ownerId: a.id, system: facts.provider, key: "url", value: facts.url });
    }
    return out;
  });
}

/**
 * What `applyAirframeFacts` would do, without doing it (the review of looked-up facts, docs/34): why the facts do
 * not fit, the aircraft they would merge this one with, and the fields they would set.
 */
export function airframeFactsEffect(store: Store, ref: RefIndex, airframeId: string, facts: AirframeFacts, opts: ApplyOptions = {}): Omit<FactsOutcome, "airframeId"> {
  const out: Omit<FactsOutcome, "airframeId"> = { applied: [], differs: [], rejected: null, mergedInto: null };
  const a = store.get("airframes", airframeId);
  if (!a) return { ...out, rejected: "the aircraft is no longer in the log" };
  out.rejected = factsMismatch(store, ref, a, facts);
  if (out.rejected) return out;
  const manufacturer = makerFor(ref, a, facts);
  const locked = lockedFields(store, a.id, opts);
  const other = sameAircraft(store, a, facts, manufacturer, locked);
  out.mergedInto = other?.id ?? null;
  factPatch(other ?? a, facts, manufacturer, locked, out);
  return out;
}

const makerFor = (ref: RefIndex, a: Airframe, facts: AirframeFacts) => a.manufacturer ?? (facts.manufacturer ? canonicalMaker(facts.manufacturer, ref) : null) ?? ref.manufacturerOf(facts.typeCode ?? a.typeCode);

/** The fields a lookup may not change: typed by the user, or imported from their own file unless overwritten. */
function lockedFields(store: Store, airframeId: string, opts: ApplyOptions) {
  const mine = userValues(store, airframeId);
  return (field: string) => mine.get(field) === "typed" || (mine.get(field) === "imported" && !opts.overwriteImported);
}

/** Another airframe in the log with the serial number the facts give: the same aircraft. */
function sameAircraft(store: Store, a: Airframe, facts: AirframeFacts, manufacturer: string | null, locked: (field: string) => boolean): Airframe | null {
  if (!facts.msn || !manufacturer || locked("msn")) return null;
  const key = identityKeyFor(manufacturer, facts.msn);
  return store.all("airframes").find((x) => x.identityKey === key && x.id !== a.id) ?? null;
}

/** The facts' values for `a`, recording what they set and where the user's own value is kept. */
function factPatch(a: Airframe, facts: AirframeFacts, manufacturer: string | null, locked: (field: string) => boolean, out: Pick<FactsOutcome, "applied" | "differs">): Partial<Airframe> {
  const patch: Partial<Airframe> = {};
  for (const field of FACT_FIELDS) {
    const value = field === "msn" && facts.msn ? normaliseMsn(facts.msn) : facts[field];
    if (!value) continue;
    const cur = a[field as FactField] as string | null;
    if (cur === value || (field === "msn" && cur && normaliseMsn(cur) === value)) continue;
    if (locked(field)) {
      if (cur) out.differs.push({ field, yours: cur, lookup: value });
      continue;
    }
    (patch as Record<string, unknown>)[field] = value;
    out.applied.push({ field, from: cur, to: value });
  }
  if (!a.manufacturer && manufacturer) {
    patch.manufacturer = manufacturer;
    out.applied.push({ field: "manufacturer", from: null, to: manufacturer });
  }
  return patch;
}

/**
 * Move everything of airframe `from` to `into` and remove `from`: records, registration and operator periods,
 * provenance and external ids. Facts `into` lacks are taken from `from`.
 */
export function mergeAirframeInto(store: Store, into: string, from: string): void {
  store.batch(() => {
    const a = store.get("airframes", into);
    const b = store.get("airframes", from);
    if (!a || !b || into === from) return;
    for (const table of ["flights", "sightings"] as const) {
      for (const r of store.all(table)) if (r.airframeId === from) store.update(table, r.id, { airframeId: into });
    }
    for (const p of store.all("registration_periods")) {
      if (p.airframeId !== from) continue;
      const dup = store.all("registration_periods").some((q) => q.airframeId === into && registrationMatchForm(q.registration ?? "") === registrationMatchForm(p.registration ?? ""));
      if (dup) store.remove("registration_periods", p.id);
      else store.update("registration_periods", p.id, { airframeId: into });
    }
    for (const p of store.all("operator_periods")) if (p.airframeId === from) store.update("operator_periods", p.id, { airframeId: into });
    for (const p of store.all("field_provenance")) if (p.ownerTable === "airframes" && p.ownerId === from) store.update("field_provenance", p.id, { ownerId: into });
    for (const e of store.all("external_ids")) if (e.ownerTable === "airframes" && e.ownerId === from) store.update("external_ids", e.id, { ownerId: into });
    const fill: Partial<Airframe> = {};
    for (const k of ["manufacturer", "msn", "lineNumber", "typeCode", "model", "firstFlightDate", "deliveryDate", "notes"] as const) {
      if (!a[k] && b[k]) (fill as Record<string, unknown>)[k] = b[k];
    }
    if (Object.keys(fill).length) store.update("airframes", into, fill);
    store.remove("airframes", from);
  });
}

/** The facts that text pasted from an airframe page gives an aircraft, and the fields they would change. */
export interface PastedForAircraft {
  pasted: PastedFacts;
  /** The values that differ from the aircraft's, with its maker when a serial number comes without one. */
  patch: Partial<Pick<Airframe, "msn" | "lineNumber" | "firstFlightDate" | "deliveryDate" | "manufacturer">>;
  /** Why the page may be about another aircraft (the same checks as for lookups), or null. */
  problem: string | null;
}

/**
 * Read text the user copied off an airframe page for aircraft `a`, which they know by `registration` (the aircraft
 * page and `touchdown aircraft edit --paste`). The values are the user's: saved with source `user` once confirmed.
 */
export function pastedFactsFor(store: Store, ref: RefIndex, a: Airframe, registration: string, text: string): PastedForAircraft {
  const pasted = parsePastedFacts(text);
  const patch: PastedForAircraft["patch"] = {};
  if (pasted.msn && pasted.msn !== a.msn) patch.msn = pasted.msn;
  if (pasted.lineNumber && pasted.lineNumber !== a.lineNumber) patch.lineNumber = pasted.lineNumber;
  if (pasted.firstFlightDate && pasted.firstFlightDate !== a.firstFlightDate) patch.firstFlightDate = pasted.firstFlightDate;
  if (pasted.deliveryDate && pasted.deliveryDate !== a.deliveryDate) patch.deliveryDate = pasted.deliveryDate;
  if (patch.msn && !a.manufacturer) {
    const maker = ref.manufacturerOf(a.typeCode);
    if (maker) patch.manufacturer = maker;
  }
  // A page about an aircraft that first flew after the user's record is about another aircraft that later carried
  // the registration.
  const problem = factsMismatch(store, ref, a, { provider: "paste", url: null, fetchedAt: "", registration, manufacturer: null, msn: pasted.msn, lineNumber: pasted.lineNumber, typeText: pasted.typeText, typeCode: null, firstFlightDate: pasted.firstFlightDate, deliveryDate: pasted.deliveryDate, status: null, registrations: [] });
  return { pasted, patch, problem };
}
