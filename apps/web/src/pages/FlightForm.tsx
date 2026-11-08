// Quick add and edit for a flight (docs/31-ui.md, "Quick add"). Flight number and date first; airports with
// suggestions; everything else under "More". Every time is a date and a time, in the airport's local time.

import { useDeferredValue, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "@tanstack/react-router";
import { t } from "@touchdown/i18n";
import { cityName, looksLikeOperatorName, parseDateTime, parseFlightNumber, todayIn, withPrivate, zonedDateTime, type Flight, type FlightValues } from "@touchdown/core";
import { useApp } from "../data/context.tsx";
import { textCode } from "../lib/codes.ts";
import { draftFindings } from "../data/draft.ts";
import { CABIN_LABEL, REASON_LABEL, typeName } from "../lib/format.ts";
import { Icon } from "../lib/icons.tsx";
import { DateTimeField, Field, operatorOptions, Picker, Segmented, TextInput } from "../components/form.tsx";
import { AirportField } from "../components/AirportField.tsx";
import { FindingList } from "../components/Findings.tsx";
import { toast } from "../components/overlay.tsx";
import { Select } from "../components/Select.tsx";
import { Disclosure } from "../components/Disclosure.tsx";
import { NotFound } from "./NotFound.tsx";

type TimeKey = "boarding" | "takeoff" | "landing";

interface Draft {
  scheduledDate: string;
  flightNumber: string;
  airlineRaw: string;
  fromRaw: string;
  toRaw: string;
  registrationRaw: string;
  typeCodeRaw: string;
  modelRaw: string;
  seat: string;
  seatPosition: "" | "window" | "middle" | "aisle";
  cabinClass: "" | "economy" | "premium_economy" | "business" | "first" | "private";
  bookingClass: string;
  fareBrand: string;
  reason: "" | "leisure" | "business" | "crew" | "other";
  departureTerminal: string;
  departureGate: string;
  livery: string;
  specialLivery: string;
  notes: string;
  ticketNumber: string;
  bookingRef: string;
  times: Record<TimeKey, { date: string; time: string }>;
}

function split(dt: string | null): { date: string; time: string } {
  const p = dt ? parseDateTime(dt) : null;
  return p ? { date: p.date, time: p.time.slice(0, 5) } : { date: "", time: "" };
}

function fromFlight(f: Flight | null): Draft {
  const s = (v: string | null | undefined) => v ?? "";
  return {
    scheduledDate: s(f?.scheduledDate) || todayIn(),
    flightNumber: s(f?.flightNumber),
    airlineRaw: s(f?.airlineRaw),
    fromRaw: s(f?.fromRaw),
    toRaw: s(f?.toRaw),
    registrationRaw: s(f?.registrationRaw ?? f?.registration),
    typeCodeRaw: s(f?.typeCodeRaw ?? f?.typeCode),
    modelRaw: s(f?.modelRaw ?? f?.model),
    seat: s(f?.seat),
    seatPosition: (f?.seatPosition ?? "") as Draft["seatPosition"],
    cabinClass: (f?.cabinClass ?? "") as Draft["cabinClass"],
    bookingClass: s(f?.bookingClass),
    fareBrand: s(f?.fareBrand),
    reason: (f?.reason ?? "") as Draft["reason"],
    departureTerminal: s(f?.departureTerminal),
    departureGate: s(f?.departureGate),
    livery: s(f?.livery),
    specialLivery: s(f?.specialLivery),
    notes: s(f?.notes),
    ticketNumber: s(f?.ticketNumber),
    bookingRef: s(f?.bookingRef),
    times: { boarding: split(f?.boardingAt ?? null), takeoff: split(f?.takeoffAt ?? null), landing: split(f?.landingAt ?? null) },
  };
}

export function FlightForm({ edit = false }: { edit?: boolean }) {
  const params = useParams({ strict: false }) as { id?: string };
  const { app } = useApp();
  const { ref } = app;
  const navigate = useNavigate();
  const settings = app.settings();
  const existing = edit && params.id ? app.store.get("flights", params.id) : null;
  // The ticket number and booking reference are in the flight's private row (docs/32, "Private data").
  const [d, setD] = useState<Draft>(() => fromFlight(existing && withPrivate(app.store, existing)));

  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((x) => ({ ...x, [k]: v }));
  const setTime = (k: TimeKey, part: "date" | "time", v: string) => setD((x) => ({ ...x, times: { ...x.times, [k]: { ...x.times[k], [part]: v } } }));

  // A time's date starts as the scheduled date and follows it until the user changes it.
  useEffect(() => {
    setD((x) => {
      const t = { ...x.times };
      for (const k of ["boarding", "takeoff", "landing"] as TimeKey[]) if (!t[k].time && x.scheduledDate) t[k] = { ...t[k], date: x.scheduledDate };
      return { ...x, times: t };
    });
  }, [d.scheduledDate]);

  // The airline follows the flight number's designator while the airline field is empty.
  const designator = parseFlightNumber(d.flightNumber)?.designator ?? "";
  const airlineRaw = d.airlineRaw || designator;

  const from = existing && d.fromRaw === (existing.fromRaw ?? "") && existing.fromAirportId ? ref.airport(existing.fromAirportId) : ref.airportByCode(d.fromRaw);
  const to = existing && d.toRaw === (existing.toRaw ?? "") && existing.toAirportId ? ref.airport(existing.toAirportId) : ref.airportByCode(d.toRaw);
  const airline = existing && airlineRaw === (existing.airlineRaw ?? "") && existing.airlineId ? ref.operator(existing.airlineId) : ref.operatorByCode(airlineRaw, d.scheduledDate, [from?.country, to?.country]);

  const values: Partial<FlightValues> = useMemo(() => {
    const at = (k: TimeKey, tz: string | undefined) => (d.times[k].date && d.times[k].time && tz ? zonedDateTime(d.times[k].date, d.times[k].time, tz) : null);
    const n = (v: string) => v.trim() || null;
    return {
      scheduledDate: d.scheduledDate || null,
      flightNumber: n(d.flightNumber),
      airlineRaw: n(airlineRaw),
      fromRaw: n(d.fromRaw),
      toRaw: n(d.toRaw),
      registrationRaw: n(d.registrationRaw),
      typeCodeRaw: n(d.typeCodeRaw),
      modelRaw: n(d.modelRaw),
      seat: n(d.seat),
      seatPosition: d.seatPosition || null,
      cabinClass: d.cabinClass || null,
      bookingClass: n(d.bookingClass)?.toUpperCase() ?? null,
      fareBrand: n(d.fareBrand),
      reason: d.reason || null,
      departureTerminal: n(d.departureTerminal),
      departureGate: n(d.departureGate),
      livery: n(d.livery),
      specialLivery: n(d.specialLivery),
      notes: n(d.notes),
      ticketNumber: n(d.ticketNumber),
      bookingRef: n(d.bookingRef),
      boardingAt: at("boarding", from?.tz),
      takeoffAt: at("takeoff", from?.tz),
      landingAt: at("landing", to?.tz),
      // Links are resolved again from the codes, unless a code is unchanged: an imported flight may have been
      // matched by a more precise code (ICAO) than the one shown.
      airlineId: existing && airlineRaw === (existing.airlineRaw ?? "") ? existing.airlineId : null,
      fromAirportId: existing && d.fromRaw === (existing.fromRaw ?? "") ? existing.fromAirportId : null,
      toAirportId: existing && d.toRaw === (existing.toRaw ?? "") ? existing.toAirportId : null,
    };
  }, [d, airlineRaw, from, to, existing]);

  const deferred = useDeferredValue(values);
  const findings = useMemo(() => draftFindings(app, "flights", deferred, existing?.id).filter((f) => f.ruleId !== "V-INCOMPLETE"), [app, deferred, existing?.id]);

  if (edit && !existing) return <NotFound what={t("flights.notFound.log")} back={{ to: "/flights", label: t("flights.allFlights") }} />;

  const save = (e: React.FormEvent) => {
    e.preventDefault();
    const row = app.saveFlight(values, existing?.id);
    toast(existing ? t("flightForm.saved") : t("flightForm.added"));
    navigate({ to: "/flights/$id", params: { id: row.id } });
  };

  // A time typed for an airport with no known zone cannot be stored yet: said in the alert colour, not dropped unsaid.
  const tzHint = (k: TimeKey, tz: string | undefined, code: string) =>
    tz ? (
      t("flightForm.hint.localTime", { code })
    ) : d.times[k].time ? (
      <span className="field__hint--bad">{t("flightForm.hint.notSaved", { typed: code ? "yes" : "no", code })}</span>
    ) : (
      t("flightForm.hint.chooseAirport")
    );
  const known = (raw: string, name: string | undefined, kind: "airport" | "airline") => (!raw.trim() ? null : name ? name : t("flightForm.unknownCode", { kind }));

  return (
    <div className="page page--form">
      <nav className="crumbs" aria-label={t("common.back")}>
        <Link to={existing ? "/flights/$id" : "/flights"} params={existing ? { id: existing.id } : undefined}>
          <Icon name="arrow-left" /> {existing ? t("flightForm.backToFlight") : t("flights.allFlights")}
        </Link>
      </nav>
      <h1 className="form-title">{existing ? t("flightForm.title.edit") : t("flightForm.title.add")}</h1>
      <p className="form-sub">{t("flightForm.intro")}</p>
      <form className="form" onSubmit={save}>
        <div className="form-grid">
          <Field label={t("flightForm.field.flightNumber")}>
            <TextInput value={d.flightNumber} onChange={(e) => set("flightNumber", e.target.value)} placeholder="DL123" autoFocus={!existing} />
          </Field>
          <Field label={t("flightForm.field.scheduledDate")} hint={t("flightForm.hint.scheduledDate")}>
            <input className="input" type="date" value={d.scheduledDate} onChange={(e) => set("scheduledDate", e.target.value)} />
          </Field>
          <AirportField label={t("flightForm.field.from")} value={d.fromRaw} onChange={(v) => set("fromRaw", v)} airport={from} shown={from ? `${cityName(from) ?? ""} ${from.name}`.trim() : ""} unknown={t("flightForm.unknownCode", { kind: "airport" })} placeholder={t("flightForm.placeholder.airport")} />
          <AirportField label={t("flightForm.field.to")} value={d.toRaw} onChange={(v) => set("toRaw", v)} airport={to} shown={to ? `${cityName(to) ?? ""} ${to.name}`.trim() : ""} unknown={t("flightForm.unknownCode", { kind: "airport" })} placeholder={t("flightForm.placeholder.airport")} />
          <Field label={t("flightForm.field.airline")}>
            <Picker label={t("flightForm.field.airline")} value={d.airlineRaw} onChange={(v) => set("airlineRaw", v)} options={operatorOptions(ref, settings.codeDisplay === "icao" ? "icao" : "iata")} placeholder={designator ? t("flightForm.placeholder.designator", { designator }) : t("flightForm.placeholder.airline")} resolved={airlineRaw && !airline && looksLikeOperatorName(airlineRaw) ? t("flightForm.operator") : known(airlineRaw, airline?.name, "airline")} invalid={!!airlineRaw && !airline && !looksLikeOperatorName(airlineRaw)} />
          </Field>
          <Field label={t("flightForm.field.registration")}>
            <TextInput value={d.registrationRaw} onChange={(e) => set("registrationRaw", e.target.value)} placeholder="N123AB" />
          </Field>
          <Field label={t("flightForm.field.typeCode")} hint={d.typeCodeRaw ? typeName(d.typeCodeRaw.toUpperCase(), ref) : t("flightForm.hint.typeCode")}>
            <TextInput value={d.typeCodeRaw} onChange={(e) => set("typeCodeRaw", e.target.value)} placeholder="A21N" />
          </Field>
          <Field label={t("flightForm.field.model")} hint={t("flightForm.hint.model")}>
            <TextInput value={d.modelRaw} onChange={(e) => set("modelRaw", e.target.value)} placeholder="A321-271NX" />
          </Field>
        </div>

        <h2 className="form-section">{t("flightForm.section.times")}</h2>
        <p className="form-sub">{t("flightForm.section.timesIntro")}</p>
        <div className="form-grid">
          <DateTimeField label={t("flightForm.field.boarding")} {...dt(d, "boarding", setTime)} hint={tzHint("boarding", from?.tz, textCode(from, d.fromRaw))} />
          <DateTimeField label={t("flightForm.field.takeoff")} {...dt(d, "takeoff", setTime)} hint={tzHint("takeoff", from?.tz, textCode(from, d.fromRaw))} />
          <DateTimeField label={t("flightForm.field.landing")} {...dt(d, "landing", setTime)} hint={tzHint("landing", to?.tz, textCode(to, d.toRaw))} />
        </div>

        {findings.length > 0 && (
          <div className="form-checks" aria-live="polite">
            <h2 className="form-section">{t("flightForm.section.checks")}</h2>
            <FindingList findings={findings.map((f) => ({ ...f, fixes: [] }))} />
          </div>
        )}

        <Disclosure className="disclosure--form" summary={t("flightForm.more")} defaultOpen={edit}>
          <div className="form-grid">
            <Field label={t("flightForm.field.seat")}>
              <TextInput value={d.seat} onChange={(e) => set("seat", e.target.value)} placeholder="14A" />
            </Field>
            <Field label={t("flightForm.field.seatPosition")}>
              <Segmented label={t("flightForm.field.seatPosition")} value={d.seatPosition || null} onChange={(v) => set("seatPosition", v ?? "")} options={[{ value: "window", label: t("flightForm.seatPosition.window") }, { value: "middle", label: t("flightForm.seatPosition.middle") }, { value: "aisle", label: t("flightForm.seatPosition.aisle") }]} />
            </Field>
            <Field label={t("flightForm.field.cabin")}>
              <Select<Draft["cabinClass"]>
                label={t("flightForm.field.cabin")}
                value={d.cabinClass}
                onChange={(v) => set("cabinClass", v)}
                options={[{ value: "", label: t("flightForm.notRecorded") }, ...Object.entries(CABIN_LABEL).map(([k, v]) => ({ value: k as Draft["cabinClass"], label: v }))]}
              />
            </Field>
            <Field label={t("flightForm.field.fare")}>
              <TextInput value={d.fareBrand} onChange={(e) => set("fareBrand", e.target.value)} placeholder="Main Cabin" />
            </Field>
            <Field label={t("flightForm.field.bookingClass")}>
              <TextInput value={d.bookingClass} onChange={(e) => set("bookingClass", e.target.value)} maxLength={1} placeholder="T" />
            </Field>
            <Field label={t("flightForm.field.reason")}>
              <Select<Draft["reason"]>
                label={t("flightForm.field.reason")}
                value={d.reason}
                onChange={(v) => set("reason", v)}
                options={[{ value: "", label: t("flightForm.notRecorded") }, ...Object.entries(REASON_LABEL).map(([k, v]) => ({ value: k as Draft["reason"], label: v }))]}
              />
            </Field>
            <Field label={t("flightForm.field.terminal")}>
              <TextInput value={d.departureTerminal} onChange={(e) => set("departureTerminal", e.target.value)} />
            </Field>
            <Field label={t("flightForm.field.gate")}>
              <TextInput value={d.departureGate} onChange={(e) => set("departureGate", e.target.value)} />
            </Field>
            <Field label={t("flightForm.field.specialLivery")} hint={t("flightForm.hint.specialLivery")}>
              <TextInput value={d.specialLivery} onChange={(e) => set("specialLivery", e.target.value)} />
            </Field>
            <Field label={t("flightForm.field.livery")}>
              <TextInput value={d.livery} onChange={(e) => set("livery", e.target.value)} />
            </Field>
            <Field label={t("flightForm.field.notes")} wide>
              <textarea className="input textarea" rows={3} value={d.notes} onChange={(e) => set("notes", e.target.value)} />
            </Field>
          </div>
          <h2 className="form-section">{t("flightForm.section.private")}</h2>
          <p className="form-sub">{t("flightForm.section.privateIntro")}</p>
          <div className="form-grid">
            <Field label={t("flightForm.field.ticketNumber")}>
              <TextInput value={d.ticketNumber} onChange={(e) => set("ticketNumber", e.target.value)} placeholder={t("flightForm.placeholder.ticketNumber")} />
            </Field>
            <Field label={t("flightForm.field.bookingRef")}>
              <TextInput value={d.bookingRef} onChange={(e) => set("bookingRef", e.target.value)} />
            </Field>
          </div>
        </Disclosure>

        <div className="form-actions">
          <button type="submit" className="btn btn--primary">
            <Icon name="check" />
            {existing ? t("flightForm.submit.save") : t("flightForm.submit.add")}
          </button>
          <Link className="btn btn--quiet" to={existing ? "/flights/$id" : "/flights"} params={existing ? { id: existing.id } : undefined}>
            {t("common.cancel")}
          </Link>
        </div>
      </form>
    </div>
  );
}

function dt(d: Draft, k: TimeKey, setTime: (k: TimeKey, part: "date" | "time", v: string) => void) {
  return { date: d.times[k].date, time: d.times[k].time, onDate: (v: string) => setTime(k, "date", v), onTime: (v: string) => setTime(k, "time", v) };
}
