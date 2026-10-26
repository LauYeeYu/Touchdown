// Airframe facts lookup (docs/13-reference-data.md, "Airframe facts"): for each aircraft in the log that lacks
// a serial number or a first flight date, ask the sources in turn, check each answer against the user's records
// and store what fits. Runs on the user's machine: on a backup file, or on a copy of the log, whose answers then
// go to the inbox as changes for review (docs/34).

import { applyAirframeFacts, copyStore, factsMismatch, recordDatesOf, refOverridesOf, registrationMatchForm, resolveAirframes, type AirframeFacts, type FactsOutcome, type InboxChange, type RefIndex, type Store } from "@touchdown/core";

export type ProviderResult =
  | { kind: "found"; candidates: AirframeFacts[] }
  | { kind: "none" }
  | { kind: "blocked"; reason: string }
  | { kind: "error"; reason: string };

export interface Provider {
  id: string;
  name: string;
  /** Manufacturers this source covers well, tried first for them; empty for every manufacturer. */
  prefer: string[];
  /** Airframe fields this source can fill; it is skipped for an aircraft that has them all. */
  gives: ("msn" | "lineNumber" | "firstFlightDate" | "deliveryDate" | "status")[];
  close?(): Promise<void>;
  /** Every airframe that carried the registration, when the source knows several. */
  lookup(registration: string): Promise<ProviderResult>;
}

export interface LookupOptions {
  providers: Provider[];
  /** Look up every aircraft, not only those missing a serial number or first flight. */
  all?: boolean;
  /** Only these registrations (any format). */
  only?: string[];
  limit?: number;
  overwriteImported?: boolean;
  log: (line: string) => void;
}

export interface LookupReport {
  looked: number;
  filled: number;
  merged: number;
  rejected: { registration: string; provider: string; reason: string }[];
  differs: { registration: string; provider: string; field: string; yours: string; lookup: string }[];
  notFound: string[];
  blocked: Map<string, string>;
  /** Each answer stored, in order: the aircraft it was for (before any merge) and the facts. */
  stored: { airframeId: string; facts: AirframeFacts }[];
}

const label = (field: string) => ({ msn: "serial", lineNumber: "line", firstFlightDate: "first flight", deliveryDate: "delivered", status: "status", manufacturer: "maker", icaoHex: "transponder address" })[field] ?? field;

/** The registrations the user recorded for an airframe, latest first. */
function registrationsOf(store: Store, airframeId: string): string[] {
  const recs = [
    ...store.all("flights").filter((f) => f.airframeId === airframeId).map((f) => ({ reg: f.registration, d: f.scheduledDate ?? f.takeoffAt ?? "" })),
    ...store.all("sightings").filter((s) => s.airframeId === airframeId).map((s) => ({ reg: s.registration, d: s.seenOn ?? "" })),
  ].sort((a, b) => b.d.localeCompare(a.d));
  return [...new Set(recs.map((r) => r.reg).filter((r): r is string => !!r))];
}

