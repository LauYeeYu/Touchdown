// One aircraft: what it is, its registrations, and every time the user flew on it or photographed it.
// Tools from docs/11-aircraft-identity.md: set the serial number, edit facts, merge two airframes.

import { useMemo, useState } from "react";
import { useNavigate, useParams } from "@tanstack/react-router";
import { inSentence, sentenceGap, series, t } from "@touchdown/i18n";
import { Link } from "../lib/link.tsx";
import { flightDay, isValidDate, liveryName, liveryNames, pastedFactsFor, phasesOf, sameLivery, type Flight, type Sighting } from "@touchdown/core";
import { useApp } from "../data/context.tsx";
import { aircraftViews } from "../lib/views.ts";
import { airportWithCode, textCode } from "../lib/codes.ts";
import { airlineLabel, dateOnly, dayMonthYear, modelLabel, PHASE_LABEL, typeName } from "../lib/format.ts";
import { Icon } from "../lib/icons.tsx";
import { Credit, Photo } from "../components/Photo.tsx";
import { ShareButton } from "../components/ShareDialog.tsx";
import { periodVideo } from "../lib/videoContent.ts";
import { sortedFlights } from "@touchdown/core/view";
import { flownIn, LiveryBand, photographedIn } from "../components/LiveryBand.tsx";
import { FindingList } from "../components/Findings.tsx";
import { Field, TextInput } from "../components/form.tsx";
import { toast } from "../components/overlay.tsx";
import { NotFound } from "./NotFound.tsx";
import { Name, voiceOf } from "../lib/voice.tsx";
import { tx } from "../lib/i18n.tsx";

/** Display names of the airframe lookup sources (docs/13-reference-data.md, "Airframe facts"). */
const PROVIDER_NAME: Record<string, string> = {
  airfleets: "airfleets.net",
  planespotters: "planespotters.net",
  "aviation.flights": "aviation.flights",
  fr24: "Flightradar24",
  adsbdb: "adsbdb",
  opensky: "OpenSky",
};

const STATUS_LABEL: Record<string, () => string> = { stored: () => t("aircraft.status.stored"), retired: () => t("aircraft.status.retired"), written_off: () => t("aircraft.status.written_off") };

type Event = { date: string | null; kind: "flight"; f: Flight } | { date: string | null; kind: "sighting"; s: Sighting };

