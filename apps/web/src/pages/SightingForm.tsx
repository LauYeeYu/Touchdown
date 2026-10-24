// One sighting, quick to enter at the airport (docs/31-ui.md, "Quick add (single)"): registration first,
// then date and place (last used by default), then the phase in one tap.

import { useDeferredValue, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "@tanstack/react-router";
import { flightDay, looksLikeOperatorName, PHASES, todayIn, type SightingValues } from "@touchdown/core";
import { useApp } from "../data/context.tsx";
import { draftFindings } from "../data/draft.ts";
import { knownFor, lastSpot, rememberSpot } from "../lib/known.ts";
import { airlineLabel, dayMonthYear, PHASE_LABEL, shortAirport, TAG_LABEL, typeName } from "../lib/format.ts";
import { Icon } from "../lib/icons.tsx";
import { airportOptions, Field, LiveryQuestion, operatorOptions, Picker, Segmented, TextInput } from "../components/form.tsx";
import { FindingList } from "../components/Findings.tsx";
import { toast } from "../components/overlay.tsx";
import { NotFound } from "./NotFound.tsx";

type Phase = (typeof PHASES)[number];

export function SightingForm({ edit = false }: { edit?: boolean }) {
  const params = useParams({ strict: false }) as { id?: string };
  const { app } = useApp();
  const { store, ref } = app;
  const navigate = useNavigate();
  const existing = edit && params.id ? store.get("sightings", params.id) : null;
  const last = lastSpot();
  const regInput = useRef<HTMLInputElement>(null);
  const init = () => ({
    registrationRaw: existing?.registrationRaw ?? existing?.registration ?? "",
    seenOn: existing?.seenOn ?? last?.date ?? todayIn(),
    airportRaw: existing?.airportRaw ?? (existing ? "" : (last?.airport ?? "")),
    phase: (existing?.phase ?? null) as Phase | null,
    typeCodeRaw: existing?.typeCodeRaw ?? existing?.typeCode ?? "",
    modelRaw: existing?.modelRaw ?? existing?.model ?? "",
    operatorRaw: existing?.operatorRaw ?? "",
    specialLivery: existing?.specialLivery ?? "",
    livery: existing?.livery ?? "",
    notes: existing?.notes ?? "",
    tags: existing ? app.tagsOf(existing.id) : ([] as string[]),
  });
  const [d, setD] = useState(init);
  const set = <K extends keyof typeof d>(k: K, v: (typeof d)[K]) => setD((x) => ({ ...x, [k]: v }));

  const known = useMemo(() => (d.registrationRaw.trim() ? knownFor(store, d.registrationRaw, d.seenOn, existing?.id) : null), [store, d.registrationRaw, d.seenOn, existing?.id]);
  const airport = ref.airportByCode(d.airportRaw);
  const operatorRaw = d.operatorRaw || (!existing ? (known?.operatorRaw ?? "") : "");
  const operator = ref.operatorByCode(operatorRaw, d.seenOn);

  const values: Partial<SightingValues> = useMemo(() => {
    const n = (v: string) => v.trim() || null;
    return {
      seenOn: d.seenOn || null,
      airportRaw: n(d.airportRaw),
      registrationRaw: n(d.registrationRaw),
      typeCodeRaw: n(d.typeCodeRaw) ?? (!existing ? (known?.typeCode ?? null) : null),
      modelRaw: n(d.modelRaw) ?? (!existing ? (known?.model ?? null) : null),
      operatorRaw: n(operatorRaw),
      phase: d.phase,
      specialLivery: n(d.specialLivery),
      livery: n(d.livery),
      notes: n(d.notes),
      airportId: existing && d.airportRaw === (existing.airportRaw ?? "") ? existing.airportId : null,
      operatorId: existing && operatorRaw === (existing.operatorRaw ?? "") ? existing.operatorId : null,
    };
  }, [d, known, operatorRaw, existing]);
  const deferred = useDeferredValue(values);
  const findings = useMemo(() => draftFindings(app, "sightings", deferred, existing?.id).filter((f) => f.ruleId !== "V-INCOMPLETE" && f.ruleId !== "C-LIVERY-MISSING"), [app, deferred, existing?.id]);

  if (edit && !existing) return <NotFound what="That sighting is not in your log." back={{ to: "/spotting", label: "Spotting" }} />;

  const save = (another: boolean) => {
    app.saveSighting(values, existing?.id, d.tags);
    if (d.seenOn && d.airportRaw) rememberSpot(d.seenOn, d.airportRaw);
    if (another) {
      toast(`${values.registrationRaw ?? "Sighting"} saved. Next one.`);
      setD((x) => ({ ...init(), seenOn: x.seenOn, airportRaw: x.airportRaw, registrationRaw: "" }));
      regInput.current?.focus();
    } else {
      toast(existing ? "Sighting saved." : "Sighting added.");
      navigate({ to: "/spotting" });
    }
  };
  const remove = () => {
    if (!existing || !window.confirm(`Delete this sighting of ${existing.registration ?? "this aircraft"}?`)) return;
    app.deleteRecord("sightings", existing.id);
    toast("Sighting deleted.");
    navigate({ to: "/spotting" });
  };
  const toggleTag = (t: string) => set("tags", d.tags.includes(t) ? d.tags.filter((x) => x !== t) : [...d.tags, t]);
  const others = known ? known.sightings.filter((s) => s.id !== existing?.id) : [];

  return (
    <div className="page page--form">
      <nav className="crumbs" aria-label="Back">
        <Link to="/spotting">
          <Icon name="arrow-left" /> Spotting
        </Link>
      </nav>
      <h1 className="form-title">{existing ? "Edit sighting" : "Add a sighting"}</h1>
      <p className="form-sub">
        One sighting is one aircraft at one place on one day. For many aircraft, <Link to="/spotting/session">log a session</Link>.
      </p>
      <form
        className="form"
        onSubmit={(e) => {
          e.preventDefault();
          save(!existing);
        }}
      >
        <div className="form-grid">
          <Field label="Registration">
            <TextInput ref={regInput} value={d.registrationRaw} onChange={(e) => set("registrationRaw", e.target.value)} placeholder="N123AB" autoFocus={!existing} />
          </Field>
          <Field label="Date">
            <input className="input" type="date" value={d.seenOn} onChange={(e) => set("seenOn", e.target.value)} />
          </Field>
          <Field label="Location">
            <Picker label="Location" value={d.airportRaw} onChange={(v) => set("airportRaw", v)} options={airportOptions(ref)} placeholder="Airport code or city" resolved={d.airportRaw.trim() ? (airport ? shortAirport(airport.id, ref) : "Not a known airport code") : null} invalid={!!d.airportRaw.trim() && !airport} />
          </Field>
        </div>

        {known && (
          <div className="known">
            <Icon name="info" />
            <p>
              <b>{known.typeCode ? typeName(known.typeCode, ref) : "Type not recorded"}</b>
              {known.operatorId && ` · ${airlineLabel(known.operatorId, ref)}`}.{" "}
              {others.length > 0 && `Seen ${others.length === 1 ? "once" : `${others.length} times`} before, last on ${others[0]!.seenOn ? dayMonthYear(others[0]!.seenOn) : "an unknown date"}. `}
              {known.flights.length > 0 && `You flew on it on ${known.flights.map((f) => (flightDay(f) ? dayMonthYear(flightDay(f)!) : "an unknown date")).join(", ")}. `}
              {known.specialLivery && !d.specialLivery.trim() && <LiveryQuestion worn={known.specialLivery} onUse={() => set("specialLivery", known.specialLivery!.name)} />}
            </p>
          </div>
        )}

        <Field label="Phase">
          <Segmented label="Phase" value={d.phase} onChange={(v) => set("phase", v)} options={PHASES.filter((p) => p !== "other").map((p) => ({ value: p, label: PHASE_LABEL[p]! }))} />
        </Field>

        <div className="form-grid">
          <Field label="Type code" hint={known?.typeCode && !d.typeCodeRaw ? `${known.typeCode} from earlier records` : d.typeCodeRaw ? typeName(d.typeCodeRaw.toUpperCase(), ref) : undefined}>
            <TextInput value={d.typeCodeRaw} onChange={(e) => set("typeCodeRaw", e.target.value)} placeholder={known?.typeCode ?? "B738"} />
          </Field>
          <Field label="Model">
            <TextInput value={d.modelRaw} onChange={(e) => set("modelRaw", e.target.value)} placeholder={known?.model ?? "737-8H4"} />
          </Field>
          <Field label="Airline">
            <Picker label="Airline" value={d.operatorRaw} onChange={(v) => set("operatorRaw", v)} options={operatorOptions(ref, "icao")} placeholder={known?.operatorRaw ?? "Code or name"} resolved={operatorRaw ? (operator ? operator.name : looksLikeOperatorName(operatorRaw) ? "Not an airline: saved as an operator of your own" : "Not a known airline code") : null} invalid={!!operatorRaw && !operator && !looksLikeOperatorName(operatorRaw)} />
          </Field>
          <Field label="Special livery" hint="Only real special liveries and stickers">
            <TextInput value={d.specialLivery} onChange={(e) => set("specialLivery", e.target.value)} />
          </Field>
          <Field label="Regular livery variant">
            <TextInput value={d.livery} onChange={(e) => set("livery", e.target.value)} />
          </Field>
          <Field label="Photo notes">
            <div className="chips" role="group" aria-label="Photo notes">
              {Object.entries(TAG_LABEL).map(([k, v]) => (
                <button key={k} type="button" className="chip" aria-pressed={d.tags.includes(k)} onClick={() => toggleTag(k)}>
                  {v}
                </button>
              ))}
            </div>
          </Field>
          <Field label="Notes" wide>
            <textarea className="input textarea" rows={2} value={d.notes} onChange={(e) => set("notes", e.target.value)} />
          </Field>
        </div>

        {findings.length > 0 && (
          <div className="form-checks" aria-live="polite">
            <h2 className="form-section">Checks</h2>
            <FindingList findings={findings.map((f) => ({ ...f, fixes: [] }))} />
          </div>
        )}

        <div className="form-actions">
          {existing ? (
            <>
              <button type="button" className="btn btn--primary" onClick={() => save(false)}>
                <Icon name="check" />
                Save sighting
              </button>
              <button type="button" className="btn btn--quiet" onClick={remove}>
                <Icon name="trash" />
                Delete
              </button>
            </>
          ) : (
            <>
              <button type="submit" className="btn btn--primary">
                <Icon name="check" />
                Save and add another
              </button>
              <button type="button" className="btn btn--quiet" onClick={() => save(false)}>
                Save and close
              </button>
            </>
          )}
        </div>
      </form>
    </div>
  );
}
