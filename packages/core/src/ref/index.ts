// Lookups over the reference tables, with the user's overrides applied on top
// (docs/10-domain-model.md, "Reference tables").

import type { Airport, AircraftType, Family, ModelPattern, Operator, RefTables, RegistrationPrefix } from "./types.ts";

export * from "./types.ts";

export interface RefOverrides {
  airports?: Airport[];
  operators?: Operator[];
  aircraftTypes?: AircraftType[];
  familyOverrides?: { designator: string; familyId: string }[];
}

const PRIVATE_OWNER_RE = /^private( owner)?$/i;

function nameKey(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

/** A value that names an operator rather than giving its code: lower-case letters, spaces, or longer than a code. */
export function looksLikeOperatorName(raw: string | null | undefined): boolean {
  if (!raw) return false;
  const v = raw.trim();
  return !PRIVATE_OWNER_RE.test(v) && (/[a-z]/.test(v) || /\s/.test(v) || v.length > 3);
}

/**
 * The city to show. OurAirports often adds a district, province or another name in brackets
 * ("Shanghai (Minhang)", "Foggia (FG)", "Gqeberha (Port Elizabeth)"); the table keeps them for search.
 */
export function cityName(a: Pick<Airport, "city"> | null | undefined): string | null {
  return a?.city?.replace(/\s*\(.*\)\s*$/, "").replace(/\s+/g, " ").trim() || null;
}

function within(date: string | null | undefined, from: string | null, to: string | null): boolean {
  if (!date) return true;
  return (!from || from <= date) && (!to || date <= to);
}

export class RefIndex {
  readonly airports = new Map<string, Airport>();
  readonly operators = new Map<string, Operator>();
  readonly types = new Map<string, AircraftType>();
  readonly families = new Map<string, Family>();
  private airportsByIata = new Map<string, Airport[]>();
  private airportsByIcao = new Map<string, Airport>();
  private operatorsByIata = new Map<string, Operator[]>();
  private operatorsByIcao = new Map<string, Operator[]>();
  private operatorsByName = new Map<string, Operator>();
  private patterns = new Map<string, { re: RegExp; source: ModelPattern }[]>();
  private familyOverride = new Map<string, string>();
  private prefixes: (RegistrationPrefix & { re: RegExp; bare: string; dashAt: number })[] = [];
  private referenceOperators: Operator[];

  constructor(tables: RefTables, overrides: RefOverrides = {}) {
    this.referenceOperators = tables.operators;
    for (const a of [...tables.airports, ...(overrides.airports ?? [])]) this.addAirport(a);
    for (const o of [...tables.operators, ...(overrides.operators ?? [])]) this.addOperator(o);
    for (const t of [...tables.aircraftTypes, ...(overrides.aircraftTypes ?? [])]) this.types.set(t.designator, t);
    for (const f of tables.families) this.families.set(f.id, f);
    for (const o of overrides.familyOverrides ?? []) this.familyOverride.set(o.designator, o.familyId);
    for (const p of tables.modelPatterns) {
      const list = this.patterns.get(p.designator) ?? [];
      list.push({ re: new RegExp(p.pattern), source: p });
      this.patterns.set(p.designator, list);
    }
    this.prefixes = tables.registrationPrefixes
      .map((p) => ({ ...p, re: new RegExp(p.pattern), bare: p.prefix.replace(/-/g, ""), dashAt: p.prefix.indexOf("-") }))
      .sort((a, b) => b.bare.length - a.bare.length);
  }

  private addAirport(a: Airport) {
    const old = this.airports.get(a.id);
    if (old) this.removeAirportCodes(old);
    this.airports.set(a.id, a);
    if (a.iata) this.airportsByIata.set(a.iata, [...(this.airportsByIata.get(a.iata) ?? []), a]);
    if (a.icao) this.airportsByIcao.set(a.icao, a);
  }

  private removeAirportCodes(a: Airport) {
    if (a.iata) this.airportsByIata.set(a.iata, (this.airportsByIata.get(a.iata) ?? []).filter((x) => x.id !== a.id));
    if (a.icao && this.airportsByIcao.get(a.icao)?.id === a.id) this.airportsByIcao.delete(a.icao);
  }

  /** Add an operator (the user's own, from operator_overrides). Later lookups find it by code or name. */
  addOperator(o: Operator) {
    this.operators.set(o.id, o);
    if (o.iata) this.operatorsByIata.set(o.iata, [...(this.operatorsByIata.get(o.iata) ?? []), o]);
    if (o.icao) this.operatorsByIcao.set(o.icao, [...(this.operatorsByIcao.get(o.icao) ?? []), o]);
    const key = nameKey(o.name);
    // A name maps to one operator: the user's own wins, then one still operating.
    const cur = this.operatorsByName.get(key);
    if (!cur || o.id.startsWith("op_") === false || (cur.validTo && !o.validTo)) this.operatorsByName.set(key, o);
  }

  /**
   * Replace the user's own operators and family choices with the ones the log holds now. They change after the
   * index is built: by sync (a browser signed in again starts empty and the log arrives later) and by edits.
   */
  setUserOverrides(overrides: Pick<RefOverrides, "operators" | "familyOverrides">) {
    this.operators.clear();
    this.operatorsByIata.clear();
    this.operatorsByIcao.clear();
    this.operatorsByName.clear();
    for (const o of [...this.referenceOperators, ...(overrides.operators ?? [])]) this.addOperator(o);
    this.familyOverride.clear();
    for (const o of overrides.familyOverrides ?? []) this.familyOverride.set(o.designator, o.familyId);
  }

  /** Airport by IATA (3 letters) or ICAO (4 characters) code, any case. */
  airportByCode(code: string | null | undefined): Airport | null {
    if (!code) return null;
    const c = code.trim().toUpperCase();
    if (c.length === 4) return this.airportsByIcao.get(c) ?? null;
    if (c.length === 3) {
      const list = this.airportsByIata.get(c) ?? [];
      // An IATA code can sit on a closed field and its replacement; prefer the one with an ICAO code.
      return list.find((a) => a.icao) ?? list[0] ?? null;
    }
    return null;
  }

  airport(id: string | null | undefined): Airport | null {
    return id ? (this.airports.get(id) ?? null) : null;
  }

  /**
   * Operator by IATA (2 characters) or ICAO (3 letters) code, any case. IATA codes are reused over
   * time, so the one valid on `date` wins; without a date the one still operating wins.
   */
  operatorByCode(code: string | null | undefined, date?: string | null): Operator | null {
    if (!code) return null;
    const raw = code.trim();
    if (PRIVATE_OWNER_RE.test(raw)) return this.operators.get("op_private") ?? null;
    const c = raw.toUpperCase();
    const list = c.length === 3 ? this.operatorsByIcao.get(c) : c.length === 2 ? this.operatorsByIata.get(c) : undefined;
    // Not a code (or an unknown one): try the operator's name, as written in a sheet ("Hyundai").
    if (!list?.length) return this.operatorsByName.get(nameKey(raw)) ?? null;
    if (list.length === 1) return list[0]!;
    const valid = list.filter((o) => within(date, o.validFrom, o.validTo));
    const pool = valid.length ? valid : list;
    return pool.find((o) => !o.validTo) ?? [...pool].sort((a, b) => (b.validTo ?? "").localeCompare(a.validTo ?? ""))[0]!;
  }

  operator(id: string | null | undefined): Operator | null {
    return id ? (this.operators.get(id) ?? null) : null;
  }

  type(designator: string | null | undefined): AircraftType | null {
    return designator ? (this.types.get(designator.toUpperCase()) ?? null) : null;
  }

  familyIdOf(designator: string | null | undefined): string | null {
    if (!designator) return null;
    const d = designator.toUpperCase();
    return this.familyOverride.get(d) ?? this.types.get(d)?.familyId ?? null;
  }

  family(id: string | null | undefined): Family | null {
    return id ? (this.families.get(id) ?? null) : null;
  }

  manufacturerOf(designator: string | null | undefined): string | null {
    return this.type(designator)?.manufacturer ?? null;
  }

  hasPatterns(designator: string): boolean {
    return this.patterns.has(designator);
  }

  /** Does a standard-form model match one of the type's patterns? null when the type has no patterns. */
  modelMatchesType(model: string, designator: string): boolean | null {
    const list = this.patterns.get(designator.toUpperCase());
    if (!list) return null;
    return list.some((p) => p.re.test(model));
  }

  /** Example models in the standard form for a type ("A321-271NX"), as the model patterns give them. */
  modelExamples(designator: string): string[] {
    return (this.patterns.get(designator.toUpperCase()) ?? []).map((p) => p.source.example).filter(Boolean);
  }

  /** Type designators whose patterns match a standard-form model. */
  typesForModel(model: string): string[] {
    const out: string[] = [];
    for (const [designator, list] of this.patterns) if (list.some((p) => p.re.test(model))) out.push(designator);
    return out.sort();
  }

  /**
   * Registration prefix for a registration written with or without its dash. Returns the display form
   * (with the country's dash) when a prefix pattern matches; the longest matching prefix wins.
   */
  classifyRegistration(compact: string): { prefix: RegistrationPrefix; display: string } | null {
    const v = compact.toUpperCase();
    const hasDash = v.includes("-");
    const bareInput = v.replace(/-/g, "");
    for (const p of this.prefixes) {
      if (!bareInput.startsWith(p.bare)) continue;
      const candidates = hasDash ? [v] : [];
      if (p.dashAt >= 0) candidates.push(bareInput.slice(0, p.dashAt) + "-" + bareInput.slice(p.dashAt));
      else candidates.push(bareInput);
      for (const cand of candidates) if (p.re.test(cand)) return { prefix: p, display: cand };
    }
    return null;
  }
}
