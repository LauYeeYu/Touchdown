// `touchdown aircraft [REF]` (docs/34, "Reading"): the Aircraft page's list, or one aircraft's page: its facts,
// registrations and every time the user flew on it or photographed it.

import { flightDay, phasesOf } from "@touchdown/core";
import { aircraftViews, airlineLabel, airportWithCode, PHASE_LABEL, STATUS_WORD, textCode, type AircraftView } from "@touchdown/core/view";
import { t } from "@touchdown/i18n/cli";
import { aircraftLabel, airportJson, findingJson, openFindings } from "./shape.ts";
import { argsOrHelp, fail, fields, findAircraft, notFound, openOrFail, optionLines, plain, printJson, readFrom, readOptions, section, table, usage, type OpenedLog } from "./read.ts";
import { bold, dim, red, yellow, tc } from "./term.ts";
import { aircraftChangeCommand, aircraftChangeHelp } from "./change.ts";

export const aircraftHelp = () => `${usage(`./touchdown aircraft [--flown | --both | --provisional | --no-first-flight] [--search TEXT]
                          [--sort last | count | reg] [--log FILE] [--json]
       ./touchdown aircraft REF [--log FILE] [--json]`)}

${t("cliRead.aircraft.help")}

${optionLines(19, [
  ["REF", t("cliRead.aircraft.option.ref")],
  ["--flown", t("cliRead.aircraft.option.flown")],
  ["--both", t("cliRead.aircraft.option.both")],
  ["--provisional", t("cliRead.aircraft.option.provisional")],
  ["--no-first-flight", t("cliRead.aircraft.option.noFirstFlight")],
  ["--search TEXT", t("cliRead.aircraft.option.search")],
  ["--sort ORDER", t("cliRead.aircraft.option.sort")],
])}
${readOptions(19)}

${aircraftChangeHelp()}`;

const squash = (s: string) => s.toLowerCase().replace(/[\s-]+/g, "");

function listJson(log: OpenedLog, v: AircraftView) {
  const a = v.airframe;
  return {
    id: a.id,
    registration: v.registration,
    typeCode: a.typeCode,
    type: aircraftLabel(log, a.typeCode, a.model) || null,
    manufacturer: a.manufacturer,
    msn: a.msn,
    provisional: !!a.provisional,
    airline: v.operatorId ? { id: v.operatorId, name: airlineLabel(v.operatorId, log.ref) } : null,
    flights: v.flights.length,
    sightings: v.sightings.length,
    first: v.first,
    last: v.last,
  };
}

export async function aircraftCommand(args: string[]) {
  if (args[0] === "edit" || args[0] === "merge") return aircraftChangeCommand(args);
  const a = argsOrHelp(args, { values: ["--search", "--sort"], flags: ["--flown", "--both", "--provisional", "--no-first-flight"] }, aircraftHelp(), [0, 1]);
  const json = a.flags.has("--json");
  const log = await openOrFail(json, a.values.get("--log"));
  if (a.positional.length) return oneAircraft(log, json, a.positional[0]!);

  const sort = a.values.get("--sort") ?? "last";
  if (!["last", "count", "reg"].includes(sort)) return fail(json, t("cliRead.aircraft.sortInvalid"));
  const needle = squash(a.values.get("--search") ?? "");
  const views = aircraftViews(log.store).filter((v) => v.flights.length || v.sightings.length);
  const shown = views
    .filter((v) => !a.flags.has("--flown") || v.flights.length > 0)
    .filter((v) => !a.flags.has("--both") || (v.flights.length > 0 && v.sightings.length > 0))
    .filter((v) => !a.flags.has("--provisional") || !!v.airframe.provisional)
    .filter((v) => !a.flags.has("--no-first-flight") || !v.airframe.firstFlightDate)
    .filter((v) => !needle || squash([v.registration, v.airframe.typeCode, aircraftLabel(log, v.airframe.typeCode, null), airlineLabel(v.operatorId, log.ref), v.airframe.msn].join("|")).includes(needle))
    .sort((x, y) =>
      sort === "reg"
        ? (x.registration ?? "").localeCompare(y.registration ?? "")
        : sort === "count"
          ? y.flights.length + y.sightings.length - (x.flights.length + x.sightings.length) || (y.last ?? "").localeCompare(x.last ?? "")
          : (y.last ?? "").localeCompare(x.last ?? ""),
    );
  const flown = views.filter((v) => v.flights.length).length;
  const both = views.filter((v) => v.flights.length && v.sightings.length).length;

  if (json) return printJson({ ok: true, from: log.from, total: views.length, flown, both, count: shown.length, aircraft: shown.map((v) => listJson(log, v)) });
  const summary = [tc("cliRead.aircraft.summary", { count: views.length, flown, both }, { b: bold }), shown.length !== views.length ? t("cliRead.aircraft.shown", { count: shown.length }) : null].filter(Boolean).join(" ");
  console.log(`${summary} ${dim(readFrom(log))}`);
  if (!shown.length) return;
  console.log("");
  const rows = shown.map((v) => [
    v.registration ?? "",
    aircraftLabel(log, v.airframe.typeCode, null),
    airlineLabel(v.operatorId, log.ref),
    v.airframe.msn ?? (v.airframe.provisional ? "-" : ""),
    v.flights.length ? String(v.flights.length) : "",
    v.sightings.length ? String(v.sightings.length) : "",
    v.last ?? "",
  ]);
  for (const line of table(
    [
      { head: t("cliRead.column.registration") },
      { head: t("cliRead.column.aircraft"), flex: true },
      { head: t("cliRead.column.airline") },
      { head: t("cliRead.column.serial") },
      { head: t("cliRead.column.flown"), align: "right" },
      { head: t("cliRead.column.seen"), align: "right" },
      { head: t("cliRead.column.last") },
    ],
    rows,
  ))
    console.log(line);
}

