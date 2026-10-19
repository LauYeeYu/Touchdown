// One flight in a list (Flights, airport pages), with the column heads that go above a list of them.

import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { useApp } from "../data/context.tsx";
import type { FlightView } from "../lib/views.ts";
import type { TrackInfo } from "../lib/mapdata.ts";
import { typeName, airlineLabel, cityOf, dateOnly, distance } from "../lib/format.ts";
import { ArrowGlyph, Icon } from "../lib/icons.tsx";
import { esc, hideTip, showTip } from "./overlay.tsx";
import { Duration } from "./Duration.tsx";

export function FlightCols() {
  return (
    <div className="cols" aria-hidden="true">
      <span>Date</span>
      <span>Route</span>
      <span>Flight</span>
      <span className="col-aircraft">Aircraft</span>
      <span className="num">Time</span>
      <span className="num col-dist">Distance</span>
      <span className="track-col">Track</span>
    </div>
  );
}

const TRACK_SOURCE: Record<string, string> = { fr24_csv: "a Flightradar24 track file", fr24_kml: "a Flightradar24 track file", adsblol: "adsb.lol", aeroapi: "FlightAware", gpx: "a GPX file" };

/** What the track icon means, for its tooltip and for screen readers. */
function trackText(track: TrackInfo | null): { title: string; detail: string } {
  const from = track?.provider && TRACK_SOURCE[track.provider] ? ` from ${TRACK_SOURCE[track.provider]}` : "";
  if (!track) return { title: "Great circle only", detail: "No recorded track for this flight. The map draws the shortest path between the two airports, not the route flown." };
  if (track.coverage === "partial") return { title: "Recorded track, with gaps", detail: `Part of the path the aircraft flew${from}. The missing stretches are drawn as dashed great circles.` };
  return { title: "Recorded track", detail: `The path the aircraft flew${from}, drawn on the map in place of the great circle.` };
}

interface Props {
  v: FlightView;
  track: TrackInfo | null;
  review?: boolean;
  active?: boolean;
  /** A short label after the route, e.g. "Transit". */
  badge?: ReactNode;
  onHover?: (on: boolean) => void;
}

export function FlightRow({ v, track, review, active, badge, onHover }: Props) {
  const { app } = useApp();
  const { ref } = app;
  const unit = app.settings().distanceUnit ?? "km";
  const t = trackText(track);
  const tip = (e: React.PointerEvent) => showTip(`<strong>${esc(t.title)}</strong><br><span class="muted">${esc(t.detail)}</span>`, e.clientX, e.clientY);
  return (
    <li>
      <Link
        className={`row${active ? " is-active" : ""}`}
        to="/flights/$id"
        params={{ id: v.f.id }}
        onPointerEnter={() => onHover?.(true)}
        onPointerLeave={() => onHover?.(false)}
        onFocus={() => onHover?.(true)}
        onBlur={() => onHover?.(false)}
      >
        <span className="row__date">
          {v.day ? (
            <>
              <b>{dateOnly(v.day)}</b> {dateOnly(v.day, { weekday: "short" })}
            </>
          ) : (
            <b>No date</b>
          )}
        </span>
        <span className="row__route-wrap">
          <span className="row__route">
            {v.fromCode}
            <ArrowGlyph />
            {v.toCode}
            {badge}
            {review && (
              <span className="review" title="This flight has a check to look at">
                <Icon name="info" />
                Review
              </span>
            )}
          </span>
          <span className="row__cities">
            {cityOf(v.f.fromAirportId, ref) || v.f.fromRaw} to {cityOf(v.f.toAirportId, ref) || v.f.toRaw}
          </span>
        </span>
        <span className="row__cell row__flight">
          <b>{v.f.flightNumber ?? "—"}</b>
          {airlineLabel(v.f.airlineId, ref) || v.f.airlineRaw}
        </span>
        <span className="row__cell row__aircraft">
          <b>{typeName(v.f.typeCode, ref) || "—"}</b>
          {v.f.registration}
        </span>
        <span className="row__num row__num--dur tabular">{v.min !== null ? <Duration min={v.min} /> : "—"}</span>
        <span className="row__num row__num--dist tabular">{v.km !== null ? distance(v.km, unit) : "—"}</span>
        <span className="row__track" onPointerEnter={tip} onPointerMove={tip} onPointerLeave={hideTip}>
          <Icon name={track ? "route" : "great-circle"} />
          <span className="visually-hidden">
            {t.title}. {t.detail}
          </span>
        </span>
      </Link>
    </li>
  );
}
