// An aircraft type's figures as the type pages show them (docs/31-ui.md, "Aircraft types"): each with its label, its
// value (a range in nautical miles and a speed in knots, as aviation gives them, whatever unit the log's distances are
// in), the same in other units for its tooltip, and the difference between two types, for a family's table and for
// Compare.

import type { RefIndex } from "@touchdown/core";
import { locale, t } from "@touchdown/i18n";
import { distance, nf } from "./format.ts";
import type { TypeData, TypeInfo } from "./typeInfo.ts";

const MINUS = "−";
// Up to one or two decimals, in the interface's language, made once a language.
const formats = new Map<string, Intl.NumberFormat>();
const decimals = (digits: number) => ({
  format: (n: number) => {
    const key = `${locale()}|${digits}`;
    let f = formats.get(key);
    if (!f) formats.set(key, (f = new Intl.NumberFormat(locale(), { maximumFractionDigits: digits })));
    return f.format(n);
  },
});
const n1 = decimals(1);
const n2 = decimals(2);

export const metres = (m: number) => t("format.measure.m", { n: n2.format(m) });
/** "35–38.71 m": two lengths with the unit once. */
export const metresBetween = (lo: number, hi: number) => t("format.measure.m", { n: t("aircraft.types.between", { low: n2.format(lo), high: n2.format(hi) }) });
/** A weight: tonnes from 10 t (or always, as `tonnes` says, so a difference is in the unit of its figures), else kilograms. */
export const weight = (kg: number, tonnes = kg >= 10_000) => (tonnes ? t("format.measure.t", { n: n1.format(kg / 1000) }) : t("format.measure.kg", { n: nf.format(Math.round(kg)) }));
/** A speed in knots. */
export const knots = (kmh: number) => t("format.measure.kt", { n: nf.format(Math.round(kmh / 1.852)) });
/** A distance in nautical miles. */
const nautical = (km: number) => distance(km, "nm");

// The other units a figure is given in: feet and inches, pounds, kilometres and miles, km/h and mph, square feet.
const INCH_M = 0.0254;
const POUND_KG = 0.45359237;
const MILE_KM = 1.609344;
/** "250 ft 2 in", "64 ft". */
export function feetInches(m: number): string {
  const inches = Math.round(m / INCH_M);
  const [ft, inch] = [Math.floor(inches / 12), inches % 12];
  return inch ? t("format.measure.ftIn", { ft: nf.format(ft), in: inch }) : t("format.measure.ft", { n: nf.format(ft) });
}
/** To four significant figures, no finer than a whole one: a weight converted from kilograms (447,696 kg is 987,000 lb, not 987,001) claims no more than its tonnes do. */
const fourFigures = (v: number) => {
  const step = 10 ** Math.max(0, Math.floor(Math.log10(Math.abs(v) || 1)) - 3);
  return Math.round(v / step) * step;
};
const pounds = (kg: number) => t("format.measure.lb", { n: nf.format(fourFigures(kg / POUND_KG)) });
const kmh = (v: number) => t("format.measure.kmh", { n: nf.format(Math.round(v)) });
const mph = (v: number) => t("format.measure.mph", { n: nf.format(Math.round(v / MILE_KM)) });
const squareFeet = (m2: number) => t("format.measure.sqft", { n: nf.format(Math.round(m2 / (12 * INCH_M) ** 2)) });

/** A figure (in its stored unit) in the units the page does not show it in; `tonnes` when it is shown in tonnes. */
function otherUnits(key: TypeFigure["key"], v: number, tonnes: boolean): string[] {
  switch (key) {
    case "mtow":
      return tonnes ? [t("format.measure.kg", { n: nf.format(Math.round(v)) }), pounds(v)] : [pounds(v)];
    case "length":
    case "span":
    case "height":
    case "width":
      return [feetInches(v)];
    case "range":
      return [distance(v, "km"), distance(v, "mi")];
    case "speed":
      return [kmh(v), mph(v)];
    case "area":
      return [squareFeet(v)];
    default:
      return [];
  }
}

export interface TypeFigure {
  key: "length" | "span" | "height" | "width" | "mtow" | "range" | "seats" | "speed" | "area" | "sweep";
  label: string;
  /** The figure as a number to compare with another type's, in its stored unit. */
  value: (s: TypeData) => number | null;
  text: (s: TypeData) => string | null;
  /** The difference from another type's figure (`d`, `from` it), signed, in the figure's unit. */
  diff: (d: number, from: number) => string;
  /** The figure in other units, for its tooltip: "250 ft 2 in"; "14,310 km", "8,892 mi". None for seats and sweep. */
  others: (s: TypeData) => string[];
  /** The same of a difference, signed: "+18 ft 4 in". */
  diffOthers: (d: number, from: number) => string[];
}

// "=" where the difference rounds to nothing in the figure's unit (351.5 t and 351.534 t).
const signed = (d: number, text: (abs: number) => string) => {
  const shown = text(Math.abs(d));
  return shown === text(0) ? "=" : `${d > 0 ? "+" : MINUS}${shown}`;
};

