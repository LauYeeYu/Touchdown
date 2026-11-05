// `touchdown flights`, `flight`, `sightings` and `sessions` (docs/34, "Reading"): the Flights and Spotting pages and a
// flight's page, in the terminal or as JSON.

import { arrivalAirportId, phasesOf, type Flight, type Sighting } from "@touchdown/core";
import { airlineLabel, airportWithCode, CABIN_LABEL, dayLong, distance, extensionPercent, flightSearch, inPeriod, PHASE_LABEL, REASON_LABEL, routeExtension, sessionsOf, sortedFlights, textCode, TRACK_SOURCE, type FlightView } from "@touchdown/core/view";
import { t } from "@touchdown/i18n/cli";
import { aircraftLabel, airportJson, duration, findingJson, findingsOf, flightJson, openFindings, sightingJson, timeLabel, trackOf } from "./shape.ts";
import { argsOrHelp, fail, fields, findAirport, findFlight, notFound, openOrFail, optionLines, periodOf, plain, printJson, privateFields, readFrom, readOptions, section, table, usage, type OpenedLog } from "./read.ts";
import { bold, dim, red, yellow, tc } from "./term.ts";

export const flightsHelp = () => `${usage(`./touchdown flights [--year Y | all] [--airline X] [--airport X] [--type X] [--search TEXT] [--recorded]
                         [--log FILE] [--json]`)}

${t("cliRead.flights.help")}

${optionLines(16, [
  ["--year Y", t("cliRead.option.yearAll")],
  ["--airline X", t("cliRead.flights.option.airline")],
  ["--airport X", t("cliRead.flights.option.airport")],
  ["--type X", t("cliRead.flights.option.type")],
  ["--search TEXT", t("cliRead.flights.option.search")],
  ["--recorded", t("cliRead.flights.option.recorded")],
])}
${readOptions(16)}`;

export const flightHelp = () => `${usage("./touchdown flight REF [--log FILE] [--json]")}

${t("cliRead.flight.help")}

${optionLines(13, [["REF", t("cliRead.flight.option.ref")]])}
${readOptions(13)}

${t("cliRead.flight.exit")}`;

export const sightingsHelp = () => `${usage(`./touchdown sightings [--year Y | all] [--airport X] [--airline X] [--type X] [--search TEXT]
                           [--log FILE] [--json]`)}

${t("cliRead.sightings.help")}

${optionLines(16, [
  ["--year Y", t("cliRead.option.yearAll")],
  ["--airport X", t("cliRead.sightings.option.airport")],
  ["--airline X", t("cliRead.sightings.option.airline")],
  ["--type X", t("cliRead.sightings.option.type")],
  ["--search TEXT", t("cliRead.sightings.option.search")],
])}
${readOptions(16)}`;

export const sessionsHelp = () => `${usage("./touchdown sessions [--year Y | all] [--log FILE] [--json]")}

${t("cliRead.sessions.help")}

${optionLines(16, [["--year Y", t("cliRead.option.yearAll")]])}
${readOptions(16)}`;

const squash = (s: string) => s.toLowerCase().replace(/\s+/g, "");

/** An airline named by code or name, or stop. */
function airlineOf(log: OpenedLog, json: boolean, text: string | undefined): string | null {
  if (!text) return null;
  const op = log.ref.operatorByCode(text);
  return op ? op.id : fail(json, t("cliRead.find.airline.none", { text }));
}

function airportOf(log: OpenedLog, json: boolean, text: string | undefined): string | null {
  if (!text) return null;
  const a = findAirport(log.ref, text);
  return a ? a.id : fail(json, t("cliRead.find.airport.notCode", { text }));
}

const route = (v: FlightView) => `${v.fromCode} → ${v.toCode}`;

/** "A11", "A11 (terminal 3)", "terminal 3". */
const gate = (g: string | null, terminal: string | null) => (g ? (terminal ? t("cliRead.flight.gateTerminal", { gate: g, terminal }) : g) : terminal ? t("cliRead.flight.terminal", { terminal }) : null);

const trackWord = (log: OpenedLog, f: Flight) => {
  const track = trackOf(log, f.id);
  return !track ? "" : track.coverage === "partial" ? t("cliRead.flights.track.partial") : t("cliRead.flights.track.recorded");
};

