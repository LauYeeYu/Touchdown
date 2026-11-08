// `touchdown stats` (docs/34, "Reading"; docs/24-statistics.md): Home's sentence and facts and the Statistics page's
// figures and ranked lists for a period, or a pivot as in its Custom view. The numbers come from the core package,
// so they are the web app's.

import { combinedStats, DIMENSIONS, EARTH_CIRCUMFERENCE_KM, filterRecords, flightName, flightStats, flownDistances, phaseIndex, pivot, sightingStats, todayIn, viewFilters, type Dataset, type Flight, type Measure, type Measured, type PivotFilter, type Sighting, type StatsContext, type Tally } from "@touchdown/core";
import { ageLeftOutText, ageTodayNote, ageText, aircraftAges, airlineLabel, averageAge, byAge, distance, durShort, filtersText, flownAndPhotographed, inPeriod, nf, outOfService, pivotValueLabel, sortedFlights, STATUS_WORD, typeName, yearsIn } from "@touchdown/core/view";
import { list, t, tDynamic } from "@touchdown/i18n/cli";
import { noDimension, whereFilters, wrongDataset } from "./where.ts";
import { savedViewNamed, viewsCommand } from "./change.ts";
import { argsOrHelp, EXIT, fail, openOrFail, optionLines, periodOf, plain, printJson, readFrom, readOptions, section, table, usage, type OpenedLog } from "./read.ts";
import { bold, dim } from "./term.ts";

const DIMENSION_IDS = DIMENSIONS.map((d) => d.id);

export const statsHelp = () => `${usage(`./touchdown stats [flights | spotting | both] [--year Y | all] [--top N | all] [--log FILE] [--json]
       ./touchdown stats --by DIM [--cols DIM] [--of flights | sightings] [--measure M] [--where DIM=V[,V]]…
                         [--year Y | all] [--top N] [--log FILE] [--json]
       ./touchdown stats --view NAME [--year Y | all] [--top N] [--log FILE] [--json]
       ./touchdown stats views [save NAME --by DIM [--cols DIM] [--of DATA] [--measure M] [--where …] | remove NAME]`)}

${t("cliRead.stats.help")}

${optionLines(14, [
  ["--year Y", t("cliRead.option.yearDefault")],
  ["--top N", t("cliRead.stats.option.top")],
  ["--by DIM", t("cliRead.stats.option.by", { dimensions: DIMENSION_IDS.join(", ") })],
  ["--cols DIM", t("cliRead.stats.option.cols")],
  ["--of DATA", t("cliRead.stats.option.of")],
  ["--measure M", t("cliRead.stats.option.measure")],
  ["--where DIM=V", t("cliRead.stats.option.where")],
  ["--view NAME", t("cliRead.stats.option.view")],
])}
${readOptions(14)}

${t("cliRead.stats.help.views")}`;

interface Ctx {
  log: OpenedLog;
  top: number;
}

const ty = (log: OpenedLog, code: string) => `${typeName(code, log.ref)} (${code})`;

/** A value of a dimension as the Statistics page names it. */
const keyLabel = (log: OpenedLog, dimId: string, k: string) => plain(pivotValueLabel(dimId, k, log.ref, log.codes));

/** The records a figure leaves out, by what they lack: "2 records left out (no airports)". */
type Lacking = "airports" | "airport" | "times" | "registration" | "airline" | "type" | "seatPosition" | "cabin" | "location" | "phase";
const leftOut = (m: { leftOut: number }, lacking: Lacking) => (m.leftOut ? tDynamic(`cliRead.stats.leftOut.${lacking}`, { count: m.leftOut }) : null);

/** "and 12 more", under a list cut to --top. */
const more = (count: number) => t("cliRead.stats.more", { count });

function rankedJson(c: Ctx, t: Tally, dimId: string) {
  const items = c.top ? t.items.slice(0, c.top) : t.items;
  return { items: items.map((x) => ({ key: x.key, label: keyLabel(c.log, dimId, x.key), count: x.count })), more: t.items.length - items.length, leftOut: t.leftOut };
}

