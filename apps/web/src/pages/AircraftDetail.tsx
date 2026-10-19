// One aircraft: what it is, its registrations, and every time the user flew on it or photographed it.
// Tools from docs/11-aircraft-identity.md: set the serial number, edit facts, merge two airframes.

import { useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "@tanstack/react-router";
import { factsMismatch, flightDay, isValidDate, parsePastedFacts, type Flight, type Sighting } from "@touchdown/core";
import { useApp } from "../data/context.tsx";
import { aircraftViews } from "../lib/views.ts";
import { airportWithCode, textCode } from "../lib/codes.ts";
import { airlineLabel, dateOnly, dayMonthYear, modelLabel, PHASE_LABEL, plural, typeName } from "../lib/format.ts";
import { Icon } from "../lib/icons.tsx";
import { Credit, Photo } from "../components/Photo.tsx";
import { FindingList } from "../components/Findings.tsx";
import { Field, TextInput } from "../components/form.tsx";
import { toast } from "../components/overlay.tsx";
import { NotFound } from "./NotFound.tsx";

/** Display names of the airframe lookup sources (docs/13-reference-data.md, "Airframe facts"). */
const PROVIDER_NAME: Record<string, string> = {
  airfleets: "airfleets.net",
  planespotters: "planespotters.net",
  "aviation.flights": "aviation.flights",
  fr24: "Flightradar24",
  adsbdb: "adsbdb",
  opensky: "OpenSky",
};

const STATUS_LABEL: Record<string, string> = { stored: "Stored", retired: "Retired", written_off: "Written off" };

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

  if (!v) return <NotFound what="That aircraft is not in your log." back={{ to: "/aircraft", label: "All aircraft" }} />;
  const a = v.airframe;
  const regs = store.all("registration_periods").filter((p) => p.airframeId === a.id);
  const events: Event[] = [
    ...v.flights.map((f) => ({ date: flightDay(f), kind: "flight" as const, f })),
    ...v.sightings.map((s) => ({ date: s.seenOn, kind: "sighting" as const, s })),
  ].sort((x, y) => (x.date ?? "9999").localeCompare(y.date ?? "9999"));
  const liveries = [...new Set([...v.flights, ...v.sightings].map((r) => r.specialLivery).filter(Boolean))] as string[];
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
    if (p.source === "user") return <span className="muted"> · {p.detail && p.detail !== "merge" ? "from your sheet" : "entered by you"}</span>;
    if (p.source === "lookup" && p.detail) {
      const url = sourceUrl(p.detail);
      const name = PROVIDER_NAME[p.detail] ?? p.detail;
      return (
        <span className="muted">
          {" "}
          · from{" "}
          {url ? (
            <a href={url} target="_blank" rel="noopener">
              {name}
            </a>
          ) : (
            name
          )}
        </span>
      );
    }
    return null;
  };

  const mergeCandidates = mergeQ.trim().length >= 2 ? views.filter((x) => x.airframe.id !== a.id && (x.registration ?? "").toUpperCase().replace(/-/g, "").includes(mergeQ.trim().toUpperCase().replace(/-/g, ""))).slice(0, 6) : [];

  const sentence = (
    <>
      {v.flights.length > 0 && `You flew on ${reg || "this aircraft"} ${v.flights.length === 1 ? "once" : plural(v.flights.length, "time")}`}
      {v.flights.length > 0 && v.sightings.length > 0 && " and photographed it "}
      {v.flights.length === 0 && v.sightings.length > 0 && `You photographed ${reg || "this aircraft"} `}
      {v.sightings.length > 0 && (v.sightings.length === 1 ? "once" : plural(v.sightings.length, "time"))}
      {first?.date && `, first on ${dateOnly(first.date, { day: "numeric", month: "long", year: "numeric" })}`}
      {first?.kind === "sighting" && first.s.airportId && ` at ${airportWithCode(first.s.airportId, ref)}`}
      {first?.kind === "flight" && ` on ${first.f.flightNumber ?? "a flight"}`}.
    </>
  );

  // These sites do not allow automated access, so they open in the browser for the user to read (docs/13).
  const links = [
    { href: `https://www.airfleets.net/recherche/?key=${encodeURIComponent(reg)}`, label: "airfleets.net" },
    { href: `https://aviation.flights/registration/${encodeURIComponent(reg)}`, label: "aviation.flights" },
    { href: `https://www.planespotters.net/search?q=${encodeURIComponent(reg)}`, label: "planespotters.net" },
    { href: `https://www.flightradar24.com/data/aircraft/${encodeURIComponent(reg.toLowerCase())}`, label: "Flightradar24" },
  ];
  const pasted = paste.trim() ? parsePastedFacts(paste) : null;
  const pastedPatch: { msn?: string; lineNumber?: string; firstFlightDate?: string; deliveryDate?: string } = {};
  if (pasted?.msn && pasted.msn !== a.msn) pastedPatch.msn = pasted.msn;
  if (pasted?.lineNumber && pasted.lineNumber !== a.lineNumber) pastedPatch.lineNumber = pasted.lineNumber;
  if (pasted?.firstFlightDate && pasted.firstFlightDate !== a.firstFlightDate) pastedPatch.firstFlightDate = pasted.firstFlightDate;
  if (pasted?.deliveryDate && pasted.deliveryDate !== a.deliveryDate) pastedPatch.deliveryDate = pasted.deliveryDate;
  // The same check as for lookups: a page about an aircraft that first flew after the user's record is about
  // another aircraft that later carried the registration.
  const pastedProblem = pasted
    ? factsMismatch(store, ref, a, { provider: "paste", url: null, fetchedAt: "", registration: reg, manufacturer: null, msn: pasted.msn, lineNumber: pasted.lineNumber, typeText: pasted.typeText, typeCode: null, firstFlightDate: pasted.firstFlightDate, deliveryDate: pasted.deliveryDate, status: null, registrations: [] })
    : null;

  return (
    <div className="page">
      <nav className="crumbs" aria-label="Back">
        <Link to="/aircraft">
          <Icon name="arrow-left" /> All aircraft
        </Link>
      </nav>
      <div className="aircraft-hero">
        <div>
          <h1 className="route-hero__code">{reg || "No registration"}</h1>
          <p className="flight-date">
            <b>{typeText || "Type not recorded"}</b>
            {v.operatorId && ` · ${airlineLabel(v.operatorId, ref)}`}
          </p>
          <p className="lead lead--flight">{sentence}</p>
        </div>
        <figure className="aircraft-hero__photo card">
          <Photo reg={reg} alt={`${reg}, ${typeText}`} />
          <figcaption className="card__body">
            <Credit reg={reg} />
          </figcaption>
        </figure>
      </div>

      <section className="section detail-grid">
        <div>
          <div className="section__head">
            <h2 className="section__title">Timeline</h2>
            <span className="section__aside">{plural(events.length, "record")}</span>
          </div>
          <ul className="timeline">
            {events.map((e) =>
              e.kind === "flight" ? (
                <li key={e.f.id}>
                  <span className="dot dot--flown" />
                  <span className="timeline__date">{e.date ? dayMonthYear(e.date) : "No date"}</span>
                  <Link to="/flights/$id" params={{ id: e.f.id }}>
                    Flew {e.f.flightNumber ?? ""} {textCode(ref.airport(e.f.fromAirportId), e.f.fromRaw)} → {textCode(ref.airport(e.f.toAirportId), e.f.toRaw)}
                  </Link>
                  {e.f.registration && e.f.registration !== reg && <span className="muted"> as {e.f.registration}</span>}
                </li>
              ) : (
                <li key={e.s.id}>
                  <span className="dot dot--spotted" />
                  <span className="timeline__date">{e.date ? dayMonthYear(e.date) : "No date"}</span>
                  <Link to="/spotting/$id/edit" params={{ id: e.s.id }}>
                    Spotted at {airportWithCode(e.s.airportId, ref, e.s.airportRaw) || "an unknown place"}
                  </Link>
                  {e.s.phase && <span className="muted"> · {PHASE_LABEL[e.s.phase]?.toLowerCase()}</span>}
                  {e.s.specialLivery && <span className="pill pill--livery">{e.s.specialLivery}</span>}
                </li>
              ),
            )}
          </ul>
          {findings.length > 0 && (
            <>
              <h3 className="subhead">Checks</h3>
              <FindingList findings={findings} />
            </>
          )}
        </div>
        <div>
          <div className="section__head">
            <h2 className="section__title">Facts</h2>
          </div>
          <dl className="dl">
            <div>
              <dt>Type</dt>
              <dd>
                {typeText || "—"}
                {a.typeCode && <span className="muted"> · {a.typeCode}</span>}
              </dd>
            </div>
            <div>
              <dt>Serial number</dt>
              <dd>
                {a.msn ?? <span className="muted">Not known yet</span>}
                {a.msn && a.lineNumber && <span className="muted"> · line {a.lineNumber}</span>}
                {a.msn && sourceNote("msn")}
              </dd>
            </div>
            <div>
              <dt>First flight</dt>
              <dd>
                {a.firstFlightDate ? dayMonthYear(a.firstFlightDate) : <span className="muted">Not known</span>}
                {a.firstFlightDate && sourceNote("firstFlightDate")}
              </dd>
            </div>
            {a.deliveryDate && (
              <div>
                <dt>Delivered</dt>
                <dd>
                  {dayMonthYear(a.deliveryDate)}
                  {sourceNote("deliveryDate")}
                </dd>
              </div>
            )}
            {a.status && a.status !== "unknown" && a.status !== "active" && (
              <div>
                <dt>Status</dt>
                <dd>{STATUS_LABEL[a.status] ?? a.status}</dd>
              </div>
            )}
            <div>
              <dt>Registrations</dt>
              <dd>
                {regs.length
                  ? regs.map((p) => `${p.registration}${p.validFrom || p.validTo ? ` (${p.validFrom ?? "…"} to ${p.validTo ?? "now"})` : ""}`).join(", ")
                  : "—"}
              </dd>
            </div>
            {liveries.length > 0 && (
              <div>
                <dt>Special liveries seen</dt>
                <dd>{liveries.join(", ")}</dd>
              </div>
            )}
            <div>
              <dt>Identity</dt>
              <dd>{a.provisional ? "Matched by registration and date until the serial number is known" : "Confirmed by serial number"}</dd>
            </div>
          </dl>
          {reg && (
            <p className="status-line">
              <Icon name="external-link" />
              <span>
                Look it up:{" "}
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

          <h3 className="subhead">Correct this aircraft</h3>
          <div className="paste-facts">
            <Field label="Paste from a web page" hint="Open one of the sites above, select all and copy, then paste here. The serial number, line number, first flight and delivery dates are read from the text.">
              <textarea className="input textarea" rows={3} value={paste} onChange={(e) => setPaste(e.target.value)} placeholder="Serial number 10741 · First flight date 17/09/2011 …" />
            </Field>
            {pasted && (
              <div className="paste-facts__found">
                {Object.keys(pastedPatch).length ? (
                  <p>
                    Found{pasted.site ? ` on ${pasted.site}` : ""}:{" "}
                    {[
                      pastedPatch.msn && `serial number ${pastedPatch.msn}`,
                      pastedPatch.lineNumber && `line ${pastedPatch.lineNumber}`,
                      pastedPatch.firstFlightDate && `first flight ${dayMonthYear(pastedPatch.firstFlightDate)}`,
                      pastedPatch.deliveryDate && `delivered ${dayMonthYear(pastedPatch.deliveryDate)}`,
                    ]
                      .filter(Boolean)
                      .join(", ")}
                    .
                  </p>
                ) : (
                  <p className="muted">{pasted.msn || pasted.firstFlightDate ? "Nothing new: these values are already saved." : "No serial number or dates found in this text."}</p>
                )}
                {pasted.firstFlightMonth && !pasted.firstFlightDate && <p className="muted">The page gives only the month of the first flight ({pasted.firstFlightMonth}); a date needs the day.</p>}
                {pastedProblem && (
                  <p className="paste-facts__warn">
                    <Icon name="info" /> This may be another aircraft: {pastedProblem}.
                  </p>
                )}
                {Object.keys(pastedPatch).length > 0 && (
                  <button
                    type="button"
                    className="btn btn--quiet btn--small"
                    onClick={() => {
                      app.updateAirframe(a.id, { ...pastedPatch, ...(pastedPatch.msn ? { manufacturer: a.manufacturer ?? ref.manufacturerOf(a.typeCode) } : {}) });
                      setPaste("");
                      toast("Saved from the pasted page.");
                    }}
                  >
                    Save these
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
              toast("Serial number saved. This aircraft is now confirmed.");
            }}
          >
            <Field label="Serial number (MSN)" hint="From the manufacturer, e.g. on airfleets.net or planespotters.net">
              <TextInput value={msn} onChange={(e) => setMsn(e.target.value)} placeholder={a.msn ?? "e.g. 10741"} />
            </Field>
            <button type="submit" className="btn btn--quiet btn--small" disabled={!msn.trim()}>
              Save
            </button>
          </form>
          <form
            className="inline-form"
            onSubmit={(e) => {
              e.preventDefault();
              if (!isValidDate(ffd)) return;
              app.updateAirframe(a.id, { firstFlightDate: ffd });
              setFfd("");
              toast("First flight date saved.");
            }}
          >
            <Field label="First flight date">
              <input className="input" type="date" value={ffd} onChange={(e) => setFfd(e.target.value)} />
            </Field>
            <button type="submit" className="btn btn--quiet btn--small" disabled={!isValidDate(ffd)}>
              Save
            </button>
          </form>
          <div className="inline-form inline-form--merge">
            <Field label="Same aircraft as…" hint="Two entries for one physical aircraft, for example after a registration change. Their records move here.">
              <TextInput value={mergeQ} onChange={(e) => setMergeQ(e.target.value)} placeholder="Registration of the other entry" />
            </Field>
            {mergeCandidates.length > 0 && (
              <ul className="merge-list">
                {mergeCandidates.map((c) => (
                  <li key={c.airframe.id}>
                    <span>
                      <b>{c.registration}</b> · {typeName(c.airframe.typeCode, ref)} · {plural(c.flights.length + c.sightings.length, "record")}
                    </span>
                    <button
                      type="button"
                      className="btn btn--quiet btn--small"
                      onClick={() => {
                        if (!window.confirm(`Merge ${c.registration} into ${reg}? Its ${plural(c.flights.length + c.sightings.length, "record")} move to this aircraft.`)) return;
                        app.mergeAirframes(a.id, c.airframe.id);
                        setMergeQ("");
                        toast("Merged.");
                        navigate({ to: "/aircraft/$id", params: { id: a.id } });
                      }}
                    >
                      <Icon name="merge" />
                      Merge here
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
