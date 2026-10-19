// One flight: the route at full size, the date, a sentence, the track map, dated local times, the aircraft.

import { useState } from "react";
import { Link, useNavigate, useParams } from "@tanstack/react-router";
import { daysBetween, flightDay, guessSeatPosition, parseDateTime, type Flight } from "@touchdown/core";
import { useApp } from "../data/context.tsx";
import { sortedFlights } from "../lib/views.ts";
import { trackIndex } from "../lib/mapdata.ts";
import { airlineLabel, CABIN_LABEL, clock, dateOnly, dayLong, dayMonthYear, dayShort, distance, durLong, localDay, modelLabel, offsetLabel, plural, REASON_LABEL, shortAirport, typeName } from "../lib/format.ts";
import { Icon } from "../lib/icons.tsx";
import { FlightMap } from "../components/maps.tsx";
import { AltitudeChart } from "../components/charts.tsx";
import { Duration } from "../components/Duration.tsx";
import { Credit, Photo } from "../components/Photo.tsx";
import { FindingList } from "../components/Findings.tsx";
import { toast } from "../components/overlay.tsx";
import { NotFound } from "./NotFound.tsx";

/** "an Airbus", "an Embraer", "a Boeing". */
function article(word: string): string {
  return /^[aeiou]/i.test(word) ? "an" : "a";
}

function partOfDay(dt: string): "night" | "morning" | "afternoon" | "evening" {
  const h = Number(clock(dt).slice(0, 2));
  return h < 5 ? "night" : h < 12 ? "morning" : h < 17 ? "afternoon" : "evening";
}

const SOURCE_TEXT: Record<string, string> = {
  fr24_csv: "Imported from a my.flightradar24.com CSV.",
  sheet: "Imported from a spreadsheet.",
  csv: "Imported from a CSV file.",
  manual: "Entered by hand.",
  api: "Filled from a flight lookup.",
};

function TimeCell({ label, dt, extra }: { label: string; dt: string; extra?: React.ReactNode }) {
  const day = localDay(dt)!;
  return (
    <div className="time">
      <p className="time__label">{label}</p>
      <p className="time__clock">{clock(dt)}</p>
      <p className="time__date">
        {dayShort(day)} · {offsetLabel(dt)}
      </p>
      {extra}
    </div>
  );
}

