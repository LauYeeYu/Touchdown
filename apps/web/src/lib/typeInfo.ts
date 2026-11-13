// The aircraft types' figures, families' history and silhouettes (docs/13-reference-data.md, "Type figures",
// "Silhouettes"; @touchdown/refdata/typeinfo), loaded the first time a page needs them and kept for the tab.

import { useEffect, useState } from "react";
import type { FamilyFacts, RefIndex, SilhouetteShape, TypeRole, TypeSpecs, TypeWikidata, TypeWikipedia } from "@touchdown/core";
import type { Planform } from "./silhouette.ts";

/**
 * A type's figures: the curated ones from Wikipedia, with what they lack from Wikidata, then from the specifications
 * of the type's own English Wikipedia article, and where they come from. A type with none of them has no figures.
 */
export interface TypeData extends Omit<TypeSpecs, "article" | "revision"> {
  wikipedia: { article: string; revision: number } | null;
  /** Wikidata's item for the type, and whether it gave a figure the page shows (its only ones, or ones Wikipedia lacks). */
  wikidata: { item: string; revision: number; label: string | null; figures: boolean } | null;
  /** The type's own article whose specifications gave a figure the other two lack. */
  article: { title: string; revision: number } | null;
  role: TypeRole | null;
  /** The type's own history, from Wikidata: a page shows it when the type has no family's. */
  firstFlight: string | null;
  introduced: string | null;
  built: number | null;
}

export type TypePlanform = Planform & {
  checked: boolean;
  /** Drawn with the usual shape of its kind, as it has no family's (genericShape). */
  generic: boolean;
};

export interface TypeInfo {
  specs(code: string | null | undefined): TypeData | null;
  facts(familyId: string | null | undefined): FamilyFacts | null;
  /** The type's role: Wikidata's, else its family's, else what its engines and size make it most likely to be. */
  role(code: string, ref: RefIndex): TypeRole;
  /** What a type is drawn with, and whether its family is checked yet (G11); null without a shape, a length or a span. */
  planform(code: string | null | undefined, ref: RefIndex): TypePlanform | null;
  /** A family's type codes by generation, then model; codes it does not know keep their order, last. */
  inOrder(familyId: string, codes: string[]): string[];
}

/** The figures Wikidata may fill where Wikipedia's table gives none (the others Wikidata does not have). */
const FROM_WIKIDATA = ["lengthM", "spanM", "heightM", "mtowKg", "rangeKm", "cruiseKmh", "seatsMax", "engines"] as const;
/** The figures a type's own article's specifications may fill after both. */
const FROM_ARTICLE = ["lengthM", "spanM", "heightM", "mtowKg"] as const;

/**
 * A type's figures from its curated row (`s`), its Wikidata row (`w`) and its own article's specifications (`a`):
 * Wikipedia's curated ones first, Wikidata's where they have none, then the article's.
 */
export function mergeTypeData(code: string, s: TypeSpecs | undefined, w: TypeWikidata | undefined, a?: TypeWikipedia): TypeData | null {
  if (!s && !w && !a) return null;
  const filled = FROM_WIKIDATA.filter((k) => (s?.[k] ?? null) === null && (w?.[k] ?? null) !== null);
  const fromArticle = FROM_ARTICLE.filter((k) => (s?.[k] ?? w?.[k] ?? null) === null && (a?.[k] ?? null) !== null);
  return {
    designator: code,
    lengthM: s?.lengthM ?? w?.lengthM ?? a?.lengthM ?? null,
    spanM: s?.spanM ?? w?.spanM ?? a?.spanM ?? null,
    heightM: s?.heightM ?? w?.heightM ?? a?.heightM ?? null,
    fuselageWidthM: s?.fuselageWidthM ?? null,
    wingAreaM2: s?.wingAreaM2 ?? null,
    sweepDeg: s?.sweepDeg ?? null,
    mtowKg: s?.mtowKg ?? w?.mtowKg ?? a?.mtowKg ?? null,
    rangeKm: s?.rangeKm ?? w?.rangeKm ?? null,
    cruiseKmh: s?.cruiseKmh ?? w?.cruiseKmh ?? null,
    cruiseMach: s?.cruiseMach ?? null,
    seatsTypical: s?.seatsTypical ?? null,
    seatsMax: s?.seatsMax ?? w?.seatsMax ?? null,
    engines: s?.engines ?? w?.engines ?? null,
    wikipedia: s ? { article: s.article, revision: s.revision } : null,
    wikidata: w ? { item: w.item, revision: w.revision, label: w.label, figures: filled.length > 0 } : null,
    article: a && fromArticle.length ? { title: a.article, revision: a.revision } : null,
    role: w?.role ?? null,
    firstFlight: w?.firstFlight ?? null,
    introduced: w?.introduced ?? null,
    built: w?.built ?? null,
  };
}

