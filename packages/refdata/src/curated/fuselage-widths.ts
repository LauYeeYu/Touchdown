// Fuselage widths for the families whose types' own figures give none (docs/13-reference-data.md, "Type figures"): from
// the "Fuselage width" column of the comparison tables in English Wikipedia's "Wide-body aircraft" and "Narrow-body
// aircraft", at the revisions below. Every type of the family shows it, as a family's types share their fuselage.
// A family where one type's figures give a width takes that instead (apps/web/src/lib/typeInfo.ts). Each entry names
// its row in the table; a value the table gives once for several rows is each row's.

/** The articles the widths come from, and the revision each was read at. */
export const widthArticles = {
  "Wide-body aircraft": 1384434532,
  "Narrow-body aircraft": 1384692038,
} as const;

export type WidthArticle = keyof typeof widthArticles;

/** By family, or by type code for a type without a family: the width in metres and the article it is from. */
export const comparisonWidths: Record<string, { widthM: number; from: WidthArticle }> = {
  A350: { widthM: 5.96, from: "Wide-body aircraft" }, // "Airbus A350"
  A380: { widthM: 7.14, from: "Wide-body aircraft" }, // "Airbus A380"
  L1011: { widthM: 6.02, from: "Wide-body aircraft" }, // "Lockheed L-1011"
  IL86: { widthM: 6.08, from: "Wide-body aircraft" }, // "Ilyushin Il-86"
  B727: { widthM: 3.76, from: "Narrow-body aircraft" }, // "Boeing 727", one cell with the 707, 737 and 757
  Tu154: { widthM: 3.8, from: "Narrow-body aircraft" }, // "Tupolev Tu-154"
  T334: { widthM: 3.8, from: "Narrow-body aircraft" }, // "Tupolev Tu-334", one cell with the Tu-154
  YK42: { widthM: 3.8, from: "Narrow-body aircraft" }, // "Yakovlev Yak-42", one cell with the Tu-154
  IL62: { widthM: 3.8, from: "Narrow-body aircraft" }, // "Ilyushin Il-62"
  VC10: { widthM: 3.75, from: "Narrow-body aircraft" }, // "Vickers VC10"
  F28: { widthM: 3.3, from: "Narrow-body aircraft" }, // "Fokker F28/Fokker 70/Fokker 100"
  T144: { widthM: 3.3, from: "Narrow-body aircraft" }, // "Tupolev Tu-144"
  B717: { widthM: 3.343, from: "Narrow-body aircraft" }, // "McDonnell Douglas DC-9/MD-80/MD-90/Boeing 717"
  MD80: { widthM: 3.343, from: "Narrow-body aircraft" }, // the same row
  An148: { widthM: 3.35, from: "Narrow-body aircraft" }, // "Antonov An-148/An-158"
  ARJ21: { widthM: 3.36, from: "Narrow-body aircraft" }, // "Comac C909", the ARJ21's name since 2024
  IL18: { widthM: 3.51, from: "Narrow-body aircraft" }, // "Ilyushin Il-18"
  BAe146: { widthM: 3.5, from: "Narrow-body aircraft" }, // "British Aerospace 146"
  YK40: { widthM: 2.4, from: "Narrow-body aircraft" }, // "Yakovlev Yak-40"
  ATR42: { widthM: 2.73, from: "Narrow-body aircraft" }, // "ATR 42/ATR 72"
  ATR72: { widthM: 2.73, from: "Narrow-body aircraft" }, // the same row
  T134: { widthM: 2.9, from: "Narrow-body aircraft" }, // "Tupolev Tu-124/Tu-134"
  I114: { widthM: 2.64, from: "Narrow-body aircraft" }, // "Ilyushin Il-114"
  E170: { widthM: 3.01, from: "Narrow-body aircraft" }, // "Embraer E-Jet/E-Jet E2"
  E175: { widthM: 3.01, from: "Narrow-body aircraft" }, // the same row
  E190: { widthM: 3.01, from: "Narrow-body aircraft" }, // the same row
  E195: { widthM: 3.01, from: "Narrow-body aircraft" }, // the same row
  DHC6: { widthM: 1.75, from: "Narrow-body aircraft" }, // "de Havilland Canada DHC-6 Twin Otter"
  E120: { widthM: 2.28, from: "Narrow-body aircraft" }, // "Embraer EMB 120"
  E145: { widthM: 2.28, from: "Narrow-body aircraft" }, // "Embraer ERJ 145 family"
  SF34: { widthM: 2.31, from: "Narrow-body aircraft" }, // "Saab 340/Saab 2000"
  SB20: { widthM: 2.31, from: "Narrow-body aircraft" }, // the same row
};
