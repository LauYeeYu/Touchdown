// An airport Touchdown does not know, added by the user, or one they added, changed (docs/31, "Airports of your
// own"): its code, name, place, country, position and time zone. The position sets the country and the time zone to
// start from, those of the nearest known airport, until the user chooses them.

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { airportName, haversineKm, nearestAirport, parsePosition, type Airport } from "@touchdown/core";
import { locale, t } from "@touchdown/i18n";
import { useApp } from "../data/context.tsx";
import { countryName, distance } from "../lib/format.ts";
import { Icon } from "../lib/icons.tsx";
import { Field, TextInput } from "./form.tsx";
import { toast } from "./overlay.tsx";
import { Select } from "./Select.tsx";
import { useModal } from "../lib/dialog.ts";

const CODE = /^[A-Z0-9]{3,4}$/;

/** What a record has, as the code to start from: a code as typed, upper-cased; a name gives none. */
const codeFrom = (raw: string) => (CODE.test(raw.trim().toUpperCase()) ? raw.trim().toUpperCase() : "");

/**
 * `raw`: what the record or the field has (a code, or a name the user typed). `airport`: one of the user's own, to
 * change. `onSaved` hears the code it was saved under. Drawn at the end of the page, so a form it opens from does not
 * hold its form.
 */
