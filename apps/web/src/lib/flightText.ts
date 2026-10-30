// Words for a flight's sentence, shared by its page in the app and on a shared link (docs/32).

import { clock } from "./format.ts";

/** "a" or "an" before a word. */
export function article(word: string): string {
  return /^[aeiou]/i.test(word) ? "an" : "a";
}

/** The part of the local day a time falls in. */
export function partOfDay(dt: string): "night" | "morning" | "afternoon" | "evening" {
  const h = Number(clock(dt).slice(0, 2));
  return h < 5 ? "night" : h < 12 ? "morning" : h < 17 ? "afternoon" : "evening";
}
