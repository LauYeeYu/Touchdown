// Badges on the pages (docs/31, "Badges"): Statistics' Badges tab, Home's latest, and the badges a flight earned.
// Worked out from the log in core (`badges`), on a share link from the records it holds, as in the app.

import { useMemo } from "react";
import { flightName, flownDistances, type Flight } from "@touchdown/core";
import { badgeLevel, badgeName, badgeRule, badges as allBadges, BADGE_GROUPS, badgesOf, dayMonthYear, shownBadges, type Badge, type BadgePart } from "@touchdown/core/view";
import { t, tDynamic } from "@touchdown/i18n";
import { useApp } from "../data/context.tsx";
import { primaryCode } from "../lib/codes.ts";
import { Link } from "../lib/link.tsx";
import { Icon } from "../lib/icons.tsx";
import { BadgeStamp } from "./BadgeStamp.tsx";

/** Every badge of the log, earned or not, worked out again when the log changes or a planned flight's time passes. */
export function useBadges(): Badge[] {
  const { app, version } = useApp();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => allBadges(app.store, app.ref, { flown: flownDistances(app.store, app.ref) }), [app, version]);
}

/** The badges earned, newest first. */
export function latestEarned(list: readonly Badge[]): Badge[] {
  return list.filter((b) => b.by).sort((a, b) => (b.by!.day ?? "").localeCompare(a.by!.day ?? ""));
}

/** The record that earned a badge, as a link: a flight's number and route, or a sighting's registration and place. */
function EarnedBy({ badge }: { badge: Badge }) {
  const { app } = useApp();
  const by = badge.by!;
  if (by.table === "flights") {
    const f = app.store.get("flights", by.id);
    if (!f) return null;
    const route = [primaryCode(app.ref.airport(f.fromAirportId), f.fromRaw), primaryCode(app.ref.airport(f.divertedToAirportId ?? f.toAirportId), f.toRaw)].filter(Boolean).join(" → ");
    return (
      <Link to="/flights/$id" params={{ id: f.id }}>
        {[flightName(f), route].filter(Boolean).join(" · ")}
      </Link>
    );
  }
  const s = app.store.get("sightings", by.id);
  if (!s) return null;
  const place = primaryCode(app.ref.airport(s.airportId), s.airportRaw);
  return (
    <Link to="/spotting/$id/edit" params={{ id: s.id }}>
      {[s.registration, place].filter(Boolean).join(" · ")}
    </Link>
  );
}

function partLabel(b: Badge, p: BadgePart, ref: ReturnType<typeof useApp>["app"]["ref"]): string {
  if (b.parts?.kind === "airport") return primaryCode(ref.airport(p.key)) || p.key;
  if (b.parts?.kind === "continent") return tDynamic(`badges.continent.${p.key}`);
  return p.key;
}

/** One badge in the grid: the stamp, its name, its date and record or its rule, its parts and its level. */
function BadgeCell({ badge }: { badge: Badge }) {
  const { app } = useApp();
  const unit = app.settings().distanceUnit ?? "km";
  const level = badgeLevel(badge);
  return (
    <li className={`badge-cell badge-cell--${badge.ink}${badge.by ? "" : " badge-cell--not-yet"}`}>
      <BadgeStamp badge={badge} />
      <p className="badge-cell__name">{badgeName(badge)}</p>
      <p className="badge-cell__rule">{badgeRule(badge, unit)}</p>
      {badge.by ? (
        <p className="badge-cell__by">
          {badge.by.day && <span className="badge-cell__date">{dayMonthYear(badge.by.day)}</span>}
          <EarnedBy badge={badge} />
        </p>
      ) : (
        <p className="visually-hidden">{t("badges.notYet")}</p>
      )}
      {badge.parts && badge.parts.list.length > 1 && (
        <ul className="badge-cell__parts">
          {badge.parts.list.map((p) => {
            const label = partLabel(badge, p, app.ref);
            return (
              <li key={p.key} className={p.by ? "is-done" : undefined}>
                <span aria-hidden="true">{label}</span>
                <span className="visually-hidden">{p.by ? t("badges.part.done", { part: label }) : t("badges.part.notYet", { part: label })}</span>
              </li>
            );
          })}
        </ul>
      )}
      {level && <p className="badge-cell__level">{level}</p>}
    </li>
  );
}

/** Statistics' Badges tab: every badge whatever the period, by group. */
export function BadgesTab() {
  const list = useBadges();
  const shown = shownBadges(list);
  const hiddenLeft = list.some((b) => b.hidden && !b.by);
  return (
    <div className="badges">
      {BADGE_GROUPS.map((g) => {
        const items = shown.filter((b) => b.group === g);
        if (!items.length) return null;
        return (
          <section key={g} className="badges__group" aria-labelledby={`badges-${g}`}>
            <h3 className="badges__title" id={`badges-${g}`}>
              {tDynamic(`badges.group.${g}`)}
            </h3>
            <ul className="badges__grid">
              {items.map((b) => (
                <BadgeCell key={b.id} badge={b} />
              ))}
            </ul>
          </section>
        );
      })}
      {hiddenLeft && <p className="badges__note">{t("badges.hiddenNote")}</p>}
    </div>
  );
}

/** Home's latest badges, five on a desktop and three on a phone, with All badges. Nothing before the first. */
export function HomeBadges() {
  const earned = latestEarned(useBadges()).slice(0, 5);
  if (!earned.length) return null;
  return (
    <section className="section" aria-labelledby="badges-title">
      <div className="section__head">
        <h2 className="section__title" id="badges-title">
          {t("badges.home.title")}
        </h2>
      </div>
      <ul className="badges__row">
        {earned.map((b) => (
          <li key={b.id} className={`badge-cell badge-cell--small badge-cell--${b.ink}`}>
            <BadgeStamp badge={b} size={96} />
            <p className="badge-cell__name">{badgeName(b)}</p>
            {b.by?.day && <p className="badge-cell__date">{dayMonthYear(b.by.day)}</p>}
          </li>
        ))}
      </ul>
      <Link className="link-arrow" to="/stats" search={{ tab: "badges" }}>
        {t("badges.home.all")} <Icon name="arrow-right" />
      </Link>
    </section>
  );
}

/** The badges a flight earned, under its details: small stamps, each with its name, opening the Badges tab. */
export function FlightBadges({ flight }: { flight: Flight }) {
  const earned = badgesOf(useBadges(), flight.id);
  if (!earned.length) return null;
  return (
    <div className="flight-badges">
      <h3 className="subhead">{t("badges.flight.title")}</h3>
      <ul className="flight-badges__list">
        {earned.map((b) => (
          <li key={b.id}>
            <Link to="/stats" search={{ tab: "badges" }}>
              <BadgeStamp badge={b} size={28} words={false} />
              {badgeName(b)}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
