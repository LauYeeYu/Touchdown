// `touchdown stats` (docs/34, "Reading"; docs/24-statistics.md): Home's sentence and facts and the Statistics page's
// figures and ranked lists for a period, or a pivot as in its Custom view. The numbers come from the core package,
// so they are the web app's.

import { combinedStats, DIMENSIONS, EARTH_CIRCUMFERENCE_KM, filterRecords, flightStats, phaseIndex, pivot, sightingStats, todayIn, viewFilters, type Dataset, type Flight, type Measure, type Measured, type PivotFilter, type Sighting, type StatsContext, type Tally } from "@touchdown/core";
import { AGE_TODAY_NOTE, ageLeftOutText, ageText, aircraftAges, airlineLabel, averageAge, byAge, distance, durShort, filtersText, flownAndPhotographed, inPeriod, nf, outOfService, pivotValueLabel, sortedFlights, STATUS_WORD, typeName, yearsIn } from "@touchdown/core/view";
import { whereFilters } from "./where.ts";
import { savedViewNamed, viewsCommand } from "./change.ts";
import { argsOrHelp, EXIT, fail, openOrFail, periodLabel, periodOf, plain, printJson, readOptions, section, table, type OpenedLog } from "./read.ts";
import { bold, dim, plural } from "./term.ts";

const DIMENSION_IDS = DIMENSIONS.map((d) => d.id);

export const STATS_HELP = `Usage: ./touchdown stats [flights | spotting | both] [--year Y | all] [--top N | all] [--log FILE] [--json]
       ./touchdown stats --by DIM [--cols DIM] [--of flights | sightings] [--measure M] [--where DIM=V[,V]]…
                         [--year Y | all] [--top N] [--log FILE] [--json]
       ./touchdown stats --view NAME [--year Y | all] [--top N] [--log FILE] [--json]
       ./touchdown stats views [save NAME --by DIM [--cols DIM] [--of DATA] [--measure M] [--where …] | remove NAME]

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
  --where DIM=V only the records whose DIM is V, or one of V,W,…; repeat it for another dimension (all must hold).
                A value as stored, as the page shows it, or a code: --where airline=BA,LH --where month=March
  --view NAME   a view saved on the Statistics page's Custom tab, or with stats views save, with its filters
${readOptions(14)}

stats views lists the saved views; save and remove change them as the other changing commands do: through the
inbox, for review (./touchdown help views).`;

interface Ctx {
  log: OpenedLog;
  top: number;
}

const ty = (log: OpenedLog, code: string) => `${typeName(code, log.ref)} (${code})`;

