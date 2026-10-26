// `touchdown tracks`: recorded tracks for the flights in the log that have none, from adsb.lol's history
// (docs/23-tracks-and-maps.md, "Backfill"). Each flight's aircraft is found by its hex code (the log's, the US
// N-number scheme, or the OpenSky database), its trace for the day is read from adsb.lol's daily release
// (providers/adsblol.ts), and the leg that is the flight is cut out and checked as a file would be. What is found
// goes to the inbox as track changes, for review; what is not is reported with the reason and remembered, so the
// next run does not ask again (--refresh does).

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import {
  ADSBLOL_ATTRIBUTION,
  addDays,
  flightDay,
  instant,
  nNumberIcao,
  normaliseMsn,
  registrationMatchForm,
  toUtcIso,
  trackChangeFor,
  trackFromReadsb,
  zonedInstant,
  type Flight,
  type InboxChange,
  type ReadsbTrace,
  type Store,
} from "@touchdown/core";
import { AFTER, changeOptions, parse, writeChanges } from "./change.ts";
import { privatePath } from "./paths.ts";
import { ADSBLOL_FIRST_DAY, adsbLolTraces } from "./providers/adsblol.ts";
import { openSkyIndex, type OpenSkyRow } from "./providers/opensky.ts";
import { fail, findFlight, notFound, openOrFail } from "./read.ts";
import { dim } from "./term.ts";

export const TRACKS_HELP = `Usage: ./touchdown tracks [--only REF,…] [--limit N] [--refresh] [options]

Finds recorded tracks for the flights in your log that have none, in adsb.lol's history (open data, from
16 February 2023; thin until March 2023, good over the US and Europe, gaps over oceans, little over China). Each
day's archive is 1.5 to 3.5 GB; only the aircraft's part of it is read, usually 10 to 60 MB a flight, and the
trace found is kept in data/private/cache/adsblol. Each track is checked against its flight as a file is: its
times, its route, enough of it to draw. The tracks found go to the inbox as changes; the flights without one are
listed with the reason and not asked about again unless --refresh.

  --only REF,…   only these flights (XY123@YYYY-MM-DD or ids)
  --limit N      look up at most N flights
  --refresh      ask again about flights that had no track before
${changeOptions(15)}

${AFTER}`;

const MISSES = privatePath("cache/adsblol/flights.json");

interface Miss {
  checkedAt: string;
  reason: string;
}

function readMisses(): Record<string, Miss> {
  try {
    return existsSync(MISSES) ? (JSON.parse(readFileSync(MISSES, "utf8")) as Record<string, Miss>) : {};
  } catch {
    return {};
  }
}

const nameOf = (f: Flight) => `${f.flightNumber ?? "A flight"}${flightDay(f) ? `@${flightDay(f)}` : ""}`;

/** The aircraft's hex code on the flight's day: the log's, the US N-number's, else OpenSky's for the registration. */
function hexFor(store: Store, f: Flight, openSky: Map<string, OpenSkyRow[]> | null): string | null {
  const reg = f.registration ? registrationMatchForm(f.registration) : null;
  if (!reg) return null;
  const day = flightDay(f) ?? "";
  const logged = store.all("registration_periods").find((p) => p.icaoHex && p.registration && registrationMatchForm(p.registration) === reg && (!p.validFrom || p.validFrom <= day) && (!p.validTo || day <= p.validTo));
  if (logged?.icaoHex) return logged.icaoHex.toLowerCase();
  // A US registration's address follows from the N-number itself, whichever aircraft carries it.
  const us = nNumberIcao(reg);
  if (us) return us;
  const rows = (openSky?.get(reg) ?? []).filter((r) => /^[0-9a-f]{6}$/.test(r.icao24));
  if (!rows.length) return null;
  const msn = f.airframeId ? store.get("airframes", f.airframeId)?.msn : null;
  const pick =
    (msn ? rows.find((r) => r.serialNumber && normaliseMsn(r.serialNumber) === normaliseMsn(msn)) : undefined) ??
    rows.find((r) => (!r.registered || r.registered <= day) && (!r.regUntil || day <= r.regUntil)) ??
    [...rows].sort((a, b) => b.updated.localeCompare(a.updated))[0]!;
  return pick.icao24;
}

/** The UTC days the flight may have flown on: around takeoff and landing, else its day at the departure airport. */
function daysFor(f: Flight, tz: string | null): string[] {
  const t0 = instant(f.takeoffAt) ?? instant(f.departureAt);
  const t1 = instant(f.landingAt) ?? (t0 !== null ? t0 + 20 * 3600_000 : null);
  let from: number;
  let to: number;
  if (t0 !== null && t1 !== null) [from, to] = [t0 - 3 * 3600_000, t1 + 3 * 3600_000];
  else {
    const day = flightDay(f)!;
    from = (tz ? zonedInstant(day, "00:00", tz) : null) ?? Date.parse(`${day}T00:00:00Z`) - 14 * 3600_000;
    to = from + 48 * 3600_000;
  }
  const days: string[] = [];
  for (let d = toUtcIso(from).slice(0, 10); d <= toUtcIso(to).slice(0, 10); d = addDays(d, 1)) days.push(d);
  return days;
}

