// The aircraft types as the types pages list them (docs/31-ui.md, "Aircraft types"): each curated family as one entry
// and every type code without a family as one of its own, under its manufacturer, with its roles, what the log has of it and
// when it first flew. Shared by the list, the manufacturers and a manufacturer's page.

import { useMemo } from "react";
import type { Family, RefIndex, TypeRole } from "@touchdown/core";
import { useApp } from "../data/context.tsx";
import { typeName } from "./format.ts";
import { familyTypes } from "./typeFigures.ts";
import { useTypeInfo, type TypeInfo } from "./typeInfo.ts";

/** How often the log has each type code: flights flown on it, sightings of it. */
export function useTypeCounts() {
  const { app, version } = useApp();
  return useMemo(() => {
    const flown = new Map<string, number>();
    const seen = new Map<string, number>();
    for (const f of app.store.all("flights")) if (f.typeCode) flown.set(f.typeCode, (flown.get(f.typeCode) ?? 0) + 1);
    for (const s of app.store.all("sightings")) if (s.typeCode) seen.set(s.typeCode, (seen.get(s.typeCode) ?? 0) + 1);
    return { flown, seen };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [app.store, version]);
}

export type TypeCounts = ReturnType<typeof useTypeCounts>;

export interface TypeEntry {
  /** The family's id, or the type code of a type without one. */
  key: string;
  family: Family | null;
  name: string;
  manufacturer: string;
  codes: string[];
  /** The type the entry opens: the one the log has most, else the first with figures, else the first. */
  main: string;
  /** The type it is drawn with: the main one, else the next most logged one that has a drawing. */
  drawn: string;
  roles: TypeRole[];
  flown: number;
  seen: number;
  /** When the family (its article) or the type (Wikidata) first flew: YYYY, YYYY-MM or YYYY-MM-DD. */
  firstFlight: string | null;
  /** Its names, manufacturer and codes, folded for a search. */
  text: string;
}

export interface TypeManufacturer {
  name: string;
  /** Its address on the site: /types/manufacturers/<slug>. */
  slug: string;
  entries: TypeEntry[];
  codes: number;
  families: number;
}

/**
 * Whether a code is an aircraft type with a page: not one of ICAO's codes for a group of aircraft without a designator of
 * their own (ZZZZ, GLID, BALL, ULAC and the like), which have no manufacturer.
 */
export function hasTypePage(ref: RefIndex, code: string | null | undefined): boolean {
  return !!ref.type(code)?.manufacturer;
}

/** Text for a search: no case, no accents, no spaces or hyphens. */
export const fold = (s: string) => s.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[\s-]+/g, "");

/** A manufacturer's address: its name in lower case, without accents, words joined by hyphens ("Aérospatiale-BAC" → "aerospatiale-bac"). */
export const manufacturerSlug = (name: string) =>
  name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

function entryOf(ref: RefIndex, info: TypeInfo | null, counts: TypeCounts, key: string, family: Family | null, name: string, manufacturer: string, codes: string[]): TypeEntry {
  const n = (c: string) => (counts.flown.get(c) ?? 0) + (counts.seen.get(c) ?? 0);
  const flown = codes.reduce((s, c) => s + (counts.flown.get(c) ?? 0), 0);
  const seen = codes.reduce((s, c) => s + (counts.seen.get(c) ?? 0), 0);
  const logged = [...codes].sort((a, b) => n(b) - n(a));
  const main = (flown + seen > 0 ? logged[0] : codes.find((c) => info?.specs(c)?.lengthM)) ?? codes[0]!;
  const drawn = family ? ([main, ...logged].find((c) => info?.planform(c, ref)) ?? main) : main;
  const roles = info ? [...new Set(codes.map((c) => info.role(c, ref)))] : [];
  const firstFlight = family ? (info?.facts(family.id)?.firstFlight ?? null) : (info?.specs(main)?.firstFlight ?? null);
  const text = fold([name, manufacturer, ...codes, ...codes.map((c) => typeName(c, ref))].join("|"));
  return { key, family, name, manufacturer, codes, main, drawn, roles, flown, seen, firstFlight, text };
}

/** Every entry, by manufacturer and name, and the manufacturers, by name. */
export function useTypeEntries(): { entries: TypeEntry[]; manufacturers: TypeManufacturer[] } {
  const { app } = useApp();
  const { ref } = app;
  const info = useTypeInfo();
  const counts = useTypeCounts();
  return useMemo(() => {
    const entries: TypeEntry[] = [];
    for (const fam of ref.families.values()) {
      const codes = familyTypes(ref, fam.id, info);
      if (codes.length) entries.push(entryOf(ref, info, counts, fam.id, fam, fam.name, fam.manufacturer, codes));
    }
    for (const type of ref.types.values()) {
      if ((type.familyId && ref.family(type.familyId)) || !hasTypePage(ref, type.designator)) continue;
      entries.push(entryOf(ref, info, counts, type.designator, null, typeName(type.designator, ref), type.manufacturer, [type.designator]));
    }
    entries.sort((a, b) => a.manufacturer.localeCompare(b.manufacturer) || a.name.localeCompare(b.name));
    const byManufacturer = new Map<string, TypeManufacturer>();
    for (const e of entries) {
      const m = byManufacturer.get(e.manufacturer) ?? byManufacturer.set(e.manufacturer, { name: e.manufacturer, slug: manufacturerSlug(e.manufacturer), entries: [], codes: 0, families: 0 }).get(e.manufacturer)!;
      m.entries.push(e);
      m.codes += e.codes.length;
      if (e.family) m.families++;
    }
    return { entries, manufacturers: [...byManufacturer.values()] };
  }, [ref, info, counts]);
}
