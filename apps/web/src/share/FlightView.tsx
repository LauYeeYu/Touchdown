// A flight on a shared link (docs/32-modes-and-sharing.md, "What a link shows"): its page as the app shows it, read-only,
// with nothing that opens the app. The recorded track comes from /p/<id>/tracks/<flight id> once the page is up.

import { useEffect, useMemo, useState } from "react";
import { cityName, daysBetween, guessSeatPosition, liveryName, type RefIndex, type Store } from "@touchdown/core";
import { sortedFlights } from "../lib/views.ts";
import { primaryCode, secondaryCode } from "../lib/codes.ts";
import { mapFlights, trackIndex } from "../lib/mapdata.ts";
import { trackSamples } from "../lib/trackStatus.ts";
import { airlineLabel, CABIN_LABEL, dateOnly, dayLong, distance, durLong, localDay, modelLabel, plural, REASON_LABEL, shortAirport, typeName } from "../lib/format.ts";
import { article, partOfDay } from "../lib/flightText.ts";
import { FlightMap } from "../components/maps.tsx";
import { Duration } from "../components/Duration.tsx";
import { Credit, Photo } from "../components/Photo.tsx";
import { flownIn, LiveryBand } from "../components/LiveryBand.tsx";
import { TimeCell } from "../components/TimeCell.tsx";
import { loadTrack } from "./load.ts";
import { Back, Gone } from "./Frame.tsx";

