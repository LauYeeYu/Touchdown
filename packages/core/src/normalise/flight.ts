// Flight number, seat and fare class parsing (docs/20-validation.md, docs/01-existing-data.md).

const FLIGHT_NO_RE = /^([A-Z]{3}|[A-Z0-9]{2})(\d{1,4})([A-Z]?)$/;

export interface ParsedFlightNumber {
  value: string; // normalised: DL49, B6123
  designator: string; // DL, B6, DAL
  number: string; // 49, without leading zeros
  suffix: string;
}

export function parseFlightNumber(raw: string | null | undefined): ParsedFlightNumber | null {
  if (!raw) return null;
  const v = raw.trim().toUpperCase().replace(/\s+/g, "");
  const m = FLIGHT_NO_RE.exec(v);
  if (!m) return null;
  // A two-character designator is all digits only in odd data; "12" is not a designator.
  if (/^\d\d$/.test(m[1]!)) return null;
  const number = String(Number(m[2]));
  return { value: `${m[1]}${number}${m[3]}`, designator: m[1]!, number, suffix: m[3]! };
}

export function normaliseFlightNumber(raw: string | null | undefined): string | null {
  if (!raw) return null;
  return parseFlightNumber(raw)?.value ?? (raw.trim().toUpperCase().replace(/\s+/g, "") || null);
}

const SEAT_RE = /^(\d{1,3})([A-Z])$/;

export function normaliseSeat(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const v = raw.trim().toUpperCase().replace(/\s+/g, "");
  return v || null;
}

export function isSeatFormat(seat: string): boolean {
  return SEAT_RE.test(seat);
}

type Layout = string[]; // seat letters per block, left to right: ["ABC", "DEF"]

// Usual economy layouts by family, for the seat position guess. Marked as derived in the UI.
const LAYOUTS: Record<string, Layout> = {
  narrow33: ["ABC", "DEF"],
  a220: ["AC", "DEF"],
  e2x2: ["AC", "DF"],
  crj: ["AC", "DF"],
  w343: ["ABC", "DEFG", "HJK"],
  w333: ["ABC", "DEF", "GHK"],
  w242: ["AC", "DEFG", "HK"],
  w232: ["AB", "DEF", "JK"],
};

const FAMILY_LAYOUT: Record<string, keyof typeof LAYOUTS> = {
  A320: "narrow33",
  B737: "narrow33",
  B757: "narrow33",
  A220: "a220",
  E170: "e2x2",
  E175: "e2x2",
  E190: "e2x2",
  CRJ: "crj",
  B777: "w343",
  B747: "w343",
  A380: "w343",
  B787: "w333",
  A350: "w333",
  A330: "w242",
  A340: "w242",
  A300: "w242",
  B767: "w232",
};

/** Guess window / middle / aisle from the seat letter and the type's family. */
export function guessSeatPosition(seat: string | null | undefined, familyId: string | null): "window" | "middle" | "aisle" | null {
  if (!seat || !familyId) return null;
  const m = SEAT_RE.exec(seat.toUpperCase());
  if (!m) return null;
  const key = FAMILY_LAYOUT[familyId];
  if (!key) return null;
  const blocks = LAYOUTS[key]!;
  const letter = m[2]!;
  for (let b = 0; b < blocks.length; b++) {
    const block = blocks[b]!;
    const i = block.indexOf(letter);
    if (i < 0) continue;
    if ((b === 0 && i === 0) || (b === blocks.length - 1 && i === block.length - 1)) return "window";
    if (i === 0 || i === block.length - 1) return "aisle";
    return "middle";
  }
  return null;
}

export interface ParsedFareClass {
  bookingClass: string | null;
  fareBrand: string | null;
  cabinClass: "economy" | "premium_economy" | "business" | "first" | null;
}

/**
 * The flight log's "Class" column holds a booking class letter (K), a fare brand (Basic Economy), a fare
 * brand with the letter in parentheses (Main Cabin (L)), or a letter with the brand in parentheses (X (COACH)).
 */
export function parseFareClass(raw: string | null | undefined): ParsedFareClass {
  const empty: ParsedFareClass = { bookingClass: null, fareBrand: null, cabinClass: null };
  if (!raw) return empty;
  const v = raw.trim().replace(/\s+/g, " ");
  if (!v) return empty;
  let bookingClass: string | null = null;
  let fareBrand: string | null = null;
  let m: RegExpExecArray | null;
  if (/^[A-Za-z]$/.test(v)) bookingClass = v.toUpperCase();
  else if ((m = /^(.*?)\s*\(([A-Za-z])\)$/.exec(v))) {
    fareBrand = m[1]!.trim() || null;
    bookingClass = m[2]!.toUpperCase();
  } else if ((m = /^([A-Za-z])\s*\((.+)\)$/.exec(v))) {
    bookingClass = m[1]!.toUpperCase();
    fareBrand = m[2]!.trim();
  } else fareBrand = v;
  const text = (fareBrand ?? "").toLowerCase();
  const cabinClass = /\bfirst\b/.test(text)
    ? "first"
    : /\bbusiness\b|\bpolaris\b|\bdelta one\b/.test(text)
      ? "business"
      : /\bpremium\b/.test(text)
        ? "premium_economy"
        : "economy";
  return { bookingClass, fareBrand, cabinClass };
}