function rankedLines(c: Ctx, title: string, tally: Tally, dimId: string, unit: (count: number) => string, missing: Lacking): string[] {
  const r = rankedJson(c, tally, dimId);
  if (!r.items.length && !tally.leftOut) return [];
  const lines = table([{ head: title, flex: true }, { head: "", align: "right" }], r.items.map((x) => [x.label, unit(x.count)])).slice(1);
  if (r.more) lines.push(dim(more(r.more)));
  const lo = leftOut(tally, missing);
  if (lo) lines.push(dim(lo));
  return ["", bold(title), ...lines.map((l) => `  ${l}`)];
}

const factLines = (facts: [string, string, string | null][]) => {
  const w = Math.max(...facts.map(([l]) => l.length));
  return facts.map(([label, value, detail]) => `${dim(label.padEnd(w))}  ${bold(plain(value))}${detail ? dim(`  ${plain(detail)}`) : ""}`);
};

/** "3 without a serial number", or "all confirmed". */
const serialText = (provisional: number) => (provisional ? t("cliRead.stats.withoutSerial", { count: provisional }) : t("cliRead.stats.allConfirmed"));

const flightCount = (count: number) => t("common.count.flights", { count });
const aircraftCount = (count: number) => t("common.count.aircraft", { count });

export async function statsCommand(args: string[]) {
  if (args[0] === "views") return viewsCommand(args.slice(1));
  const a = argsOrHelp(args, { values: ["--year", "--top", "--by", "--cols", "--of", "--measure", "--view"], lists: ["--where"] }, statsHelp(), [0, 1]);
  const json = a.flags.has("--json");
  const part = a.positional[0];
  if (part && !["flights", "spotting", "both"].includes(part)) return fail(json, t("cliRead.stats.partInvalid", { part }));
  const topText = a.values.get("--top");
  const top = topText === undefined ? 8 : topText === "all" ? 0 : Number(topText);
  if (!Number.isInteger(top) || top < 0) return fail(json, t("cliRead.stats.topInvalid"));
  // With the tracks' positions, so distances are the ones flown, as the web app shows them.
  const log = await openOrFail(json, a.values.get("--log"), { tracks: true });
  const year = periodOf(log.store, a.values.get("--year"), "default");
  if (typeof year !== "string") return fail(json, year.error);
  const c: Ctx = { log, top };
  const ctx: StatsContext = { ref: log.ref, airframes: new Map(log.store.all("airframes").map((x) => [x.id, x])), phases: phaseIndex(log.store), flown: flownDistances(log.store, log.ref) };
  const viewName = a.values.get("--view");
  if (viewName !== undefined) {
    if (["--by", "--cols", "--of", "--measure"].some((o) => a.values.has(o)) || a.lists.has("--where")) return fail(json, t("cliRead.stats.viewAlone"));
    const v = savedViewNamed(log.store, viewName);
    if (!v) return fail(json, t("cliRead.stats.noView", { name: viewName }), EXIT.notFound);
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
  if (a.values.has("--cols") || a.values.has("--of") || a.values.has("--measure") || a.lists.has("--where")) return fail(json, t("cliRead.stats.needsBy"));

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
  const flown = views.length > 0;
  const spotted = ss.aircraft.value > 0;
  const said = {
    first: yearsIn(store)[0] ?? thisYear,
    year,
    parts: flown && spotted ? "both" : flown ? "flown" : "spotted",
    flights: views.length,
    withDistance: fs.distanceKm.value > 0 ? "yes" : "no",
    distance: plain(dist(fs.distanceKm.value)),
    aircraft: fs.aircraft.value,
    spotted: ss.aircraft.value,
    airports: ss.airports.value,
  };
  const sentence = !flown && !spotted
    ? t("cliRead.stats.sentence.nothing", { year })
    : [
        year === "all" ? t("cliRead.stats.sentence.all", said) : past ? t("cliRead.stats.sentence.current", said) : t("cliRead.stats.sentence.past", said),
        both.length ? t("cliRead.stats.sentence.flownOnSpotted", { count: both.length }) : null,
      ]
        .filter(Boolean)
        .join(" ");
  const longest = fs.longestByDistance ? views.find((v) => v.f.id === fs.longestByDistance!.id) : undefined;
  const topFrame = fs.byAirframe.items[0];
  const topFrameFlight = topFrame ? views.find((v) => v.f.airframeId === topFrame.key) : undefined;
  const facts: [string, string, string | null][] = [];
  if (longest?.km) facts.push([t("cliRead.stats.fact.longest"), `${longest.fromCode} → ${longest.toCode}`, [dist(longest.km), flightName(longest.f)].filter(Boolean).join(" · ")]);
  if (fs.minutes.value) facts.push([t("cliRead.stats.fact.timeInAir"), durShort(fs.minutes.value), t("cliRead.stats.fact.acrossFlights", { count: views.length - fs.minutes.leftOut })]);
  if (fs.byAirline.items[0]) facts.push([t("cliRead.stats.fact.topAirlines", { count: fs.byAirline.top.length }), list(fs.byAirline.top.map((id) => airlineLabel(id, ref))), t("common.count.flights", { count: fs.byAirline.items[0].count })]);
  if (topFrame && topFrame.count > 1 && topFrameFlight) facts.push([t("cliRead.stats.fact.topAircraft"), topFrameFlight.f.registration ?? "", `${t("common.count.flights", { count: topFrame.count })} · ${typeName(topFrameFlight.f.typeCode, ref)}`]);
  if (ss.byType.items[0]) facts.push([t("cliRead.stats.fact.topSpottedType"), typeName(ss.byType.items[0].key, ref), t("common.count.aircraft", { count: ss.byType.items[0].count })]);

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
      return { flightId: r.flightId, flightNumber: f ? flightName(f) : null, day: r.day, airframeId: r.airframeId, registration: f?.registration ?? null, typeCode: f?.typeCode ?? null, days: r.days, age: ageText(r.days) };
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
  } else out.push(bold(t("cliRead.stats.partTitle", { part, year })));
  if (!part || part === "flights") {
    out.push(
      ...section(
        t("cliRead.stats.flights"),
        factLines(
          [
            [t("cliRead.stats.figure.flights"), nf.format(fs.flights), null],
            [t("cliRead.stats.figure.distance"), dist(fs.distanceKm.value), [t("cliRead.stats.timesAroundEarth", { times: flightsPart.timesAroundTheEarth }), leftOut(fs.distanceKm, "airports")].filter(Boolean).join(" · ")],
            [t("cliRead.stats.figure.timeInAir"), durShort(fs.minutes.value), leftOut(fs.minutes, "times")],
            [t("cliRead.stats.figure.airports"), nf.format(fs.airports.value), t("common.count.countries", { count: fs.countries.value })],
            [t("cliRead.stats.figure.airlines"), nf.format(fs.airlines.value), null],
            [t("cliRead.stats.figure.aircraft"), nf.format(fs.aircraft.value), [serialText(fs.aircraft.provisional), leftOut(fs.aircraft, "registration")].filter(Boolean).join(" · ")],
            [t("cliRead.stats.figure.types"), nf.format(fs.types.value), null],
            [t("cliRead.stats.figure.routes"), nf.format(fs.routes.value), t("cliRead.stats.routesBothWays")],
          ] as [string, string, string | null][],
        ),
      ),
      ...rankedLines(c, t("cliRead.stats.ranked.airlines"), fs.byAirline, "airline", flightCount, "airline"),
      ...rankedLines(c, t("cliRead.stats.ranked.routes"), fs.byRoute, "route", flightCount, "airports"),
      ...rankedLines(c, t("cliRead.stats.ranked.airports"), fs.airportVisits, "airport", (count) => t("cliRead.stats.count.visits", { count }), "airport"),
      ...rankedLines(c, t("cliRead.stats.ranked.types"), fs.byType, "type", flightCount, "type"),
      ...rankedLines(c, t("cliRead.stats.ranked.families"), fs.byFamily, "family", flightCount, "type"),
      ...rankedLines(c, t("cliRead.stats.ranked.manufacturers"), fs.byManufacturer, "manufacturer", flightCount, "type"),
      ...rankedLines(c, t("cliRead.stats.ranked.seatPosition"), fs.seatPositions, "seatPosition", flightCount, "seatPosition"),
      ...rankedLines(c, t("cliRead.stats.ranked.cabin"), fs.cabinClasses, "cabin", flightCount, "cabin"),
    );
    if (ages.whenFlown.length) {
      const days = ages.whenFlown.map((r) => r.days);
      const lines = [
        t("cliRead.stats.age.summary", { count: ages.whenFlown.length, average: ageText(agesPart.averageDays!), min: ageText(Math.min(...days)), max: ageText(Math.max(...days)) }),
        "",
        ...table(
          [{ head: t("cliRead.stats.age.column.whenFlown"), flex: true }, { head: t("cliRead.stats.age.column.aircraft") }, { head: t("cliRead.stats.age.column.age"), align: "right" }],
          agesPart.whenFlown.map((r) => [`${r.flightNumber ?? t("cliRead.stats.age.flight")} · ${r.day}`, [r.registration, r.typeCode && typeName(r.typeCode, ref)].filter(Boolean).join(" · "), r.age]),
        ),
        ...(agesPart.whenFlownMore ? [dim(more(agesPart.whenFlownMore))] : []),
        "",
        ...table(
          [{ head: t("cliRead.stats.age.column.today"), flex: true }, { head: t("cliRead.stats.age.column.firstFlight") }, { head: t("cliRead.stats.age.column.sinceFirstFlight"), align: "right" }],
          agesPart.now.map((r) => [[r.registration ?? t("cliRead.stats.age.aircraft"), r.status && STATUS_WORD[r.status], r.typeCode && typeName(r.typeCode, ref)].filter(Boolean).join(" · "), r.firstFlightDate, r.sinceFirstFlight]),
        ),
        ...(agesPart.nowMore ? [dim(more(agesPart.nowMore))] : []),
        ...(ages.now.some((r) => outOfService(r.status)) ? [dim(ageTodayNote())] : []),
      ];
      const left = ageLeftOutText(ages.leftOut);
      if (left) lines.push(dim(left));
      out.push(...section(t("cliRead.stats.age"), lines));
    }
    if (fs.perYear.length > 1) {
      const head = [{ head: t("cliRead.stats.byYear.year") }, { head: t("cliRead.stats.byYear.flights"), align: "right" as const }, { head: t("cliRead.stats.byYear.distance"), align: "right" as const }, { head: t("cliRead.stats.byYear.timeInAir"), align: "right" as const }];
      out.push(...section(t("cliRead.stats.byYear"), table(head, fs.perYear.map((y) => [y.year, String(y.flights), dist(y.distanceKm), durShort(y.minutes)]))));
    }
  }
  if (!part || part === "spotting") {
    out.push(
      ...section(
        t("cliRead.stats.spotting"),
        factLines([
          [t("cliRead.stats.figure.aircraft"), nf.format(ss.aircraft.value), [serialText(ss.aircraft.provisional), leftOut(ss.aircraft, "registration")].filter(Boolean).join(" · ")],
          [t("cliRead.stats.figure.sightings"), nf.format(ss.sightings), null],
          [t("cliRead.stats.figure.airlines"), nf.format(ss.airlines.value), leftOut(ss.airlines, "airline")],
          [t("cliRead.stats.figure.families"), nf.format(ss.families.value), null],
          [t("cliRead.stats.figure.types"), nf.format(ss.typeCodes.value), null],
          [t("cliRead.stats.figure.specialLiveries"), nf.format(ss.specialLiveryAircraft.value), t("common.count.liveries", { count: ss.specialLiveries.value })],
        ]),
      ),
      ...rankedLines(c, t("cliRead.stats.ranked.airlines"), ss.byAirline, "airline", aircraftCount, "airline"),
      ...rankedLines(c, t("cliRead.stats.ranked.families"), ss.byFamily, "family", aircraftCount, "type"),
      ...rankedLines(c, t("cliRead.stats.ranked.types"), ss.byType, "type", aircraftCount, "type"),
      ...rankedLines(c, t("cliRead.stats.ranked.manufacturers"), ss.byManufacturer, "manufacturer", aircraftCount, "type"),
      ...rankedLines(c, t("cliRead.stats.ranked.locations"), ss.byLocation, "location", aircraftCount, "location"),
      ...rankedLines(c, t("cliRead.stats.ranked.registrationCountries"), ss.byRegistrationCountry, "regCountry", aircraftCount, "registration"),
      ...rankedLines(c, t("cliRead.stats.ranked.phase"), ss.byPhase, "phase", (count) => t("common.count.sightings", { count }), "phase"),
    );
  }
  if (!part || part === "both") {
    out.push(
      ...section(
        t("cliRead.stats.both"),
        factLines([
          [t("cliRead.stats.figure.flownAndPhotographed"), nf.format(cs.flownAndPhotographed.length), t("cliRead.stats.aircraftUnit", { count: cs.flownAndPhotographed.length })],
          [t("cliRead.stats.figure.spottedNeverFlown"), nf.format(cs.spottedNeverFlown.length), null],
        ]),
      ),
    );
    if (typeRows.length) {
      const head = [{ head: t("cliRead.stats.types.type"), flex: true }, { head: t("cliRead.stats.types.flights"), align: "right" as const }, { head: t("cliRead.stats.types.aircraftFlown"), align: "right" as const }, { head: t("cliRead.stats.types.aircraftSpotted"), align: "right" as const }];
      out.push(...section(t("cliRead.stats.types"), table(head, typeRows.map((r) => [ty(log, r.typeCode), r.flights ? String(r.flights) : "-", r.aircraftFlown ? String(r.aircraftFlown) : "-", r.aircraftSpotted ? String(r.aircraftSpotted) : "-"]))));
      if (bothPart.more) out.push(`  ${dim(more(bothPart.more))}`);
    }
  }
  out.push("", dim(t("cliRead.stats.footer", { year, from: log.from })));
  for (const line of out) console.log(line);
}

