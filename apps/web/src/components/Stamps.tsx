// Stamps on the pages (docs/31, "Stamps"): Statistics' Stamps tab, Home's latest, and the stamps a flight earned.
// Worked out from the log in core (`stamps`), on a share link from the records it holds, as in the app, with the
// stamps the site's owner gave from the account (or the link). A hidden stamp is pressed onto the page the first time.

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { flightName, flownDistances, markStampsSeen, type Flight } from "@touchdown/core";
import { stampLevel, stampName, stampRule, stamps as allStamps, STAMP_GROUPS, stampsOf, stampsToPress, dayMonthYear, shownStamps, type Stamp, type StampPart } from "@touchdown/core/view";
import { t, tDynamic } from "@touchdown/i18n";
import { useApp } from "../data/context.tsx";
import { primaryCode } from "../lib/codes.ts";
import { Link } from "../lib/link.tsx";
import { Icon } from "../lib/icons.tsx";
import { StampMark } from "./StampMark.tsx";

/** Every stamp of the log, earned or not, worked out again when the log changes or a planned flight's time passes. */
export function useStamps(): Stamp[] {
  const { app, version } = useApp();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => allStamps(app.store, app.ref, { flown: flownDistances(app.store, app.ref), granted: app.granted }), [app, version]);
}

/** The hidden stamps to press onto the page here: none on a share link, whose viewer is not the log's owner. */
function useToPress(list: readonly Stamp[]): Set<string> {
  const { app, version } = useApp();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => (app.readOnly ? new Set<string>() : stampsToPress(app.store, list)), [app, version, list]);
}

/**
 * Holds a stamp. A hidden stamp shown for the first time (`press`) waits unseen until most of it is on screen, is
 * pressed onto the page (DESIGN.md, "Stamps") and is then recorded in the log as seen, so it plays once on any device.
 * Leaving before it lands leaves it for next time. With reduced motion it is simply there, and recorded once in view.
 */
function StampHold({ stamp, press, children }: { stamp: Stamp; press: boolean; children: ReactNode }) {
  const { app } = useApp();
  const ref = useRef<HTMLSpanElement>(null);
  const [pressing, setPressing] = useState(false);
  const recorded = useRef(false);
  const record = () => {
    if (recorded.current) return;
    recorded.current = true;
    markStampsSeen(app.store, [stamp.id]);
  };
  useEffect(() => {
    const el = ref.current;
    if (!press || !el) return;
    const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const io = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting)) return;
        io.disconnect();
        if (still) record();
        else setPressing(true);
      },
      { threshold: 0.6 },
    );
    io.observe(el);
    return () => io.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [press]);
  return (
    <span ref={ref} className={`stamp-hold${press ? " stamp-hold--press" : ""}${pressing ? " is-pressing" : ""}`} onAnimationEnd={(e) => e.animationName === "stamp-press" && record()}>
      {children}
    </span>
  );
}

/** The stamps earned, newest first. */
export function latestEarned(list: readonly Stamp[]): Stamp[] {
  return list.filter((b) => b.by).sort((a, b) => (b.by!.day ?? "").localeCompare(a.by!.day ?? ""));
}

