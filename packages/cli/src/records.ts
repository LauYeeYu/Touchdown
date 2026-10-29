// `touchdown flights`, `flight`, `sightings` and `sessions` (docs/34, "Reading"): the Flights and Spotting pages and a
// flight's page, in the terminal or as JSON.

import { arrivalAirportId, phasesOf, type Flight, type Sighting } from "@touchdown/core";
import { airlineLabel, airportWithCode, CABIN_LABEL, dayLong, distance, flightSearch, inPeriod, PHASE_LABEL, REASON_LABEL, sessionsOf, sortedFlights, textCode, TRACK_SOURCE, type FlightView } from "@touchdown/core/view";
import { aircraftLabel, airportJson, duration, findingJson, findingsOf, flightJson, openFindings, sightingJson, timeLabel, trackOf } from "./shape.ts";
import { argsOrHelp, fail, fields, findAirport, findFlight, notFound, openOrFail, periodLabel, periodOf, plain, printJson, privateFields, readOptions, section, table, type OpenedLog } from "./read.ts";
import { bold, dim, plural, red, yellow } from "./term.ts";

export const FLIGHTS_HELP = `Usage: ./touchdown flights [--year Y | all] [--airline X] [--airport X] [--type X] [--search TEXT] [--recorded]
                         [--log FILE] [--json]

Your flights, newest first, as the Flights page lists them.

  --year Y        one year (2025), or all (the default)
  --airline X     flown with this airline: its IATA or ICAO code, or its name
  --airport X     from or to this airport: its IATA or ICAO code
  --type X        on this type: its ICAO type code (A21N)
  --search TEXT   as the Flights page's search: flight number, airports, cities, registration, airline, type,
                  or a route: "SHA-PEK" either way, "SHA > PEK" one way
  --recorded      only flights with a recorded track
${readOptions(16)}`;

export const FLIGHT_HELP = `Usage: ./touchdown flight REF [--log FILE] [--json]

One flight, as its page in the web app shows it: every field, the aircraft, the track and the open findings.
Ticket numbers and booking references are never shown, only whether one is recorded.

  REF          the flight's id, or its flight number and day: XY123@2025-04-02
${readOptions(13)}

Exit status: 0 shown, 1 no such flight (or several: their ids are listed), 2 the log could not be read.`;

export const SIGHTINGS_HELP = `Usage: ./touchdown sightings [--year Y | all] [--airport X] [--airline X] [--type X] [--search TEXT]
                           [--log FILE] [--json]

The aircraft you photographed, newest first.

  --year Y        one year (2025), or all (the default)
  --airport X     at this airport: its IATA or ICAO code
  --airline X     of this airline: its IATA or ICAO code, or its name
  --type X        of this type: its ICAO type code (B738)
  --search TEXT   registration, type, airline or airport
${readOptions(16)}`;

export const SESSIONS_HELP = `Usage: ./touchdown sessions [--year Y | all] [--log FILE] [--json]

Your days out spotting, newest first: the day, the airport, how many sightings and aircraft, and how many of
those aircraft were new to your log.

  --year Y        one year (2025), or all (the default)
${readOptions(16)}`;

const squash = (s: string) => s.toLowerCase().replace(/\s+/g, "");

/** An airline named by code or name, or stop. */
function airlineOf(log: OpenedLog, json: boolean, text: string | undefined): string | null {
  if (!text) return null;
  const op = log.ref.operatorByCode(text);
  return op ? op.id : fail(json, `${text} is not an airline in your log or in the reference data.`);
}

function airportOf(log: OpenedLog, json: boolean, text: string | undefined): string | null {
  if (!text) return null;
  const a = findAirport(log.ref, text);
  return a ? a.id : fail(json, `${text} is not an airport code.`);
}

const route = (v: FlightView) => `${v.fromCode} → ${v.toCode}`;

/** "A11", "A11 (terminal 3)", "terminal 3". */
const gate = (g: string | null, terminal: string | null) => (g ? (terminal ? `${g} (terminal ${terminal})` : g) : terminal ? `terminal ${terminal}` : null);

const trackWord = (log: OpenedLog, f: Flight) => {
  const t = trackOf(log, f.id);
  return !t ? "" : t.coverage === "partial" ? "partial" : "recorded";
};

export async function flightsCommand(args: string[]) {
  const a = argsOrHelp(args, { values: ["--year", "--airline", "--airport", "--type", "--search"], flags: ["--recorded"] }, FLIGHTS_HELP);
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
  console.log(`${bold(plural(shown.length, "flight"))} in ${periodLabel(year)}${km ? `, ${plain(distance(km, log.unit))}` : ""}. ${dim(`Read from ${log.from}.`)}`);
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
    [{ head: "Date" }, { head: "Route" }, { head: "Flight" }, { head: "Airline" }, { head: "Aircraft", flex: true }, { head: "Time", align: "right" }, { head: "Distance", align: "right" }, { head: "Track" }],
    rows,
  ))
    console.log(line);
}