export function FlightDetail() {
  const { id } = useParams({ from: "/flights/$id" });
  const { app } = useApp();
  const { store, ref } = app;
  const navigate = useNavigate();
  const settings = app.settings();
  const unit = settings.distanceUnit ?? "km";
  const [showTicket, setShowTicket] = useState(false);

  const all = sortedFlights(store, ref);
  const idx = all.findIndex((v) => v.f.id === id);
  if (idx < 0) return <NotFound what="That flight is not in your log." back={{ to: "/flights", label: "All flights" }} />;
  const v = all[idx]!;
  const f: Flight = v.f;
  const prev = all[idx - 1];
  const next = all[idx + 1];
  const A = ref.airport(f.fromAirportId);
  const B = ref.airport(f.divertedToAirportId ?? f.toAirportId);
  const airframe = store.get("airframes", f.airframeId);
  const track = trackIndex(store).get(f.id) ?? null;
  const trackRow = store.all("tracks").find((t) => t.flightId === f.id);
  const findings = app.findingsFor("flights", f.id);
  const onThis = f.airframeId ? all.filter((o) => o.f.airframeId === f.airframeId) : [v];
  const spotted = f.airframeId ? store.all("sightings").filter((s) => s.airframeId === f.airframeId).sort((a, b) => (a.seenOn ?? "").localeCompare(b.seenOn ?? "")) : [];
  const built = airframe?.firstFlightDate?.slice(0, 4) ?? null;
  const age = built && v.day ? Number(v.day.slice(0, 4)) - Number(built) : null;
  const typeText = f.model ? modelLabel(f.model, f.typeCode, ref, settings.modelNaming ?? "standard") : typeName(f.typeCode, ref);
  const day = v.day;

  const landDays = f.takeoffAt && f.landingAt ? daysBetween(localDay(f.takeoffAt)!, localDay(f.landingAt)!) : 0;
  const slipped = f.takeoffAt && f.scheduledDate ? daysBetween(f.scheduledDate, localDay(f.takeoffAt)!) : 0;
  const tPart = f.takeoffAt ? partOfDay(f.takeoffAt) : null;
  const kind = !tPart
    ? "A flight"
    : landDays >= 1 && (tPart === "evening" || tPart === "night")
      ? "An overnight flight"
      : (v.min ?? 0) >= 600
        ? "A long-haul flight"
        : `A${tPart === "afternoon" || tPart === "evening" ? "n" : ""} ${tPart} flight`;
  const landing = !f.landingAt ? null : landDays === 0 ? "the same day" : landDays === 1 ? `the next ${partOfDay(f.landingAt)}` : `${landDays} days later by the local calendar`;
  const guessed = !f.seatPosition ? guessSeatPosition(f.seat, ref.familyIdOf(f.typeCode)) : null;

  const scrollToAircraft = () => {
    document.getElementById("aircraft")?.scrollIntoView({ behavior: "smooth", block: "start" });
    const card = document.getElementById("aircraft-card");
    if (card) {
      card.classList.remove("is-flash");
      void card.offsetWidth;
      card.classList.add("is-flash");
    }
  };
  const phraseProps = {
    role: "button" as const,
    tabIndex: 0,
    onClick: scrollToAircraft,
    onKeyDown: (e: React.KeyboardEvent) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        scrollToAircraft();
      }
    },
  };

  const remove = () => {
    if (!window.confirm(`Delete ${f.flightNumber ?? "this flight"}${day ? ` on ${dayMonthYear(day)}` : ""}? It can be restored from the history later.`)) return;
    app.deleteRecord("flights", f.id);
    toast("Flight deleted.");
    navigate({ to: "/flights" });
  };

  const altitude =
    track && trackRow
      ? store
          .all("track_points")
          .filter((p) => p.trackId === trackRow.id && p.altitudeFt !== null)
          .sort((a, b) => a.seq - b.seq)
      : [];
  const t0 = altitude[0]?.t ?? 0;
  const fromOffset = f.takeoffAt ? parseDateTime(f.takeoffAt)!.offsetMin : 0;

  return (
    <div className="page">
      <nav className="crumbs" aria-label="Flight navigation">
        <Link to="/flights">
          <Icon name="arrow-left" /> All flights
        </Link>
        <span className="crumbs__pager">
          {prev && (
            <Link to="/flights/$id" params={{ id: prev.f.id }} title="Previous flight">
              <Icon name="arrow-left" />
              {prev.f.flightNumber ?? `${prev.fromCode} → ${prev.toCode}`}
            </Link>
          )}
          {next && (
            <Link to="/flights/$id" params={{ id: next.f.id }} title="Next flight">
              {next.f.flightNumber ?? `${next.fromCode} → ${next.toCode}`}
              <Icon name="arrow-right" />
            </Link>
          )}
        </span>
      </nav>

      <div className="route-hero">
        <div className="route-hero__end">
          <h1 className="route-hero__code" aria-label={`${f.flightNumber ?? "Flight"} from ${shortAirport(f.fromAirportId, ref) || f.fromRaw || "an unknown airport"}`}>
            {v.fromCode}
          </h1>
          <p className="route-hero__place">
            {A ? (
              <Link className="route-hero__city route-hero__link" to="/airports/$id" params={{ id: A.id }}>
                {A.city ?? A.name}
              </Link>
            ) : (
              <span className="route-hero__city">{f.fromRaw ?? "Unknown airport"}</span>
            )}
            {A && <span className="route-hero__name">{A.name} · </span>}
            {A?.icao && <span className="route-hero__icao">{A.icao}</span>}
          </p>
        </div>
        <div className="route-hero__mid" aria-hidden="true">
          <svg viewBox="0 0 200 56" preserveAspectRatio="none">
            <path className="arcline" d="M4 50 C 50 4, 150 4, 196 50" vectorEffect="non-scaling-stroke" />
          </svg>
          <div className="route-hero__stat">
            {v.min !== null && <b>{durLong(v.min)}</b>}
            {v.min !== null && v.km !== null && " · "}
            {v.km !== null && distance(v.km, unit)}
          </div>
        </div>
        <div className="route-hero__end route-hero__end--to">
          <p className="route-hero__code" aria-label={`to ${shortAirport(f.toAirportId, ref) || f.toRaw || "an unknown airport"}`}>
            {v.toCode}
          </p>
          <p className="route-hero__place">
            {B ? (
              <Link className="route-hero__city route-hero__link" to="/airports/$id" params={{ id: B.id }}>
                {B.city ?? B.name}
              </Link>
            ) : (
              <span className="route-hero__city">{f.toRaw ?? "Unknown airport"}</span>
            )}
            {B && <span className="route-hero__name">{B.name} · </span>}
            {B?.icao && <span className="route-hero__icao">{B.icao}</span>}
          </p>
        </div>
      </div>
      <div className="flight-date-row">
        <p className="flight-date">
          <b>{day ? dayLong(day) : "Date not recorded"}</b>
          {f.flightNumber && ` · ${f.flightNumber}`}
          {f.airlineId && ` · ${airlineLabel(f.airlineId, ref)}`}
        </p>
        <div className="actions">
          <Link className="btn btn--quiet btn--small" to="/flights/$id/edit" params={{ id: f.id }}>
            <Icon name="pencil" />
            Edit
          </Link>
          <button type="button" className="btn btn--quiet btn--small" onClick={remove}>
            <Icon name="trash" />
            Delete
          </button>
        </div>
      </div>

      <p className="lead lead--flight">
        {kind}
        {v.min !== null && `, ${durLong(v.min)} in the air`}
        {f.registration ? (
          <>
            {" "}
            on{" "}
            <span className="phrase phrase--flown" {...phraseProps}>
              {f.registration}
            </span>
            {typeText && `, ${article(typeText)} ${typeText}`}
          </>
        ) : (
          typeText && ` on ${article(typeText)} ${typeText}`
        )}
        {built && ` first flown in ${built}`}
        {landing && B && `, landing in ${B.city ?? B.name} ${landing}`}.
        {onThis.length > 1 && ` You have flown on it ${plural(onThis.length, "time")}.`}{" "}
        {spotted[0] && (
          <span className="phrase phrase--spotted" {...phraseProps}>
            You photographed this aircraft{spotted[0].airportId ? ` at ${ref.airport(spotted[0].airportId)?.city ?? shortAirport(spotted[0].airportId, ref)}` : ""}
            {spotted[0].seenOn ? ` on ${dateOnly(spotted[0].seenOn, { day: "numeric", month: "long", year: "numeric" })}` : ""}.
          </span>
        )}
      </p>

      {A && B && (
        <div className="map-wrap">
          <div className="legend" aria-hidden="true">
            {track ? (
              <>
                <span className="legend__item">
                  <span className="swatch-line" />
                  Recorded track{trackRow?.attribution ? ` · ${trackRow.attribution}` : ""}
                </span>
                <span className="legend__item">
                  <span className="swatch-line swatch-line--dashed" />
                  Great circle
                </span>
              </>
            ) : (
              <span className="legend__item">
                <span className="swatch-line" />
                Great circle · no recorded track for this flight
              </span>
            )}
          </div>
          <FlightMap from={[A.lon, A.lat]} to={[B.lon, B.lat]} fromCode={v.fromCode} toCode={v.toCode} track={track} onAirportClick={(which) => navigate({ to: "/airports/$id", params: { id: which === "from" ? A.id : B.id } })} label={`Map of ${f.flightNumber ?? "the flight"} from ${shortAirport(A.id, ref)} to ${shortAirport(B.id, ref)}`} />
        </div>
      )}

      {(f.boardingAt || f.takeoffAt || f.landingAt) && (
        <div className="times">
          {f.boardingAt && <TimeCell label="Boarding" dt={f.boardingAt} />}
          {f.takeoffAt && (
            <TimeCell
              label={`Takeoff · ${v.fromCode}`}
              dt={f.takeoffAt}
              extra={
                slipped > 0 &&
                f.scheduledDate && (
                  <p className="time__date">
                    Scheduled {dateOnly(f.scheduledDate)}
                    <span className="plus-day">took off after midnight</span>
                  </p>
                )
              }
            />
          )}
          {f.landingAt && (
            <div className="time">
              <p className="time__label">Landing · {v.toCode}</p>
              <p className="time__clock">{clock(f.landingAt)}</p>
              <p className="time__date">
                {dayShort(localDay(f.landingAt)!)} · {offsetLabel(f.landingAt)}
                {landDays > 0 && <span className="plus-day">+{plural(landDays, "day")}</span>}
              </p>
            </div>
          )}
          {v.min !== null && (
            <div className="time">
              <p className="time__label">In the air</p>
              <p className="time__clock">
                <Duration min={v.min} />
              </p>
              <p className="time__date">{v.km !== null ? `${distance(v.km, unit)} great circle` : ""}</p>
            </div>
          )}
        </div>
      )}

      {altitude.length > 10 && (
        <section className="section" aria-labelledby="alt-title">
          <div className="section__head">
            <h2 className="section__title" id="alt-title">
              Altitude
            </h2>
            <span className="section__aside">
              {plural(altitude.length, "point")}
              {trackRow?.attribution ? ` · ${trackRow.attribution}` : ""}
            </span>
          </div>
          <div className="chart">
            <AltitudeChart
              points={altitude.map((p) => {
                const local = new Date((p.t + fromOffset * 60) * 1000).toISOString().slice(11, 16);
                return { min: (p.t - t0) / 60, alt: p.altitudeFt ?? 0, gs: p.groundSpeedKt, clock: `${local} at ${v.fromCode}` };
              })}
            />
          </div>
        </section>
      )}

      <section className="section detail-grid">
        <div id="aircraft">
          <div className="section__head">
            <h2 className="section__title">The aircraft</h2>
          </div>
          <article className="card aircraft-card" id="aircraft-card">
            <Photo reg={f.registration} alt={`${f.registration ?? ""}, ${typeText}`} />
            <div className="card__body">
              <span className="card__reg">{f.registration ?? "No registration recorded"}</span>
              <span className="card__type">
                {typeText}
                {f.airlineId && ` · ${airlineLabel(f.airlineId, ref)}`}
              </span>
              <ul className="card__events">
                {onThis.map((o) => (
                  <li key={o.f.id}>
                    <span className="dot dot--flown" />
                    {o.f.id === f.id ? (
                      "This flight"
                    ) : (
                      <Link to="/flights/$id" params={{ id: o.f.id }}>
                        {o.f.flightNumber ?? "Flight"} {o.fromCode} → {o.toCode}
                      </Link>
                    )}
                    {o.day && `, ${dayMonthYear(o.day)}`}
                  </li>
                ))}
                {spotted.map((s) => (
                  <li key={s.id}>
                    <span className="dot dot--spotted" />
                    Spotted{s.airportId ? ` at ${shortAirport(s.airportId, ref)}` : ""}
                    {s.seenOn && `, ${dayMonthYear(s.seenOn)}`}
                  </li>
                ))}
              </ul>
              {airframe && (
                <p className="identity">
                  <Icon name="info" />
                  <span>
                    {age !== null && built ? `First flown in ${built}, about ${plural(age, "year")} old on this flight. ` : ""}
                    {airframe.provisional
                      ? "Serial number not known yet, so this aircraft is matched by registration and date until one is."
                      : `Serial number ${airframe.msn}.`}{" "}
                    <Link to="/aircraft/$id" params={{ id: airframe.id }}>
                      Aircraft page
                    </Link>
                  </span>
                </p>
              )}
              <Credit reg={f.registration} />
            </div>
          </article>
        </div>
        <div>
          <div className="section__head">
            <h2 className="section__title">Seat and ticket</h2>
          </div>
          <dl className="dl">
            <div>
              <dt>Seat</dt>
              <dd>
                {f.seat ?? "—"}
                {f.seatPosition && <span className="muted"> · {f.seatPosition}</span>}
                {guessed && <span className="muted"> · {guessed} (guess from the usual layout)</span>}
              </dd>
            </div>
            <div>
              <dt>Cabin</dt>
              <dd>{f.cabinClass ? CABIN_LABEL[f.cabinClass] : "—"}</dd>
            </div>
            <div>
              <dt>Fare</dt>
              <dd>
                {f.fareBrand ?? (f.bookingClass ? "" : "—")}
                {f.bookingClass && <span className="muted">{f.fareBrand ? " · " : ""}class {f.bookingClass}</span>}
              </dd>
            </div>
            {f.reason && (
              <div>
                <dt>Reason</dt>
                <dd>{REASON_LABEL[f.reason]}</dd>
              </div>
            )}
            <div>
              <dt>Flight</dt>
              <dd>
                {f.flightNumber ?? "—"}
                {f.flightNumber && ref.operator(f.airlineId)?.icao && <span className="muted"> · {ref.operator(f.airlineId)!.icao}{f.flightNumber.replace(/^[A-Z0-9]{2}/, "")}</span>}
              </dd>
            </div>
            <div>
              <dt>Airports</dt>
              <dd>
                {[A?.iata, A?.icao].filter(Boolean).join(" / ") || f.fromRaw} → {[B?.iata, B?.icao].filter(Boolean).join(" / ") || f.toRaw}
              </dd>
            </div>
            {(f.departureGate || f.departureTerminal) && (
              <div>
                <dt>Gate</dt>
                <dd>
                  {f.departureTerminal && `Terminal ${f.departureTerminal} · `}
                  {f.departureGate}
                </dd>
              </div>
            )}
            {(f.specialLivery || f.livery) && (
              <div>
                <dt>Livery</dt>
                <dd>{f.specialLivery ?? f.livery}</dd>
              </div>
            )}
            <div>
              <dt>Ticket number</dt>
              <dd>
                {!f.ticketNumber ? (
                  <span className="muted">Not recorded</span>
                ) : showTicket ? (
                  <>
                    {f.ticketNumber}{" "}
                    <button type="button" className="link-btn" onClick={() => setShowTicket(false)}>
                      Hide
                    </button>
                  </>
                ) : (
                  <>
                    <span className="muted">Hidden · private field</span>{" "}
                    <button type="button" className="link-btn" onClick={() => setShowTicket(true)}>
                      Show
                    </button>
                  </>
                )}
              </dd>
            </div>
          </dl>
          {f.notes && (
            <>
              <h3 className="subhead">Notes</h3>
              <p className="notes">{f.notes}</p>
            </>
          )}
          <h3 className="subhead">Source and checks</h3>
          <p className="status-line">
            <Icon name="info" />
            <span>{SOURCE_TEXT[f.sourceKind ?? "manual"]} Times are takeoff and landing, stored with their date and UTC offset.</span>
          </p>
          {findings.length ? (
            <FindingList findings={findings} />
          ) : (
            <p className="status-line status-line--good">
              <Icon name="circle-check" />
              <span>All checks passed.</span>
            </p>
          )}
        </div>
      </section>

      <nav className="pager-foot" aria-label="Previous and next flight">
        {prev ? (
          <Link className="prev" to="/flights/$id" params={{ id: prev.f.id }}>
            <small>Previous flight</small>
            <span>
              {prev.f.flightNumber ?? "Flight"} · {prev.fromCode} → {prev.toCode}
            </span>
          </Link>
        ) : (
          <span />
        )}
        {next && (
          <Link className="next" to="/flights/$id" params={{ id: next.f.id }}>
            <small>Next flight</small>
            <span>
              {next.f.flightNumber ?? "Flight"} · {next.fromCode} → {next.toCode}
            </span>
          </Link>
        )}
      </nav>
    </div>
  );
}

export function flightTitle(f: Flight): string {
  return [f.flightNumber, flightDay(f)].filter(Boolean).join(" · ");
}