/** The record that earned a stamp, as a link: a flight's number and route, or a sighting's registration and place. */
function EarnedBy({ stamp }: { stamp: Stamp }) {
  const { app } = useApp();
  const by = stamp.by!;
  // A stamp the owner gave has its day and no record.
  if (by.table === "granted") return null;
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

function partLabel(b: Stamp, p: StampPart, ref: ReturnType<typeof useApp>["app"]["ref"]): string {
  if (b.parts?.kind === "airport") return primaryCode(ref.airport(p.key)) || p.key;
  if (b.parts?.kind === "continent") return tDynamic(`stamps.continent.${p.key}`);
  return p.key;
}

/** One stamp in the grid: the stamp, its name, its date and record or its rule, its parts and its level. */
function StampCell({ stamp, press }: { stamp: Stamp; press: boolean }) {
  const { app } = useApp();
  const unit = app.settings().distanceUnit ?? "km";
  const level = stampLevel(stamp);
  return (
    <li className={`stamp-cell stamp-cell--${stamp.ink}${stamp.by ? "" : " stamp-cell--not-yet"}`}>
      <StampHold stamp={stamp} press={press}>
        <StampMark stamp={stamp} />
      </StampHold>
      <p className="stamp-cell__name">{stampName(stamp)}</p>
      <p className="stamp-cell__rule">{stampRule(stamp, unit)}</p>
      {stamp.by ? (
        <p className="stamp-cell__by">
          {stamp.by.day && <span className="stamp-cell__date">{dayMonthYear(stamp.by.day)}</span>}
          <EarnedBy stamp={stamp} />
        </p>
      ) : (
        <p className="visually-hidden">{t("stamps.notYet")}</p>
      )}
      {stamp.parts && stamp.parts.list.length > 1 && (
        <ul className="stamp-cell__parts">
          {stamp.parts.list.map((p) => {
            const label = partLabel(stamp, p, app.ref);
            return (
              <li key={p.key} className={p.by ? "is-done" : undefined}>
                <span aria-hidden="true">{label}</span>
                <span className="visually-hidden">{p.by ? t("stamps.part.done", { part: label }) : t("stamps.part.notYet", { part: label })}</span>
              </li>
            );
          })}
        </ul>
      )}
      {level && <p className="stamp-cell__level">{level}</p>}
    </li>
  );
}

/** Statistics' Stamps tab: every stamp whatever the period, by group. */
export function StampsTab() {
  const list = useStamps();
  const shown = shownStamps(list);
  const toPress = useToPress(list);
  const hiddenLeft = list.some((b) => b.hidden && !b.by);
  return (
    <div className="stamps">
      {STAMP_GROUPS.map((g) => {
        const items = shown.filter((b) => b.group === g);
        if (!items.length) return null;
        return (
          <section key={g} className="stamps__group" aria-labelledby={`stamps-${g}`}>
            <h3 className="stamps__title" id={`stamps-${g}`}>
              {tDynamic(`stamps.group.${g}`)}
            </h3>
            <ul className="stamps__grid">
              {items.map((b) => (
                <StampCell key={b.id} stamp={b} press={toPress.has(b.id)} />
              ))}
            </ul>
          </section>
        );
      })}
      {hiddenLeft && <p className="stamps__note">{t("stamps.hiddenNote")}</p>}
    </div>
  );
}

/** Home's latest stamps, five on a desktop and three on a phone, with All stamps. Nothing before the first. */
export function HomeStamps() {
  const list = useStamps();
  const earned = latestEarned(list).slice(0, 5);
  const toPress = useToPress(list);
  if (!earned.length) return null;
  return (
    <section className="section" aria-labelledby="stamps-title">
      <div className="section__head">
        <h2 className="section__title" id="stamps-title">
          {t("stamps.home.title")}
        </h2>
      </div>
      <ul className="stamps__row">
        {earned.map((b) => (
          <li key={b.id} className={`stamp-cell stamp-cell--small stamp-cell--${b.ink}`}>
            <StampHold stamp={b} press={toPress.has(b.id)}>
              <StampMark stamp={b} size={96} />
            </StampHold>
            <p className="stamp-cell__name">{stampName(b)}</p>
            {b.by?.day && <p className="stamp-cell__date">{dayMonthYear(b.by.day)}</p>}
          </li>
        ))}
      </ul>
      <Link className="link-arrow" to="/stats" search={{ tab: "stamps" }}>
        {t("stamps.home.all")} <Icon name="arrow-right" />
      </Link>
    </section>
  );
}

/** The stamps a flight earned, under its details: small stamps, each with its name, opening the Stamps tab. */
export function FlightStamps({ flight }: { flight: Flight }) {
  const earned = stampsOf(useStamps(), flight.id);
  if (!earned.length) return null;
  return (
    <div className="flight-stamps">
      <h3 className="subhead">{t("stamps.flight.title")}</h3>
      <ul className="flight-stamps__list">
        {earned.map((b) => (
          <li key={b.id}>
            <Link to="/stats" search={{ tab: "stamps" }}>
              <StampMark stamp={b} size={28} words={false} />
              {stampName(b)}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
