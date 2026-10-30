// An aircraft on a shared link (docs/32-modes-and-sharing.md, "What a link shows"): its facts, its special liveries,
// and the timeline of the flights on it and sightings of it in the log it was shared from. A shared page names nobody,
// so it says "flown on", not "you flew on". Inside a whole-log link the flights open their own pages.

import { useMemo } from "react";
import { liveryName, liveryNames, phasesOf, sameLivery, type RefIndex, type Store } from "@touchdown/core";
import { aircraftViews } from "../lib/views.ts";
import { airportWithCode, textCode } from "../lib/codes.ts";
import { airlineLabel, dateOnly, dayMonthYear, PHASE_LABEL, plural, typeName } from "../lib/format.ts";
import { Icon } from "../lib/icons.tsx";
import { Credit, Photo } from "../components/Photo.tsx";
import { flownIn, LiveryBand, photographedIn } from "../components/LiveryBand.tsx";
import { Back, Gone } from "./Frame.tsx";

const times = (n: number) => (n === 1 ? "once" : n === 2 ? "twice" : `${n} times`);

export function AircraftView({ store, ref, airframeId, inLog, back }: { store: Store; ref: RefIndex; airframeId: string; inLog: boolean; back?: { href: string; label: string } }) {
  const v = useMemo(() => aircraftViews(store).find((x) => x.airframe.id === airframeId) ?? null, [store, airframeId]);
  if (!v) return <Gone what="This aircraft is no longer shared." />;
  const a = v.airframe;
  const reg = v.registration ?? "";
  const typeText = typeName(a.typeCode, ref);
  const events = [
    ...v.flights.map((f) => ({ kind: "flight" as const, date: f.scheduledDate ?? f.takeoffAt?.slice(0, 10) ?? null, f })),
    ...v.sightings.map((s) => ({ kind: "sighting" as const, date: s.seenOn, s })),
  ].sort((x, y) => (x.date ?? "").localeCompare(y.date ?? ""));
  const liveries = liveryNames(events.map((e) => (e.kind === "flight" ? e.f.specialLivery : e.s.specialLivery)));
  const flightsIn = v.flights.filter((f) => f.specialLivery?.trim()).length;
  const sightingsIn = v.sightings.filter((s) => s.specialLivery?.trim());
  const built = a.firstFlightDate?.slice(0, 4);
  const parts = [v.flights.length && `flown on ${times(v.flights.length)}`, v.sightings.length && `photographed ${times(v.sightings.length)}`].filter(Boolean) as string[];
  const sentence = `${parts.length ? `${parts.join(" and ").replace(/^./, (c) => c.toUpperCase())}` : "In this log"}${built ? `, first flown in ${built}` : ""}.`;
  const registrations = store.all("registration_periods").filter((p) => p.airframeId === a.id && p.registration).sort((x, y) => (x.validFrom ?? "").localeCompare(y.validFrom ?? ""));

  return (
    <>
      {back && <Back {...back} />}
      <div className={`aircraft-hero${liveries.length ? " aircraft-hero--livery" : ""}`}>
        <div>
          <h1 className="route-hero__code">{reg || "No registration"}</h1>
          <p className="flight-date">
            <b>{typeText || "Type not recorded"}</b>
            {v.operatorId && ` · ${airlineLabel(v.operatorId, ref)}`}
          </p>
          <p className="lead lead--flight">{sentence}</p>
        </div>
        {!liveries.length && (
          <figure className="aircraft-hero__photo card">
            <Photo reg={reg} alt={`${reg}, ${typeText}`} />
            <figcaption className="card__body">
              <Credit reg={reg} />
            </figcaption>
          </figure>
        )}
      </div>
      {liveries.length > 0 && (
        <LiveryBand
          names={liveries}
          reg={reg || null}
          alt={`${reg}, ${typeText}`}
          about={[typeText, v.operatorId && airlineLabel(v.operatorId, ref)].filter(Boolean).join(" · ")}
          facts={[
            ...(flightsIn ? [{ label: liveries.length > 1 ? "Flown in them" : "Flown in it", value: flownIn(flightsIn, v.flights.length) }] : []),
            ...(sightingsIn.length ? [{ label: liveries.length > 1 ? "Photographed in them" : "Photographed in it", value: photographedIn(sightingsIn.map((x) => x.seenOn)) }] : []),
          ]}
        />
      )}

      <section className="section detail-grid">
        <div>
          <div className="section__head">
            <h2 className="section__title">Timeline</h2>
            <span className="section__aside">{plural(events.length, "record")}</span>
          </div>
          <ul className="timeline">
            {events.map((e) =>
              e.kind === "flight" ? (
                <li key={e.f.id} className={e.f.specialLivery?.trim() ? "is-livery" : undefined}>
                  <span className="dot dot--flown" />
                  <span className="timeline__date">{e.date ? dayMonthYear(e.date) : "No date"}</span>
                  <span className="timeline__what">
                    {inLog ? (
                      <a href={`#/flights/${e.f.id}`}>
                        Flew {e.f.flightNumber ?? ""} {textCode(ref.airport(e.f.fromAirportId), e.f.fromRaw)} → {textCode(ref.airport(e.f.toAirportId), e.f.toRaw)}
                      </a>
                    ) : (
                      <>
                        Flew {e.f.flightNumber ?? ""} {textCode(ref.airport(e.f.fromAirportId), e.f.fromRaw)} → {textCode(ref.airport(e.f.toAirportId), e.f.toRaw)}
                      </>
                    )}
                    {e.f.registration && e.f.registration !== reg && <span className="muted"> as {e.f.registration}</span>}
                  </span>
                  {e.f.specialLivery?.trim() && <LiveryNote name={liveries.find((l) => sameLivery(l, e.f.specialLivery)) ?? e.f.specialLivery} />}
                </li>
              ) : (
                <li key={e.s.id} className={e.s.specialLivery?.trim() ? "is-livery" : undefined}>
                  <span className="dot dot--spotted" />
                  <span className="timeline__date">{e.date ? dayMonthYear(e.date) : "No date"}</span>
                  <span className="timeline__what">Spotted at {airportWithCode(e.s.airportId, ref, e.s.airportRaw) || "an unknown place"}</span>
                  {phasesOf(store, e.s.id).length > 0 && (
                    <span className="timeline__more">
                      {phasesOf(store, e.s.id)
                        .map((p, i) => (i ? (PHASE_LABEL[p] ?? p).toLowerCase() : (PHASE_LABEL[p] ?? p)))
                        .join(", ")}
                    </span>
                  )}
                  {e.s.specialLivery?.trim() && <LiveryNote name={liveries.find((l) => sameLivery(l, e.s.specialLivery)) ?? e.s.specialLivery} />}
                </li>
              ),
            )}
          </ul>
        </div>
        <div>
          <div className="section__head">
            <h2 className="section__title">Facts</h2>
          </div>
          <dl className="dl">
            <Row label="Type" value={typeText ? `${typeText}${a.typeCode ? ` (${a.typeCode})` : ""}` : null} />
            <Row label="Model" value={a.model} />
            <Row label="Serial number" value={a.msn} />
            <Row label="Line number" value={a.lineNumber} />
            <Row label="First flight" value={a.firstFlightDate && dateOnly(a.firstFlightDate, { day: "numeric", month: "short", year: "numeric" })} />
            <Row label="Delivered" value={a.deliveryDate && dateOnly(a.deliveryDate, { day: "numeric", month: "short", year: "numeric" })} />
            <Row label={registrations.length > 1 ? "Registrations" : "Registration"} value={registrations.map((p) => p.registration).join(", ") || reg || null} />
            <Row label={liveries.length > 1 ? "Special liveries" : "Special livery"} value={liveries.join(" · ") || null} />
          </dl>
        </div>
      </section>
    </>
  );
}

function Row({ label, value }: { label: string; value: string | null | undefined }) {
  if (!value) return null;
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function LiveryNote({ name }: { name: string }) {
  return (
    <span className="timeline__livery">
      <Icon name="paint-roller" />
      {liveryName(name)} livery
    </span>
  );
}
