// The words of a map made into an image or a video (lib/figure.ts, lib/video.ts): its title, the line under it and its
// figures, for a flight, an aircraft and a period of the log. The pages show the same figures (FlightDetail, Home,
// AircraftDetail), and `touchdown render` makes its videos with these words (render/main.ts), so a video made on the
// command line reads as one made in the app.

import { flightName, flightStats, flownDistances, greatCircleKm, phaseIndex, sightingStats, type RefIndex, type Settings, type Sighting, type Store } from "@touchdown/core";
import { extensionPercent, inPeriod, routeExtension } from "@touchdown/core/view";
import { list, t } from "@touchdown/i18n";
import type { FigureStat } from "./figure.ts";
import { airlineLabel, clock, dayMonthYear, dayShort, distance, durShort, localDay, modelLabel, nf, offsetLabel, typeName } from "./format.ts";
import { trackIndex } from "./mapdata.ts";
import { aircraftViews, sortedFlights, type FlightView } from "./views.ts";

/** The log a figure is made from: the web app's data, or the log the command line read. */
export interface LogData {
  store: Store;
  ref: RefIndex;
  settings: Settings;
}

export interface FigureWords {
  title: string;
  subtitle: string;
  stats: FigureStat[];
}

/** A flight's model as the settings name it, else its type. */
export const flightTypeText = (d: LogData, f: FlightView["f"]) => (f.model ? modelLabel(f.model, f.typeCode, d.ref, d.settings.modelNaming ?? "standard") : typeName(f.typeCode, d.ref));

/**
 * A flight's: titled with its name and route, its day and distance under it, and as figures what its page shows: takeoff
 * and landing, time in the air, distance flown (with the great circle), route extension and aircraft. Never a private field.
 */
export function flightWords(d: LogData, v: FlightView): FigureWords {
  const { store, ref, settings } = d;
  const f = v.f;
  const unit = settings.distanceUnit ?? "km";
  const typeText = flightTypeText(d, f);
  const extension = trackIndex(store).get(f.id) ? routeExtension(store, ref, f) : null;
  const basis = f.distanceKmOverride !== null && f.distanceKmOverride !== undefined ? "entered" : v.flown ? "track" : "greatCircle";
  const greatCircle = greatCircleKm(f, ref);
  const when = (dt: string) => `${dayShort(localDay(dt)!)} · ${offsetLabel(dt)}`;
  const airline = f.airlineId ? airlineLabel(f.airlineId, ref) : null;
  const stats = [
    f.takeoffAt ? { label: t("flights.detail.time.takeoff", { code: v.fromCode }), value: clock(f.takeoffAt), detail: when(f.takeoffAt) } : null,
    f.landingAt ? { label: t("flights.detail.time.landing", { code: v.toCode }), value: clock(f.landingAt), detail: when(f.landingAt) } : null,
    v.min !== null ? { label: t("flights.detail.time.inAir"), value: durShort(v.min) } : null,
    v.km !== null ? { label: t("flights.detail.distance.label", { basis }), value: distance(v.km, unit), detail: basis === "track" && greatCircle !== null ? t("flights.detail.time.greatCircle", { distance: distance(greatCircle, unit) }) : undefined } : null,
    extension ? { label: t("flights.detail.extension.label"), value: extensionPercent(extension.percent), detail: t("flights.detail.extension.detail", { extra: distance(extension.extraKm, unit) }) } : null,
    f.registration || f.typeCode || f.model ? { label: t("flights.figure.stat.aircraft"), value: f.registration ?? typeText, detail: [f.registration ? typeText : null, airline].filter(Boolean).join(" · ") || undefined } : null,
  ];
  return {
    title: [flightName(f), `${v.fromCode} → ${v.toCode}`].filter(Boolean).join(" · "),
    subtitle: [v.day && dayMonthYear(v.day), v.km !== null && distance(v.km, unit)].filter(Boolean).join(" · "),
    stats: stats.filter((x) => x !== null),
  };
}

/** An aircraft's: its registration and type, as its page's heading. */
export function aircraftWords(d: LogData, airframeId: string): FigureWords | null {
  const v = aircraftViews(d.store).find((x) => x.airframe.id === airframeId);
  if (!v) return null;
  const a = v.airframe;
  const typeText = a.model ? modelLabel(a.model, a.typeCode, d.ref, d.settings.modelNaming ?? "standard") : typeName(a.typeCode, d.ref);
  return { title: [v.registration ?? "", typeText].filter(Boolean).join(" · "), subtitle: "", stats: [] };
}

