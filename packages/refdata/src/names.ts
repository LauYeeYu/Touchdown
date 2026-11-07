// The reference data's names in the interface's other languages (docs/13, "Names in other languages"), loaded only for
// the language chosen. An entry of its own (`@touchdown/refdata/names`), so loading names does not load the tables.

import type { RefNames } from "../../core/src/ref/index.ts";

// Written by scripts/names.ts, so the shape is known: each airport's name and place, each operator's name. Each file
// comes through a module that imports it (names/<tag>.ts): a browser takes a JSON file imported at run time only as
// JSON, and the build serves it as a script.
const FILES: Record<string, () => Promise<{ default: unknown }>> = {
  "zh-CN": () => import("./names/zh-CN.ts"),
  "zh-TW": () => import("./names/zh-TW.ts"),
  "de-DE": () => import("./names/de-DE.ts"),
};

/** The names for a language, or null for one the data's own names are in (English). */
export async function loadRefNames(tag: string): Promise<RefNames | null> {
  const load = FILES[tag];
  if (!load) return null;
  const { airports, operators } = (await load()).default as RefNames;
  return { airports, operators };
}