export async function lookupAirframes(store: Store, ref: RefIndex, opts: LookupOptions): Promise<LookupReport> {
  const report: LookupReport = { looked: 0, filled: 0, merged: 0, rejected: [], differs: [], notFound: [], blocked: new Map(), stored: [] };
  const only = opts.only?.length ? new Set(opts.only.map(registrationMatchForm)) : null;
  const targets = store
    .all("airframes")
    .filter((a) => recordDatesOf(store, a.id).length || registrationsOf(store, a.id).length)
    .filter((a) => opts.all || !a.msn || !a.firstFlightDate)
    .map((a) => ({ id: a.id, regs: registrationsOf(store, a.id) }))
    .filter((t) => t.regs.length && (!only || t.regs.some((r) => only.has(registrationMatchForm(r)))))
    .slice(0, opts.limit ?? Infinity);
  opts.log(`Looking up ${targets.length} aircraft (sources: ${opts.providers.map((p) => p.name).join(", ")}).`);

  for (const t of targets) {
    let id = t.id;
    report.looked++;
    let found = false;
    const done = () => {
      const a = store.get("airframes", id);
      return !a || (!!a.msn && !!a.firstFlightDate && !opts.all);
    };
    const maker = store.get("airframes", id)?.manufacturer ?? null;
    const order = [...opts.providers].sort((x, y) => rank(y, maker) - rank(x, maker));
    const lines: string[] = [];
    for (const p of order) {
      if (done()) break;
      if (report.blocked.has(p.id)) continue;
      const cur = store.get("airframes", id)!;
      if (!opts.all && p.gives.every((f) => cur[f])) continue;
      for (const reg of t.regs) {
        const res = await p.lookup(reg);
        if (res.kind === "blocked") {
          report.blocked.set(p.id, res.reason);
          lines.push(`${p.name}: ${res.reason}; not used for the rest of this run`);
          break;
        }
        if (res.kind === "error") {
          lines.push(`${p.name}: ${res.reason}`);
          break;
        }
        if (res.kind === "none") continue;
        found = true;
        const a = store.get("airframes", id)!;
        // A reused registration gives several airframes; use the one that fits the user's records.
        const fit = res.candidates.find((c) => !factsMismatch(store, ref, a, c));
        if (!fit) {
          const why = factsMismatch(store, ref, a, res.candidates[0]!)!;
          report.rejected.push({ registration: reg, provider: p.name, reason: why });
          lines.push(`${p.name}: not used: ${why}`);
          continue;
        }
        const out: FactsOutcome = applyAirframeFacts(store, ref, id, fit, { overwriteImported: opts.overwriteImported });
        if (out.applied.length || out.mergedInto) report.stored.push({ airframeId: id, facts: fit });
        if (out.mergedInto) {
          report.merged++;
          id = out.mergedInto;
          lines.push(`${p.name}: same serial number as another aircraft in your log; merged`);
        }
        if (out.applied.length) {
          lines.push(`${p.name}: ${out.applied.map((x) => `${label(x.field)} ${x.to}`).join(", ")}`);
        }
        for (const d of out.differs) {
          report.differs.push({ registration: reg, provider: p.name, ...d });
          lines.push(`${p.name}: ${label(d.field)} ${d.lookup} differs from your ${d.yours} (yours kept)`);
        }
        break;
      }
    }
    const a = store.get("airframes", id);
    if (a && (a.msn || a.firstFlightDate) && (a.factsProvider && lines.some((l) => !l.includes("not used")))) report.filled++;
    if (!found && !lines.length) report.notFound.push(t.regs[0]!);
    opts.log(`  ${t.regs.join(" / ").padEnd(16)} ${lines.length ? lines.join("; ") : found ? "nothing new" : "not found"}`);
  }
  for (const p of opts.providers) await p.close?.();
  resolveAirframes(store, ref);
  return report;
}

function rank(p: Provider, maker: string | null): number {
  if (!p.prefer.length) return 0;
  return maker && p.prefer.some((m) => m.toLowerCase() === maker.toLowerCase()) ? 1 : -1;
}

/**
 * Look up facts for the aircraft in the log without changing it: on a copy, whose stored answers become changes
 * (`facts`), applied in the same order when the user imports them, and checked against the records again then.
 */
export async function lookupAsChanges(log: Store, ref: RefIndex, opts: LookupOptions): Promise<{ report: LookupReport; changes: InboxChange[] }> {
  const copy = copyStore(log);
  try {
    const report = await lookupAirframes(copy, ref, opts);
    const changes: InboxChange[] = report.stored.map((x) => ({ op: "facts", id: x.airframeId, facts: x.facts, ...(opts.overwriteImported && { overwriteImported: true }) }));
    return { report, changes };
  } finally {
    ref.setUserOverrides(refOverridesOf(log));
  }
}