export function AircraftDetail() {
  const { id } = useParams({ from: "/aircraft/$id" });
  const { app, version } = useApp();
  const { store, ref } = app;
  const navigate = useNavigate();
  const settings = app.settings();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const views = useMemo(() => aircraftViews(store), [store, version]);
  const v = views.find((x) => x.airframe.id === id);
  const [msn, setMsn] = useState("");
  const [ffd, setFfd] = useState("");
  const [mergeQ, setMergeQ] = useState("");
  const [paste, setPaste] = useState("");

  // A share link leaves out what changes the log. Its sentence is about a whole log's owner by name, or on a link to
  // one record about nobody (lib/voice.tsx).
  const shared = app.readOnly;
  const voice = voiceOf(app);
  const who = voice.kind === "named" ? <Name name={voice.name} /> : null;
  if (!v) return <NotFound what={t("aircraft.detail.notFound", { where: shared ? "link" : "log" })} back={{ to: "/aircraft", label: t("aircraft.detail.all") }} />;
  const a = v.airframe;
  const regs = store.all("registration_periods").filter((p) => p.airframeId === a.id);
  const events: Event[] = [
    ...v.flights.map((f) => ({ date: flightDay(f), kind: "flight" as const, f })),
    ...v.sightings.map((s) => ({ date: s.seenOn, kind: "sighting" as const, s })),
  ].sort((x, y) => (x.date ?? "9999").localeCompare(y.date ?? "9999"));
  // Its special liveries in the order they were first recorded, each named once, capitalised where any record is.
  const liveries = liveryNames(events.map((e) => (e.kind === "flight" ? e.f.specialLivery : e.s.specialLivery)));
  const flightsIn = v.flights.filter((f) => f.specialLivery?.trim()).length;
  const sightingsIn = v.sightings.filter((s) => s.specialLivery?.trim());
  // "…, once in its Centenary livery": said only when the aircraft has one special livery in the log.
  const only = liveries.length === 1 ? liveries[0] : null;
  const liveryForm = (n: number, total: number) => (!only || !n ? null : n === total ? (total === 1 ? "single" : "each") : "some");
  const inLivery = (n: number, total: number) => {
    const form = liveryForm(n, total);
    return form ? t("aircraft.detail.lead.livery", { form, name: only!, count: n }) : "";
  };
  const flownClause = inLivery(flightsIn, v.flights.length);
  const spottedClause = flownClause ? "" : inLivery(sightingsIn.length, v.sightings.length);
  const flownForm = liveryForm(flightsIn, v.flights.length);
  const findings = app.findings().filter((f) => f.records.some((r) => (r.table === "flights" && v.flights.some((x) => x.id === r.id)) || (r.table === "sightings" && v.sightings.some((x) => x.id === r.id))));
  const typeText = a.model ? modelLabel(a.model, a.typeCode, ref, settings.modelNaming ?? "standard") : typeName(a.typeCode, ref);
  const first = events[0];
  const reg = v.registration ?? "";
  // Where each fact came from: the latest provenance row per field.
  const factSource = new Map<string, { source: string; detail: string | null }>();
  for (const p of store.all("field_provenance")) {
    if (p.ownerTable === "airframes" && p.ownerId === a.id && p.field && p.source) factSource.set(p.field, { source: p.source, detail: p.detail });
  }
  const sourceUrl = (provider: string) => store.all("external_ids").find((e) => e.ownerTable === "airframes" && e.ownerId === a.id && e.system === provider)?.value ?? null;
  const sourceNote = (field: string) => {
    const p = factSource.get(field);
    if (!p) return null;
    if (p.source === "user") return <span className="muted"> · {p.detail && p.detail !== "merge" ? t("aircraft.detail.source.sheet") : t("aircraft.detail.source.user")}</span>;
    if (p.source === "lookup" && p.detail) {
      const url = sourceUrl(p.detail);
      const name = PROVIDER_NAME[p.detail] ?? p.detail;
      return (
        <span className="muted">
          {" "}
          ·{" "}
          {tx("aircraft.detail.source.lookup", {
            name: url ? (
              <a href={url} target="_blank" rel="noopener">
                {name}
              </a>
            ) : (
              name
            ),
          })}
        </span>
      );
    }
    return null;
  };

  const mergeCandidates = mergeQ.trim().length >= 2 ? views.filter((x) => x.airframe.id !== a.id && (x.registration ?? "").toUpperCase().replace(/-/g, "").includes(mergeQ.trim().toUpperCase().replace(/-/g, ""))).slice(0, 6) : [];

  // The first record, after the counts: ", first on 9 June 2025 at …" (", on …" when it is the only one).
  const firstClause = t("aircraft.detail.lead.first", {
    kind: first?.kind === "sighting" ? (first.s.airportId ? "sighting" : "none") : first?.kind === "flight" ? (first.f.flightNumber == null ? "unnumbered" : "flight") : "none",
    dated: first?.date ? "yes" : "no",
    // With one record, it is not the first of several.
    only: v.flights.length + v.sightings.length === 1 ? "yes" : "no",
    date: first?.date ? dateOnly(first.date, { day: "numeric", month: "long", year: "numeric" }) : "",
    place: first?.kind === "sighting" && first.s.airportId ? airportWithCode(first.s.airportId, ref) : "",
    flight: first?.kind === "flight" ? (first.f.flightNumber ?? "") : "",
  });
  const sentence = tx("aircraft.detail.lead", {
    has: v.flights.length && v.sightings.length ? "both" : v.flights.length ? "flown" : v.sightings.length ? "spotted" : "nothing",
    voice: voice.kind,
    owner: who,
    hasReg: reg ? "yes" : "no",
    reg,
    flights: v.flights.length,
    sightings: v.sightings.length,
    flownLivery: flownClause,
    spottedLivery: spottedClause,
    comma: flownForm === "each" || flownForm === "some" ? "yes" : "no",
    first: firstClause,
  });

  // These sites do not allow automated access, so they open in the browser for the user to read (docs/13).
  const links = [
    { href: `https://www.airfleets.net/recherche/?key=${encodeURIComponent(reg)}`, label: "airfleets.net" },
    { href: `https://aviation.flights/registration/${encodeURIComponent(reg)}`, label: "aviation.flights" },
    { href: `https://www.planespotters.net/search?q=${encodeURIComponent(reg)}`, label: "planespotters.net" },
    { href: `https://www.flightradar24.com/data/aircraft/${encodeURIComponent(reg.toLowerCase())}`, label: "Flightradar24" },
  ];
  // The same reading and checks as `touchdown aircraft edit --paste` (core: pastedFactsFor).
  const fromPaste = paste.trim() ? pastedFactsFor(store, ref, a, reg, paste) : null;
  const pasted = fromPaste?.pasted ?? null;
  const pastedPatch = fromPaste?.patch ?? {};
  const pastedProblem = fromPaste?.problem ?? null;

  return (
    <div className="page">
      <nav className="crumbs" aria-label={t("common.back")}>
        <Link to="/aircraft">
          <Icon name="arrow-left" /> {t("aircraft.detail.all")}
        </Link>
      </nav>
      <div className={`aircraft-hero${liveries.length ? " aircraft-hero--livery" : ""}`}>
        <div>
          <h1 className="route-hero__code">{reg || t("aircraft.noRegistration")}</h1>
          <p className="flight-date">
            <b>{typeText || t("aircraft.detail.typeUnknown")}</b>
            {v.operatorId && ` · ${airlineLabel(v.operatorId, ref)}`}
          </p>
          <div className="actions aircraft-hero__actions">
            {/* The link, the image of what the link shows and, with flights, its flights in the order they were flown as a video. */}
            <ShareButton
              kind="aircraft"
              subject={v.airframe.id}
              anchor={events[0] ? `${events[0].kind === "flight" ? "flights" : "sightings"}/${events[0].kind === "flight" ? events[0].f.id : events[0].s.id}` : null}
              video={
                v.flights.length > 0
                  ? {
                      content: () => periodVideo(app, sortedFlights(store, ref).filter((x) => x.f.airframeId === a.id), { title: [reg, typeText].filter(Boolean).join(" · ") }),
                      name: `touchdown-${reg.replace(/[^A-Za-z0-9-]+/g, "") || "aircraft"}.mp4`,
                    }
                  : undefined
              }
            />
          </div>
          <p className="lead lead--flight">{sentence}</p>
        </div>
        {!liveries.length && (
          <figure className="aircraft-hero__photo card">
            <Photo reg={reg} alt={`${reg}, ${typeText}`} />
            <figcaption className="card__body">
              <Credit reg={reg} />
            </figcaption>
          </figure>
        )}
      </div>
      {liveries.length > 0 && (
        <LiveryBand
          names={liveries}
          reg={reg || null}
          alt={`${reg}, ${typeText}`}
          about={[typeText, v.operatorId && airlineLabel(v.operatorId, ref)].filter(Boolean).join(" · ")}
          facts={[
            ...(flightsIn ? [{ label: t("aircraft.livery.flownIn", { count: liveries.length }), value: flownIn(flightsIn, v.flights.length) }] : []),
            ...(sightingsIn.length ? [{ label: t("aircraft.livery.photographedIn", { count: liveries.length }), value: photographedIn(sightingsIn.map((x) => x.seenOn)) }] : []),
          ]}
        />
      )}

      <section className="section detail-grid">
        <div>
          <div className="section__head">
            <h2 className="section__title">{t("aircraft.detail.timeline")}</h2>
            <span className="section__aside">{t("common.count.records", { count: events.length })}</span>
          </div>
          <ul className="timeline">
            {events.map((e) =>
              e.kind === "flight" ? (
                <li key={e.f.id} className={e.f.specialLivery?.trim() ? "is-livery" : undefined}>
                  <span className="dot dot--flown" />
                  <span className="timeline__date">{e.date ? dayMonthYear(e.date) : t("aircraft.detail.noDate")}</span>
                  <span className="timeline__what">
                    <Link to="/flights/$id" params={{ id: e.f.id }}>
                      {t("aircraft.detail.flew", { flight: e.f.flightNumber ?? "", from: textCode(ref.airport(e.f.fromAirportId), e.f.fromRaw), to: textCode(ref.airport(e.f.toAirportId), e.f.toRaw) })}
                    </Link>
                    {e.f.registration && e.f.registration !== reg && <span className="muted"> {t("aircraft.detail.as", { reg: e.f.registration })}</span>}
                  </span>
                  {e.f.specialLivery?.trim() && <LiveryNote name={liveries.find((l) => sameLivery(l, e.f.specialLivery)) ?? e.f.specialLivery} />}
                </li>
              ) : (
                <li key={e.s.id} className={e.s.specialLivery?.trim() ? "is-livery" : undefined}>
                  <span className="dot dot--spotted" />
                  <span className="timeline__date">{e.date ? dayMonthYear(e.date) : t("aircraft.detail.noDate")}</span>
                  <span className="timeline__what">
                    <Link to="/spotting/$id/edit" params={{ id: e.s.id }}>
                      {t("aircraft.detail.spottedAt", { known: airportWithCode(e.s.airportId, ref, e.s.airportRaw) ? "yes" : "no", place: airportWithCode(e.s.airportId, ref, e.s.airportRaw) })}
                    </Link>
                  </span>
                  {phasesOf(store, e.s.id).length > 0 && <span className="timeline__more">{phaseList(phasesOf(store, e.s.id))}</span>}
                  {e.s.specialLivery?.trim() && <LiveryNote name={liveries.find((l) => sameLivery(l, e.s.specialLivery)) ?? e.s.specialLivery} />}
                </li>
              ),
            )}
          </ul>
          {findings.length > 0 && (
            <>
              <h3 className="subhead">{t("aircraft.detail.checks")}</h3>
              <FindingList findings={findings} />
            </>
          )}
        </div>
        <div>
          <div className="section__head">
            <h2 className="section__title">{t("aircraft.detail.facts")}</h2>
          </div>
          <dl className="dl">
            <div>
              <dt>{t("aircraft.cols.type")}</dt>
              <dd>
                {typeText || "—"}
                {a.typeCode && <span className="muted"> · {a.typeCode}</span>}
              </dd>
            </div>
            <div>
              <dt>{t("aircraft.detail.serial")}</dt>
              <dd>
                {a.msn ?? <span className="muted">{t("aircraft.detail.notKnownYet")}</span>}
                {a.msn && a.lineNumber && <span className="muted"> · {t("aircraft.detail.line", { n: a.lineNumber })}</span>}
                {a.msn && sourceNote("msn")}
              </dd>
            </div>
            <div>
              <dt>{t("aircraft.detail.firstFlight")}</dt>
              <dd>
                {a.firstFlightDate ? dayMonthYear(a.firstFlightDate) : <span className="muted">{t("aircraft.detail.notKnown")}</span>}
                {a.firstFlightDate && sourceNote("firstFlightDate")}
              </dd>
            </div>
            {a.deliveryDate && (
              <div>
                <dt>{t("aircraft.detail.delivered")}</dt>
                <dd>
                  {dayMonthYear(a.deliveryDate)}
                  {sourceNote("deliveryDate")}
                </dd>
              </div>
            )}
            {a.status && a.status !== "unknown" && a.status !== "active" && (
              <div>
                <dt>{t("aircraft.detail.status")}</dt>
                <dd>{STATUS_LABEL[a.status]?.() ?? a.status}</dd>
              </div>
            )}
            <div>
              <dt>{t("aircraft.detail.registrations")}</dt>
              <dd>
                {regs.length
                  ? series(regs.map((p) => (p.validFrom || p.validTo ? t("aircraft.detail.registrationPeriod", { reg: `${p.registration}`, hasFrom: p.validFrom ? "yes" : "no", from: p.validFrom ?? "", hasTo: p.validTo ? "yes" : "no", to: p.validTo ?? "" }) : `${p.registration}`)))
                  : "—"}
              </dd>
            </div>
            {liveries.length > 0 && (
              <div>
                <dt>{t("aircraft.livery.special", { count: liveries.length })}</dt>
                <dd>{series(liveries)}</dd>
              </div>
            )}
            <div>
              <dt>{t("aircraft.detail.identity")}</dt>
              <dd>{a.provisional ? t("aircraft.detail.identity.provisional") : t("aircraft.detail.identity.confirmed")}</dd>
            </div>
          </dl>
          {reg && (
            <p className="status-line">
              <Icon name="external-link" />
              <span>
                {t("aircraft.detail.lookUp")}{sentenceGap()}
                {links.map((l, i) => (
                  <span key={l.href}>
                    {i > 0 && " · "}
                    <a href={l.href} target="_blank" rel="noopener">
                      {l.label}
                    </a>
                  </span>
                ))}
              </span>
            </p>
          )}

          {!shared && (
            <>
              <h3 className="subhead">{t("aircraft.detail.correct")}</h3>
              <div className="paste-facts">
                <Field label={t("aircraft.detail.paste.label")} hint={t("aircraft.detail.paste.hint")}>
                  <textarea className="input textarea" rows={3} value={paste} onChange={(e) => setPaste(e.target.value)} placeholder={t("aircraft.detail.paste.placeholder")} />
                </Field>
                {pasted && (
                  <div className="paste-facts__found">
                    {Object.keys(pastedPatch).length ? (
                      <p>
                        {t("aircraft.detail.paste.found", {
                          hasSite: pasted.site ? "yes" : "no",
                          site: pasted.site ?? "",
                          facts: series(
                            [
                              pastedPatch.msn && t("aircraft.detail.paste.msn", { msn: pastedPatch.msn }),
                              pastedPatch.lineNumber && t("aircraft.detail.line", { n: pastedPatch.lineNumber }),
                              pastedPatch.firstFlightDate && t("aircraft.detail.paste.firstFlight", { date: dayMonthYear(pastedPatch.firstFlightDate) }),
                              pastedPatch.deliveryDate && t("aircraft.detail.paste.delivered", { date: dayMonthYear(pastedPatch.deliveryDate) }),
                            ].filter((x): x is string => !!x),
                          ),
                        })}
                      </p>
                    ) : (
                      <p className="muted">{pasted.msn || pasted.firstFlightDate ? t("aircraft.detail.paste.nothingNew") : t("aircraft.detail.paste.nothingFound")}</p>
                    )}
                    {pasted.firstFlightMonth && !pasted.firstFlightDate && <p className="muted">{t("aircraft.detail.paste.monthOnly", { month: pasted.firstFlightMonth })}</p>}
                    {pastedProblem && (
                      <p className="paste-facts__warn">
                        <Icon name="info" /> {t("aircraft.detail.paste.otherAircraft", { problem: pastedProblem })}
                      </p>
                    )}
                    {Object.keys(pastedPatch).length > 0 && (
                      <button
                        type="button"
                        className="btn btn--quiet btn--small"
                        onClick={() => {
                          app.updateAirframe(a.id, pastedPatch);
                          setPaste("");
                          toast(t("aircraft.detail.paste.saved"));
                        }}
                      >
                        {t("aircraft.detail.paste.save")}
                      </button>
                    )}
                  </div>
                )}
              </div>
              <form
                className="inline-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!msn.trim()) return;
                  app.updateAirframe(a.id, { msn: msn.trim(), manufacturer: a.manufacturer ?? ref.manufacturerOf(a.typeCode) });
                  setMsn("");
                  toast(t("aircraft.detail.msn.saved"));
                }}
              >
                <Field label={t("aircraft.detail.msn.label")} hint={t("aircraft.detail.msn.hint")}>
                  <TextInput value={msn} onChange={(e) => setMsn(e.target.value)} placeholder={a.msn ?? t("aircraft.detail.msn.placeholder")} />
                </Field>
                <button type="submit" className="btn btn--quiet btn--small" disabled={!msn.trim()}>
                  {t("common.save")}
                </button>
              </form>
              <form
                className="inline-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!isValidDate(ffd)) return;
                  app.updateAirframe(a.id, { firstFlightDate: ffd });
                  setFfd("");
                  toast(t("aircraft.detail.firstFlight.saved"));
                }}
              >
                <Field label={t("aircraft.detail.firstFlight.label")}>
                  <input className="input" type="date" value={ffd} onChange={(e) => setFfd(e.target.value)} />
                </Field>
                <button type="submit" className="btn btn--quiet btn--small" disabled={!isValidDate(ffd)}>
                  {t("common.save")}
                </button>
              </form>
              <div className="inline-form inline-form--merge">
                <Field label={t("aircraft.detail.merge.label")} hint={t("aircraft.detail.merge.hint")}>
                  <TextInput value={mergeQ} onChange={(e) => setMergeQ(e.target.value)} placeholder={t("aircraft.detail.merge.placeholder")} />
                </Field>
                {mergeCandidates.length > 0 && (
                  <ul className="merge-list">
                    {mergeCandidates.map((c) => (
                      <li key={c.airframe.id}>
                        <span>
                          <b>{c.registration}</b> · {typeName(c.airframe.typeCode, ref)} · {t("common.count.records", { count: c.flights.length + c.sightings.length })}
                        </span>
                        <button
                          type="button"
                          className="btn btn--quiet btn--small"
                          onClick={() => {
                            if (!window.confirm(t("aircraft.detail.merge.confirm", { from: c.registration ?? "", to: reg, count: c.flights.length + c.sightings.length }))) return;
                            app.mergeAirframes(a.id, c.airframe.id);
                            setMergeQ("");
                            toast(t("aircraft.detail.merge.done"));
                            navigate({ to: "/aircraft/$id", params: { id: a.id } });
                          }}
                        >
                          <Icon name="merge" />
                          {t("aircraft.detail.merge.button")}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </>
          )}
        </div>
      </section>
    </div>
  );
}

/** A sighting's statuses on their own line: "Taking off, taxiing". */
const phaseList = (phases: string[]) => series(phases.map((p, i) => (i ? inSentence(PHASE_LABEL[p] ?? p) : (PHASE_LABEL[p] ?? p))));

/** A timeline record in a special livery: its name on a line under the record. */
function LiveryNote({ name }: { name: string }) {
  return (
    <span className="timeline__livery">
      <Icon name="paint-roller" />
      {t("aircraft.liveryName", { name: liveryName(name) })}
    </span>
  );
}