export async function tracksCommand(args: string[]) {
  const c = parse(args, TRACKS_HELP, { values: ["--only", "--limit"], switches: ["--refresh"] });
  if (c.positional.length) return fail(c.json, `tracks takes no ${c.positional[0]}; give flights with --only.`);
  const limit = c.values.has("--limit") ? Number(c.values.get("--limit")) : Infinity;
  if (!(limit > 0)) return fail(c.json, "--limit needs a number of flights.");
  const log = await openOrFail(c.json, c.log);
  const say = (line: string) => {
    if (!c.json) console.error(dim(line));
  };

  const tracked = new Set(log.store.all("tracks").map((t) => t.flightId));
  let flights = log.store.all("flights").filter((f) => !tracked.has(f.id));
  if (c.values.has("--only")) {
    const ids = new Set<string>();
    for (const ref of c.values.get("--only")!.split(",").map((s) => s.trim()).filter(Boolean)) {
      const found = findFlight(log.store, ref);
      if (!("row" in found)) return notFound(c.json, found);
      ids.add(found.row.id);
    }
    flights = flights.filter((f) => ids.has(f.id));
  }
  flights.sort((a, b) => (flightDay(a) ?? "").localeCompare(flightDay(b) ?? ""));

  const misses = readMisses();
  const yesterday = addDays(toUtcIso(Date.now()).slice(0, 10), -1);
  const notes: string[] = [];
  const remember = (f: Flight, reason: string) => {
    misses[f.id] = { checkedAt: toUtcIso(Date.now()), reason };
    notes.push(`${nameOf(f)}: ${reason}`);
  };

  // Which flights to look up, and which aircraft on which days.
  let openSky: Map<string, OpenSkyRow[]> | null | undefined;
  const plans: { f: Flight; hex: string; days: string[] }[] = [];
  for (const f of flights) {
    if (plans.length >= limit) break;
    const day = flightDay(f);
    const before = misses[f.id];
    if (before && !c.switches.has("--refresh")) {
      notes.push(`${nameOf(f)}: no track on ${before.checkedAt.slice(0, 10)} (${before.reason}); --refresh asks again.`);
      continue;
    }
    if (!day) {
      remember(f, "the flight has no date.");
      continue;
    }
    if (day < ADSBLOL_FIRST_DAY) {
      remember(f, "before adsb.lol's history, which starts on 16 Feb 2023.");
      continue;
    }
    if (day > yesterday) {
      notes.push(`${nameOf(f)}: adsb.lol publishes a day the morning after; try again tomorrow.`);
      continue;
    }
    if (!f.registration) {
      remember(f, "no registration, so the aircraft cannot be found.");
      continue;
    }
    if (openSky === undefined && !nNumberIcao(f.registration)) {
      const index = await openSkyIndex(say)();
      openSky = "error" in index ? null : index;
    }
    const hex = hexFor(log.store, f, openSky ?? null);
    if (!hex) {
      remember(f, `no hex code is known for ${f.registration}.`);
      continue;
    }
    plans.push({ f, hex, days: daysFor(f, log.ref.airport(f.fromAirportId)?.tz ?? null) });
  }

  // Each day's archive once, for every aircraft wanted that day.
  const wanted = new Map<string, Set<string>>();
  for (const p of plans) for (const d of p.days) wanted.set(d, (wanted.get(d) ?? new Set()).add(p.hex));
  const traces = new Map<string, ReadsbTrace | null>();
  const noDay = new Set<string>();
  const failed = new Map<string, string>();
  let bytes = 0;
  for (const [day, hexes] of [...wanted].sort((a, b) => a[0].localeCompare(b[0]))) {
    try {
      const r = await adsbLolTraces(day, [...hexes], say);
      bytes += r.read.bytes;
      if (r.noDay) noDay.add(day);
      for (const [hex, t] of r.traces) traces.set(`${day}|${hex}`, t);
    } catch (e) {
      failed.set(day, (e as Error).message);
    }
  }
  if (plans.length) say(`  Read ${(bytes / 2 ** 20).toFixed(1)} MB from adsb.lol for ${plans.length} flights.`);

  const changes: InboxChange[] = [];
  for (const { f, hex, days } of plans) {
    const trouble = days.map((d) => failed.get(d)).find(Boolean);
    if (trouble) {
      notes.push(`${nameOf(f)}: ${trouble} Nothing remembered; try again later.`);
      continue;
    }
    const found = days.map((d) => traces.get(`${d}|${hex}`)).filter((t): t is ReadsbTrace => !!t);
    if (!found.length) {
      remember(f, days.every((d) => noDay.has(d)) ? `adsb.lol has no release for ${days.join(", ")}.` : `the aircraft (${hex}) has no trace in adsb.lol's history that day.`);
      continue;
    }
    const leg = trackFromReadsb(found, f, log.ref);
    if ("problem" in leg) {
      remember(f, leg.problem);
      continue;
    }
    delete misses[f.id];
    changes.push(trackChangeFor(f.id, { points: leg.points, provider: "adsblol", attribution: ADSBLOL_ATTRIBUTION }, leg.coverage));
  }
  if (!c.dryRun) {
    mkdirSync(dirname(MISSES), { recursive: true });
    writeFileSync(MISSES, JSON.stringify(misses, null, 1));
  }
  return writeChanges(log, "tracks", changes, c, notes);
}
