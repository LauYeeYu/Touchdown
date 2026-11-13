// The aircraft types' figures, families' history and silhouettes (docs/13-reference-data.md, "Type figures",
// "Silhouettes"; @touchdown/refdata/typeinfo), loaded the first time a page needs them and kept for the tab.

import { useEffect, useState } from "react";
import type { FamilyFacts, RefIndex, SilhouetteShape, TypeSpecs } from "@touchdown/core";
import type { Planform } from "./silhouette.ts";

export interface TypeInfo {
  specs(code: string | null | undefined): TypeSpecs | null;
  facts(familyId: string | null | undefined): FamilyFacts | null;
  /** What a type is drawn with, and whether its family is checked yet (G11); null with no shape for its family, or no length or span. */
  planform(code: string | null | undefined, ref: RefIndex): (Planform & { checked: boolean }) | null;
  /** A family's type codes by generation, then model; codes it does not know keep their order, last. */
  inOrder(familyId: string, codes: string[]): string[];
  /** When the figures were read, and their attribution. */
  source: { sources: string[]; version: string };
}

let loaded: TypeInfo | null = null;
let loading: Promise<TypeInfo> | null = null;

export function loadTypeInfo(): Promise<TypeInfo> {
  loading ??= import("@touchdown/refdata/typeinfo").then((m) => {
    const specs = new Map(m.loadTypeSpecs().map((s) => [s.designator, s]));
    const facts = new Map(m.loadFamilyFacts().map((f) => [f.familyId, f]));
    // A span or a length to draw with where a type's article gives none: another code's on the same wing, or as long.
    const borrow = (groups: string[][], value: (s: TypeSpecs) => number | null) => {
      const groupOf = new Map(groups.flatMap((group) => group.map((c) => [c, group] as const)));
      return (code: string, own: number | null) => own ?? (groupOf.get(code) ?? []).map((c) => { const s = specs.get(c); return s ? value(s) : null; }).find((x) => x !== null) ?? null;
    };
    const spanToDraw = borrow(m.sameWing, (s) => s.spanM);
    const lengthToDraw = borrow(m.sameBody, (s) => s.lengthM);
    const info: TypeInfo = {
      specs: (code) => (code ? (specs.get(code) ?? null) : null),
      facts: (id) => (id ? (facts.get(id) ?? null) : null),
      planform(code, ref) {
        if (!code) return null;
        const s = specs.get(code);
        const shape = m.shapeOf(ref.type(code)?.familyId, code) as (SilhouetteShape & { checked: boolean }) | null;
        const span = s ? spanToDraw(code, s.spanM) : null;
        const length = s ? lengthToDraw(code, s.lengthM) : null;
        // Every drawn type shows, checked or not (G11): a type's page says when its family is not checked yet.
        if (!s || !shape || !length || !span) return null;
        // The fuselage's width and the sweep from the figures, else the shape's own, else what a type of its kind has.
        const width = s.fuselageWidthM ?? shape.width ?? (shape.kind === "helicopter" ? length * 0.14 : length * 0.085);
        const sweep = s.sweepDeg ?? shape.sweep ?? (shape.kind === "jet" ? 25 : 0);
        return { length, span, width, sweep, shape, checked: shape.checked };
      },
      inOrder(familyId, codes) {
        const order = m.familyOrder[familyId] ?? [];
        const rank = (c: string) => (order.includes(c) ? order.indexOf(c) : order.length + codes.indexOf(c));
        return [...codes].sort((a, b) => rank(a) - rank(b));
      },
      source: m.typeSpecsSource,
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
