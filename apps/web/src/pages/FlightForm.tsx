// Quick add and edit for a flight (docs/31-ui.md, "Quick add"). Flight number and date first; airports with
// suggestions; everything else under "More". Every time is a date and a time, in the airport's local time.

import { useDeferredValue, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "@tanstack/react-router";
import { cityName, parseDateTime, parseFlightNumber, todayIn, zonedDateTime, type Flight, type FlightValues } from "@touchdown/core";
import { useApp } from "../data/context.tsx";
import { textCode } from "../lib/codes.ts";
import { draftFindings } from "../data/draft.ts";
import { CABIN_LABEL, REASON_LABEL, typeName } from "../lib/format.ts";
import { Icon } from "../lib/icons.tsx";
import { airportOptions, DateTimeField, Field, operatorOptions, Picker, Segmented, TextInput } from "../components/form.tsx";
import { FindingList } from "../components/Findings.tsx";
import { toast } from "../components/overlay.tsx";
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
  const [d, setD] = useState<Draft>(() => fromFlight(existing));

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
  const airline = existing && airlineRaw === (existing.airlineRaw ?? "") && existing.airlineId ? ref.operator(existing.airlineId) : ref.operatorByCode(airlineRaw, d.scheduledDate);

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

  if (edit && !existing) return <NotFound what="That flight is not in your log." back={{ to: "/flights", label: "All flights" }} />;

  const save = (e: React.FormEvent) => {
    e.preventDefault();
    const row = app.saveFlight(values, existing?.id);
    toast(existing ? "Flight saved." : "Flight added.");
    navigate({ to: "/flights/$id", params: { id: row.id } });
  };

  const tzHint = (tz: string | undefined, code: string) => (tz ? `Local time at ${code}` : "Choose the airport first, so the time is stored with its UTC offset");
  const known = (raw: string, name: string | undefined, kind: string) => (!raw.trim() ? null : name ? name : `Not a known ${kind} code`);

  return (
    <div className="page page--form">
      <nav className="crumbs" aria-label="Back">
        <Link to={existing ? "/flights/$id" : "/flights"} params={existing ? { id: existing.id } : undefined}>
          <Icon name="arrow-left" /> {existing ? "Back to the flight" : "All flights"}
        </Link>
      </nav>
      <h1 className="form-title">{existing ? "Edit flight" : "Add a flight"}</h1>
      <p className="form-sub">Every field is optional. Checks run as you type and never stop you saving.</p>
      <form className="form" onSubmit={save}>
        <div className="form-grid">
          <Field label="Flight number">
            <TextInput value={d.flightNumber} onChange={(e) => set("flightNumber", e.target.value)} placeholder="DL123" autoFocus={!existing} />
          </Field>
          <Field label="Scheduled date" hint="The date on the ticket">
            <input className="input" type="date" value={d.scheduledDate} onChange={(e) => set("scheduledDate", e.target.value)} />
          </Field>
          <Field label="From">
            <Picker label="From" value={d.fromRaw} onChange={(v) => set("fromRaw", v)} options={airportOptions(ref)} placeholder="Code, city or name" resolved={known(d.fromRaw, from ? `${cityName(from) ?? ""} ${from.name}`.trim() : undefined, "airport")} invalid={!!d.fromRaw.trim() && !from} />
          </Field>
          <Field label="To">
            <Picker label="To" value={d.toRaw} onChange={(v) => set("toRaw", v)} options={airportOptions(ref)} placeholder="Code, city or name" resolved={known(d.toRaw, to ? `${cityName(to) ?? ""} ${to.name}`.trim() : undefined, "airport")} invalid={!!d.toRaw.trim() && !to} />
          </Field>
          <Field label="Airline">
            <Picker label="Airline" value={d.airlineRaw} onChange={(v) => set("airlineRaw", v)} options={operatorOptions(ref, settings.codeDisplay === "icao" ? "icao" : "iata")} placeholder={designator ? `${designator} (from the flight number)` : "Code or name"} resolved={known(airlineRaw, airline?.name, "airline")} invalid={!!airlineRaw && !airline} />
          </Field>
          <Field label="Registration">
            <TextInput value={d.registrationRaw} onChange={(e) => set("registrationRaw", e.target.value)} placeholder="N123AB" />
          </Field>
          <Field label="Type code" hint={d.typeCodeRaw ? typeName(d.typeCodeRaw.toUpperCase(), ref) : "ICAO designator, e.g. A21N"}>
            <TextInput value={d.typeCodeRaw} onChange={(e) => set("typeCodeRaw", e.target.value)} placeholder="A21N" />
          </Field>
          <Field label="Model" hint="Either style: 777-322(ER) or B777-322ER">
            <TextInput value={d.modelRaw} onChange={(e) => set("modelRaw", e.target.value)} placeholder="A321-271NX" />
          </Field>
        </div>

        <h2 className="form-section">Times</h2>
        <p className="form-sub">Takeoff and landing, in local time at each airport. A takeoff after midnight goes on the next day.</p>
        <div className="form-grid">
          <DateTimeField label="Boarding" {...dt(d, "boarding", setTime)} hint={tzHint(from?.tz, textCode(from, d.fromRaw))} />
          <DateTimeField label="Takeoff" {...dt(d, "takeoff", setTime)} hint={tzHint(from?.tz, textCode(from, d.fromRaw))} />
          <DateTimeField label="Landing" {...dt(d, "landing", setTime)} hint={tzHint(to?.tz, textCode(to, d.toRaw))} />
        </div>

        {findings.length > 0 && (
          <div className="form-checks" aria-live="polite">
            <h2 className="form-section">Checks</h2>
            <FindingList findings={findings.map((f) => ({ ...f, fixes: [] }))} />
          </div>
        )}

        <Disclosure className="disclosure--form" summary="More: seat, class, gate, livery, notes, ticket" defaultOpen={edit}>
          <div className="form-grid">
            <Field label="Seat">
              <TextInput value={d.seat} onChange={(e) => set("seat", e.target.value)} placeholder="14A" />
            </Field>
            <Field label="Seat position">
              <Segmented label="Seat position" value={d.seatPosition || null} onChange={(v) => set("seatPosition", v ?? "")} options={[{ value: "window", label: "Window" }, { value: "middle", label: "Middle" }, { value: "aisle", label: "Aisle" }]} />
            </Field>
            <Field label="Cabin">
              <select className="select" value={d.cabinClass} onChange={(e) => set("cabinClass", e.target.value as Draft["cabinClass"])}>
                <option value="">Not recorded</option>
                {Object.entries(CABIN_LABEL).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Fare">
              <TextInput value={d.fareBrand} onChange={(e) => set("fareBrand", e.target.value)} placeholder="Main Cabin" />
            </Field>
            <Field label="Booking class">
              <TextInput value={d.bookingClass} onChange={(e) => set("bookingClass", e.target.value)} maxLength={1} placeholder="T" />
            </Field>
            <Field label="Reason">
              <select className="select" value={d.reason} onChange={(e) => set("reason", e.target.value as Draft["reason"])}>
                <option value="">Not recorded</option>
                {Object.entries(REASON_LABEL).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Terminal">
              <TextInput value={d.departureTerminal} onChange={(e) => set("departureTerminal", e.target.value)} />
            </Field>
            <Field label="Gate">
              <TextInput value={d.departureGate} onChange={(e) => set("departureGate", e.target.value)} />
            </Field>
            <Field label="Special livery" hint="Only real special liveries and stickers">
              <TextInput value={d.specialLivery} onChange={(e) => set("specialLivery", e.target.value)} />
            </Field>
            <Field label="Regular livery variant">
              <TextInput value={d.livery} onChange={(e) => set("livery", e.target.value)} />
            </Field>
            <Field label="Notes" wide>
              <textarea className="input textarea" rows={3} value={d.notes} onChange={(e) => set("notes", e.target.value)} />
            </Field>
          </div>
          <h2 className="form-section">Private</h2>
          <p className="form-sub">Kept in your data only. Never sent to a lookup or an agent check, and left out of exports unless you include them.</p>
          <div className="form-grid">
            <Field label="Ticket number">
              <TextInput value={d.ticketNumber} onChange={(e) => set("ticketNumber", e.target.value)} placeholder="13 digits and coupon, e.g. /1" />
            </Field>
            <Field label="Booking reference">
              <TextInput value={d.bookingRef} onChange={(e) => set("bookingRef", e.target.value)} />
            </Field>
          </div>
        </Disclosure>

        <div className="form-actions">
          <button type="submit" className="btn btn--primary">
            <Icon name="check" />
            {existing ? "Save flight" : "Add flight"}
          </button>
          <Link className="btn btn--quiet" to={existing ? "/flights/$id" : "/flights"} params={existing ? { id: existing.id } : undefined}>
            Cancel
          </Link>
        </div>
      </form>
    </div>
  );
}

function dt(d: Draft, k: TimeKey, setTime: (k: TimeKey, part: "date" | "time", v: string) => void) {
  return { date: d.times[k].date, time: d.times[k].time, onDate: (v: string) => setTime(k, "date", v), onTime: (v: string) => setTime(k, "time", v) };
}
