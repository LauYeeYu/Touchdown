// `touchdown stats` (docs/34, "Reading"; docs/24-statistics.md): Home's sentence and facts and the Statistics page's
// figures and ranked lists for a period, or a pivot as in its Custom view. The numbers come from the core package,
// so they are the web app's.

import { combinedStats, DIMENSIONS, EARTH_CIRCUMFERENCE_KM, flightStats, pivot, sightingStats, todayIn, type Dataset, type Measure, type Measured, type Sighting, type StatsContext, type Tally } from "@touchdown/core";
import { airlineLabel, airportWithCode, CABIN_LABEL, countryName, distance, durShort, flownAndPhotographed, inPeriod, nf, PHASE_LABEL, routeCodes, sortedFlights, typeName, yearsIn } from "@touchdown/core/view";
import { argsOrHelp, fail, openOrFail, periodLabel, periodOf, plain, printJson, readOptions, section, table, type OpenedLog } from "./read.ts";
import { bold, dim, plural } from "./term.ts";

const DIMENSION_IDS = DIMENSIONS.map((d) => d.id);

export const STATS_HELP = `Usage: ./touchdown stats [flights | spotting | both] [--year Y | all] [--top N | all] [--log FILE] [--json]
       ./touchdown stats --by DIM [--cols DIM] [--of flights | sightings] [--measure M] [--year Y | all]
                         [--top N] [--log FILE] [--json]

Without --by: the Home page's sentence and facts for the period, then the Statistics page's figures and ranked
lists: flights, spotting and both (or only the part named). With --by: a table as in the Statistics page's
Custom view, one row per value of DIM (and one column per value of --cols).

  --year Y      one year (2025), or all; without it, this year when it has records, else the latest year
  --top N       rows per ranked list (8, as on the page), or all
  --by DIM      the rows: ${DIMENSION_IDS.join(", ")}
  --cols DIM    the columns, from the same list
  --of DATA     flights (the default) or sightings; airport and phase are for sightings, from, to, route,
                cabin and seatPosition for flights
  --measure M   records (the default), aircraft, distance or time (distance and time for flights)
${readOptions(14)}`;

interface Ctx {
  log: OpenedLog;
  top: number;
}

const ty = (log: OpenedLog, code: string) => `${typeName(code, log.ref)} (${code})`;

/** A value of a dimension as the Statistics page names it. */
function keyLabel(log: OpenedLog, dimId: string, k: string): string {
  if (dimId === "airline") return airlineLabel(k, log.ref) || k;
  if (["airport", "from", "to", "location"].includes(dimId)) return plain(airportWithCode(k, log.ref, null, log.codes)) || k;
  if (dimId === "route") return routeCodes(k, log.ref, " ⇄ ", log.codes);
  if (dimId === "type") return ty(log, k);
  if (dimId === "family") return log.ref.family(k)?.name ?? k;
  if (dimId === "regCountry") return countryName(k);
  if (dimId === "phase") return PHASE_LABEL[k] ?? k;
  if (dimId === "cabin") return CABIN_LABEL[k] ?? k;
  if (dimId === "seatPosition") return k[0]!.toUpperCase() + k.slice(1);
  return k;
}

const leftOut = (m: { leftOut: number }, what: string) => (m.leftOut ? `${plural(m.leftOut, "record")} left out (no ${what})` : null);

function rankedJson(c: Ctx, t: Tally, dimId: string) {
  const items = c.top ? t.items.slice(0, c.top) : t.items;
  return { items: items.map((x) => ({ key: x.key, label: keyLabel(c.log, dimId, x.key), count: x.count })), more: t.items.length - items.length, leftOut: t.leftOut };
}

function rankedLines(c: Ctx, title: string, t: Tally, dimId: string, unit: [string, string], missing: string): string[] {
  const r = rankedJson(c, t, dimId);
  if (!r.items.length && !t.leftOut) return [];
  const lines = table([{ head: title, flex: true }, { head: "", align: "right" }], r.items.map((x) => [x.label, plural(x.count, unit[0], unit[1])])).slice(1);
  if (r.more) lines.push(dim(`and ${r.more} more`));
  const lo = leftOut(t, missing);
  if (lo) lines.push(dim(lo));
  return ["", bold(title), ...lines.map((l) => `  ${l}`)];
}

