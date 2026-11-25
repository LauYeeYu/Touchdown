// Stamps the site's owner gives (docs/24-statistics.md, "Stamps the owner gives"): not worked out from a log but kept
// on the server with each account, which the owner grants from People. The ids are stored there, so one is never
// renamed. It depends on nothing, so the server can use it without the rest of core.

/** The stamps the owner can give, in the order People and the Stamps tab list them. */
export const GRANTED_STAMP_IDS = ["alpha", "bugFinder", "translator"] as const;
export type GrantedStampId = (typeof GRANTED_STAMP_IDS)[number];

/** A stamp given to an account, as the server sends it: which, and when (a UTC date-time). */
export interface GrantedStamp {
  id: GrantedStampId;
  grantedAt: string;
}

export function isGrantedStampId(v: unknown): v is GrantedStampId {
  return typeof v === "string" && (GRANTED_STAMP_IDS as readonly string[]).includes(v);
}