let loaded: TypeInfo | null = null;
let loading: Promise<TypeInfo> | null = null;

export function loadTypeInfo(): Promise<TypeInfo> {
  loading ??= import("@touchdown/refdata/typeinfo").then((m) => {
    const specs = new Map(m.loadTypeSpecs().map((s) => [s.designator, s]));
    const wikidata = new Map(m.loadTypeWikidata().map((w) => [w.designator, w]));
    const articles = new Map(m.loadTypeWikipedia().map((a) => [a.designator, a]));
    const facts = new Map(m.loadFamilyFacts().map((f) => [f.familyId, f]));
    const merged = new Map<string, TypeData | null>();
    const data = (code: string) => {
      if (!merged.has(code)) merged.set(code, mergeTypeData(code, specs.get(code), wikidata.get(code), articles.get(code)));
      return merged.get(code)!;
    };
    // A span or a length to draw with where a type has none: another code's on the same wing, or as long.
    const borrow = (groups: string[][], value: (d: TypeData) => number | null) => {
      const groupOf = new Map(groups.flatMap((group) => group.map((c) => [c, group] as const)));
      return (code: string, own: number | null) => own ?? (groupOf.get(code) ?? []).map((c) => { const d = data(c); return d ? value(d) : null; }).find((x) => x !== null) ?? null;
    };
    const spanToDraw = borrow(m.sameWing, (d) => d.spanM);
    const lengthToDraw = borrow(m.sameBody, (d) => d.lengthM);
    // A family's role: the one most of its codes have on Wikidata.
    const familyRoles = new Map<string, TypeRole | null>();
    const familyRole = (familyId: string, ref: RefIndex): TypeRole | null => {
      if (!familyRoles.has(familyId)) {
        const n = new Map<TypeRole, number>();
        for (const t of ref.types.values()) {
          const r = t.familyId === familyId ? data(t.designator)?.role : null;
          if (r) n.set(r, (n.get(r) ?? 0) + 1);
        }
        familyRoles.set(familyId, [...n.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null);
      }
      return familyRoles.get(familyId)!;
    };
    const info: TypeInfo = {
      specs: (code) => (code ? data(code) : null),
      facts: (id) => (id ? (facts.get(id) ?? null) : null),
      role(code, ref) {
        const own = data(code)?.role;
        if (own) return own;
        const type = ref.type(code);
        if (!type) return "other";
        const fam = type.familyId ? familyRole(type.familyId, ref) : null;
        if (fam) return fam;
        if (m.shapeOf(type.familyId, code)?.kind === "helicopter") return "helicopter";
        // What a type of its engines and size most often is.
        // A small jet with one engine is a light aircraft (a glider's sustainer, a personal jet); business jets have two.
        if (type.engineType === "jet") return type.wtc !== "L" ? "airliner" : (type.engineCount ?? 1) >= 2 ? "business" : "light";
        if (type.engineType === "turboprop") return type.wtc === "L" ? "light" : "airliner";
        if (type.engineType === "piston" || type.engineType === "electric") return "light";
        return "other";
      },
      planform(code, ref) {
        if (!code) return null;
        const type = ref.type(code);
        if (!type) return null;
        const d = data(code);
        const own = m.shapeOf(type.familyId, code) as (SilhouetteShape & { checked: boolean }) | null;
        const span = spanToDraw(code, d?.spanM ?? null);
        const shape = own ?? m.genericShape({ engineType: type.engineType, engineCount: type.engineCount, wtc: type.wtc, role: info.role(code, ref), span });
        const length = lengthToDraw(code, d?.lengthM ?? null);
        // Every drawn type shows, checked or not (G11): a type's page says when its family is not checked yet.
        if (!shape || !length || !span) return null;
        // The fuselage's width and the sweep from the figures, else the shape's own, else what a type of its kind has.
        const width = d?.fuselageWidthM ?? shape.width ?? (shape.kind === "helicopter" ? length * 0.14 : length * 0.085);
        const sweep = d?.sweepDeg ?? shape.sweep ?? (shape.kind === "jet" ? 25 : 0);
        return { length, span, width, sweep, shape, checked: own?.checked ?? false, generic: !own };
      },
      inOrder(familyId, codes) {
        const order = m.familyOrder[familyId] ?? [];
        const rank = (c: string) => (order.includes(c) ? order.indexOf(c) : order.length + codes.indexOf(c));
        return [...codes].sort((a, b) => rank(a) - rank(b));
      },
    };
    loaded = info;
    return info;
  });
  return loading;
}

/** The types' information once loaded; null until then (the page draws without it first). */
export function useTypeInfo(): TypeInfo | null {
  const [info, setInfo] = useState(loaded);
  useEffect(() => {
    if (!info) void loadTypeInfo().then(setInfo);
  }, [info]);
  return info;
}
