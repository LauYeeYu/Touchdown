// A spotting session in bulk (docs/31-ui.md, "Session add"): set the day and the place once, then add
// registrations one after another, or paste a list. Each row shows what the log knows and its checks.
// The draft is kept in this browser until it is saved, so a long session survives a reload.

import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { looksLikeOperatorName, normaliseRegistration, PHASES, todayIn } from "@touchdown/core";
import { useApp } from "../data/context.tsx";
import { knownFor, lastSpot, rememberSpot } from "../lib/known.ts";
import { typeName, airlineLabel, PHASE_LABEL, plural, shortAirport } from "../lib/format.ts";
import { Icon } from "../lib/icons.tsx";
import { airportOptions, Field, LiveryQuestion, Picker } from "../components/form.tsx";
import { toast } from "../components/overlay.tsx";

type Phase = (typeof PHASES)[number];

interface Row {
  key: string;
  registrationRaw: string;
  typeCodeRaw: string;
  operatorRaw: string;
  phase: Phase | "";
  specialLivery: string;
}

const DRAFT = "td-session-draft";

function loadDraft(): { date: string; airport: string; rows: Row[] } | null {
  try {
    return JSON.parse(localStorage.getItem(DRAFT) ?? "null");
  } catch {
    return null;
  }
}