/** The figures, in the order the pages show them. A helicopter's span is its rotor's diameter. */
export function typeFigures(helicopter = false): TypeFigure[] {
  const figures: Omit<TypeFigure, "others" | "diffOthers">[] = [
    { key: "mtow", label: t("aircraft.types.figure.mtow"), value: (s) => s.mtowKg, text: (s) => (s.mtowKg ? weight(s.mtowKg) : null), diff: (d, from) => signed(d, (abs) => weight(abs, from >= 10_000)) },
    { key: "length", label: t("aircraft.types.figure.length"), value: (s) => s.lengthM, text: (s) => (s.lengthM ? metres(s.lengthM) : null), diff: (d) => signed(d, metres) },
    { key: "span", label: t("aircraft.types.figure.span", { rotor: helicopter ? "yes" : "no" }), value: (s) => s.spanM, text: (s) => (s.spanM ? metres(s.spanM) : null), diff: (d) => signed(d, metres) },
    { key: "height", label: t("aircraft.types.figure.height"), value: (s) => s.heightM, text: (s) => (s.heightM ? metres(s.heightM) : null), diff: (d) => signed(d, metres) },
    { key: "width", label: t("aircraft.types.figure.width"), value: (s) => s.fuselageWidthM, text: (s) => (s.fuselageWidthM ? metres(s.fuselageWidthM) : null), diff: (d) => signed(d, metres) },
    { key: "range", label: t("aircraft.types.figure.range"), value: (s) => s.rangeKm, text: (s) => (s.rangeKm ? nautical(s.rangeKm) : null), diff: (d) => signed(d, nautical) },
    {
      key: "seats",
      label: t("aircraft.types.figure.seats"),
      value: (s) => s.seatsTypical ?? s.seatsMax,
      text: (s) => (s.seatsTypical ? (s.seatsMax && s.seatsMax !== s.seatsTypical ? t("aircraft.types.seats.upTo", { typical: s.seatsTypical, max: s.seatsMax }) : nf.format(s.seatsTypical)) : s.seatsMax ? t("aircraft.types.seats.max", { max: s.seatsMax }) : null),
      diff: (d) => signed(d, (abs) => nf.format(abs)),
    },
    {
      key: "speed",
      label: t("aircraft.types.figure.speed"),
      value: (s) => s.cruiseKmh,
      text: (s) => (s.cruiseMach && s.cruiseKmh ? `${t("format.measure.mach", { n: s.cruiseMach })} · ${knots(s.cruiseKmh)}` : s.cruiseMach ? t("format.measure.mach", { n: s.cruiseMach }) : s.cruiseKmh ? knots(s.cruiseKmh) : null),
      diff: (d) => signed(d, knots),
    },
    { key: "area", label: t("aircraft.types.figure.area"), value: (s) => s.wingAreaM2, text: (s) => (s.wingAreaM2 ? t("format.measure.m2", { n: nf.format(Math.round(s.wingAreaM2)) }) : null), diff: (d) => signed(d, (abs) => t("format.measure.m2", { n: nf.format(Math.round(abs)) })) },
    { key: "sweep", label: t("aircraft.types.figure.sweep"), value: (s) => s.sweepDeg, text: (s) => (s.sweepDeg !== null ? t("format.measure.deg", { n: n1.format(s.sweepDeg) }) : null), diff: (d) => signed(d, (abs) => t("format.measure.deg", { n: n1.format(abs) })) },
  ];
  return figures.map((x) => ({
    ...x,
    // A speed's figure is its Mach number or its speed in km/h, and only the latter has other units.
    others: (s) => {
      const v = x.key === "speed" ? s.cruiseKmh : x.value(s);
      return v ? otherUnits(x.key, v, v >= 10_000) : [];
    },
    // A difference that rounds to nothing has none, and its sign goes before each.
    diffOthers: (d, from) => (x.diff(d, from) === "=" ? [] : otherUnits(x.key, Math.abs(d), from >= 10_000).map((o) => `${d > 0 ? "+" : MINUS}${o}`)),
  }));
}

/** A family's type codes, by generation, then model, once the types' information is loaded. */
export function familyTypes(ref: RefIndex, familyId: string, info: TypeInfo | null): string[] {
  const codes = [...ref.types.values()].filter((x) => x.familyId === familyId).map((x) => x.designator);
  return info ? info.inOrder(familyId, codes) : codes;
}

/** "37.6–44.5 m": the smallest and largest of a figure across types, or one value; `between` writes the two. */
export function spanOf(values: (number | null)[], text: (n: number) => string, between?: (lo: number, hi: number) => string): string | null {
  const v = values.filter((x): x is number => x !== null && x > 0);
  if (!v.length) return null;
  const [lo, hi] = [Math.min(...v), Math.max(...v)];
  return lo === hi ? text(lo) : between ? between(lo, hi) : t("aircraft.types.between", { low: text(lo), high: text(hi) });
}