export async function flightsCommand(args: string[]) {
  const a = argsOrHelp(args, { values: ["--year", "--airline", "--airport", "--type", "--search"], flags: ["--recorded"] }, flightsHelp());
  const json = a.flags.has("--json");
  const log = await openOrFail(json, a.values.get("--log"));
  const year = periodOf(log.store, a.values.get("--year"), "all");
  if (typeof year !== "string") return fail(json, year.error);
  const airline = airlineOf(log, json, a.values.get("--airline"));
  const airport = airportOf(log, json, a.values.get("--airport"));
  const type = a.values.get("--type")?.toUpperCase();
  const search = flightSearch(a.values.get("--search") ?? "", log.ref);
  const recorded = a.flags.has("--recorded");
  const tracked = new Set(log.store.all("tracks").map((t) => t.flightId));

  const shown = sortedFlights(log.store, log.ref, log.codes)
    .filter((v) => inPeriod(v.day, year))
    .filter((v) => !airline || v.f.airlineId === airline)
    .filter((v) => !airport || v.f.fromAirportId === airport || v.f.toAirportId === airport || arrivalAirportId(v.f) === airport)
    .filter((v) => !type || v.f.typeCode === type)
    .filter((v) => !recorded || tracked.has(v.f.id))
    .filter(search)
    .reverse();
  const km = shown.reduce((n, v) => n + (v.km ?? 0), 0);

  if (json) return printJson({ ok: true, from: log.from, year, count: shown.length, distanceKm: Math.round(km), flights: shown.map((v) => flightJson(log, v)) });
  const summary = km ? tc("cliRead.flights.summaryDistance", { count: shown.length, year, distance: plain(distance(km, log.unit)) }, { b: bold }) : tc("cliRead.flights.summary", { count: shown.length, year }, { b: bold });
  console.log(`${summary} ${dim(readFrom(log))}`);
  if (!shown.length) return;
  console.log("");
  const rows = shown.map((v) => [
    v.day ?? "",
    route(v),
    v.f.flightNumber ?? "",
    airlineLabel(v.f.airlineId, log.ref) || v.f.airlineRaw || "",
    [aircraftLabel(log, v.f.typeCode, null), v.f.registration].filter(Boolean).join(" · "),
    duration(v.min),
    v.km === null ? "" : plain(distance(v.km, log.unit)),
    trackWord(log, v.f),
  ]);
  for (const line of table(
    [{ head: t("cliRead.column.date") }, { head: t("cliRead.column.route") }, { head: t("cliRead.column.flight") }, { head: t("cliRead.column.airline") }, { head: t("cliRead.column.aircraft"), flex: true }, { head: t("cliRead.column.time"), align: "right" }, { head: t("cliRead.column.distance"), align: "right" }, { head: t("cliRead.column.track") }],
    rows,
  ))
    console.log(line);
}

/**
 * The flight's recorded positions, for its route extension: the log is read without them, so this flight's track is
 * read from the storage on its own. A backup holds them already. Without them the route extension is left out.
 */
async function withTrackPoints(log: OpenedLog, flightId: string) {
  const t = log.store.all("tracks").find((x) => x.flightId === flightId);
  if (!t || !log.storage || log.store.all("track_points").some((p) => p.trackId === t.id)) return;
  try {
    log.store.load("track_points", (await log.storage.backend.readTrack(t.id)) as never);
  } catch {
    // Left out, as for a flight without a track.
  }
}