/** A value of a dimension as the Statistics page names it. */
const keyLabel = (log: OpenedLog, dimId: string, k: string) => plain(pivotValueLabel(dimId, k, log.ref, log.codes));

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
  if (args[0] === "views") return viewsCommand(args.slice(1));
  const a = argsOrHelp(args, { values: ["--year", "--top", "--by", "--cols", "--of", "--measure", "--view"], lists: ["--where"] }, STATS_HELP, [0, 1]);
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
  const ctx: StatsContext = { ref: log.ref, airframes: new Map(log.store.all("airframes").map((x) => [x.id, x])), phases: phaseIndex(log.store) };
  const viewName = a.values.get("--view");
  if (viewName !== undefined) {
    if (["--by", "--cols", "--of", "--measure"].some((o) => a.values.has(o)) || a.lists.has("--where")) return fail(json, "--view gives the rows, columns, count and filters itself; leave out --by, --cols, --of, --measure and --where.");
    const v = savedViewNamed(log.store, viewName);
    if (!v) return fail(json, `No view is saved as "${viewName}". See ./touchdown stats views.`, EXIT.notFound);
    const values = new Map(a.values);
    values.set("--by", v.rowDimension ?? "");
    if (v.columnDimension) values.set("--cols", v.columnDimension);
    values.set("--of", v.dataset ?? "flights");
    values.set("--measure", v.measure ?? "records");
    return pivotTable(c, ctx, json, year, values, viewFilters(log.store, v.id), v.name);
  }
  if (a.values.has("--by")) {
    const dataset = (a.values.get("--of") ?? "flights") as Dataset;
    const filters = dataset === "flights" || dataset === "sightings" ? whereFilters(log, ctx, dataset, a.lists.get("--where") ?? []) : [];
    if ("error" in filters) return fail(json, filters.error);
    return pivotTable(c, ctx, json, year, a.values, filters);
  }
  if (a.values.has("--cols") || a.values.has("--of") || a.values.has("--measure") || a.lists.has("--where")) return fail(json, "--cols, --of, --measure and --where go with --by.");

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
  // Aircraft age (docs/24, "Aircraft age"), as on Statistics: oldest first, the first --top rows.
  const ages = aircraftAges(views.map((v) => v.f), ctx.airframes, todayIn());
  const flightOf = new Map(views.map((v) => [v.f.id, v.f]));
  const firstRows = <T,>(rows: T[]) => (top ? rows.slice(0, top) : rows);
  const whenFlown = firstRows(byAge(ages.whenFlown, "oldest"));
  const ageNow = firstRows(byAge(ages.now, "oldest"));
  const agesPart = {
    averageDays: averageAge(ages.whenFlown),
    whenFlown: whenFlown.map((r) => {
      const f = flightOf.get(r.flightId);
      return { flightId: r.flightId, flightNumber: f?.flightNumber ?? null, day: r.day, airframeId: r.airframeId, registration: f?.registration ?? null, typeCode: f?.typeCode ?? null, days: r.days, age: ageText(r.days) };
    }),
    whenFlownMore: ages.whenFlown.length - whenFlown.length,
    // For an aircraft retired or written off, the time since its first flight is not its age in service.
    now: ageNow.map((r) => ({ airframeId: r.airframeId, registration: r.registration, typeCode: r.typeCode, firstFlightDate: r.firstFlightDate, status: r.status, days: r.days, sinceFirstFlight: ageText(r.days) })),
    nowMore: ages.now.length - ageNow.length,
    leftOut: ages.leftOut,
  };
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
    aircraftAge: agesPart,
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
    if (ages.whenFlown.length) {
      const days = ages.whenFlown.map((r) => r.days);
      const lines = [
        ages.whenFlown.length === 1
          ? `Aircraft age: ${ageText(agesPart.averageDays!)} when you flew.`
          : `Average aircraft age: ${ageText(agesPart.averageDays!)} (range: ${ageText(Math.min(...days))} to ${ageText(Math.max(...days))}).`,
        "",
        ...table(
          [{ head: "When you flew", flex: true }, { head: "Aircraft" }, { head: "Age", align: "right" }],
          agesPart.whenFlown.map((r) => [`${r.flightNumber ?? "Flight"} · ${r.day}`, [r.registration, r.typeCode && typeName(r.typeCode, ref)].filter(Boolean).join(" · "), r.age]),
        ),
        ...(agesPart.whenFlownMore ? [dim(`and ${agesPart.whenFlownMore} more`)] : []),
        "",
        ...table(
          [{ head: "Age today", flex: true }, { head: "First flight" }, { head: "Since first flight", align: "right" }],
          agesPart.now.map((r) => [[r.registration ?? "Aircraft", r.status && STATUS_WORD[r.status], r.typeCode && typeName(r.typeCode, ref)].filter(Boolean).join(" · "), r.firstFlightDate, r.sinceFirstFlight]),
        ),
        ...(agesPart.nowMore ? [dim(`and ${agesPart.nowMore} more`)] : []),
        ...(ages.now.some((r) => outOfService(r.status)) ? [dim(`${AGE_TODAY_NOTE}.`)] : []),
      ];
      const left = ageLeftOutText(ages.leftOut);
      if (left) lines.push(dim(left));
      out.push(...section("Aircraft age", lines));
    }
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

