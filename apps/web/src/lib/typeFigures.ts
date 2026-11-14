// An aircraft type's figures as the type pages show them (docs/31-ui.md, "Aircraft types"): each with its label, its
// value (a range in nautical miles and a speed in knots, as aviation gives them, whatever unit the log's distances are
// in), and the difference between two types, for a family's table and for Compare.

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

export interface TypeFigure {
  key: "length" | "span" | "height" | "mtow" | "range" | "seats" | "speed" | "area" | "sweep";
  label: string;
  /** The figure as a number to compare with another type's, in its stored unit. */
  value: (s: TypeData) => number | null;
  text: (s: TypeData) => string | null;
  /** The difference from another type's figure (`d`, `from` it), signed, in the figure's unit. */
  diff: (d: number, from: number) => string;
}

// "=" where the difference rounds to nothing in the figure's unit (351.5 t and 351.534 t).
const signed = (d: number, text: (abs: number) => string) => {
  const shown = text(Math.abs(d));
  return shown === text(0) ? "=" : `${d > 0 ? "+" : MINUS}${shown}`;
};

/** The figures, in the order the pages show them. A helicopter's span is its rotor's diameter. */
export function typeFigures(helicopter = false): TypeFigure[] {
  return [
    { key: "mtow", label: t("aircraft.types.figure.mtow"), value: (s) => s.mtowKg, text: (s) => (s.mtowKg ? weight(s.mtowKg) : null), diff: (d, from) => signed(d, (abs) => weight(abs, from >= 10_000)) },
    { key: "length", label: t("aircraft.types.figure.length"), value: (s) => s.lengthM, text: (s) => (s.lengthM ? metres(s.lengthM) : null), diff: (d) => signed(d, metres) },
    { key: "span", label: t("aircraft.types.figure.span", { rotor: helicopter ? "yes" : "no" }), value: (s) => s.spanM, text: (s) => (s.spanM ? metres(s.spanM) : null), diff: (d) => signed(d, metres) },
    { key: "height", label: t("aircraft.types.figure.height"), value: (s) => s.heightM, text: (s) => (s.heightM ? metres(s.heightM) : null), diff: (d) => signed(d, metres) },
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
