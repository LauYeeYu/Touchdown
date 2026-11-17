// The aircraft types' figures, families' history and silhouettes (docs/13-reference-data.md, "Type figures",
// "Silhouettes"; @touchdown/refdata/typeinfo), loaded the first time a page needs them and kept for the tab.

import { useEffect, useState } from "react";
import type { FamilyFacts, RefIndex, SilhouetteShape, TypeRole, TypeSpecs, TypeWikidata, TypeWikipedia } from "@touchdown/core";
import type { WidthArticle } from "@touchdown/refdata/typeinfo";
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
  /** The family's type whose fuselage width this one shows, as its own figures give none; null when they give it. */
  widthFrom: string | null;
  /** The comparison article whose table gives the fuselage width, when neither the type's figures nor its family's do. */
  widthArticle: { title: string; revision: number } | null;
}

export type TypePlanform = Planform & {
  checked: boolean;
  /** Drawn with the usual shape of its kind, as it has no family's (genericShape). */
  generic: boolean;
};

export interface TypeInfo {
  specs(code: string | null | undefined): TypeData | null;
  facts(familyId: string | null | undefined): FamilyFacts | null;
  /**
   * The type's role: a curated one where Wikidata gives none or another, else Wikidata's, else a rotorcraft's by its
   * kind, else its family's, else what its engines and size make it most likely to be.
   */
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
  return s || w || a ? merge(code, s, w, a) : null;
}

/** A type without figures, for a table that lists it beside its family's: every figure empty. */
export const noFigures = (code: string): TypeData => merge(code, undefined, undefined, undefined);

function merge(code: string, s: TypeSpecs | undefined, w: TypeWikidata | undefined, a: TypeWikipedia | undefined): TypeData {
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
    widthFrom: null,
    widthArticle: null,
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
    const own = new Map<string, TypeData | null>();
    const ownData = (code: string) => {
      if (!own.has(code)) own.set(code, mergeTypeData(code, specs.get(code), wikidata.get(code), articles.get(code)));
      return own.get(code)!;
    };
    const { aircraftTypes } = m.loadTypeTables();
    const familyIdOf = new Map(aircraftTypes.map((t) => [t.designator, t.familyId] as const));
    const members = new Map<string, string[]>();
    for (const t of aircraftTypes) if (t.familyId) members.set(t.familyId, [...(members.get(t.familyId) ?? []), t.designator]);
    // The types sharing a type's fuselage: its family's, by generation, as a stretch lengthens a fuselage and does not
    // widen it. None in a family of separate models (ownBodies).
    const sameFuselage = (code: string): string[] => {
      const family = familyIdOf.get(code);
      return family && !m.ownBodies.includes(family) ? (m.familyOrder[family] ?? members.get(family) ?? []) : [];
    };
    // The fuselage width: the type's own, else the one most of its family's types give (the narrower of two as common,
    // as a freighter's widened body, the Dreamlifter's or the BelugaXL's, is the odd one), with the type giving it
    // nearest in length (the A320's for the A320neo), else its family's in a comparison table (docs/13, "Type figures").
    const widthOf = (code: string): { width: number; from: string | null; article: WidthArticle | null } | null => {
      const own = ownData(code)?.fuselageWidthM;
      if (own) return { width: own, from: null, article: null };
      const given = sameFuselage(code).flatMap((c) => {
        const w = ownData(c)?.fuselageWidthM;
        return w ? [{ width: w, from: c, article: null }] : [];
      });
      const count = (w: number) => given.filter((g) => g.width === w).length;
      const length = ownData(code)?.lengthM ?? null;
      const apart = (c: string) => (length === null ? 0 : Math.abs((ownData(c)?.lengthM ?? Infinity) - length));
      const shared = given.sort((a, b) => count(b.width) - count(a.width) || a.width - b.width || apart(a.from) - apart(b.from))[0];
      if (shared) return shared;
      const listed = m.comparisonWidths[familyIdOf.get(code) ?? code];
      return listed ? { width: listed.widthM, from: null, article: listed.from } : null;
    };
    const merged = new Map<string, TypeData | null>();
    const data = (code: string) => {
      if (!merged.has(code)) {
        const d = ownData(code);
        const w = d && d.fuselageWidthM === null ? widthOf(code) : null;
        merged.set(code, d && w ? { ...d, fuselageWidthM: w.width, widthFrom: w.from, widthArticle: w.article ? { title: w.article, revision: m.widthArticles[w.article] } : null } : d);
      }
      return merged.get(code)!;
    };
    // A span or a length to draw with where a type has none: one its article states in its text, else another code's
    // on the same wing, or as long.
    const borrow = (groups: string[][], value: (d: TypeData) => number | null, stated: (code: string) => number | undefined) => {
      const groupOf = new Map(groups.flatMap((group) => group.map((c) => [c, group] as const)));
      return (code: string, own: number | null) => own ?? stated(code) ?? (groupOf.get(code) ?? []).map((c) => { const d = data(c); return d ? value(d) : null; }).find((x) => x !== null) ?? null;
    };
    const spanToDraw = borrow(m.sameWing, (d) => d.spanM, (c) => m.statedSize[c]?.spanM);
    const lengthToDraw = borrow(m.sameBody, (d) => d.lengthM, (c) => m.statedSize[c]?.lengthM);
    // The length a fuselage width is worked out from where no type of the family gives one: the family's longest type's,
    // so its types are drawn equally wide (a small aircraft's fuselage is wider for its length than this makes it, and
    // the longest's is the least so), else the type's own.
    const lengthForWidth = (code: string, length: number) =>
      Math.max(length, ...sameFuselage(code).map((c) => lengthToDraw(c, data(c)?.lengthM ?? null) ?? 0));
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
        const own = m.typeRoles[code] ?? data(code)?.role;
        if (own) return own;
        const type = ref.type(code);
        if (!type) return "other";
        if (type.kind === "helicopter" || type.kind === "gyroplane" || type.kind === "tiltrotor") return "helicopter";
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
        if (!type || m.undrawable.includes(code)) return null;
        const d = data(code);
        const own = m.shapeOf(type.familyId, code) as (SilhouetteShape & { checked: boolean }) | null;
        const span = spanToDraw(code, d?.spanM ?? null);
        const length = lengthToDraw(code, d?.lengthM ?? null);
        const found = own ?? m.genericShape({ engineType: type.engineType, engineCount: type.engineCount, wtc: type.wtc, kind: type.kind, role: info.role(code, ref), span, length });
        const shape = found && m.clockwiseRotors.includes(code) ? { ...found, clockwise: true } : found;
        // Every drawn type shows, checked or not (G11): a type's page says when its family is not checked yet.
        if (!shape || !length || !span) return null;
        // The fuselage's width and the sweep from the figures (the width the family's), else the shape's own, else what a
        // type of its kind has.
        const width = widthOf(code)?.width ?? shape.width ?? lengthForWidth(code, length) * (shape.kind === "helicopter" ? 0.14 : 0.085);
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
