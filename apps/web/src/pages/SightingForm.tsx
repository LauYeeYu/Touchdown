// One sighting, quick to enter at the airport (docs/31-ui.md, "Quick add (single)"): registration first,
// then date and place (last used by default), then the phase in one tap.

import { useDeferredValue, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "@tanstack/react-router";
import { flightDay, looksLikeOperatorName, PHASES, todayIn, type SightingValues } from "@touchdown/core";
import { sentenceGap, t } from "@touchdown/i18n";
import { useApp } from "../data/context.tsx";
import { draftFindings } from "../data/draft.ts";
import { knownFor, lastSpot, rememberSpot } from "../lib/known.ts";
import { airlineLabel, dayMonthYear, PHASE_LABEL, shortAirport, TAG_LABEL, typeName } from "../lib/format.ts";
import { Icon } from "../lib/icons.tsx";
import { airportOptions, Field, LiveryQuestion, operatorOptions, Picker, Segmented, TextInput } from "../components/form.tsx";
import { ShareButton } from "../components/ShareDialog.tsx";
import { linkFor, useShares } from "../data/shares.ts";
import { FindingList } from "../components/Findings.tsx";
import { toast } from "../components/overlay.tsx";
import { NotFound } from "./NotFound.tsx";
import { tx } from "../lib/i18n.tsx";

type Phase = (typeof PHASES)[number];

export function SightingForm({ edit = false }: { edit?: boolean }) {
  const params = useParams({ strict: false }) as { id?: string };
  const { app } = useApp();
  const shareList = useShares(app.connection?.mode === "standard");
  const { store, ref } = app;
  const navigate = useNavigate();
  const existing = edit && params.id ? store.get("sightings", params.id) : null;
  const last = lastSpot();
  const regInput = useRef<HTMLInputElement>(null);
  const init = () => ({
    registrationRaw: existing?.registrationRaw ?? existing?.registration ?? "",
    seenOn: existing?.seenOn ?? last?.date ?? todayIn(),
    airportRaw: existing?.airportRaw ?? (existing ? "" : (last?.airport ?? "")),
    phases: (existing ? app.phasesOf(existing.id) : []) as Phase[],
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
  const operator = ref.operatorByCode(operatorRaw, d.seenOn, [airport?.country]);

  const values: Partial<SightingValues> = useMemo(() => {
    const n = (v: string) => v.trim() || null;
    return {
      seenOn: d.seenOn || null,
      airportRaw: n(d.airportRaw),
      registrationRaw: n(d.registrationRaw),
      typeCodeRaw: n(d.typeCodeRaw) ?? (!existing ? (known?.typeCode ?? null) : null),
      modelRaw: n(d.modelRaw) ?? (!existing ? (known?.model ?? null) : null),
      operatorRaw: n(operatorRaw),
      specialLivery: n(d.specialLivery),
      livery: n(d.livery),
      notes: n(d.notes),
      airportId: existing && d.airportRaw === (existing.airportRaw ?? "") ? existing.airportId : null,
      operatorId: existing && operatorRaw === (existing.operatorRaw ?? "") ? existing.operatorId : null,
    };
  }, [d, known, operatorRaw, existing]);
  const deferred = useDeferredValue(values);
  const findings = useMemo(() => draftFindings(app, "sightings", deferred, existing?.id).filter((f) => f.ruleId !== "V-INCOMPLETE" && f.ruleId !== "C-LIVERY-MISSING"), [app, deferred, existing?.id]);

  if (edit && !existing) return <NotFound what={t("spotting.sighting.notFound")} back={{ to: "/spotting", label: t("spotting.title") }} />;

  const save = (another: boolean) => {
    app.saveSighting(values, existing?.id, d.tags, d.phases);
    if (d.seenOn && d.airportRaw) rememberSpot(d.seenOn, d.airportRaw);
    if (another) {
      toast(t("spotting.sighting.savedNext", { typed: values.registrationRaw ? "yes" : "no", registration: values.registrationRaw ?? "" }));
      setD((x) => ({ ...init(), seenOn: x.seenOn, airportRaw: x.airportRaw, registrationRaw: "" }));
      regInput.current?.focus();
    } else {
      toast(existing ? t("spotting.sighting.saved") : t("spotting.sighting.added"));
      navigate({ to: "/spotting" });
    }
  };
  const remove = () => {
    if (!existing) return;
    const shared = linkFor(shareList, "sighting", existing.id) ? "yes" : "no";
    if (!window.confirm(t("spotting.sighting.deleteConfirm", { typed: existing.registration ? "yes" : "no", registration: existing.registration ?? "", shared }))) return;
    app.deleteRecord("sightings", existing.id);
    toast(t("spotting.sighting.deleted"));
    navigate({ to: "/spotting" });
  };
  const toggleTag = (t: string) => set("tags", d.tags.includes(t) ? d.tags.filter((x) => x !== t) : [...d.tags, t]);
  const togglePhase = (p: Phase) => set("phases", d.phases.includes(p) ? d.phases.filter((x) => x !== p) : PHASES.filter((x) => x === p || d.phases.includes(x)));
  const others = known ? known.sightings.filter((s) => s.id !== existing?.id) : [];

  return (
    <div className="page page--form">
      <nav className="crumbs" aria-label={t("common.back")}>
        <Link to="/spotting">
          <Icon name="arrow-left" /> {t("spotting.title")}
        </Link>
      </nav>
      <h1 className="form-title">{existing ? t("spotting.sighting.titleEdit") : t("spotting.sighting.titleAdd")}</h1>
      <p className="form-sub">{tx("spotting.sighting.lead", {}, { link: (text) => <Link to="/spotting/session">{text}</Link> })}</p>
      <form
        className="form"
        onSubmit={(e) => {
          e.preventDefault();
          save(!existing);
        }}
      >
        <div className="form-grid">
          <Field label={t("spotting.field.registration")}>
            <TextInput ref={regInput} value={d.registrationRaw} onChange={(e) => set("registrationRaw", e.target.value)} placeholder="N123AB" autoFocus={!existing} />
          </Field>
          <Field label={t("spotting.field.date")}>
            <input className="input" type="date" value={d.seenOn} onChange={(e) => set("seenOn", e.target.value)} />
          </Field>
          <Field label={t("spotting.field.location")}>
            <Picker label={t("spotting.field.location")} value={d.airportRaw} onChange={(v) => set("airportRaw", v)} options={airportOptions(ref)} placeholder={t("spotting.field.locationPlaceholder")} resolved={d.airportRaw.trim() ? (airport ? shortAirport(airport.id, ref) : t("spotting.field.unknownAirport")) : null} invalid={!!d.airportRaw.trim() && !airport} />
          </Field>
        </div>

        {known && (
          <div className="known">
            <Icon name="info" />
            <p>
              {tx("spotting.sighting.known.aircraft", { type: known.typeCode ? typeName(known.typeCode, ref) : t("spotting.sighting.known.noType"), withAirline: known.operatorId ? "yes" : "no", airline: known.operatorId ? airlineLabel(known.operatorId, ref) : "" }, { b: (text) => <b>{text}</b> })}{sentenceGap()}
              {others.length > 0 && `${t("spotting.sighting.known.seen", { count: others.length, date: others[0]!.seenOn ? dayMonthYear(others[0]!.seenOn) : t("spotting.sighting.known.unknownDate") })}${sentenceGap()}`}
              {known.flights.length > 0 && `${t("spotting.sighting.known.flown", { dates: known.flights.map((f) => (flightDay(f) ? dayMonthYear(flightDay(f)!) : t("spotting.sighting.known.unknownDate"))).join(", ") })}${sentenceGap()}`}
              {known.specialLivery && !d.specialLivery.trim() && <LiveryQuestion worn={known.specialLivery} onUse={() => set("specialLivery", known.specialLivery!.name)} />}
            </p>
          </div>
        )}

        <Field label={t("spotting.field.phase")} hint={t("spotting.sighting.phaseHint")}>
          <div className="chips" role="group" aria-label={t("spotting.field.phase")}>
            {PHASES.filter((p) => p !== "other" || d.phases.includes(p)).map((p) => (
              <button key={p} type="button" className="chip" aria-pressed={d.phases.includes(p)} onClick={() => togglePhase(p)}>
                {PHASE_LABEL[p]}
              </button>
            ))}
          </div>
        </Field>

        <div className="form-grid">
          <Field label={t("spotting.sighting.typeCode")} hint={known?.typeCode && !d.typeCodeRaw ? t("spotting.sighting.typeFromEarlier", { type: known.typeCode }) : d.typeCodeRaw ? typeName(d.typeCodeRaw.toUpperCase(), ref) : undefined}>
            <TextInput value={d.typeCodeRaw} onChange={(e) => set("typeCodeRaw", e.target.value)} placeholder={known?.typeCode ?? "B738"} />
          </Field>
          <Field label={t("spotting.sighting.model")}>
            <TextInput value={d.modelRaw} onChange={(e) => set("modelRaw", e.target.value)} placeholder={known?.model ?? "737-8H4"} />
          </Field>
          <Field label={t("spotting.field.airline")}>
            <Picker label={t("spotting.field.airline")} value={d.operatorRaw} onChange={(v) => set("operatorRaw", v)} options={operatorOptions(ref, "icao")} placeholder={known?.operatorRaw ?? t("spotting.sighting.airlinePlaceholder")} resolved={operatorRaw ? (operator ? operator.name : looksLikeOperatorName(operatorRaw) ? t("spotting.sighting.notAirline") : t("spotting.sighting.unknownAirline")) : null} invalid={!!operatorRaw && !operator && !looksLikeOperatorName(operatorRaw)} />
          </Field>
          <Field label={t("spotting.field.specialLivery")} hint={t("spotting.sighting.liveryHint")}>
            <TextInput value={d.specialLivery} onChange={(e) => set("specialLivery", e.target.value)} />
          </Field>
          <Field label={t("spotting.sighting.livery")}>
            <TextInput value={d.livery} onChange={(e) => set("livery", e.target.value)} />
          </Field>
          <Field label={t("spotting.sighting.photoNotes")}>
            <div className="chips" role="group" aria-label={t("spotting.sighting.photoNotes")}>
              {Object.entries(TAG_LABEL).map(([k, v]) => (
                <button key={k} type="button" className="chip" aria-pressed={d.tags.includes(k)} onClick={() => toggleTag(k)}>
                  {v}
                </button>
              ))}
            </div>
          </Field>
          <Field label={t("spotting.sighting.notes")} wide>
            <textarea className="input textarea" rows={2} value={d.notes} onChange={(e) => set("notes", e.target.value)} />
          </Field>
        </div>

        {findings.length > 0 && (
          <div className="form-checks" aria-live="polite">
            <h2 className="form-section">{t("spotting.sighting.checks")}</h2>
            <FindingList findings={findings.map((f) => ({ ...f, fixes: [] }))} />
          </div>
        )}

        <div className="form-actions">
          {existing ? (
            <>
              <button type="button" className="btn btn--primary" onClick={() => save(false)}>
                <Icon name="check" />
                {t("spotting.sighting.save")}
              </button>
              <button type="button" className="btn btn--quiet" onClick={remove}>
                <Icon name="trash" />
                {t("common.delete")}
              </button>
              <ShareButton kind="sighting" subject={existing.id} />
            </>
          ) : (
            <>
              <button type="submit" className="btn btn--primary">
                <Icon name="check" />
                {t("spotting.sighting.saveAnother")}
              </button>
              <button type="button" className="btn btn--quiet" onClick={() => save(false)}>
                {t("spotting.sighting.saveClose")}
              </button>
            </>
          )}
        </div>
      </form>
    </div>
  );
}
