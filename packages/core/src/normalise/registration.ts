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