function pivotTable(c: Ctx, ctx: StatsContext, json: boolean, year: string, values: Map<string, string>, filters: PivotFilter[], viewName: string | null = null) {
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
  const inYear: (Flight | Sighting)[] = dataset === "flights" ? sortedFlights(log.store, log.ref, log.codes).filter((v) => inPeriod(v.day, year)).map((v) => v.f) : log.store.all("sightings").filter((s) => inPeriod(s.seenOn, year));
  const records = filterRecords(dataset, inYear, filters, ctx);
  const r = pivot(dataset, records, rowDim, colDim, measure, ctx);
  const rows = c.top && values.has("--top") ? r.rows.slice(0, c.top) : r.rows;
  const cell = (row: string, col: string) => r.cells.get(`${row}\u0000${col}`) ?? 0;
  const round = (n: number) => (measure === "distance" ? Math.round(n) : n);

  if (json)
    return printJson({
      ok: true,
      from: log.from,
      ...(viewName !== null && { view: viewName }),
      year,
      of: dataset,
      measure: measure === "distance" ? "distanceKm" : measure === "time" ? "minutes" : measure,
      by: rowDim.id,
      cols: colDim?.id ?? null,
      filters: filters.map((f) => ({ dimension: f.dimension, values: f.values.map((k) => ({ key: k, label: keyLabel(log, f.dimension, k) })) })),
      records: { counted: records.length, inPeriod: inYear.length },
      columns: colDim ? r.columns.map((k) => ({ key: k, label: keyLabel(log, colDim.id, k) })) : [],
      rows: rows.map((k) => ({ key: k, label: keyLabel(log, rowDim.id, k), total: round(r.rowTotals.get(k) ?? 0), ...(colDim && { cells: Object.fromEntries(r.columns.map((col) => [col, round(cell(k, col))])) }) })),
      ...(colDim && { columnTotals: Object.fromEntries(r.columns.map((col) => [col, round(r.columnTotals.get(col) ?? 0)])) }),
      total: round(r.total),
      more: r.rows.length - rows.length,
      leftOut: r.leftOut,
    });

  const fmt = (n: number) => plain(measure === "distance" ? distance(n, log.unit) : measure === "time" ? durShort(n) : nf.format(n));
  const cols = colDim ? r.columns : [];
  const head = [{ head: rowDim.label, flex: true }, ...cols.map((k) => ({ head: keyLabel(log, colDim!.id, k), align: "right" as const })), { head: colDim ? "Total" : measure === "records" ? (dataset === "flights" ? "Flights" : "Sightings") : measure === "aircraft" ? "Aircraft" : measure === "distance" ? "Distance" : "Time", align: "right" as const }];
  const body = rows.map((k) => [keyLabel(log, rowDim.id, k), ...cols.map((col) => (cell(k, col) ? fmt(cell(k, col)) : "")), fmt(r.rowTotals.get(k) ?? 0)]);
  console.log(bold(`${viewName !== null ? `${viewName}: ` : ""}${dataset === "flights" ? "Flights" : "Sightings"} by ${rowDim.label.toLowerCase()}${colDim ? ` and ${colDim.label.toLowerCase()}` : ""}, ${periodLabel(year)}`));
  if (filters.length) console.log(dim(`Only ${plain(filtersText(filters, log.ref, log.codes))}: ${nf.format(records.length)} of ${plural(inYear.length, dataset === "flights" ? "flight" : "sighting")}`));
  console.log("");
  for (const line of table(head, body)) console.log(line);
  if (r.rows.length > rows.length) console.log(dim(`and ${r.rows.length - rows.length} more`));
  if (r.leftOut) console.log(dim(`${plural(r.leftOut, "record")} left out (no ${rowDim.label.toLowerCase()}${colDim ? ` or ${colDim.label.toLowerCase()}` : ""})`));
  console.log(dim(`Read from ${log.from}.`));
}
