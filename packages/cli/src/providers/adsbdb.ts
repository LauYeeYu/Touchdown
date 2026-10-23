// adsbdb (https://www.adsbdb.com/), an open aircraft database: type, model, maker and the owner's airline code
// for a registration (docs/13-reference-data.md, "Live lookups"). Free and without a key; aircraft data
// credited to PlaneBase. Light use only: one request at a time, a pause between requests, answers cached.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { canonicalMaker, modelFromSource, registrationMatchForm, type Evidence, type RefIndex } from "@touchdown/core";

const API = "https://api.adsbdb.com/v0/aircraft/";
const USER_AGENT = "Touchdown/0.1 (personal aircraft log)";

export interface AdsbdbOptions {
  cacheDir: string;
  maxAgeDays: number;
  delayMs: number;
  offline?: boolean;
  refresh?: boolean;
}

/** A cached answer: the aircraft, or null when adsbdb does not know the registration. */
interface Cached {
  fetchedAt: string;
  aircraft: AdsbdbAircraft | null;
}

export interface AdsbdbAircraft {
  type?: string;
  icao_type?: string;
  manufacturer?: string;
  registration?: string;
  registered_owner?: string;
  registered_owner_operator_flag_code?: string;
}

export function adsbdbEvidence(a: AdsbdbAircraft, fetchedAt: string, ref: RefIndex): Evidence | null {
  const typeCode = a.icao_type && ref.type(a.icao_type) ? a.icao_type.toUpperCase() : null;
  const flag = a.registered_owner_operator_flag_code?.trim().toUpperCase() ?? "";
  const operator = flag && ref.operatorByCode(flag)?.icao === flag ? flag : null;
  const model = modelFromSource(a.manufacturer && a.type ? `${canonicalMaker(a.manufacturer, ref)} ${a.type}` : a.type, typeCode, ref);
  if (!typeCode && !model && !operator) return null;
  return {
    source: "adsbdb",
    typeCode,
    model,
    operator,
    operatorName: a.registered_owner?.trim() || null,
    asOf: fetchedAt.slice(0, 10),
    note: null,
    facts: null,
    url: null,
  };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function adsbdb(ref: RefIndex, opts: AdsbdbOptions) {
  let last = 0;
  let stopped: string | null = null;
  const path = (reg: string) => join(opts.cacheDir, "adsbdb", registrationMatchForm(reg) + ".json");
  return {
    /** The answer for a registration, null when adsbdb does not know it, or why it could not be asked. */
    async lookup(registration: string): Promise<{ evidence: Evidence | null } | { error: string }> {
      const p = path(registration);
      if (existsSync(p)) {
        const c = JSON.parse(readFileSync(p, "utf8")) as Cached;
        if (opts.offline || (!opts.refresh && Date.now() - Date.parse(c.fetchedAt) < opts.maxAgeDays * 86_400_000)) {
          return { evidence: c.aircraft ? adsbdbEvidence(c.aircraft, c.fetchedAt, ref) : null };
        }
      }
      if (opts.offline) return { evidence: null };
      if (stopped) return { error: stopped };
      const wait = last + opts.delayMs - Date.now();
      if (wait > 0) await sleep(wait);
      last = Date.now();
      const res = await fetch(API + encodeURIComponent(registration), { headers: { "User-Agent": USER_AGENT }, signal: AbortSignal.timeout(15_000) }).catch((e: Error) => e);
      if (res instanceof Error) return { error: `adsbdb did not answer (${res.message})` };
      if (res.status === 429) {
        stopped = "adsbdb asked to slow down; not used for the rest of this session";
        return { error: stopped };
      }
      let aircraft: AdsbdbAircraft | null = null;
      // 404: not an aircraft it knows; 400: not a registration it can read. Both mean no answer.
      if (res.ok) {
        const body = (await res.json().catch(() => null)) as { response?: { aircraft?: AdsbdbAircraft } } | null;
        aircraft = body?.response?.aircraft ?? null;
      } else if (res.status !== 404 && res.status !== 400) return { error: `adsbdb answered ${res.status}` };
      const fetchedAt = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
      mkdirSync(join(opts.cacheDir, "adsbdb"), { recursive: true });
      writeFileSync(p, JSON.stringify({ fetchedAt, aircraft } satisfies Cached));
      return { evidence: aircraft ? adsbdbEvidence(aircraft, fetchedAt, ref) : null };
    },
  };
}