export async function flightCommand(args: string[]) {
  const a = argsOrHelp(args, {}, flightHelp(), [1, 1]);
  const json = a.flags.has("--json");
  const log = await openOrFail(json, a.values.get("--log"));
  const found = findFlight(log.store, a.positional[0]!);
  if (!("row" in found)) return notFound(json, found);
  const f = found.row;
  await withTrackPoints(log, f.id);
  const v = sortedFlights(log.store, log.ref, log.codes).find((x) => x.f.id === f.id)!;
  const shape = flightJson(log, v);
  const findings = findingsOf(openFindings(log), "flights", f.id);

  if (json) return printJson({ ok: true, from: log.from, flight: shape, findings: findings.map(findingJson) });
  const track = trackOf(log, f.id);
  const ext = routeExtension(log.store, log.ref, f);
  const priv = privateFields(log, f);
  const arrival = f.divertedToAirportId ?? f.toAirportId;
  console.log(bold([f.flightNumber, route(v), v.day && plain(dayLong(v.day))].filter(Boolean).join(" · ")));
  for (const line of fields([
    [t("cliRead.flight.field.airline"), airlineLabel(f.airlineId, log.ref) || f.airlineRaw],
    [t("cliRead.flight.field.operatedBy"), f.operatingAirlineId ? airlineLabel(f.operatingAirlineId, log.ref) : null],
    [t("cliRead.flight.field.from"), airportWithCode(f.fromAirportId, log.ref, f.fromRaw, log.codes)],
    [t("cliRead.flight.field.to"), airportWithCode(f.toAirportId, log.ref, f.toRaw, log.codes)],
    [t("cliRead.flight.field.divertedTo"), f.divertedToAirportId ? airportWithCode(arrival, log.ref, null, log.codes) : null],
    [t("cliRead.flight.field.boarding"), timeLabel(f.boardingAt)],
    [t("cliRead.flight.field.departure"), timeLabel(f.departureAt)],
    [t("cliRead.flight.field.takeoff"), timeLabel(f.takeoffAt)],
    [t("cliRead.flight.field.landing"), timeLabel(f.landingAt)],
    [t("cliRead.flight.field.arrival"), timeLabel(f.arrivalAt)],
    [t("cliRead.flight.field.duration"), duration(v.min)],
    [t("cliRead.flight.field.distance"), v.km === null ? null : distance(v.km, log.unit)],
    [t("cliRead.flight.field.aircraft"), [aircraftLabel(log, f.typeCode, f.model), f.registration].filter(Boolean).join(" · ")],
    [t("cliRead.flight.field.seat"), [f.seat, f.seatPosition].filter(Boolean).join(", ")],
    [t("cliRead.flight.field.class"), [f.cabinClass && (CABIN_LABEL[f.cabinClass] ?? f.cabinClass), f.bookingClass, f.fareBrand].filter(Boolean).join(" · ")],
    [t("cliRead.flight.field.departureGate"), gate(f.departureGate, f.departureTerminal)],
    [t("cliRead.flight.field.arrivalGate"), gate(f.arrivalGate, f.arrivalTerminal)],
    [t("cliRead.flight.field.reason"), f.reason && (REASON_LABEL[f.reason] ?? f.reason)],
    [t("cliRead.flight.field.livery"), [f.specialLivery, f.livery].filter(Boolean).join(" · ")],
    [t("cliRead.flight.field.notes"), f.notes],
    [t("cliRead.flight.field.track"), trackText(track)],
    [
      t("cliRead.flight.field.routeExtension"),
      ext ? t(ext.minimum ? "cliRead.flight.extensionMinimum" : "cliRead.flight.extension", { percent: extensionPercent(ext.percent), flown: distance(ext.flownKm, log.unit), greatCircle: distance(ext.greatCircleKm, log.unit) }) : null,
    ],
    [t("cliRead.flight.field.ticketNumber"), priv.ticketNumber ? t("cliRead.flight.private.recorded") : null],
    [t("cliRead.flight.field.bookingRef"), priv.bookingRef ? t("cliRead.flight.private.recorded") : null],
    [t("cliRead.flight.field.aircraftId"), f.airframeId],
    [t("cliRead.flight.field.id"), f.id],
  ]))
    console.log(`  ${line}`);
  if (findings.length) for (const line of section(t("cliRead.findings"), findings.map((x) => `${x.severity === "error" ? red("!") : yellow("?")} ${x.message}`))) console.log(line);
}

/** "Recorded, with gaps, from adsb.lol", or "Great circle only" without a track. */
function trackText(track: ReturnType<typeof trackOf>): string {
  if (!track) return t("cliRead.flight.track.none");
  const source = track.provider ? TRACK_SOURCE[track.provider] : undefined;
  const partial = track.coverage === "partial";
  if (source) return partial ? t("cliRead.flight.track.partialFrom", { source }) : t("cliRead.flight.track.recordedFrom", { source });
  return partial ? t("cliRead.flight.track.partial") : t("cliRead.flight.track.recorded");
}

function sightingMatches(log: OpenedLog, s: Sighting, needle: string): boolean {
  if (!needle) return true;
  const a = log.ref.airport(s.airportId);
  return squash([s.registration, s.registrationRaw, s.typeCode, airlineLabel(s.operatorId, log.ref), s.operatorRaw, a?.iata, a?.icao, a?.city, s.airportRaw].join("|")).includes(needle);
}