const factLines = (facts: [string, string, string | null][]) => {
  const w = Math.max(...facts.map(([l]) => l.length));
  return facts.map(([label, value, detail]) => `${dim(label.padEnd(w))}  ${bold(plain(value))}${detail ? dim(`  ${plain(detail)}`) : ""}`);
};

export async function statsCommand(args: string[]) {
  const a = argsOrHelp(args, { values: ["--year", "--top", "--by", "--cols", "--of", "--measure"] }, STATS_HELP, [0, 1]);
  const json = a.flags.has("--json");
  const part = a.positional[0];
  if (part && !["flights", "spotting", "both"].includes(part)) return fail(json, `stats shows flights, spotting or both, not "${part}".`);
  const topText = a.values.get("--top");
  const top = topText === undefined ? 8 : topText === "all" ? 0 : Number(topText);
  if (!Number.isInteger(top) || top < 0) return fail(json, "--top takes a number or all.");
  const log = await openOrFail(json, a.values.get("--log"));
  const year = periodOf(log.store, a.values.get("--year"), "default");
  if (typeof year !== "string") return fail(json, year.error);
  const c: Ctx = { log, top };
  const ctx: StatsContext = { ref: log.ref, airframes: new Map(log.store.all("airframes").map((x) => [x.id, x])) };
  if (a.values.has("--by")) return pivotTable(c, ctx, json, year, a.values);
  if (a.values.has("--cols") || a.values.has("--of") || a.values.has("--measure")) return fail(json, "--cols, --of and --measure go with --by.");

  const { store, ref } = log;
  const views = sortedFlights(store, ref, log.codes).filter((v) => inPeriod(v.day, year));
  const sightings = store.all("sightings").filter((s) => inPeriod(s.seenOn, year));
  const before: Sighting[] = year === "all" ? [] : store.all("sightings").filter((s) => s.seenOn && s.seenOn < `${year}-01-01`);
  const fs = flightStats(
    views.map((v) => v.f),
    ctx,
  );
  const ss = sightingStats(sightings, ctx, before);
  const cs = combinedStats(
    views.map((v) => v.f),
    sightings,
    ctx,
  );
  const both = flownAndPhotographed(store, year);
  const unit = log.unit;
  const dist = (km: number) => distance(km, unit);

  // Home: the sentence and the facts.
  const thisYear = todayIn().slice(0, 4);
  const past = year === "all" || year === thisYear;
  const when = year === "all" ? `Since you started logging in ${yearsIn(store)[0] ?? thisYear}, you have` : year === thisYear ? `So far in ${year} you have` : `In ${year} you`;
  const flownPart = views.length ? `${past ? "flown" : "flew"} ${plural(views.length, "flight")}${fs.distanceKm.value > 0 ? `, ${plain(dist(fs.distanceKm.value))}` : ""}${fs.aircraft.value > 0 ? ` on ${plural(fs.aircraft.value, "aircraft", "aircraft")}` : ""}` : "";
  const spotPart = ss.aircraft.value ? `spotted ${plural(ss.aircraft.value, "aircraft", "aircraft")} at ${plural(ss.airports.value, "airport")}` : "";
  const sentence = !flownPart && !spotPart ? `Nothing logged in ${year === "all" ? "your log yet" : year}.` : `${when} ${[flownPart, spotPart].filter(Boolean).join(", and ")}.${both.length ? ` You flew on ${both.length} of the aircraft you photographed.` : ""}`;
  const longest = fs.longestByDistance ? views.find((v) => v.f.id === fs.longestByDistance!.id) : undefined;
  const topFrame = fs.byAirframe.items[0];
  const topFrameFlight = topFrame ? views.find((v) => v.f.airframeId === topFrame.key) : undefined;
  const facts: [string, string, string | null][] = [];
  if (longest?.km) facts.push(["Longest flight", `${longest.fromCode} → ${longest.toCode}`, [dist(longest.km), longest.f.flightNumber].filter(Boolean).join(" · ")]);
  if (fs.minutes.value) facts.push(["Time in the air", durShort(fs.minutes.value), `across ${plural(views.length - fs.minutes.leftOut, "flight")}`]);
  if (fs.byAirline.items[0]) facts.push([fs.byAirline.top.length > 1 ? "Most flown airlines" : "Most flown airline", fs.byAirline.top.map((id) => airlineLabel(id, ref)).join(" and "), plural(fs.byAirline.items[0].count, "flight")]);
  if (topFrame && topFrame.count > 1 && topFrameFlight) facts.push(["Most flown aircraft", topFrameFlight.f.registration ?? "", `${plural(topFrame.count, "flight")} · ${typeName(topFrameFlight.f.typeCode, ref)}`]);
  if (ss.byType.items[0]) facts.push(["Most spotted type", typeName(ss.byType.items[0].key, ref), plural(ss.byType.items[0].count, "aircraft", "aircraft")]);

  const m = (x: Measured) => ({ value: x.value, leftOut: x.leftOut });
  const flightsPart = {
    flights: fs.flights,
    distanceKm: { value: Math.round(fs.distanceKm.value), leftOut: fs.distanceKm.leftOut },
    timesAroundTheEarth: Number((fs.distanceKm.value / EARTH_CIRCUMFERENCE_KM).toFixed(1)),
    minutes: m(fs.minutes),
    airports: m(fs.airports),
    countries: fs.countries.value,
    airlines: m(fs.airlines),
    aircraft: { ...m(fs.aircraft), withoutSerialNumber: fs.aircraft.provisional },
    types: m(fs.types),
    routes: m(fs.routes),
    ranked: {
      airlines: rankedJson(c, fs.byAirline, "airline"),
      routes: rankedJson(c, fs.byRoute, "route"),
      airports: rankedJson(c, fs.airportVisits, "airport"),
      types: rankedJson(c, fs.byType, "type"),
      families: rankedJson(c, fs.byFamily, "family"),
      manufacturers: rankedJson(c, fs.byManufacturer, "manufacturer"),
      seatPositions: rankedJson(c, fs.seatPositions, "seatPosition"),
      cabins: rankedJson(c, fs.cabinClasses, "cabin"),
    },
    perYear: fs.perYear.map((y) => ({ ...y, distanceKm: Math.round(y.distanceKm) })),
  };
  const spottingPart = {
    aircraft: { ...m(ss.aircraft), withoutSerialNumber: ss.aircraft.provisional },
    sightings: ss.sightings,
    airlines: m(ss.airlines),
    families: m(ss.families),
    types: m(ss.typeCodes),
    specialLiveryAircraft: m(ss.specialLiveryAircraft),
    specialLiveries: ss.specialLiveries.value,
    ranked: {
      airlines: rankedJson(c, ss.byAirline, "airline"),
      families: rankedJson(c, ss.byFamily, "family"),
      types: rankedJson(c, ss.byType, "type"),
      manufacturers: rankedJson(c, ss.byManufacturer, "manufacturer"),
      locations: rankedJson(c, ss.byLocation, "location"),
      registrationCountries: rankedJson(c, ss.byRegistrationCountry, "regCountry"),
      phases: rankedJson(c, ss.byPhase, "phase"),
    },
  };
  const typeRows = top ? cs.typesFlownVsSpotted.slice(0, top) : cs.typesFlownVsSpotted;
  const bothPart = {
    flownAndPhotographed: cs.flownAndPhotographed.length,
    typesSpottedNeverFlown: cs.spottedNeverFlown.length,
    types: typeRows.map((r) => ({ ...r, label: ty(log, r.typeCode) })),
    more: cs.typesFlownVsSpotted.length - typeRows.length,
  };

  if (json)
    return printJson({
      ok: true,
      from: log.from,
      year,
      ...(!part && { summary: { sentence, facts: facts.map(([label, value, detail]) => ({ label, value: plain(value), detail: detail && plain(detail) })) } }),
      ...((!part || part === "flights") && { flights: flightsPart }),
      ...((!part || part === "spotting") && { spotting: spottingPart }),
      ...((!part || part === "both") && { both: bothPart }),
    });

  const out: string[] = [];
  if (!part) {
    out.push(bold(sentence));
    if (facts.length) out.push("", ...factLines(facts));
  } else out.push(bold(`${part === "flights" ? "Flights" : part === "spotting" ? "Spotting" : "Flown and spotted"}, ${periodLabel(year)}`));
  if (!part || part === "flights") {
    out.push(
      ...section(
        "Flights",
        factLines(
          [
            ["Flights", nf.format(fs.flights), null],
            ["Distance", dist(fs.distanceKm.value), [`${flightsPart.timesAroundTheEarth} times around the Earth`, leftOut(fs.distanceKm, "airports")].filter(Boolean).join(" · ")],
            ["Time in the air", durShort(fs.minutes.value), leftOut(fs.minutes, "times")],
            ["Airports", nf.format(fs.airports.value), plural(fs.countries.value, "country", "countries")],
            ["Airlines", nf.format(fs.airlines.value), null],
            ["Aircraft", nf.format(fs.aircraft.value), [fs.aircraft.provisional ? `${nf.format(fs.aircraft.provisional)} without a serial number` : "all confirmed", leftOut(fs.aircraft, "registration")].filter(Boolean).join(" · ")],
            ["Aircraft types", nf.format(fs.types.value), null],
            ["Routes", nf.format(fs.routes.value), "counted both ways as one"],
          ] as [string, string, string | null][],
        ),
      ),
      ...rankedLines(c, "Airlines", fs.byAirline, "airline", ["flight", "flights"], "airline"),
      ...rankedLines(c, "Routes", fs.byRoute, "route", ["flight", "flights"], "airports"),
      ...rankedLines(c, "Airports", fs.airportVisits, "airport", ["visit", "visits"], "airport"),
      ...rankedLines(c, "Aircraft types", fs.byType, "type", ["flight", "flights"], "type"),
      ...rankedLines(c, "Families", fs.byFamily, "family", ["flight", "flights"], "type"),
      ...rankedLines(c, "Manufacturers", fs.byManufacturer, "manufacturer", ["flight", "flights"], "type"),
      ...rankedLines(c, "Seat position", fs.seatPositions, "seatPosition", ["flight", "flights"], "seat position"),
      ...rankedLines(c, "Cabin", fs.cabinClasses, "cabin", ["flight", "flights"], "cabin"),
    );
    if (fs.perYear.length > 1) out.push(...section("By year", table([{ head: "Year" }, { head: "Flights", align: "right" }, { head: "Distance", align: "right" }, { head: "Time in the air", align: "right" }], fs.perYear.map((y) => [y.year, String(y.flights), dist(y.distanceKm), durShort(y.minutes)]))));
  }
  if (!part || part === "spotting") {
    out.push(
      ...section(
        "Spotting",
        factLines([
          ["Aircraft", nf.format(ss.aircraft.value), [ss.aircraft.provisional ? `${nf.format(ss.aircraft.provisional)} without a serial number` : "all confirmed", leftOut(ss.aircraft, "registration")].filter(Boolean).join(" · ")],
          ["Sightings", nf.format(ss.sightings), null],
          ["Airlines", nf.format(ss.airlines.value), leftOut(ss.airlines, "airline")],
          ["Families", nf.format(ss.families.value), null],
          ["Aircraft types", nf.format(ss.typeCodes.value), null],
          ["Special-livery aircraft", nf.format(ss.specialLiveryAircraft.value), plural(ss.specialLiveries.value, "livery", "liveries")],
        ]),
      ),
      ...rankedLines(c, "Airlines", ss.byAirline, "airline", ["aircraft", "aircraft"], "airline"),
      ...rankedLines(c, "Families", ss.byFamily, "family", ["aircraft", "aircraft"], "type"),
      ...rankedLines(c, "Aircraft types", ss.byType, "type", ["aircraft", "aircraft"], "type"),
      ...rankedLines(c, "Manufacturers", ss.byManufacturer, "manufacturer", ["aircraft", "aircraft"], "type"),
      ...rankedLines(c, "Locations", ss.byLocation, "location", ["aircraft", "aircraft"], "location"),
      ...rankedLines(c, "Registration countries", ss.byRegistrationCountry, "regCountry", ["aircraft", "aircraft"], "registration"),
      ...rankedLines(c, "Phase", ss.byPhase, "phase", ["sighting", "sightings"], "phase"),
    );
  }
  if (!part || part === "both") {
    out.push(
      ...section(
        "Flown and spotted",
        factLines([
          ["Flown and photographed", nf.format(cs.flownAndPhotographed.length), "aircraft"],
          ["Types spotted, never flown", nf.format(cs.spottedNeverFlown.length), null],
        ]),
      ),
    );
    if (typeRows.length) {
      out.push(...section("Types flown and spotted", table([{ head: "Type", flex: true }, { head: "Flights", align: "right" }, { head: "Aircraft flown", align: "right" }, { head: "Aircraft spotted", align: "right" }], typeRows.map((r) => [ty(log, r.typeCode), r.flights ? String(r.flights) : "-", r.aircraftFlown ? String(r.aircraftFlown) : "-", r.aircraftSpotted ? String(r.aircraftSpotted) : "-"]))));
      if (bothPart.more) out.push(`  ${dim(`and ${bothPart.more} more`)}`);
    }
  }
  out.push("", dim(`${periodLabel(year)[0]!.toUpperCase()}${periodLabel(year).slice(1)}. Read from ${log.from}.`));
  for (const line of out) console.log(line);
}

