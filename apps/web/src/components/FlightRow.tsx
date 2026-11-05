// One flight in a list (Flights, airport pages, the statistics' list of flights).

import type { ReactNode } from "react";
import { t } from "@touchdown/i18n";
import { Link } from "../lib/link.tsx";
import { useApp } from "../data/context.tsx";
import type { FlightView } from "../lib/views.ts";
import type { TrackInfo } from "../lib/mapdata.ts";
import { airlineLabel, cityOf, dateOnly, distance, TRACK_SOURCE } from "../lib/format.ts";
import { ArrowGlyph, Icon } from "../lib/icons.tsx";
import { esc, hideTip, showTip } from "./overlay.tsx";
import { Duration } from "./Duration.tsx";
import { TypeCell } from "./TypeCell.tsx";

/** What the track icon means, for its tooltip and for screen readers. */
function trackText(track: TrackInfo | null, shared: boolean): { title: string; detail: string } {
  const source = track?.provider && TRACK_SOURCE[track.provider] ? TRACK_SOURCE[track.provider]! : "";
  const known = source ? "yes" : "no";
  if (!track) return { title: t("flights.row.track.none.title"), detail: t("flights.row.track.none.detail") };
  if (!track.here)
    return shared
      ? { title: t("flights.row.track.loading.title"), detail: t("flights.row.track.loading.detail", { known, source }) }
      : { title: t("flights.row.track.notHere.title"), detail: t("flights.row.track.notHere.detail", { known, source }) };
  if (track.coverage === "partial") return { title: t("flights.row.track.partial.title"), detail: t("flights.row.track.partial.detail", { known, source }) };
  return { title: t("flights.row.track.recorded.title"), detail: t("flights.row.track.recorded.detail", { known, source }) };
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
  const words = trackText(track, app.readOnly);
  const tip = (e: React.PointerEvent) => showTip(`<strong>${esc(words.title)}</strong><br><span class="muted">${esc(words.detail)}</span>`, e.clientX, e.clientY);
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
            <b>{t("flights.noDate")}</b>
          )}
        </span>
        <span className="row__route-wrap">
          <span className="row__route">
            {v.fromCode}
            <ArrowGlyph />
            {v.toCode}
            {badge}
            {review && (
              <span className="review" title={t("flights.row.review.title")}>
                <Icon name="info" />
                {t("flights.row.review.label")}
              </span>
            )}
          </span>
          <span className="row__cities">
            {t("flights.row.cities", { from: cityOf(v.f.fromAirportId, ref) || (v.f.fromRaw ?? ""), to: cityOf(v.f.toAirportId, ref) || (v.f.toRaw ?? "") })}
          </span>
        </span>
        <span className="row__cell row__flight">
          <b>{v.f.flightNumber ?? "—"}</b>
          {airlineLabel(v.f.airlineId, ref) || v.f.airlineRaw}
        </span>
        <TypeCell code={v.f.typeCode} second={v.f.registration} className="row__aircraft" />
        <span className="row__num row__num--dur tabular">{v.min !== null ? <Duration min={v.min} /> : "—"}</span>
        <span className="row__num row__num--dist tabular">{v.km !== null ? distance(v.km, unit) : "—"}</span>
        <span className="row__track" onPointerEnter={tip} onPointerMove={tip} onPointerLeave={hideTip}>
          <Icon name={track ? "route" : "great-circle"} />
          <span className="visually-hidden">{t("flights.row.track.spoken", { title: words.title, detail: words.detail })}</span>
        </span>
      </Link>
    </li>
  );
}