function pivotTable(c: Ctx, ctx: StatsContext, json: boolean, year: string, values: Map<string, string>, filters: PivotFilter[], viewName: string | null = null) {
  const { log } = c;
  const dataset = (values.get("--of") ?? "flights") as Dataset;
  if (dataset !== "flights" && dataset !== "sightings") return fail(json, t("cliRead.stats.ofInvalid"));
  const measure = (values.get("--measure") ?? "records") as Measure;
  if (!["records", "aircraft", "distance", "time"].includes(measure)) return fail(json, t("cliRead.stats.measureInvalid"));
  if (dataset === "sightings" && (measure === "distance" || measure === "time")) return fail(json, t("cliRead.stats.measureFlightsOnly"));
  const dimOf = (id: string | undefined) => {
    if (id === undefined) return null;
    const d = DIMENSIONS.find((x) => x.id === id);
    if (!d) return fail(json, noDimension(id));
    if (!d.datasets.includes(dataset)) return fail(json, wrongDataset(id, d.datasets, dataset));
    return d;
  };
  const rowDim = dimOf(values.get("--by"))!;
  const colDim = dimOf(values.get("--cols"));
  if (colDim && colDim.id === rowDim.id) return fail(json, t("cliRead.stats.sameDimensions"));
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
  const totalHead = colDim ? t("cliRead.stats.pivot.total") : t("cliRead.stats.pivot.measure", { measure: measure === "records" ? dataset : measure });
  const head = [{ head: rowDim.label, flex: true }, ...cols.map((k) => ({ head: keyLabel(log, colDim!.id, k), align: "right" as const })), { head: totalHead, align: "right" as const }];
  const body = rows.map((k) => [keyLabel(log, rowDim.id, k), ...cols.map((col) => (cell(k, col) ? fmt(cell(k, col)) : "")), fmt(r.rowTotals.get(k) ?? 0)]);
  const by = { dataset, rows: rowDim.label.toLowerCase(), year };
  const title = colDim ? t("cliRead.stats.pivot.titleColumns", { ...by, columns: colDim.label.toLowerCase() }) : t("cliRead.stats.pivot.title", by);
  console.log(bold(viewName !== null ? t("cliRead.stats.pivot.view", { view: viewName, title }) : title));
  if (filters.length) console.log(dim(t("cliRead.stats.pivot.only", { filters: plain(filtersText(filters, log.ref, log.codes)), counted: nf.format(records.length), total: inYear.length, dataset })));
  console.log("");
  for (const line of table(head, body)) console.log(line);
  if (r.rows.length > rows.length) console.log(dim(more(r.rows.length - rows.length)));
  if (r.leftOut) console.log(dim(colDim ? t("cliRead.stats.pivot.leftOutEither", { count: r.leftOut, rows: rowDim.label.toLowerCase(), columns: colDim.label.toLowerCase() }) : t("cliRead.stats.pivot.leftOut", { count: r.leftOut, rows: rowDim.label.toLowerCase() })));
  console.log(dim(readFrom(log)));
}