export async function flightCommand(args: string[]) {
  const a = argsOrHelp(args, {}, FLIGHT_HELP, [1, 1]);
  const json = a.flags.has("--json");
  const log = await openOrFail(json, a.values.get("--log"));
  const found = findFlight(log.store, a.positional[0]!);
  if (!("row" in found)) return notFound(json, found);
  const f = found.row;
  const v = sortedFlights(log.store, log.ref, log.codes).find((x) => x.f.id === f.id)!;
  const shape = flightJson(log, v);
  const findings = findingsOf(openFindings(log), "flights", f.id);

  if (json) return printJson({ ok: true, from: log.from, flight: shape, findings: findings.map(findingJson) });
  const t = trackOf(log, f.id);
  const priv = privateFields(f);
  const arrival = f.divertedToAirportId ?? f.toAirportId;
  console.log(bold([f.flightNumber, route(v), v.day && plain(dayLong(v.day))].filter(Boolean).join(" · ")));
  for (const line of fields([
    ["Airline", airlineLabel(f.airlineId, log.ref) || f.airlineRaw],
    ["Operated by", f.operatingAirlineId ? airlineLabel(f.operatingAirlineId, log.ref) : null],
    ["From", airportWithCode(f.fromAirportId, log.ref, f.fromRaw, log.codes)],
    ["To", airportWithCode(f.toAirportId, log.ref, f.toRaw, log.codes)],
    ["Diverted to", f.divertedToAirportId ? airportWithCode(arrival, log.ref, null, log.codes) : null],
    ["Boarding", timeLabel(f.boardingAt)],
    ["Departure", timeLabel(f.departureAt)],
    ["Takeoff", timeLabel(f.takeoffAt)],
    ["Landing", timeLabel(f.landingAt)],
    ["Arrival", timeLabel(f.arrivalAt)],
    ["Duration", duration(v.min)],
    ["Distance", v.km === null ? null : distance(v.km, log.unit)],
    ["Aircraft", [aircraftLabel(log, f.typeCode, f.model), f.registration].filter(Boolean).join(" · ")],
    ["Seat", [f.seat, f.seatPosition].filter(Boolean).join(", ")],
    ["Class", [f.cabinClass && (CABIN_LABEL[f.cabinClass] ?? f.cabinClass), f.bookingClass, f.fareBrand].filter(Boolean).join(" · ")],
    ["Departure gate", gate(f.departureGate, f.departureTerminal)],
    ["Arrival gate", gate(f.arrivalGate, f.arrivalTerminal)],
    ["Reason", f.reason && (REASON_LABEL[f.reason] ?? f.reason)],
    ["Livery", [f.specialLivery, f.livery].filter(Boolean).join(" · ")],
    ["Notes", f.notes],
    ["Track", t ? `${t.coverage === "partial" ? "Recorded, with gaps" : "Recorded"}${t.provider && TRACK_SOURCE[t.provider] ? `, from ${TRACK_SOURCE[t.provider]}` : ""}` : "Great circle only"],
    ["Ticket number", priv.ticketNumber ? "recorded" : null],
    ["Booking reference", priv.bookingRef ? "recorded" : null],
    ["Aircraft id", f.airframeId],
    ["Id", f.id],
  ]))
    console.log(`  ${line}`);
  if (findings.length) for (const line of section("Findings", findings.map((x) => `${x.severity === "error" ? red("!") : yellow("?")} ${x.message}`))) console.log(line);
}

function sightingMatches(log: OpenedLog, s: Sighting, needle: string): boolean {
  if (!needle) return true;
  const a = log.ref.airport(s.airportId);
  return squash([s.registration, s.registrationRaw, s.typeCode, airlineLabel(s.operatorId, log.ref), s.operatorRaw, a?.iata, a?.icao, a?.city, s.airportRaw].join("|")).includes(needle);
}

export async function sightingsCommand(args: string[]) {
  const a = argsOrHelp(args, { values: ["--year", "--airport", "--airline", "--type", "--search"] }, SIGHTINGS_HELP);
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
  console.log(`${bold(plural(shown.length, "sighting"))} of ${plural(aircraft, "aircraft", "aircraft")} at ${plural(airports, "airport")} in ${periodLabel(year)}. ${dim(`Read from ${log.from}.`)}`);
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
  for (const line of table([{ head: "Date" }, { head: "Airport" }, { head: "Registration" }, { head: "Aircraft", flex: true }, { head: "Airline" }, { head: "Phase" }], rows)) console.log(line);
}

export async function sessionsCommand(args: string[]) {
  const a = argsOrHelp(args, { values: ["--year"] }, SESSIONS_HELP);
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
  console.log(`${bold(plural(sessions.length, "day out", "days out"))} in ${periodLabel(year)}. ${dim(`Read from ${log.from}.`)}`);
  if (!sessions.length) return;
  console.log("");
  const rows = sessions.map((s) => [s.date ?? "", airportWithCode(s.airportId, log.ref, s.sightings[0]?.airportRaw ?? null, log.codes), String(s.sightings.length), String(s.aircraft), s.newAircraft ? String(s.newAircraft) : ""]);
  for (const line of table([{ head: "Date" }, { head: "Airport", flex: true }, { head: "Sightings", align: "right" }, { head: "Aircraft", align: "right" }, { head: "New", align: "right" }], rows)) console.log(line);
}
