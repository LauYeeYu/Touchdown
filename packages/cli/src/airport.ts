// `touchdown airport CODE` (docs/34, "Reading"): an airport's page: how often the user left from it, landed at it
// and changed planes there, the flights, and the aircraft photographed there.

import { cityName, flightName, todayIn } from "@touchdown/core";
import { airlineLabel, airportSummary, airportWithCode, countryName, primaryCode, secondaryCode, shortAirport } from "@touchdown/core/view";
import { list, t } from "@touchdown/i18n/cli";
import { aircraftLabel, airportJson, duration, flightJson } from "./shape.ts";
import { argsOrHelp, fail, findAirport, openOrFail, optionLines, periodOf, plain, printJson, readFrom, readOptions, section, table, usage, EXIT } from "./read.ts";
import { bold, dim } from "./term.ts";

export const airportHelp = () => `${usage("./touchdown airport CODE [--year Y | all] [--log FILE] [--json]")}

${t("cliRead.airport.help")}

${optionLines(13, [
  ["CODE", t("cliRead.airport.option.code")],
  ["--year Y", t("cliRead.option.yearDefault")],
])}
${readOptions(13)}

${t("cliRead.airport.exit")}`;

export async function airportCommand(args: string[]) {
  const a = argsOrHelp(args, { values: ["--year"] }, airportHelp(), [1, 1]);
  const json = a.flags.has("--json");
  // With the tracks' positions, so distances are the ones flown, as the web app shows them.
  const log = await openOrFail(json, a.values.get("--log"), { tracks: true });
  const ap = findAirport(log.ref, a.positional[0]!);
  if (!ap) return fail(json, t("cliRead.find.airport.notCode", { text: a.positional[0]! }), EXIT.notFound);
  const year = periodOf(log.store, a.values.get("--year"), "default");
  if (typeof year !== "string") return fail(json, year.error);
  const s = airportSummary(log.store, log.ref, ap.id, year, log.codes);
  if (!s.everFlown && !s.everSpotted) return fail(json, t("cliRead.airport.notInLog", { airport: shortAirport(ap.id, log.ref) }), EXIT.notFound);
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
  const period = year === "all" ? "all" : year === thisYear ? "current" : "past";
  const parts: string[] = [];
  if (dep) parts.push(t("cliRead.airport.visits.left", { airport: name, count: dep }));
  if (land) parts.push(dep ? t("cliRead.airport.visits.landedThere", { count: land }) : t("cliRead.airport.visits.landed", { airport: name, count: land }));
  if (trans) parts.push(dep || land ? t("cliRead.airport.visits.changedThere", { count: trans }) : t("cliRead.airport.visits.changed", { airport: name, count: trans }));
  const sentences: string[] = [];
  if (parts.length) sentences.push(t("cliRead.airport.visits", { period, year, visits: list(parts) }));
  if (s.sightings.length) sentences.push(t("cliRead.airport.photographed", { aircraft: s.spotted.length, days: s.days.size }));
  if (s.topOther) sentences.push(t("cliRead.airport.mostOften", { airport: plain(airportWithCode(s.topOther[0], log.ref, null, log.codes)), count: s.topOther[1] }));
  console.log(sentences.length ? sentences.join(" ") : t("cliRead.airport.nothing", { airport: name, year }));

  if (s.here.length) {
    const rows = [...s.here].reverse().map((v) => [v.day ?? "", `${v.fromCode} → ${v.toCode}`, flightName(v.f) ?? "", airlineLabel(v.f.airlineId, log.ref) || v.f.airlineRaw || "", [aircraftLabel(log, v.f.typeCode, null), v.f.registration].filter(Boolean).join(" · "), duration(v.min), s.transitIds.has(v.f.id) ? t("cliRead.airport.transit") : ""]);
    const head = [{ head: t("cliRead.column.date") }, { head: t("cliRead.column.route") }, { head: t("cliRead.column.flight") }, { head: t("cliRead.column.airline") }, { head: t("cliRead.column.aircraft"), flex: true }, { head: t("cliRead.column.time"), align: "right" as const }, { head: "" }];
    for (const line of section(t("cliRead.airport.flights", { count: s.here.length }), table(head, rows))) console.log(line);
  }
  if (s.spotted.length) {
    const rows = s.spotted.map((x) => [x.registration, aircraftLabel(log, x.typeCode, null), x.operatorId ? airlineLabel(x.operatorId, log.ref) : (x.operatorRaw ?? ""), String(x.count), x.last ?? "", x.airframeId && s.flownOn.get(x.airframeId) ? t("cliRead.airport.flew", { count: s.flownOn.get(x.airframeId)! }) : ""]);
    const head = [{ head: t("cliRead.column.registration") }, { head: t("cliRead.column.aircraft"), flex: true }, { head: t("cliRead.column.airline") }, { head: t("cliRead.column.seen"), align: "right" as const }, { head: t("cliRead.column.last") }, { head: "" }];
    for (const line of section(t("cliRead.airport.spotted", { count: s.spotted.length }), table(head, rows))) console.log(line);
  }
  console.log(dim(`\n${readFrom(log)}`));
}