/** A period of the log, as Home shows it: "all" or a year. */
export function periodOf(d: LogData, year: string) {
  const { store, ref } = d;
  const airframes = new Map(store.all("airframes").map((a) => [a.id, a]));
  const ctx = { ref, airframes, phases: phaseIndex(store), flown: flownDistances(store, ref) };
  const views = sortedFlights(store, ref).filter((v) => inPeriod(v.day, year));
  const sightings = store.all("sightings").filter((s) => inPeriod(s.seenOn, year));
  const before: Sighting[] = year === "all" ? [] : store.all("sightings").filter((s) => s.seenOn && s.seenOn < `${year}-01-01`);
  return { ctx, views, sightings, fs: flightStats(views.map((v) => v.f), ctx), ss: sightingStats(sightings, ctx, before) };
}

export type Period = ReturnType<typeof periodOf>;

/** One of the figures above Home's map: `kind` lets the page show its value its own way (a duration, a long name). */
export interface PeriodFact {
  kind: "longest" | "time" | "airline" | "aircraft" | "type";
  label: string;
  text: string;
  detail: string;
  /** For "time": the minutes. */
  minutes?: number;
}

/** The figures above Home's map: the longest flight, the time in the air, the most flown airline and aircraft, the most spotted type. */
export function periodFacts(d: LogData, p: Period): PeriodFact[] {
  const { ref } = d;
  const unit = d.settings.distanceUnit ?? "km";
  const { views, fs, ss } = p;
  const facts: PeriodFact[] = [];
  const longest = fs.longestByDistance ? views.find((v) => v.f.id === fs.longestByDistance!.id) : undefined;
  if (longest?.km) {
    const route = `${longest.fromCode} → ${longest.toCode}`;
    facts.push({ kind: "longest", label: t("home.facts.longest"), text: route, detail: [distance(longest.km, unit), flightName(longest.f)].filter(Boolean).join(" · ") });
  }
  if (fs.minutes.value) facts.push({ kind: "time", label: t("home.facts.time"), text: durShort(fs.minutes.value), detail: t("home.facts.timeDetail", { count: views.length - fs.minutes.leftOut }), minutes: fs.minutes.value });
  const topAirline = fs.byAirline.items[0];
  if (topAirline) {
    const names = list(fs.byAirline.top.map((id) => airlineLabel(id, ref)));
    facts.push({ kind: "airline", label: t("home.facts.airline", { count: fs.byAirline.top.length }), text: names, detail: t("common.count.flights", { count: topAirline.count }) });
  }
  const topFrame = fs.byAirframe.items[0];
  const topFrameFlight = topFrame ? views.find((v) => v.f.airframeId === topFrame.key) : undefined;
  if (topFrame && topFrame.count > 1 && topFrameFlight) {
    const reg = topFrameFlight.f.registration ?? "";
    facts.push({ kind: "aircraft", label: t("home.facts.aircraft"), text: reg, detail: `${t("common.count.flights", { count: topFrame.count })} · ${typeName(topFrameFlight.f.typeCode, ref)}` });
  }
  const topSpotType = ss.byType.items[0];
  if (topSpotType) {
    const type = typeName(topSpotType.key, ref);
    facts.push({ kind: "type", label: t("home.facts.type"), text: type, detail: t("common.count.aircraft", { count: topSpotType.count }) });
  }
  return facts;
}

/**
 * A period's: titled by the period, how many flights, how far and how many aircraft spotted under it, and as figures
 * the flights, the aircraft spotted (at `places` spotting places) and the figures above Home's map.
 */
export function periodWords(d: LogData, year: string, p: Period, places: number, facts = periodFacts(d, p)): FigureWords {
  const unit = d.settings.distanceUnit ?? "km";
  const { views, fs, ss } = p;
  const km = fs.distanceKm.value;
  const stats = [
    views.length ? { label: t("stats.flights.flights"), value: nf.format(views.length), detail: km > 0 ? distance(km, unit) : undefined } : null,
    ss.aircraft.value ? { label: t("spotting.facts.aircraft"), value: nf.format(ss.aircraft.value), detail: t("home.figure.places", { count: places }) } : null,
    ...facts.map((x) => ({ label: x.label, value: x.text, detail: x.detail })),
  ];
  return {
    title: t("home.figure.title", { period: year === "all" ? "all" : "year", year }),
    subtitle: [views.length ? t("common.count.flights", { count: views.length }) : null, km > 0 ? distance(km, unit) : null, ss.aircraft.value ? t("home.figure.spotted", { count: ss.aircraft.value }) : null].filter(Boolean).join(" · "),
    stats: stats.filter((x) => x !== null),
  };
}
