// Sections a type's page and a family's share (docs/31-ui.md, "Aircraft types"): the history and the log's aircraft.

import type { FamilyFacts } from "@touchdown/core";
import { t } from "@touchdown/i18n";
import { Link } from "../lib/link.tsx";
import { dateOnly, nf } from "../lib/format.ts";
import type { AircraftView } from "../lib/views.ts";
import { Fact } from "./Facts.tsx";

export type History = Pick<FamilyFacts, "firstFlight" | "introduced" | "built" | "builtAsOf" | "status">;

/** A date the infobox gives as a day, a month or a year, as the app writes dates. */
const historyDate = (d: string) => (d.length === 10 ? dateOnly(d, { day: "numeric", month: "short", year: "numeric" }) : d.length === 7 ? dateOnly(`${d}-01`, { month: "long", year: "numeric" }) : d);

/** First flight, entry into service, number built and status: nothing without any of them. */
export function TypeHistory({ facts }: { facts: History | null }) {
  if (!facts || !(facts.firstFlight || facts.introduced || facts.built || facts.status)) return null;
  return (
    <section className="section" aria-labelledby="history-title">
      <div className="section__head">
        <h2 className="section__title" id="history-title">
          {t("aircraft.types.history.title")}
        </h2>
      </div>
      <dl className="facts">
        {facts.firstFlight && <Fact label={t("aircraft.types.history.firstFlight")} value={historyDate(facts.firstFlight)} />}
        {facts.introduced && <Fact label={t("aircraft.types.history.introduced")} value={historyDate(facts.introduced)} />}
        {facts.built !== null && <Fact label={t("aircraft.types.history.built")} value={nf.format(facts.built)} detail={facts.builtAsOf ? t("aircraft.types.history.asOf", { date: historyDate(facts.builtAsOf) }) : undefined} />}
        {facts.status && <Fact label={t("aircraft.types.history.status")} value={facts.status} />}
      </dl>
    </section>
  );
}

/** The log's aircraft, each leading to its page with dots for its flights and sightings: nothing without any. */
export function TypeAircraft({ aircraft, title }: { aircraft: AircraftView[]; title: string }) {
  if (!aircraft.length) return null;
  return (
    <section className="section" aria-labelledby="log-title">
      <div className="section__head">
        <h2 className="section__title" id="log-title">
          {title}
        </h2>
      </div>
      <ul className="type-aircraft">
        {aircraft.map((v) => (
          <li key={v.airframe.id}>
            <Link to="/aircraft/$id" params={{ id: v.airframe.id }}>
              {v.registration ?? t("aircraft.noRegistration")}
            </Link>
            {v.flights.length > 0 && <span className="dot dot--flown" title={t("common.count.flights", { count: v.flights.length })} />}
            {v.sightings.length > 0 && <span className="dot dot--spotted" title={t("common.count.sightings", { count: v.sightings.length })} />}
          </li>
        ))}
      </ul>
    </section>
  );
}
