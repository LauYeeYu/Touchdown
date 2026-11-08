// A share link's preview for chat apps (docs/32, "Previews"): its words and a picture of its map, made here, in the
// owner's browser and language, from what the link shows, and kept by the server with the link. Made when the link is
// made, and again once a day after sync when what it shows has changed (its fingerprint).

import { fnv1a, flightName, type Flight } from "@touchdown/core";
import { dayMonthYear, sortedFlights, type FlightView } from "@touchdown/core/view";
import { list, t } from "@touchdown/i18n";
import type { AppData } from "../data/app.ts";
import { account } from "../data/account.ts";
import { loadShares, shares, sharesNow, type ShareLink } from "../data/shares.ts";
import type { MapFlight } from "../components/maps.tsx";
import { cityOf, distance, shortAirport, typeName } from "./format.ts";
import { mapFlights, mapSpots } from "./mapdata.ts";
import { figurePng, type FigureSpot } from "./figure.ts";

export interface PreviewInput {
  title: string;
  description: string;
  flights: MapFlight[];
  spots: FigureSpot[];
  /** Changes when the words or what the map shows do. */
  fingerprint: string;
}

const join = (parts: (string | null | undefined | false)[]) => parts.filter(Boolean).join(" · ");

/** What a link's preview shows, from the log in this browser; null when the record is not here (any more). */
export async function previewInput(app: AppData, link: ShareLink): Promise<PreviewInput | null> {
  const { store, ref } = app;
  const unit = app.settings().distanceUnit ?? "km";
  const all = sortedFlights(store, ref);
  const mapOf = (views: FlightView[]) => mapFlights(views, ref, unit, new Set(), store);
  const spotAt = (airportId: string | null): FigureSpot[] => {
    const a = ref.airport(airportId);
    return a ? [{ at: [a.lon, a.lat], code: a.iata ?? a.icao ?? "" }] : [];
  };
  let title: string;
  let description: string;
  let flights: MapFlight[] = [];
  let spots: FigureSpot[] = [];
  if (link.kind === "flight") {
    const v = all.find((x) => x.f.id === link.subject);
    if (!v) return null;
    const name = flightName(v.f);
    const place = (id: string | null, raw: string | null) => cityOf(id, ref) ?? raw ?? "?";
    title = t("sharing.preview.flight", { named: name ? "yes" : "no", flight: name ?? "", from: place(v.f.fromAirportId, v.f.fromRaw), to: place(v.f.divertedToAirportId ?? v.f.toAirportId, v.f.toRaw) });
    description = join([v.day && dayMonthYear(v.day), v.f.typeCode && typeName(v.f.typeCode, ref), v.km !== null && distance(v.km, unit)]);
    flights = mapOf([v]);
  } else if (link.kind === "sighting") {
    const s = store.get("sightings", link.subject);
    if (!s) return null;
    title = join([s.registration ?? s.registrationRaw, s.typeCode && typeName(s.typeCode, ref)]);
    description = t("sharing.preview.seen", { place: s.airportId ? shortAirport(s.airportId, ref) : (s.airportRaw ?? "?"), dated: s.seenOn ? "yes" : "no", date: s.seenOn ? dayMonthYear(s.seenOn) : "" });
    spots = spotAt(s.airportId);
  } else if (link.kind === "aircraft") {
    const a = store.get("airframes", link.subject);
    if (!a) return null;
    const on = all.filter((v) => v.f.airframeId === a.id);
    const seen = store.all("sightings").filter((s) => s.airframeId === a.id);
    const reg = [...on.map((v) => v.f.registration), ...seen.map((s) => s.registration)].filter(Boolean).pop() ?? null;
    title = join([reg, a.typeCode && typeName(a.typeCode, ref)]);
    description = list([on.length ? t("common.count.flights", { count: on.length }) : null, seen.length ? t("common.count.sightings", { count: seen.length }) : null].filter((x): x is string => !!x));
    flights = mapOf(on);
    spots = [...new Set(seen.map((s) => s.airportId))].flatMap(spotAt);
  } else {
    const me = await account.me().catch(() => null);
    const km = all.reduce((n, v) => n + (v.km ?? 0), 0);
    title = me?.name ? t("sharing.preview.log", { owner: me.name }) : t("sharing.preview.logUnnamed");
    description = join([t("common.count.flights", { count: all.length }), km > 0 && distance(km, unit), t("common.count.aircraft", { count: store.count("airframes") })]);
    flights = mapOf(all);
    spots = mapSpots(store.all("sightings"), ref).map((sp) => ({ at: sp.at, code: sp.code, aircraft: sp.aircraft }));
  }
  const shape = [title, description, flights.map((f) => [f.id, f.line.map((l) => l.length), f.gaps?.length ?? 0]), spots.map((s) => [s.code, s.aircraft ?? 1])];
  return { title, description, flights, spots, fingerprint: fnv1a(JSON.stringify(shape)) };
}

/** Make a link's preview and send it to the server; false when its record is not here. */
export async function sendPreview(app: AppData, link: ShareLink, input?: PreviewInput | null): Promise<boolean> {
  const p = input ?? (await previewInput(app, link));
  if (!p) return false;
  const png = await figurePng({ width: 1200, height: 630, flights: p.flights, spots: p.spots, theme: "light" });
  const bytes = new Uint8Array(await png.arrayBuffer());
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  await shares.setPreview(link.id, { title: p.title, description: p.description, image: btoa(binary), fingerprint: p.fingerprint });
  return true;
}

/**
 * Make again the previews whose links show something else now (a flight edited, a track added, the log grown). Run
 * once a day after sync in Standard mode, when every recorded track is here so the maps are whole.
 */
export async function refreshPreviews(app: AppData): Promise<number> {
  if (app.tracksNotHere() > 0) return 0;
  await loadShares();
  const links = sharesNow()?.links ?? [];
  let sent = 0;
  for (const link of links) {
    const p = await previewInput(app, link);
    if (!p || p.fingerprint === link.previewFingerprint) continue;
    if (await sendPreview(app, link, p)) sent++;
  }
  return sent;
}

/** The flights on a figure for a flight's own page: as its map draws them. */
export const flightFigure = (app: AppData, f: Flight) => mapFlights(sortedFlights(app.store, app.ref).filter((v) => v.f.id === f.id), app.ref, app.settings().distanceUnit ?? "km", new Set(), app.store);