export function FlightView({ linkId, store, ref, flightId, back }: { linkId: string; store: Store; ref: RefIndex; flightId: string; back?: { href: string; label: string } }) {
  const [tracked, setTracked] = useState(0);
  useEffect(() => {
    if (store.all("tracks").some((t) => t.flightId === flightId)) void loadTrack(linkId, store, flightId).then(setTracked);
  }, [linkId, store, flightId]);
  const v = useMemo(() => sortedFlights(store, ref).find((x) => x.f.id === flightId) ?? null, [store, ref, flightId]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const mark = useMemo(() => (v ? (mapFlights([v], ref, "km", new Set(), store, Infinity)[0] ?? null) : null), [v, ref, store, tracked]);
  if (!v) return <Gone what="This flight is no longer shared." />;

  const f = v.f;
  const A = ref.airport(f.fromAirportId);
  const B = ref.airport(f.divertedToAirportId ?? f.toAirportId);
  const airframe = store.get("airframes", f.airframeId);
  const track = trackIndex(store).get(f.id) ?? null;
  const samples = track ? trackSamples(store, f.id) : [];
  const takeoffMs = f.takeoffAt ? Date.parse(f.takeoffAt) : NaN;
  const typeText = f.model ? modelLabel(f.model, f.typeCode, ref, "standard") : typeName(f.typeCode, ref);
  const built = airframe?.firstFlightDate?.slice(0, 4) ?? null;
  const livery = f.specialLivery?.trim() ? liveryName(f.specialLivery) : null;
  const landDays = f.takeoffAt && f.landingAt ? daysBetween(localDay(f.takeoffAt)!, localDay(f.landingAt)!) : 0;
  const tPart = f.takeoffAt ? partOfDay(f.takeoffAt) : null;
  const kind = !tPart
    ? "A flight"
    : landDays >= 1 && (tPart === "evening" || tPart === "night")
      ? "An overnight flight"
      : (v.min ?? 0) >= 600
        ? "A long-haul flight"
        : `A${tPart === "afternoon" || tPart === "evening" ? "n" : ""} ${tPart} flight`;
  const landing = !f.landingAt ? null : landDays === 0 ? "the same day" : landDays === 1 ? `the next ${partOfDay(f.landingAt)}` : `${landDays} days later by the local calendar`;
  const seatPosition = f.seatPosition ?? guessSeatPosition(f.seat, ref.familyIdOf(f.typeCode));
  const photos = store.all("photo_links").filter((p) => p.ownerTable === "flights" && p.ownerId === f.id && p.url);
  const routeWhat = A && B ? `${f.flightNumber ?? "the flight"} from ${shortAirport(A.id, ref)} to ${shortAirport(B.id, ref)}` : "";

  const end = (which: "from" | "to") => {
    const ap = which === "from" ? A : B;
    const raw = which === "from" ? f.fromRaw : f.toRaw;
    return (
      <p className="route-hero__place">
        <span className="route-hero__city">{ap ? (cityName(ap) ?? ap.name) : (raw ?? "Unknown airport")}</span>
        {ap && <span className="route-hero__name">{ap.name}</span>}
        {secondaryCode(ap) && <span className="route-hero__icao"> · {secondaryCode(ap)}</span>}
      </p>
    );
  };

  return (
    <>
      {back && <Back {...back} />}
      <div className="route-hero">
        <div className="route-hero__end">
          <h1 className="route-hero__code" aria-label={`${f.flightNumber ?? "Flight"} from ${shortAirport(f.fromAirportId, ref) || f.fromRaw || "an unknown airport"}`}>
            {primaryCode(A, f.fromRaw)}
          </h1>
          {end("from")}
        </div>
        <div className="route-hero__mid" aria-hidden="true">
          <svg viewBox="0 0 200 56" preserveAspectRatio="none">
            <path className="arcline" d="M4 50 C 50 4, 150 4, 196 50" vectorEffect="non-scaling-stroke" />
          </svg>
          <div className="route-hero__stat">
            {v.min !== null && (
              <b>
                <Duration min={v.min} pad={false} />
              </b>
            )}
            {v.min !== null && v.km !== null && " · "}
            {v.km !== null && distance(v.km, "km")}
          </div>
        </div>
        <div className="route-hero__end route-hero__end--to">
          <p className="route-hero__code" aria-label={`to ${shortAirport(f.toAirportId, ref) || f.toRaw || "an unknown airport"}`}>
            {primaryCode(B, f.toRaw)}
          </p>
          {end("to")}
        </div>
      </div>
      <div className="flight-date-row">
        <p className="flight-date">
          <b>{v.day ? dayLong(v.day) : "Date not recorded"}</b>
          {f.flightNumber && ` · ${f.flightNumber}`}
          {f.airlineId && ` · ${airlineLabel(f.airlineId, ref)}`}
        </p>
      </div>

      <p className="lead lead--flight">
        {kind}
        {v.min !== null && `, ${durLong(v.min)} in the air`}
        {f.registration ? ` on ${f.registration}${typeText ? `, ${article(typeText)} ${typeText}` : ""}` : typeText && ` on ${article(typeText)} ${typeText}`}
        {livery && (f.registration || typeText) && ` in its ${livery} livery`}
        {built && `${livery && (f.registration || typeText) ? "," : ""} first flown in ${built}`}
        {landing && B && `, landing in ${cityName(B) ?? B.name} ${landing}`}.
      </p>

      {livery && (
        <LiveryBand
          names={[livery]}
          reg={f.registration}
          alt={`${f.registration ?? "The aircraft"}, ${typeText}`}
          about={[f.registration, typeText, f.airlineId && airlineLabel(f.airlineId, ref)].filter(Boolean).join(" · ")}
          facts={[{ label: "Flown in it", value: flownIn(1, 1) }]}
        />
      )}

      {A && B && (
        <div className="map-wrap">
          <div className="legend">
            {track ? (
              <>
                <span className="legend__item">
                  <span className="swatch-line swatch-line--beads" />
                  Recorded track
                </span>
                {!!mark?.gaps?.length && (
                  <span className="legend__item">
                    <span className="swatch-line swatch-line--unrecorded" />
                    Not recorded
                  </span>
                )}
              </>
            ) : (
              <span className="legend__item">
                <span className="swatch-line" />
                Great circle
              </span>
            )}
          </div>
          <FlightMap from={[A.lon, A.lat]} to={[B.lon, B.lat]} fromCode={primaryCode(A)} toCode={primaryCode(B)} line={mark?.line ?? []} gaps={mark?.gaps} recorded={!!track} samples={samples} takeoff={Number.isNaN(takeoffMs) ? null : takeoffMs / 1000} label={`Map of ${routeWhat}`} />
        </div>
      )}

      {(f.boardingAt || f.takeoffAt || f.landingAt) && (
        <div className="times">
          {f.boardingAt && <TimeCell label="Boarding" dt={f.boardingAt} />}
          {f.takeoffAt && <TimeCell label={`Takeoff · ${v.fromCode}`} dt={f.takeoffAt} />}
          {f.landingAt && (
            <TimeCell label={`Landing · ${v.toCode}`} dt={f.landingAt} extra={landDays > 0 && <p className="time__date"><span className="plus-day">+{plural(landDays, "day")}</span></p>} />
          )}
          {v.min !== null && (
            <div className="time">
              <p className="time__label">In the air</p>
              <p className="time__clock">
                <Duration min={v.min} />
              </p>
              <p className="time__date">{v.km !== null ? `${distance(v.km, "km")} great circle` : ""}</p>
            </div>
          )}
        </div>
      )}

      <section className="section detail-grid">
        <div>
          <div className="section__head">
            <h2 className="section__title">The aircraft</h2>
          </div>
          <article className="card aircraft-card">
            {!livery && <Photo reg={f.registration} alt={`${f.registration ?? ""}, ${typeText}`} />}
            <div className="card__body">
              <span className="card__reg">{f.registration ?? "No registration recorded"}</span>
              <span className="card__type">
                {typeText || "Type not recorded"}
                {f.airlineId && ` · ${airlineLabel(f.airlineId, ref)}`}
              </span>
              {(airframe?.msn || built) && (
                <span className="card__type">
                  {[airframe?.msn && `Serial number ${airframe.msn}`, built && `first flown in ${built}`].filter(Boolean).join(" · ")}
                </span>
              )}
              {!livery && <Credit reg={f.registration} />}
            </div>
          </article>
        </div>
        <div>
          <div className="section__head">
            <h2 className="section__title">Details</h2>
          </div>
          <dl className="dl">
            {f.seat && (
              <div>
                <dt>Seat</dt>
                <dd>
                  {f.seat}
                  {seatPosition && ` · ${seatPosition}`}
                </dd>
              </div>
            )}
            {(f.cabinClass || f.bookingClass || f.fareBrand) && (
              <div>
                <dt>Class</dt>
                <dd>{[f.cabinClass && (CABIN_LABEL[f.cabinClass] ?? f.cabinClass), f.bookingClass, f.fareBrand].filter(Boolean).join(" · ")}</dd>
              </div>
            )}
            {f.reason && (
              <div>
                <dt>Reason</dt>
                <dd>{REASON_LABEL[f.reason] ?? f.reason}</dd>
              </div>
            )}
            {(f.departureGate || f.departureTerminal) && (
              <div>
                <dt>Departure</dt>
                <dd>{[f.departureTerminal && `Terminal ${f.departureTerminal}`, f.departureGate && `gate ${f.departureGate}`].filter(Boolean).join(", ")}</dd>
              </div>
            )}
            {f.scheduledDate && v.day && f.scheduledDate !== v.day && (
              <div>
                <dt>Scheduled</dt>
                <dd>{dateOnly(f.scheduledDate, { day: "numeric", month: "short", year: "numeric" })}</dd>
              </div>
            )}
            {f.notes && (
              <div>
                <dt>Notes</dt>
                <dd className="share-notes">{f.notes}</dd>
              </div>
            )}
            {photos.length > 0 && (
              <div>
                <dt>Photos</dt>
                <dd>
                  {photos.map((p) => (
                    <a key={p.id} href={p.url!} target="_blank" rel="noopener noreferrer" className="share-photo-link">
                      {p.label || "Photos"}
                    </a>
                  ))}
                </dd>
              </div>
            )}
          </dl>
        </div>
      </section>
    </>
  );
}
