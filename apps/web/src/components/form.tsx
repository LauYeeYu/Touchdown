// Form pieces: labelled fields, an airport and airline picker, and a date-and-time field that always shows
// the date next to the time (requirement G8).

import { useId, useMemo, useRef, useState, type ReactNode } from "react";
import { cityName, type Airport, type Operator, type RefIndex, type WornLivery } from "@touchdown/core";
import { dayMonthYear } from "../lib/format.ts";

export function Field({ label, hint, children, wide }: { label: string; hint?: ReactNode; children: ReactNode; wide?: boolean }) {
  return (
    <label className={`field${wide ? " field--wide" : ""}`}>
      <span className="field__label">{label}</span>
      {children}
      {hint && <span className="field__hint">{hint}</span>}
    </label>
  );
}

export function TextInput(props: React.ComponentProps<"input">) {
  return <input className="input" autoComplete="off" spellCheck={false} {...props} />;
}

function normal(s: string) {
  return s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
}

/** Airports matching typed text: exact IATA or ICAO code first, then city and name. */
export function searchAirports(ref: RefIndex, q: string, limit = 8): Airport[] {
  const t = normal(q.trim());
  if (!t) return [];
  const exact = ref.airportByCode(t.toUpperCase());
  const out: Airport[] = exact ? [exact] : [];
  const scored: { a: Airport; s: number }[] = [];
  for (const a of ref.airports.values()) {
    if (a === exact) continue;
    const city = normal(a.city ?? "");
    const name = normal(a.name);
    let s = 0;
    if (a.iata && normal(a.iata).startsWith(t)) s = 3;
    else if (a.icao && normal(a.icao).startsWith(t)) s = 3;
    else if (city.startsWith(t)) s = 2;
    else if (name.includes(t) || city.includes(t)) s = 1;
    if (s) scored.push({ a, s: s + (a.iata ? 0.5 : 0) });
  }
  scored.sort((x, y) => y.s - x.s || (x.a.city ?? x.a.name).localeCompare(y.a.city ?? y.a.name));
  return [...out, ...scored.slice(0, limit - out.length).map((x) => x.a)];
}

export function searchOperators(ref: RefIndex, q: string, limit = 8): Operator[] {
  const t = normal(q.trim());
  if (!t) return [];
  const exact = ref.operatorByCode(t.toUpperCase());
  const out: Operator[] = exact ? [exact] : [];
  const scored: { o: Operator; s: number }[] = [];
  for (const o of ref.operators.values()) {
    if (o === exact) continue;
    const name = normal(o.name);
    let s = 0;
    if ((o.iata && normal(o.iata) === t) || (o.icao && normal(o.icao) === t)) s = 4;
    else if (name.startsWith(t)) s = 2;
    else if (name.includes(t)) s = 1;
    if (s) scored.push({ o, s: s + (o.iata ? 0.5 : 0) + (o.validTo ? -1 : 0) });
  }
  scored.sort((x, y) => y.s - x.s || x.o.name.localeCompare(y.o.name));
  return [...out, ...scored.slice(0, limit - out.length).map((x) => x.o)];
}

interface PickerOption {
  value: string; // what goes in the field: a code
  label: string;
  detail: string;
}

