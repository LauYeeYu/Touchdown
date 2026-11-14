// The aircraft types' figures (from Wikipedia and Wikidata), their families' history and the shapes their silhouettes
// are drawn with (docs/13-reference-data.md, "Type figures", "Silhouettes"). A module of its own, loaded the first time
// a page needs it (the type pages, the aircraft list's silhouettes), so the app's first load does not carry it.

import {
  rowsToObjects,
  type AircraftType,
  type Family,
  type FamilyFacts,
  type RefTableFile,
  type TypeSpecs,
  type TypeWikidata,
  type TypeWikipedia,
} from "../../core/src/ref/types.ts";
import specs from "../data/type_specs.json" with { type: "json" };
import wikidata from "../data/type_wikidata.json" with { type: "json" };
import wikipedia from "../data/type_wikipedia.json" with { type: "json" };
import facts from "../data/family_facts.json" with { type: "json" };
import aircraftTypes from "../data/aircraft_types.json" with { type: "json" };
import families from "../data/families.json" with { type: "json" };

export { familyShapes, genericShape, sameBody, sameWing, shapeOf, statedSize, type TypeKind } from "./curated/silhouettes.ts";
export { familyOrder } from "./curated/type-order.ts";

export function loadTypeSpecs(): TypeSpecs[] {
  return rowsToObjects(specs as RefTableFile);
}

/**
 * Every type code's figures from Wikidata, where an item could be matched: for the codes without curated figures, and
 * to fill what the curated ones lack.
 */
export function loadTypeWikidata(): TypeWikidata[] {
  return rowsToObjects(wikidata as RefTableFile);
}

/**
 * The figures that the specifications template of a type code's English Wikipedia article states, for the codes that
 * neither the curated figures nor Wikidata give a length and a span.
 */
export function loadTypeWikipedia(): TypeWikipedia[] {
  return rowsToObjects(wikipedia as RefTableFile);
}

/**
 * The type codes and their families alone, for the public types pages (docs/31, "Aircraft types"), which need nothing
 * else of the reference data: the app has them with the rest (index.ts).
 */
export function loadTypeTables(): { aircraftTypes: AircraftType[]; families: Family[] } {
  return { aircraftTypes: rowsToObjects(aircraftTypes as RefTableFile), families: rowsToObjects(families as RefTableFile) };
}

export function loadFamilyFacts(): FamilyFacts[] {
  return rowsToObjects(facts as RefTableFile);
}

/** The figures' attribution line and the date they were read. */
export const typeSpecsSource = { sources: (specs as RefTableFile).sources, version: (specs as RefTableFile).version };

/** The Wikidata figures' attribution line and the date they were read. */
export const typeWikidataSource = { sources: (wikidata as RefTableFile).sources, version: (wikidata as RefTableFile).version };

/** The attribution line of the figures from the articles' specifications templates, and the date they were read. */
export const typeWikipediaSource = { sources: (wikipedia as RefTableFile).sources, version: (wikipedia as RefTableFile).version };
