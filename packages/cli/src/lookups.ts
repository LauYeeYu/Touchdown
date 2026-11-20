// What the sources say about a registration (docs/13-reference-data.md, "Live lookups"): the user's log, the OpenSky
// snapshot, adsbdb and, when asked, Flightradar24 through the user's own Chrome. Used by `touchdown spot` for the
// lines typed in a session and by `touchdown check log` for the records already in the log.

import { t } from "@touchdown/i18n/cli";
import { logEvidence, registrationMatchForm, type Evidence, type LogSelf, type RefIndex, type Store } from "@touchdown/core";
import { adsbdb } from "./providers/adsbdb.ts";
import { fr24Evidence, fr24Pages, fr24Url } from "./providers/fr24.ts";
import { openSkyEvidence, openSkyIndex, type OpenSkyRow } from "./providers/opensky.ts";
import { privatePath } from "./paths.ts";

const CACHE = privatePath("cache/airframes");
const MAX_AGE_DAYS = 90;

export interface LookupOptions {
  adsbdb: boolean;
  fr24: boolean;
  chromePort: number;
  offline: boolean;
}

export interface LookupHooks {
  /** A line about the OpenSky snapshot being downloaded or read. */
  progress: (line: string) => void;
  /** A source that cannot be used, by source: said once per source by the caller. */
  problem: (source: "opensky" | "adsbdb" | "fr24", line: string) => void;
}

export function registrationLookups(ref: RefIndex, log: Store | null, o: LookupOptions, hooks: LookupHooks) {
  const openSky = openSkyIndex(hooks.progress);
  const adsb = o.adsbdb ? adsbdb(ref, { cacheDir: CACHE, maxAgeDays: MAX_AGE_DAYS, delayMs: 1000, offline: o.offline }) : null;
  let fr24 = o.fr24 ? fr24Pages({ port: o.chromePort, delayMs: 10_000, cacheDir: CACHE, maxAgeDays: MAX_AGE_DAYS, offline: o.offline }) : null;

  /**
   * What the sources say about a registration on a date. `self` is the record being looked up, so a row already in
   * the log does not vouch for itself; `quick` asks adsbdb only when OpenSky does not know the aircraft (a whole
   * spreadsheet).
   */
  const lookUp = async (registration: string, date: string, opts: { self?: LogSelf; quick?: boolean } = {}): Promise<Evidence[]> => {
    const out: Evidence[] = [];
    if (log) {
      const e = logEvidence(log, ref, registration, date, opts.self ?? { date });
      if (e) out.push(e);
    }
    const index = await openSky();
    if (index instanceof Map) {
      const rows = index.get(registrationMatchForm(registration)) ?? [];
      // A reused registration has several rows: the one registered on the date, else the latest.
      const held = (r: OpenSkyRow) => (!r.registered || r.registered <= date) && (!r.regUntil || date <= r.regUntil);
      const row = [...(rows.some(held) ? rows.filter(held) : rows)].sort((a, b) => b.updated.localeCompare(a.updated))[0];
      if (row) out.push(openSkyEvidence(row, ref));
    } else hooks.problem("opensky", t("cliWrite.spot.openSkyUnused", { error: index.error }));
    if (adsb && !(opts.quick && out.some((e) => e.source === "opensky"))) {
      const r = await adsb.lookup(registration);
      if ("error" in r) hooks.problem("adsbdb", t("cliWrite.spot.adsbdbError", { error: r.error }));
      else if (r.evidence) out.push(r.evidence);
    }
    if (fr24) {
      const url = fr24Url(registration);
      const page = await fr24.read(registration, url);
      if ("blocked" in page) {
        hooks.problem("fr24", t("cliWrite.spot.fr24Blocked", { why: page.blocked }));
        await fr24.close();
        fr24 = null;
      } else {
        const e = fr24Evidence(registration, page, ref, url);
        if (e) out.push(e);
      }
    }
    return out;
  };

  return {
    lookUp,
    /** The OpenSky snapshot, read (and downloaded the first time) on the first call. */
    openSky,
    usesAdsbdb: !!adsb,
    /** Flightradar24 is asked: false once it was asked for and stopped at a bot check. */
    usesFr24: () => !!fr24,
    close: async () => {
      await fr24?.close();
    },
  };
}