function oneAircraft(log: OpenedLog, json: boolean, text: string) {
  const found = findAircraft(log.store, text);
  if (!("row" in found)) return notFound(json, found);
  const v = aircraftViews(log.store).find((x) => x.airframe.id === found.row.id)!;
  const a = v.airframe;
  const regs = log.store.all("registration_periods").filter((p) => p.airframeId === a.id);
  const events = [
    ...v.flights.map((f) => ({ date: flightDay(f), kind: "flight" as const, id: f.id, f })),
    ...v.sightings.map((s) => ({ date: s.seenOn, kind: "sighting" as const, id: s.id, s })),
  ].sort((x, y) => (x.date ?? "9999").localeCompare(y.date ?? "9999"));
  const liveries = [...new Set([...v.flights, ...v.sightings].map((r) => r.specialLivery).filter((x): x is string => !!x))];
  const recordIds = new Set(events.map((e) => e.id));
  const findings = openFindings(log).filter((f) => f.records.some((r) => recordIds.has(r.id)));

  if (json)
    return printJson({
      ok: true,
      from: log.from,
      aircraft: {
        ...listJson(log, v),
        model: a.model,
        lineNumber: a.lineNumber,
        firstFlight: a.firstFlightDate,
        delivered: a.deliveryDate,
        status: a.status,
        registrations: regs.map((p) => ({ registration: p.registration, from: p.validFrom, to: p.validTo })),
        specialLiveries: liveries,
      },
      timeline: events.map((e) =>
        e.kind === "flight"
          ? { kind: "flight", id: e.id, date: e.date, flightNumber: e.f.flightNumber, from: airportJson(log, e.f.fromAirportId, e.f.fromRaw), to: airportJson(log, e.f.toAirportId, e.f.toRaw), registration: e.f.registration }
          : { kind: "sighting", id: e.id, date: e.date, airport: airportJson(log, e.s.airportId, e.s.airportRaw), phases: phasesOf(log.store, e.s.id), registration: e.s.registration, specialLivery: e.s.specialLivery },
      ),
      findings: findings.map(findingJson),
    });

  console.log(bold([v.registration, aircraftLabel(log, a.typeCode, a.model)].filter(Boolean).join(" · ") || a.id));
  for (const line of fields([
    [t("cliRead.aircraft.field.type"), [aircraftLabel(log, a.typeCode, a.model), a.typeCode].filter(Boolean).join(" · ")],
    [t("cliRead.aircraft.field.serial"), a.msn ? (a.lineNumber ? t("cliRead.aircraft.serialLine", { msn: a.msn, line: a.lineNumber }) : a.msn) : t("cliRead.aircraft.serialUnknown")],
    [t("cliRead.aircraft.field.firstFlight"), a.firstFlightDate ?? t("cliRead.aircraft.firstFlightUnknown")],
    [t("cliRead.aircraft.field.delivered"), a.deliveryDate],
    [t("cliRead.aircraft.field.status"), a.status && a.status !== "unknown" && a.status !== "active" ? (STATUS_WORD[a.status] ?? a.status) : null],
    [
      t("cliRead.aircraft.field.registrations"),
      regs.map((p) => (p.validFrom || p.validTo ? t("cliRead.aircraft.registrationPeriod", { registration: `${p.registration}`, from: p.validFrom ?? "…", to: p.validTo ?? t("cliRead.aircraft.registrationNow") }) : `${p.registration}`)).join(", ") || "-",
    ],
    [t("cliRead.aircraft.field.liveries"), liveries.join(", ")],
    [t("cliRead.aircraft.field.identity"), a.provisional ? t("cliRead.aircraft.identity.provisional") : t("cliRead.aircraft.identity.confirmed")],
    [t("cliRead.aircraft.field.id"), a.id],
  ]))
    console.log(`  ${line}`);
  const reg = v.registration ?? "";
  const lines = events.map((e) => {
    const date = (e.date ?? t("cliRead.aircraft.timeline.noDate")).padEnd(10);
    if (e.kind === "flight") {
      const flight = [e.f.flightNumber, `${textCode(log.ref.airport(e.f.fromAirportId), e.f.fromRaw, log.codes)} → ${textCode(log.ref.airport(e.f.toAirportId), e.f.toRaw, log.codes)}`].filter(Boolean).join(" ");
      return `${date}  ${e.f.registration && e.f.registration !== reg ? t("cliRead.aircraft.timeline.flewAs", { flight, registration: e.f.registration }) : t("cliRead.aircraft.timeline.flew", { flight })}`;
    }
    const place = airportWithCode(e.s.airportId, log.ref, e.s.airportRaw, log.codes) || t("cliRead.aircraft.timeline.unknownPlace");
    const phases = phasesOf(log.store, e.s.id)
      .map((p) => (PHASE_LABEL[p] ?? p).toLowerCase())
      .join(", ");
    const livery = e.s.specialLivery;
    const spotted = phases
      ? livery
        ? t("cliRead.aircraft.timeline.spottedPhasesLivery", { place, phases, livery })
        : t("cliRead.aircraft.timeline.spottedPhases", { place, phases })
      : livery
        ? t("cliRead.aircraft.timeline.spottedLivery", { place, livery })
        : t("cliRead.aircraft.timeline.spotted", { place });
    return plain(`${date}  ${spotted}`);
  });
  for (const line of section(t("cliRead.aircraft.timeline.title", { count: events.length }), lines)) console.log(line);
  if (findings.length) for (const line of section(t("cliRead.findings"), findings.map((x) => `${x.severity === "error" ? red("!") : yellow("?")} ${x.message}`))) console.log(line);
}
