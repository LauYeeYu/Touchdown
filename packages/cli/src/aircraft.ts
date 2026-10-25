// `touchdown aircraft [REF]` (docs/34, "Reading"): the Aircraft page's list, or one aircraft's page: its facts,
// registrations and every time the user flew on it or photographed it.

import { flightDay } from "@touchdown/core";
import { aircraftViews, airlineLabel, airportWithCode, PHASE_LABEL, textCode, type AircraftView } from "@touchdown/core/view";
import { aircraftLabel, airportJson, findingJson, openFindings } from "./shape.ts";
import { argsOrHelp, fail, fields, findAircraft, notFound, openOrFail, plain, printJson, readOptions, section, table, type OpenedLog } from "./read.ts";
import { bold, dim, plural, red, yellow } from "./term.ts";

export const AIRCRAFT_HELP = `Usage: ./touchdown aircraft [--flown | --both | --provisional | --no-first-flight] [--search TEXT]
                          [--sort last | count | reg] [--log FILE] [--json]
       ./touchdown aircraft REF [--log FILE] [--json]

Without REF, the aircraft in your log, as the Aircraft page lists them (last seen first). With REF, one
aircraft: what it is, its registrations and its timeline of flights and sightings.

  REF                the aircraft's id, or a registration (G-ABCD), on a date when it was reused (G-ABCD@2019-05-01)
  --flown            only aircraft you flew on
  --both             only aircraft you flew on and photographed
  --provisional      only aircraft matched by registration until a serial number is known
  --no-first-flight  only aircraft without a first flight date
  --search TEXT      registration, type, airline or serial number
  --sort ORDER       last (the default), count (most records first) or reg
${readOptions(19)}`;

const STATUS_LABEL: Record<string, string> = { stored: "Stored", retired: "Retired", written_off: "Written off" };

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
  const a = argsOrHelp(args, { values: ["--search", "--sort"], flags: ["--flown", "--both", "--provisional", "--no-first-flight"] }, AIRCRAFT_HELP, [0, 1]);
  const json = a.flags.has("--json");
  const log = await openOrFail(json, a.values.get("--log"));
  if (a.positional.length) return oneAircraft(log, json, a.positional[0]!);

  const sort = a.values.get("--sort") ?? "last";
  if (!["last", "count", "reg"].includes(sort)) return fail(json, "--sort takes last, count or reg.");
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
  console.log(`Your log holds ${bold(plural(views.length, "aircraft", "aircraft"))}: you flew on ${flown}, and ${both} of those you also photographed.${shown.length !== views.length ? ` ${shown.length} shown.` : ""} ${dim(`Read from ${log.from}.`)}`);
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
  for (const line of table([{ head: "Registration" }, { head: "Aircraft", flex: true }, { head: "Airline" }, { head: "Serial" }, { head: "Flown", align: "right" }, { head: "Seen", align: "right" }, { head: "Last" }], rows)) console.log(line);
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
          : { kind: "sighting", id: e.id, date: e.date, airport: airportJson(log, e.s.airportId, e.s.airportRaw), phase: e.s.phase, registration: e.s.registration, specialLivery: e.s.specialLivery },
      ),
      findings: findings.map(findingJson),
    });

  console.log(bold([v.registration, aircraftLabel(log, a.typeCode, a.model)].filter(Boolean).join(" · ") || a.id));
  for (const line of fields([
    ["Type", [aircraftLabel(log, a.typeCode, a.model), a.typeCode].filter(Boolean).join(" · ")],
    ["Serial number", a.msn ? `${a.msn}${a.lineNumber ? ` · line ${a.lineNumber}` : ""}` : "not known yet"],
    ["First flight", a.firstFlightDate ?? "not known"],
    ["Delivered", a.deliveryDate],
    ["Status", a.status && a.status !== "unknown" && a.status !== "active" ? (STATUS_LABEL[a.status] ?? a.status) : null],
    ["Registrations", regs.map((p) => `${p.registration}${p.validFrom || p.validTo ? ` (${p.validFrom ?? "…"} to ${p.validTo ?? "now"})` : ""}`).join(", ") || "-"],
    ["Special liveries", liveries.join(", ")],
    ["Identity", a.provisional ? "matched by registration and date until the serial number is known" : "confirmed by serial number"],
    ["Id", a.id],
  ]))
    console.log(`  ${line}`);
  const reg = v.registration ?? "";
  const lines = events.map((e) => {
    const date = (e.date ?? "no date").padEnd(10);
    if (e.kind === "flight") return `${date}  Flew ${[e.f.flightNumber, `${textCode(log.ref.airport(e.f.fromAirportId), e.f.fromRaw, log.codes)} → ${textCode(log.ref.airport(e.f.toAirportId), e.f.toRaw, log.codes)}`].filter(Boolean).join(" ")}${e.f.registration && e.f.registration !== reg ? ` as ${e.f.registration}` : ""}`;
    return plain(`${date}  Spotted at ${airportWithCode(e.s.airportId, log.ref, e.s.airportRaw, log.codes) || "an unknown place"}${e.s.phase ? `, ${(PHASE_LABEL[e.s.phase] ?? e.s.phase).toLowerCase()}` : ""}${e.s.specialLivery ? ` (${e.s.specialLivery})` : ""}`);
  });
  for (const line of section(`Timeline: ${plural(events.length, "record")}`, lines)) console.log(line);
  if (findings.length) for (const line of section("Findings", findings.map((x) => `${x.severity === "error" ? red("!") : yellow("?")} ${x.message}`))) console.log(line);
}
