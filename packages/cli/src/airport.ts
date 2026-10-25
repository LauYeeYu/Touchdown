// `touchdown airport CODE` (docs/34, "Reading"): an airport's page: how often the user left from it, landed at it
// and changed planes there, the flights, and the aircraft photographed there.

import { cityName, todayIn } from "@touchdown/core";
import { airlineLabel, airportSummary, airportWithCode, countryName, primaryCode, secondaryCode, shortAirport } from "@touchdown/core/view";
import { aircraftLabel, airportJson, duration, flightJson } from "./shape.ts";
import { argsOrHelp, fail, findAirport, openOrFail, periodLabel, periodOf, plain, printJson, readOptions, section, table, EXIT } from "./read.ts";
import { bold, dim, plural } from "./term.ts";

export const AIRPORT_HELP = `Usage: ./touchdown airport CODE [--year Y | all] [--log FILE] [--json]

One airport, as its page in the web app shows it: how often you left from it, landed at it and changed planes
there, its flights, and the aircraft you photographed there.

  CODE         the airport's IATA or ICAO code
  --year Y     one year (2025), or all; without it, this year when it has records, else the latest year
${readOptions(13)}

Exit status: 0 shown, 1 not an airport or not in your log, 2 the log could not be read.`;

const times = (n: number) => (n === 1 ? "once" : n === 2 ? "twice" : `${n} times`);

export async function airportCommand(args: string[]) {
  const a = argsOrHelp(args, { values: ["--year"] }, AIRPORT_HELP, [1, 1]);
  const json = a.flags.has("--json");
  const log = await openOrFail(json, a.values.get("--log"));
  const ap = findAirport(log.ref, a.positional[0]!);
  if (!ap) return fail(json, `${a.positional[0]} is not an airport code.`, EXIT.notFound);
  const year = periodOf(log.store, a.values.get("--year"), "default");
  if (typeof year !== "string") return fail(json, year.error);
  const s = airportSummary(log.store, log.ref, ap.id, year, log.codes);
  if (!s.everFlown && !s.everSpotted) return fail(json, `${shortAirport(ap.id, log.ref)} is not in your log.`, EXIT.notFound);
  const dep = s.visits.departures.length;
  const land = s.visits.landings.length;
  const trans = s.visits.transits.length;

  if (json)
    return printJson({
      ok: true,
      from: log.from,
      year,
      airport: airportJson(log, ap.id, null),
      departures: dep,
      landings: land,
      transits: trans,
      daysSpotting: s.days.size,
      firstDay: s.firstDay,
      mostFlownWith: s.topOther ? { airport: airportJson(log, s.topOther[0], null), flights: s.topOther[1] } : null,
      flights: [...s.here].reverse().map((v) => ({ ...flightJson(log, v), transit: s.transitIds.has(v.f.id) })),
      spotted: s.spotted.map((x) => ({ aircraftId: x.airframeId, registration: x.registration, typeCode: x.typeCode, type: aircraftLabel(log, x.typeCode, null) || null, airline: x.operatorId ? airlineLabel(x.operatorId, log.ref) : x.operatorRaw, sightings: x.count, days: x.days.size, last: x.last, flownOn: x.airframeId ? (s.flownOn.get(x.airframeId) ?? 0) : 0 })),
    });

  const name = shortAirport(ap.id, log.ref);
  const other = secondaryCode(ap, log.codes);
  console.log(bold(`${primaryCode(ap, null, log.codes)} · ${cityName(ap) ?? ap.name}`) + dim(` · ${ap.name}${ap.country ? `, ${countryName(ap.country)}` : ""}${other ? ` · ${other}` : ""}`));
  const thisYear = todayIn().slice(0, 4);
  const opening = year === "all" ? "" : year === thisYear ? `So far in ${year} ` : `In ${year} `;
  const parts: string[] = [];
  if (dep) parts.push(`left from ${name} ${times(dep)}`);
  if (land) parts.push(`landed ${dep ? "there" : `at ${name}`} ${times(land)}`);
  if (trans) parts.push(`changed planes ${dep || land ? "there" : `at ${name}`} ${times(trans)}`);
  const sentences: string[] = [];
  if (parts.length) sentences.push(`${opening ? `${opening}you` : "You"} ${parts.length > 1 ? `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}` : parts[0]}.`);
  if (s.sightings.length) sentences.push(`You photographed ${plural(s.spotted.length, "aircraft", "aircraft")} there on ${plural(s.days.size, "day")}.`);
  if (s.topOther) sentences.push(`Most often to or from ${plain(airportWithCode(s.topOther[0], log.ref, null, log.codes))}: ${plural(s.topOther[1], "flight")}.`);
  console.log(sentences.length ? sentences.join(" ") : `Nothing logged at ${name} in ${periodLabel(year)}.`);

  if (s.here.length) {
    const rows = [...s.here].reverse().map((v) => [v.day ?? "", `${v.fromCode} → ${v.toCode}`, v.f.flightNumber ?? "", airlineLabel(v.f.airlineId, log.ref) || v.f.airlineRaw || "", [aircraftLabel(log, v.f.typeCode, null), v.f.registration].filter(Boolean).join(" · "), duration(v.min), s.transitIds.has(v.f.id) ? "transit" : ""]);
    for (const line of section(`Flights: ${s.here.length}`, table([{ head: "Date" }, { head: "Route" }, { head: "Flight" }, { head: "Airline" }, { head: "Aircraft", flex: true }, { head: "Time", align: "right" }, { head: "" }], rows))) console.log(line);
  }
  if (s.spotted.length) {
    const rows = s.spotted.map((x) => [x.registration, aircraftLabel(log, x.typeCode, null), x.operatorId ? airlineLabel(x.operatorId, log.ref) : (x.operatorRaw ?? ""), String(x.count), x.last ?? "", x.airframeId && s.flownOn.get(x.airframeId) ? `flew ${times(s.flownOn.get(x.airframeId)!)}` : ""]);
    for (const line of section(`Aircraft photographed: ${s.spotted.length}`, table([{ head: "Registration" }, { head: "Aircraft", flex: true }, { head: "Airline" }, { head: "Seen", align: "right" }, { head: "Last" }, { head: "" }], rows))) console.log(line);
  }
  console.log(dim(`\nRead from ${log.from}.`));
}