export function AirportDialog({ raw = "", airport, onClose, onSaved }: { raw?: string; airport?: Airport; onClose: () => void; onSaved?: (code: string) => void }) {
  const { app } = useApp();
  const { ref } = app;
  const { ref: dialog, close, props: dialogProps } = useModal(onClose);
  const [code, setCode] = useState(airport ? (airport.icao ?? airport.iata ?? "") : codeFrom(raw));
  const [name, setName] = useState(airport?.name ?? "");
  const [city, setCity] = useState(airport?.city ?? "");
  const [position, setPosition] = useState(airport ? `${airport.lat}, ${airport.lon}` : "");
  const [country, setCountry] = useState(airport?.country ?? "");
  const [tz, setTz] = useState(airport?.tz ?? "");
  // Chosen by the user: the position no longer sets them.
  const [chose, setChose] = useState({ country: !!airport, tz: !!airport });
  const [tried, setTried] = useState(false);

  useEffect(() => {
    dialog.current?.showModal();
    // A code the small airfields have is not one to add (docs/13, "Airports").
    void app.loadAirfields();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pos = parsePosition(position);
  const near = useMemo(() => {
    if (!pos) return null;
    const a = nearestAirport(ref, pos.lat, pos.lon);
    return a && a.id !== airport?.id ? { airport: a, km: haversineKm(pos, a) } : null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pos?.lat, pos?.lon, ref, app.airfieldsLoaded]);
  useEffect(() => {
    if (!near) return;
    if (!chose.country) setCountry(near.airport.country);
    if (!chose.tz) setTz(near.airport.tz);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [near?.airport.id]);

  const countries = useMemo(() => {
    const codes = new Set<string>();
    for (const a of ref.airports.values()) if (a.country) codes.add(a.country);
    if (country) codes.add(country);
    return [...codes].map((c) => ({ value: c, label: countryName(c) })).sort((a, b) => a.label.localeCompare(b.label, locale()));
  }, [ref, country]);
  const zones = useMemo(() => {
    const list = Intl.supportedValuesOf("timeZone");
    // The browser may list a zone under its older name (Asia/Calcutta for the data's Asia/Kolkata): the airport's
    // spelling takes its place.
    if (tz && !list.includes(tz)) {
      const at = list.indexOf(canonicalZone(tz));
      if (at >= 0) list[at] = tz;
      else list.push(tz);
    }
    return list.sort().map((z) => ({ value: z, label: z.replaceAll("_", " ") }));
  }, [tz]);
  const unset = { value: "", label: t("airport.own.fromPosition"), disabled: true };

  const upper = code.trim().toUpperCase();
  const codeOk = CODE.test(upper);
  const holder = codeOk ? ref.airportByCode(upper) : null;
  const taken = holder && holder.id !== airport?.id ? holder : null;
  const problems = {
    code: !codeOk ? (upper || tried ? t("airport.own.error.code") : null) : taken ? t("airport.own.error.taken", { code: upper, airport: airportName(taken) }) : null,
    name: tried && !name.trim() ? t("airport.own.error.name") : null,
    position: (position.trim() || tried) && !pos ? t("airport.own.error.position") : null,
  };
  const ready = codeOk && !taken && !!name.trim() && !!pos && !!country && !!tz;
  const unit = app.settings().distanceUnit ?? "km";

  const save = (e: React.FormEvent) => {
    e.preventDefault();
    // A form it opened from hears the event too (React passes it on through the portal).
    e.stopPropagation();
    setTried(true);
    if (!ready) return;
    toast(app.saveOwnAirport({ code: upper, name, city, country, lat: pos.lat, lon: pos.lon, tz }, { id: airport?.id, raw }));
    onSaved?.(upper);
    close();
  };

  return createPortal(
    <dialog ref={dialog} className="share-dialog airport-dialog" {...dialogProps} aria-labelledby="airport-dialog-title">
      <h2 id="airport-dialog-title" className="share-dialog__title">
        {airport ? t("airport.own.title.edit") : t("airport.own.title.add")}
      </h2>
      {!airport && <p className="share-dialog__text">{t("airport.own.intro")}</p>}
      <form className="form airport-dialog__form" onSubmit={save} noValidate>
        <div className="form-grid">
          <Field label={t("airport.own.field.code")} hint={<Hint problem={problems.code} text={t("airport.own.hint.code")} />}>
            <TextInput value={code} onChange={(e) => setCode(e.target.value)} maxLength={4} className={`input${problems.code ? " input--invalid" : ""}`} autoFocus={!code} />
          </Field>
          <Field label={t("airport.own.field.name")} hint={problems.name && <Hint problem={problems.name} text="" />}>
            <TextInput value={name} onChange={(e) => setName(e.target.value)} className={`input${problems.name ? " input--invalid" : ""}`} autoFocus={!!code && !airport} />
          </Field>
          <Field
            wide
            label={t("airport.own.field.position")}
            hint={<Hint problem={problems.position} text={near ? t("airport.own.hint.near", { distance: distance(near.km, unit), airport: airportName(near.airport) }) : t("airport.own.hint.position")} />}
          >
            <TextInput value={position} onChange={(e) => setPosition(e.target.value)} inputMode="text" placeholder="51.5008, -0.7744" className={`input${problems.position ? " input--invalid" : ""}`} />
          </Field>
          <Field label={t("airport.own.field.city")}>
            <TextInput value={city} onChange={(e) => setCity(e.target.value)} />
          </Field>
          <div className="field">
            <span className="field__label" id="airport-dialog-country">
              {t("airport.own.field.country")}
            </span>
            <Select
              labelledBy="airport-dialog-country"
              value={country}
              options={country ? countries : [unset, ...countries]}
              onChange={(v) => {
                setCountry(v);
                setChose((c) => ({ ...c, country: true }));
              }}
            />
          </div>
          <div className="field field--wide">
            <span className="field__label" id="airport-dialog-tz">
              {t("airport.own.field.tz")}
            </span>
            <Select
              labelledBy="airport-dialog-tz"
              value={tz}
              options={tz ? zones : [unset, ...zones]}
              onChange={(v) => {
                setTz(v);
                setChose((c) => ({ ...c, tz: true }));
              }}
            />
            <span className="field__hint">{tz && !chose.tz && near ? t("airport.own.hint.tz", { airport: airportName(near.airport) }) : ""}</span>
          </div>
        </div>
        <div className="share-dialog__foot">
          <button type="submit" className="btn btn--primary btn--small">
            <Icon name="check" />
            {t("common.save")}
          </button>
          <button type="button" className="btn btn--ghost btn--small" onClick={close}>
            {t("common.cancel")}
          </button>
        </div>
      </form>
    </dialog>,
    document.body,
  );
}

function canonicalZone(tz: string): string {
  try {
    return new Intl.DateTimeFormat("en", { timeZone: tz }).resolvedOptions().timeZone;
  } catch {
    return tz;
  }
}

function Hint({ problem, text }: { problem: string | null; text: string }) {
  return problem ? <span className="field__hint--bad">{problem}</span> : <>{text}</>;
}
