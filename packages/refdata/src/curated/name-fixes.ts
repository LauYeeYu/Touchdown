// Names Wikidata has wrong for a row of the reference tables, put right when the names are built (scripts/names.ts,
// docs/13, "Names in other languages"). A name replaces Wikidata's, null drops it so the English name shows. Keyed by
// the row's id. Add one with the source that shows the right name, or the reason, beside it.

export type NameFixes = Partial<
  Record<"zh-CN" | "zh-TW" | "de-DE", { airports?: Record<string, [string | null, string | null] | null>; operators?: Record<string, string | null> }>
>;

export const nameFixes: NameFixes = {
  "zh-CN": {
    operators: {
      // Andes Líneas Aéreas (Q491770): Wikidata's Chinese label is Austral Líneas Aéreas'.
      op_ans: "安第斯航空",
    },
  },
  "zh-TW": {
    operators: {
      op_ans: "安地斯航空",
    },
  },
};
