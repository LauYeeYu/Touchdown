// Words for a flight's sentence, shared by its page in the app and on a shared link (docs/32).

import { daysBetween } from "@touchdown/core";
import { clock, localDay } from "./format.ts";

/** "a" or "an" before a word. */
export function article(word: string): string {
  return /^[aeiou]/i.test(word) ? "an" : "a";
}

/** The part of the local day a time falls in. */
export function partOfDay(dt: string): "night" | "morning" | "afternoon" | "evening" {
  const h = Number(clock(dt).slice(0, 2));
  return h < 5 ? "night" : h < 12 ? "morning" : h < 17 ? "afternoon" : "evening";
}

/**
 * When a flight flew, for its lead sentence (`flights.detail.lead`): its kind, by the part of the day it took off in,
 * overnight when it flies through the night into the next day and long-haul from 10 hours, and its landing against
 * the day it took off on, by each airport's local calendar (`days`). A landing in the small hours after a takeoff the
 * day before, outside them, is that same night: "after midnight", neither an overnight flight nor "the next night".
 */
export function flightWhen(takeoffAt: string | null, landingAt: string | null, minutes: number | null) {
  const takeoff = takeoffAt ? partOfDay(takeoffAt) : null;
  const landingPart = landingAt ? partOfDay(landingAt) : null;
  const days = takeoffAt && landingAt ? daysBetween(localDay(takeoffAt)!, localDay(landingAt)!) : 0;
  const afterMidnight = days === 1 && landingPart === "night" && takeoff !== "night";
  const kind = !takeoff ? "plain" : days >= 1 && !afterMidnight && (takeoff === "evening" || takeoff === "night") ? "overnight" : (minutes ?? 0) >= 600 ? "longHaul" : takeoff;
  const landing = !landingAt ? "none" : days === 0 ? "sameDay" : afterMidnight ? "afterMidnight" : days === 1 ? "nextDay" : "later";
  return { kind, landing, landingPart: landingPart ?? "", days };
}