export async function sightingsCommand(args: string[]) {
  const a = argsOrHelp(args, { values: ["--year", "--airport", "--airline", "--type", "--search"] }, sightingsHelp());
  const json = a.flags.has("--json");
  const log = await openOrFail(json, a.values.get("--log"));
  const year = periodOf(log.store, a.values.get("--year"), "all");
  if (typeof year !== "string") return fail(json, year.error);
  const airport = airportOf(log, json, a.values.get("--airport"));
  const airline = airlineOf(log, json, a.values.get("--airline"));
  const type = a.values.get("--type")?.toUpperCase();
  const needle = squash(a.values.get("--search") ?? "");
  const shown = log.store
    .all("sightings")
    .filter((s) => inPeriod(s.seenOn, year))
    .filter((s) => !airport || s.airportId === airport)
    .filter((s) => !airline || s.operatorId === airline)
    .filter((s) => !type || s.typeCode === type)
    .filter((s) => sightingMatches(log, s, needle))
    .sort((x, y) => (y.seenOn ?? "").localeCompare(x.seenOn ?? "") || (y.seenAt ?? "").localeCompare(x.seenAt ?? "") || x.id.localeCompare(y.id));
  const aircraft = new Set(shown.map((s) => s.airframeId ?? s.id)).size;
  const airports = new Set(shown.map((s) => s.airportId ?? s.airportRaw).filter(Boolean)).size;

  if (json) return printJson({ ok: true, from: log.from, year, count: shown.length, aircraft, airports, sightings: shown.map((s) => sightingJson(log, s)) });
  console.log(`${tc("cliRead.sightings.summary", { count: shown.length, aircraft, airports, year }, { b: bold })} ${dim(readFrom(log))}`);
  if (!shown.length) return;
  console.log("");
  const rows = shown.map((s) => [
    s.seenOn ?? "",
    textCode(log.ref.airport(s.airportId), s.airportRaw, log.codes),
    s.registration ?? s.registrationRaw ?? "",
    aircraftLabel(log, s.typeCode, s.model),
    airlineLabel(s.operatorId, log.ref) || s.operatorRaw || "",
    phasesOf(log.store, s.id)
      .map((p) => PHASE_LABEL[p] ?? p)
      .join(", "),
  ]);
  for (const line of table([{ head: t("cliRead.column.date") }, { head: t("cliRead.column.airport") }, { head: t("cliRead.column.registration") }, { head: t("cliRead.column.aircraft"), flex: true }, { head: t("cliRead.column.airline") }, { head: t("cliRead.column.phase") }], rows)) console.log(line);
}

export async function sessionsCommand(args: string[]) {
  const a = argsOrHelp(args, { values: ["--year"] }, sessionsHelp());
  const json = a.flags.has("--json");
  const log = await openOrFail(json, a.values.get("--log"));
  const year = periodOf(log.store, a.values.get("--year"), "all");
  if (typeof year !== "string") return fail(json, year.error);
  const sessions = sessionsOf(log.store).filter((s) => inPeriod(s.date, year));

  if (json)
    return printJson({
      ok: true,
      from: log.from,
      year,
      count: sessions.length,
      sessions: sessions.map((s) => ({ date: s.date, airport: airportJson(log, s.airportId, s.sightings[0]?.airportRaw ?? null), sightings: s.sightings.length, aircraft: s.aircraft, newAircraft: s.newAircraft, sightingIds: s.sightings.map((x) => x.id) })),
    });
  console.log(`${tc("cliRead.sessions.summary", { count: sessions.length, year }, { b: bold })} ${dim(readFrom(log))}`);
  if (!sessions.length) return;
  console.log("");
  const rows = sessions.map((s) => [s.date ?? "", airportWithCode(s.airportId, log.ref, s.sightings[0]?.airportRaw ?? null, log.codes), String(s.sightings.length), String(s.aircraft), s.newAircraft ? String(s.newAircraft) : ""]);
  for (const line of table([{ head: t("cliRead.column.date") }, { head: t("cliRead.column.airport"), flex: true }, { head: t("cliRead.column.sightings"), align: "right" }, { head: t("cliRead.column.aircraft"), align: "right" }, { head: t("cliRead.column.new"), align: "right" }], rows)) console.log(line);
}