function pivotTable(c: Ctx, ctx: StatsContext, json: boolean, year: string, values: Map<string, string>) {
  const { log } = c;
  const dataset = (values.get("--of") ?? "flights") as Dataset;
  if (dataset !== "flights" && dataset !== "sightings") return fail(json, "--of takes flights or sightings.");
  const measure = (values.get("--measure") ?? "records") as Measure;
  if (!["records", "aircraft", "distance", "time"].includes(measure)) return fail(json, "--measure takes records, aircraft, distance or time.");
  if (dataset === "sightings" && (measure === "distance" || measure === "time")) return fail(json, "Distance and time are measured for flights only.");
  const dimOf = (id: string | undefined) => {
    if (id === undefined) return null;
    const d = DIMENSIONS.find((x) => x.id === id);
    if (!d) return fail(json, `There is no dimension "${id}". Choose from: ${DIMENSION_IDS.join(", ")}.`);
    if (!d.datasets.includes(dataset)) return fail(json, `${id} is for ${d.datasets.join(" and ")}, not ${dataset}.`);
    return d;
  };
  const rowDim = dimOf(values.get("--by"))!;
  const colDim = dimOf(values.get("--cols"));
  if (colDim && colDim.id === rowDim.id) return fail(json, "--by and --cols need two different dimensions.");
  const records = dataset === "flights" ? sortedFlights(log.store, log.ref, log.codes).filter((v) => inPeriod(v.day, year)).map((v) => v.f) : log.store.all("sightings").filter((s) => inPeriod(s.seenOn, year));
  const r = pivot(dataset, records, rowDim, colDim, measure, ctx);
  const rows = c.top && values.has("--top") ? r.rows.slice(0, c.top) : r.rows;
  const cell = (row: string, col: string) => r.cells.get(`${row}\u0000${col}`) ?? 0;
  const round = (n: number) => (measure === "distance" ? Math.round(n) : n);

  if (json)
    return printJson({
      ok: true,
      from: log.from,
      year,
      of: dataset,
      measure: measure === "distance" ? "distanceKm" : measure === "time" ? "minutes" : measure,
      by: rowDim.id,
      cols: colDim?.id ?? null,
      columns: colDim ? r.columns.map((k) => ({ key: k, label: keyLabel(log, colDim.id, k) })) : [],
      rows: rows.map((k) => ({ key: k, label: keyLabel(log, rowDim.id, k), total: round(r.rowTotals.get(k) ?? 0), ...(colDim && { cells: Object.fromEntries(r.columns.map((col) => [col, round(cell(k, col))])) }) })),
      more: r.rows.length - rows.length,
      leftOut: r.leftOut,
    });

  const fmt = (n: number) => plain(measure === "distance" ? distance(n, log.unit) : measure === "time" ? durShort(n) : nf.format(n));
  const cols = colDim ? r.columns : [];
  const head = [{ head: rowDim.label, flex: true }, ...cols.map((k) => ({ head: keyLabel(log, colDim!.id, k), align: "right" as const })), { head: colDim ? "Total" : measure === "records" ? (dataset === "flights" ? "Flights" : "Sightings") : measure === "aircraft" ? "Aircraft" : measure === "distance" ? "Distance" : "Time", align: "right" as const }];
  const body = rows.map((k) => [keyLabel(log, rowDim.id, k), ...cols.map((col) => (cell(k, col) ? fmt(cell(k, col)) : "")), fmt(r.rowTotals.get(k) ?? 0)]);
  console.log(bold(`${dataset === "flights" ? "Flights" : "Sightings"} by ${rowDim.label.toLowerCase()}${colDim ? ` and ${colDim.label.toLowerCase()}` : ""}, ${periodLabel(year)}`));
  console.log("");
  for (const line of table(head, body)) console.log(line);
  if (r.rows.length > rows.length) console.log(dim(`and ${r.rows.length - rows.length} more`));
  if (r.leftOut) console.log(dim(`${plural(r.leftOut, "record")} left out (no ${rowDim.label.toLowerCase()}${colDim ? ` or ${colDim.label.toLowerCase()}` : ""})`));
  console.log(dim(`Read from ${log.from}.`));
}
