// The aircraft types as the types pages list them (docs/31-ui.md, "Aircraft types"): each curated family of more than one
// type as one entry, and every other type code as one of its own, a family of one type included, under its manufacturer,
// with its roles, what the log has of it and when it first flew; and each type of a family as an entry of its own too,
// which a search lists above its family. Shared by the list, the manufacturers and a manufacturer's page.

import { useMemo } from "react";
import { withoutAccents, type Family, type RefIndex, type TypeRole } from "@touchdown/core";
import { searchFold, searchMatcher, searchText } from "@touchdown/core/view";
import { useApp } from "../data/context.tsx";
import { typeName } from "./format.ts";
import { familyTypes } from "./typeFigures.ts";
import { useTypeInfo, type TypeInfo } from "./typeInfo.ts";

/** How often the log has each type code: flights flown on it, sightings of it. */
export function useTypeCounts(): TypeCounts {
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

export interface TypeCounts {
  flown: Map<string, number>;
  seen: Map<string, number>;
}

export interface TypeEntry {
  /** The family's id, or the type code of a type without one or of a family's only type. */
  key: string;
  /** A family of more than one type. A family's only type is an entry of a type, with its family's history. */
  family: Family | null;
  name: string;
  manufacturer: string;
  codes: string[];
  /** Its main type: the one the log has most, else the first with figures, else the first. A type's row opens it. */
  main: string;
  /** The type it is drawn with: the main one, else the next most logged one that has a drawing. */
  drawn: string;
  /** The type it is drawn with whatever the log has: its first with figures, else the next one that has a drawing. */
  usual: string;
  roles: TypeRole[];
  flown: number;
  seen: number;
  /** When the family (its article) or the type (its family's article, else Wikidata) first flew: YYYY, YYYY-MM or YYYY-MM-DD. */
  firstFlight: string | null;
  /** Its names, manufacturer, family and codes, and the names its types go by, as a search reads them (`searchText`). */
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

/** Names in order, numbers in them by value: the 717 before the 727, the C-17 before the C-135. */
export const byName = new Intl.Collator(undefined, { numeric: true }).compare;

/**
 * The names a type code goes by, for a search: its code, its ICAO name with its maker, and the titles its figures'
 * sources give it, Wikipedia's article and Wikidata's item, such as "Boeing 777X" for the 777-9 and "Boeing 787
 * Dreamliner" for the 787-8.
 */
export function typeNames(code: string, ref: RefIndex, info: TypeInfo | null): string[] {
  const s = info?.specs(code);
  return [code, typeName(code, ref), s?.wikipedia?.article, s?.article?.title, s?.wikidata?.label].filter((n): n is string => !!n);
}

/** The only type of a family of one type, whose page stands for the family's (docs/31): null for another family. */
export function onlyType(ref: RefIndex, familyId: string): string | null {
  const codes = familyTypes(ref, familyId, null);
  return codes.length === 1 ? codes[0]! : null;
}

/**
 * A manufacturer's or a family's address: its name in lower case, without accents, words joined by hyphens
 * ("Aérospatiale-BAC" → "aerospatiale-bac", "Boeing 737" → "boeing-737").
 */
export const slugOf = (name: string) =>
  withoutAccents(name)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

/** An entry: a family's when `family` is given, else a type's, `of` the family of one type it is (for its history and a search). */
function entryOf(ref: RefIndex, info: TypeInfo | null, counts: TypeCounts, key: string, family: Family | null, name: string, manufacturer: string, codes: string[], of?: Family): TypeEntry {
  const n = (c: string) => (counts.flown.get(c) ?? 0) + (counts.seen.get(c) ?? 0);
  const flown = codes.reduce((s, c) => s + (counts.flown.get(c) ?? 0), 0);
  const seen = codes.reduce((s, c) => s + (counts.seen.get(c) ?? 0), 0);
  const logged = [...codes].sort((a, b) => n(b) - n(a));
  const first = codes.find((c) => info?.specs(c)?.lengthM) ?? codes[0]!;
  const main = flown + seen > 0 ? logged[0]! : first;
  // A family is drawn by the first of these that has a drawing.
  const drawable = (lead: string, rest: string[]) => (family ? ([lead, ...rest].find((c) => info?.planform(c, ref)) ?? lead) : lead);
  const drawn = drawable(main, logged);
  const usual = drawable(first, codes);
  const roles = info ? [...new Set(codes.map((c) => info.role(c, ref)))] : [];
  const firstFlight = family ? (info?.facts(family.id)?.firstFlight ?? null) : ((of && info?.facts(of.id)?.firstFlight) ?? info?.specs(main)?.firstFlight ?? null);
  const text = searchText([name, manufacturer, family?.id, of?.name, of?.id, ...codes.flatMap((c) => typeNames(c, ref, info))]);
  return { key, family, name, manufacturer, codes, main, drawn, usual, roles, flown, seen, firstFlight, text };
}

export interface TypeEntries {
  entries: TypeEntry[];
  manufacturers: TypeManufacturer[];
  /** A family's types, each an entry of its own (keyed "type:<code>", leading to the type), by the family's id, in order. */
  members: Map<string, TypeEntry[]>;
}

/** Every entry, by manufacturer and name, the manufacturers, by name, and the types of each family of more than one. */
export function typeEntries(ref: RefIndex, info: TypeInfo | null, counts: TypeCounts): TypeEntries {
  const entries: TypeEntry[] = [];
  const members = new Map<string, TypeEntry[]>();
  for (const fam of ref.families.values()) {
    const codes = familyTypes(ref, fam.id, info);
    if (!codes.length) continue;
    // A family of one type is that type in these pages, its row leading to the type's page.
    if (codes.length === 1) {
      entries.push(entryOf(ref, info, counts, codes[0]!, null, typeName(codes[0]!, ref), fam.manufacturer, codes, fam));
      continue;
    }
    entries.push(entryOf(ref, info, counts, fam.id, fam, fam.name, fam.manufacturer, codes));
    members.set(
      fam.id,
      codes.map((c) => entryOf(ref, info, counts, `type:${c}`, null, typeName(c, ref), fam.manufacturer, [c])),
    );
  }
  for (const type of ref.types.values()) {
    if ((type.familyId && ref.family(type.familyId)) || !hasTypePage(ref, type.designator)) continue;
    entries.push(entryOf(ref, info, counts, type.designator, null, typeName(type.designator, ref), type.manufacturer, [type.designator]));
  }
  entries.sort((a, b) => byName(a.manufacturer, b.manufacturer) || byName(a.name, b.name));
  const byManufacturer = new Map<string, TypeManufacturer>();
  for (const e of entries) {
    const m = byManufacturer.get(e.manufacturer) ?? byManufacturer.set(e.manufacturer, { name: e.manufacturer, slug: slugOf(e.manufacturer), entries: [], codes: 0, families: 0 }).get(e.manufacturer)!;
    m.entries.push(e);
    m.codes += e.codes.length;
    if (e.family) m.families++;
  }
  return { entries, manufacturers: [...byManufacturer.values()], members };
}

/**
 * The entries a search finds: each family it finds, after the types of it the search names, the more precise answer
 * first, each leading to its page ("748" finds the 747-8, then the Boeing 747). A search for the family's own name finds
 * the family alone ("747"), but for the code typed whole ("A320"). `keep` is the page's other filters, for the types as
 * for the families.
 */
export function searched(all: TypeEntries, query: string, keep: (e: TypeEntry) => boolean): TypeEntry[] {
  const found = searchMatcher(query);
  if (!found) return all.entries.filter(keep);
  const whole = searchFold(query);
  return all.entries
    .filter((e) => keep(e) && found(e.text))
    .flatMap((e) => {
      if (!e.family) return [e];
      const ownName = found(searchText([e.name, e.family.id]));
      const named = (all.members.get(e.key) ?? []).filter((m) => found(m.text) && (!ownName || searchFold(m.main) === whole));
      return [...named.filter(keep), e];
    });
}

/** typeEntries for the page, with the log's counts, made again when the log or the types' information changes. */
export function useTypeEntries(): TypeEntries {
  const { app } = useApp();
  const info = useTypeInfo();
  const counts = useTypeCounts();
  return useMemo(() => typeEntries(app.ref, info, counts), [app.ref, info, counts]);
}