export function SessionAdd() {
  const { app } = useApp();
  const { store, ref } = app;
  const navigate = useNavigate();
  const draft = loadDraft();
  const last = lastSpot();
  const [date, setDate] = useState(draft?.date ?? last?.date ?? todayIn());
  const [airport, setAirport] = useState(draft?.airport ?? last?.airport ?? "");
  const [rows, setRows] = useState<Row[]>(draft?.rows ?? []);
  const [entry, setEntry] = useState("");
  const [phase, setPhase] = useState<Phase | "">("");
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    try {
      if (rows.length) localStorage.setItem(DRAFT, JSON.stringify({ date, airport, rows }));
      else localStorage.removeItem(DRAFT);
    } catch {
      /* storage unavailable: the draft lives only on this page */
    }
  }, [date, airport, rows]);

  const ap = ref.airportByCode(airport);
  const add = (text: string) => {
    const regs = text.split(/[\s,;]+/).map((r) => r.trim()).filter(Boolean);
    if (!regs.length) return;
    setRows((rs) => [
      ...regs.map((r, i) => {
        const k = knownFor(store, r);
        return { key: `${Date.now()}-${i}-${r}`, registrationRaw: r, typeCodeRaw: k?.typeCode ?? "", operatorRaw: k?.operatorRaw ?? (k?.operatorId ? (ref.operator(k.operatorId)?.icao ?? "") : ""), phase, specialLivery: "" };
      }).reverse(),
      ...rs,
    ]);
    setEntry("");
  };
  const update = (key: string, patch: Partial<Row>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const remove = (key: string) => setRows((rs) => rs.filter((r) => r.key !== key));

  const checked = useMemo(
    () =>
      rows.map((r) => {
        const n = normaliseRegistration(r.registrationRaw, ref);
        const notes: string[] = [];
        if (n && !n.knownFormat) notes.push("Unknown registration format");
        if (r.typeCodeRaw && !ref.type(r.typeCodeRaw)) notes.push(`${r.typeCodeRaw.toUpperCase()} is not a type code`);
        if (r.operatorRaw && !ref.operatorByCode(r.operatorRaw, date)) notes.push(looksLikeOperatorName(r.operatorRaw) ? `${r.operatorRaw.trim()} is added as an operator` : `${r.operatorRaw} is not an airline code`);
        const k = knownFor(store, r.registrationRaw, date);
        if (k?.typeCode && r.typeCodeRaw && k.typeCode !== r.typeCodeRaw.toUpperCase()) notes.push(`Recorded before as ${k.typeCode}`);
        const dup = rows.filter((o) => normaliseRegistration(o.registrationRaw, ref)?.match === n?.match).length > 1;
        if (dup) notes.push("Twice in this session");
        const seenToday = k?.sightings.some((s) => s.seenOn === date && (s.airportRaw ?? "").toUpperCase() === airport.toUpperCase());
        if (seenToday) notes.push("Already logged here today");
        return { row: r, display: n?.display ?? r.registrationRaw, known: k, notes, fresh: !k };
      }),
    [rows, ref, store, date, airport],
  );

  const save = () => {
    const n = app.saveSightings(
      rows
        .slice()
        .reverse()
        .map((r) => ({
          values: {
            seenOn: date || null,
            airportRaw: airport || null,
            registrationRaw: r.registrationRaw,
            typeCodeRaw: r.typeCodeRaw || null,
            operatorRaw: r.operatorRaw || null,
            phase: r.phase || null,
            specialLivery: r.specialLivery || null,
          },
        })),
    );
    if (date && airport) rememberSpot(date, airport);
    setRows([]);
    toast(`${plural(n, "sighting")} saved.`);
    navigate({ to: "/spotting" });
  };

  const fresh = checked.filter((c) => c.fresh).length;

  return (
    <div className="page page--form">
      <nav className="crumbs" aria-label="Back">
        <Link to="/spotting">
          <Icon name="arrow-left" /> Spotting
        </Link>
      </nav>
      <h1 className="form-title">Log a spotting session</h1>
      <p className="form-sub">Set the day and the place once, then type a registration and press Enter. Pasting a list works too.</p>
      <div className="form-grid">
        <Field label="Date">
          <input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <Field label="Location">
          <Picker label="Location" value={airport} onChange={setAirport} options={airportOptions(ref)} placeholder="Airport code or city" resolved={airport.trim() ? (ap ? shortAirport(ap.id, ref) : "Not a known airport code") : null} invalid={!!airport.trim() && !ap} />
        </Field>
        <Field label="Phase for new rows">
          <select className="select" value={phase} onChange={(e) => setPhase(e.target.value as Phase | "")}>
            <option value="">Not recorded</option>
            {PHASES.map((p) => (
              <option key={p} value={p}>
                {PHASE_LABEL[p]}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <form
        className="session-entry"
        onSubmit={(e) => {
          e.preventDefault();
          add(entry);
          input.current?.focus();
        }}
      >
        <input
          ref={input}
          className="input input--big"
          value={entry}
          onChange={(e) => setEntry(e.target.value)}
          onPaste={(e) => {
            const t = e.clipboardData.getData("text");
            if (/[\s,;]/.test(t.trim())) {
              e.preventDefault();
              add(t);
            }
          }}
          placeholder="Registration, then Enter"
          aria-label="Registration"
          autoComplete="off"
          spellCheck={false}
          autoCapitalize="characters"
          autoFocus
        />
        <button type="submit" className="btn btn--quiet">
          <Icon name="plus" />
          Add
        </button>
      </form>

      {rows.length > 0 && (
        <>
          <p className="session-count">
            {plural(rows.length, "aircraft", "aircraft")}
            {fresh > 0 && (
              <>
                {" "}
                · <span className="tag-new">{fresh} new</span> to your log
              </>
            )}
          </p>
          <ul className="session-rows">
            {checked.map(({ row, display, known, notes }) => (
              <li key={row.key} className="session-row">
                <span className="session-row__reg">
                  <b>{display}</b>
                  <small>{known ? `${typeName(known.typeCode, ref)}${known.operatorId ? ` · ${airlineLabel(known.operatorId, ref)}` : ""} · seen ${plural(known.sightings.length, "time")}` : "New to your log"}</small>
                </span>
                <input className="input" value={row.typeCodeRaw} onChange={(e) => update(row.key, { typeCodeRaw: e.target.value })} placeholder="Type" aria-label={`Type code for ${display}`} />
                <input className="input" value={row.operatorRaw} onChange={(e) => update(row.key, { operatorRaw: e.target.value })} placeholder="Airline" aria-label={`Airline for ${display}`} />
                <select className="select" value={row.phase} onChange={(e) => update(row.key, { phase: e.target.value as Phase | "" })} aria-label={`Phase for ${display}`}>
                  <option value="">Phase</option>
                  {PHASES.map((p) => (
                    <option key={p} value={p}>
                      {PHASE_LABEL[p]}
                    </option>
                  ))}
                </select>
                <input className="input" value={row.specialLivery} onChange={(e) => update(row.key, { specialLivery: e.target.value })} placeholder="Special livery" aria-label={`Special livery for ${display}`} />
                <button type="button" className="icon-btn" onClick={() => remove(row.key)} aria-label={`Remove ${display}`}>
                  <Icon name="x" />
                </button>
                {known?.specialLivery && !row.specialLivery.trim() && (
                  <span className="session-row__ask">
                    <LiveryQuestion worn={known.specialLivery} onUse={() => update(row.key, { specialLivery: known.specialLivery!.name })} />
                  </span>
                )}
                {notes.length > 0 && (
                  <span className="session-row__notes">
                    <Icon name="triangle-alert" />
                    {notes.join(" · ")}
                  </span>
                )}
              </li>
            ))}
          </ul>
          <div className="form-actions">
            <button type="button" className="btn btn--primary" onClick={save}>
              <Icon name="check" />
              Save {plural(rows.length, "sighting")}
            </button>
            <button
              type="button"
              className="btn btn--quiet"
              onClick={() => {
                if (window.confirm("Discard this session's rows?")) setRows([]);
              }}
            >
              Discard
            </button>
          </div>
        </>
      )}
    </div>
  );
}
