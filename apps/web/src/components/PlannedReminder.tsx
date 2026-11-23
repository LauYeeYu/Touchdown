// The reminder to confirm a planned flight once its time has passed (docs/31, "Planned flights"): its words, and the
// buttons, Confirm, Update and "Remind me later". A bar under the masthead on every page of the owner's app shows it
// for the flights whose reminder time has come; a flight's page shows it in a band above the map, whatever that time.
// Never on a share link. Every time is the one at its airport, as the ticket gives it.

import { arrivalAirportId, flightName, toConfirm, type Flight, type RefIndex } from "@touchdown/core";
import { t } from "@touchdown/i18n";
import { useNavigate } from "@tanstack/react-router";
import type { AppData } from "../data/app.ts";
import { useApp } from "../data/context.tsx";
import { cityOf, clock, dateOnly, localDay } from "../lib/format.ts";
import { Icon } from "../lib/icons.tsx";
import { MenuButton } from "./Menu.tsx";
import { NoteBar } from "./NoteBar.tsx";
import { toast } from "./overlay.tsx";

const HOUR = 3600_000;

/** When "Remind me later" brings the reminder back, from now. */
const LATER = [
  { key: "hour", after: HOUR },
  { key: "tomorrow", after: 24 * HOUR },
  { key: "days", after: 3 * 24 * HOUR },
  { key: "week", after: 7 * 24 * HOUR },
] as const;

/** A day with its weekday, without the year: "Sunday 15 December". */
const dayOf = (ymd: string) => dateOnly(ymd, { weekday: "long", day: "numeric", month: "long" });

/**
 * What the reminder says of one flight: its arrival at the arrival airport, as the ticket gives it, else its departure
 * at the departure airport, else the date alone.
 */
export function dueText(f: Flight, ref: RefIndex): string {
  const name = flightName(f);
  const flight = { numbered: name ? "yes" : "no", flight: name ?? "" };
  const arrives = f.arrivalScheduledAt ?? f.landingAt ?? f.arrivalAt;
  const leaves = f.departureScheduledAt ?? f.takeoffAt ?? f.departureAt;
  const to = cityOf(arrivalAirportId(f), ref) || f.toRaw || "";
  const from = cityOf(f.fromAirportId, ref) || f.fromRaw || "";
  if (arrives && localDay(arrives)) return t("flights.planned.due.arrival", { ...flight, city: to, time: clock(arrives), date: dayOf(localDay(arrives)!) });
  if (leaves && localDay(leaves)) return t("flights.planned.due.departure", { ...flight, city: from, time: clock(leaves), date: dayOf(localDay(leaves)!) });
  return t("flights.planned.due.date", { ...flight, from, to, date: f.scheduledDate ? dayOf(f.scheduledDate) : "" });
}

/** "Remind me later": the reminder to confirm these flights comes back at the time chosen, on every device. */
export function RemindLater({ app, ids, className = "btn btn--quiet btn--small" }: { app: AppData; ids: string[]; className?: string }) {
  return (
    <MenuButton
      className={className}
      label={t("flights.planned.later")}
      items={LATER.map((l) => ({ label: t(`flights.planned.later.${l.key}`), onSelect: () => app.remindLater(ids, Date.now() + l.after) }))}
    >
      <Icon name="clock" />
      {t("flights.planned.later")}
      <Icon name="chevron-down" />
    </MenuButton>
  );
}

/** Confirm a planned flight as flown, saying so. */
export function confirm(app: AppData, id: string) {
  app.confirmFlight(id);
  toast(t("flights.planned.confirmed"));
}

/** The bar under the masthead: the due flights whose reminder time has come, the owner's app only. */
export function PlannedBar() {
  const { app } = useApp();
  const navigate = useNavigate();
  if (app.readOnly) return null;
  const due = app.store
    .all("flights")
    .filter((f) => toConfirm(f, app.ref))
    .sort((a, b) => (a.scheduledDate ?? "").localeCompare(b.scheduledDate ?? ""));
  if (!due.length) return null;
  const one = due.length === 1 ? due[0]! : null;
  return (
    <NoteBar
      icon="tickets-plane"
      actions={
        <>
          {one ? (
            <>
              <button type="button" className="btn btn--quiet btn--small" onClick={() => confirm(app, one.id)}>
                {t("flights.planned.confirm")}
              </button>
              <button type="button" className="btn btn--quiet btn--small" onClick={() => navigate({ to: "/flights/$id/edit", params: { id: one.id } })}>
                {t("flights.planned.update")}
              </button>
            </>
          ) : (
            <button type="button" className="btn btn--quiet btn--small" onClick={() => navigate({ to: "/flights/$id", params: { id: due[0]!.id } })}>
              {t("flights.planned.review")}
            </button>
          )}
          <RemindLater app={app} ids={due.map((f) => f.id)} className="btn btn--ghost btn--small" />
        </>
      }
    >
      {one ? dueText(one, app.ref) : t("flights.planned.due.several", { count: due.length })}
    </NoteBar>
  );
}