/** A text field with suggestions. The typed text is the value; picking a suggestion fills its code. */
export function Picker({ value, onChange, options, placeholder, label, resolved, invalid }: {
  value: string;
  onChange: (v: string) => void;
  options: (q: string) => PickerOption[];
  placeholder?: string;
  label: string;
  resolved?: string | null; // what the current value resolves to, shown under the field
  invalid?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const listId = useId();
  const blurTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const list = useMemo(() => (open ? options(value) : []), [open, value, options]);
  const choose = (o: PickerOption) => {
    onChange(o.value);
    setOpen(false);
  };
  return (
    <span className="picker">
      <input
        className={`input${invalid ? " input--invalid" : ""}`}
        value={value}
        placeholder={placeholder}
        aria-label={label}
        role="combobox"
        aria-expanded={open && list.length > 0}
        aria-controls={listId}
        aria-autocomplete="list"
        autoComplete="off"
        spellCheck={false}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
          setActive(0);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => (blurTimer.current = setTimeout(() => setOpen(false), 120))}
        onKeyDown={(e) => {
          if (!list.length) return;
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setActive((a) => (a + 1) % list.length);
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActive((a) => (a + list.length - 1) % list.length);
          } else if (e.key === "Enter" && open) {
            e.preventDefault();
            choose(list[active]!);
          } else if (e.key === "Escape") setOpen(false);
        }}
      />
      {open && list.length > 0 && (
        <span className="picker__list" role="listbox" id={listId}>
          {list.map((o, i) => (
            <span
              key={o.value + o.label}
              role="option"
              aria-selected={i === active}
              className="picker__option"
              onPointerDown={(e) => {
                e.preventDefault();
                clearTimeout(blurTimer.current);
                choose(o);
              }}
              onPointerEnter={() => setActive(i)}
            >
              <b>{o.value}</b>
              <span>
                {o.label}
                <small>{o.detail}</small>
              </span>
            </span>
          ))}
        </span>
      )}
      {resolved !== undefined && <span className={`field__hint${invalid ? " field__hint--bad" : ""}`}>{resolved ?? ""}</span>}
    </span>
  );
}

export function airportOptions(ref: RefIndex) {
  return (q: string) =>
    searchAirports(ref, q).map((a) => ({ value: a.iata ?? a.icao ?? a.id, label: cityName(a) ? `${cityName(a)} · ${a.name}` : a.name, detail: [a.iata, a.icao, a.country].filter(Boolean).join(" · ") }));
}

export function operatorOptions(ref: RefIndex, prefer: "iata" | "icao") {
  return (q: string) =>
    searchOperators(ref, q).map((o) => ({
      value: (prefer === "icao" ? (o.icao ?? o.iata) : (o.iata ?? o.icao)) ?? o.name,
      label: o.name,
      detail: [o.iata, o.icao, o.country, o.validTo ? `until ${o.validTo.slice(0, 4)}` : null].filter(Boolean).join(" · "),
    }));
}

/** Date and time inputs side by side. Empty time means the value is not recorded. */
export function DateTimeField({ label, date, time, onDate, onTime, hint, disabled }: {
  label: string;
  date: string;
  time: string;
  onDate: (v: string) => void;
  onTime: (v: string) => void;
  hint?: ReactNode;
  disabled?: boolean;
}) {
  return (
    <div className="field">
      <span className="field__label">{label}</span>
      <span className="datetime">
        <input className="input" type="date" value={date} onChange={(e) => onDate(e.target.value)} aria-label={`${label} date`} disabled={disabled} />
        <input className="input" type="time" value={time} onChange={(e) => onTime(e.target.value)} aria-label={`${label} time, local`} disabled={disabled} />
      </span>
      {hint && <span className="field__hint">{hint}</span>}
    </div>
  );
}

export function Segmented<T extends string>({ value, options, onChange, label }: { value: T | null; options: { value: T; label: string }[]; onChange: (v: T | null) => void; label: string }) {
  return (
    <div className="chips" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" role="radio" aria-checked={value === o.value} className="chip" onClick={() => onChange(value === o.value ? null : o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Asks whether the aircraft still wore the special livery the log has for it; never filled in unasked (docs/21). */
export function LiveryQuestion({ worn, onUse }: { worn: WornLivery; onUse: () => void }) {
  return (
    <>
      Recorded in <b>{worn.name}</b> on {dayMonthYear(worn.on)}. Still in it?{" "}
      <button type="button" className="link-btn" onClick={onUse} aria-label={`Add special livery ${worn.name}`}>
        Yes, add it
      </button>
    </>
  );
}
