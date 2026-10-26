// Registration normalisation (docs/11-aircraft-identity.md, "Normalising a registration").

import type { RefIndex } from "../ref/index.ts";

export interface NormalisedRegistration {
  display: string; // with the country's dash: B-1234, N123AB, D-ABCD
  match: string; // letters and digits only: B1234, N123AB, DABCD
  country: string | null; // ISO alpha-2 from the prefix
  knownFormat: boolean; // false raises V-REG-FORMAT
}

export function registrationMatchForm(s: string): string {
  return s.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export function normaliseRegistration(raw: string | null | undefined, ref: RefIndex): NormalisedRegistration | null {
  if (!raw) return null;
  const v = raw.trim().toUpperCase().replace(/\s+/g, "");
  if (!v) return null;
  const hit = ref.classifyRegistration(v);
  if (hit) return { display: hit.display, match: registrationMatchForm(hit.display), country: hit.prefix.country, knownFormat: true };
  return { display: v, match: registrationMatchForm(v), country: null, knownFormat: false };
}

// US civil aircraft: the FAA gives each N-number its ICAO 24-bit address by a fixed scheme, from N1 (a00001) to
// N99999 (adf7c7), letters after the digits included. Letters skip I and O.
const N_LETTERS = "ABCDEFGHJKLMNPQRSTUVWXYZ";
const N_SUFFIXES = 1 + N_LETTERS.length * (1 + N_LETTERS.length); // none, one letter, or two letters
const N_BUCKET4 = 1 + N_LETTERS.length + 10;
const N_BUCKET3 = 10 * N_BUCKET4 + N_SUFFIXES;
const N_BUCKET2 = 10 * N_BUCKET3 + N_SUFFIXES;
const N_BUCKET1 = 10 * N_BUCKET2 + N_SUFFIXES;

/** The ICAO address of a US registration ("N565JB" → "a73a47"), or null when it is not a valid N-number. */
export function nNumberIcao(registration: string): string | null {
  const n = registrationMatchForm(registration);
  if (!/^N[1-9][0-9]{0,4}[A-HJ-NP-Z]{0,2}$/.test(n) || n.length > 6) return null;
  const rest = n.slice(1);
  const letters = (s: string) => (s ? (N_LETTERS.length + 1) * N_LETTERS.indexOf(s[0]!) + 1 + (s[1] ? N_LETTERS.indexOf(s[1]) + 1 : 0) : 0);
  let out = 0xa00001 + (Number(rest[0]) - 1) * N_BUCKET1;
  const buckets = [N_BUCKET2, N_BUCKET3, N_BUCKET4];
  for (let i = 1; i < rest.length; i++) {
    const ch = rest[i]!;
    if (!/\d/.test(ch)) {
      // Letters end the N-number: two may follow up to the fourth character, one after four digits.
      if (i === 4) return rest.length === 5 ? (out + 1 + N_LETTERS.indexOf(ch)).toString(16) : null;
      return (out + letters(rest.slice(i))).toString(16);
    }
    if (i === 4) return (out + 1 + N_LETTERS.length + Number(ch)).toString(16);
    out += N_SUFFIXES + Number(ch) * buckets[i - 1]!;
  }
  return out.toString(16);
}
