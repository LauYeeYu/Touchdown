// One aircraft: what it is, its registrations, and every time the user flew on it or photographed it.
// Tools from docs/11-aircraft-identity.md: set the serial number, edit facts, merge two airframes.

import { useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "@tanstack/react-router";
import { flightDay, isValidDate, liveryName, pastedFactsFor, phasesOf, sameLivery, type Flight, type Sighting } from "@touchdown/core";
import { useApp } from "../data/context.tsx";
import { aircraftViews } from "../lib/views.ts";
import { airportWithCode, textCode } from "../lib/codes.ts";
import { airlineLabel, dateOnly, dayMonthYear, modelLabel, PHASE_LABEL, plural, typeName } from "../lib/format.ts";
import { Icon } from "../lib/icons.tsx";
import { Credit, Photo } from "../components/Photo.tsx";
import { flownIn, LiveryBand, photographedIn } from "../components/LiveryBand.tsx";
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
  // Its special liveries in the order they were first recorded, each named once, capitalised where any record is.
  const liveries: string[] = [];
  for (const e of events) {
    const name = e.kind === "flight" ? e.f.specialLivery : e.s.specialLivery;
    if (!name?.trim()) continue;
    const i = liveries.findIndex((l) => sameLivery(l, name));
    if (i < 0) liveries.push(liveryName(name));
    else if (liveries[i] === liveries[i]!.toLowerCase()) liveries[i] = liveryName(name);
  }
  const flightsIn = v.flights.filter((f) => f.specialLivery?.trim()).length;
  const sightingsIn = v.sightings.filter((s) => s.specialLivery?.trim());
  // "…, once in its Centenary livery": said only when the aircraft has one special livery in the log.
  const only = liveries.length === 1 ? liveries[0] : null;
  const inLivery = (n: number, total: number) =>
    !only || !n ? "" : n === total ? (total === 1 ? ` in its ${only} livery` : `, each time in its ${only} livery`) : `, ${n === 1 ? "once" : plural(n, "time")} in its ${only} livery`;
  const flownClause = inLivery(flightsIn, v.flights.length);
  const spottedClause = flownClause ? "" : inLivery(sightingsIn.length, v.sightings.length);
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
      {v.flights.length > 0 && `You flew on ${reg || "this aircraft"} ${v.flights.length === 1 ? "once" : plural(v.flights.length, "time")}${flownClause}`}
      {v.flights.length > 0 && v.sightings.length > 0 && `${flownClause.startsWith(",") ? "," : ""} and photographed it `}
      {v.flights.length === 0 && v.sightings.length > 0 && `You photographed ${reg || "this aircraft"} `}
      {v.sightings.length > 0 && `${v.sightings.length === 1 ? "once" : plural(v.sightings.length, "time")}${spottedClause}`}
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
  // The same reading and checks as `touchdown aircraft edit --paste` (core: pastedFactsFor).
  const fromPaste = paste.trim() ? pastedFactsFor(store, ref, a, reg, paste) : null;
  const pasted = fromPaste?.pasted ?? null;
  const pastedPatch = fromPaste?.patch ?? {};
  const pastedProblem = fromPaste?.problem ?? null;

  return (
    <div className="page">
      <nav className="crumbs" aria-label="Back">
        <Link to="/aircraft">
          <Icon name="arrow-left" /> All aircraft
        </Link>
      </nav>
      <div className={`aircraft-hero${liveries.length ? " aircraft-hero--livery" : ""}`}>
        <div>
          <h1 className="route-hero__code">{reg || "No registration"}</h1>
          <p className="flight-date">
            <b>{typeText || "Type not recorded"}</b>
            {v.operatorId && ` · ${airlineLabel(v.operatorId, ref)}`}
          </p>
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
            ...(flightsIn ? [{ label: liveries.length > 1 ? "Flown in them" : "Flown in it", value: flownIn(flightsIn, v.flights.length) }] : []),
            ...(sightingsIn.length ? [{ label: liveries.length > 1 ? "Photographed in them" : "Photographed in it", value: photographedIn(sightingsIn.map((x) => x.seenOn)) }] : []),
          ]}
        />
      )}

      <section className="section detail-grid">
        <div>
          <div className="section__head">
            <h2 className="section__title">Timeline</h2>
            <span className="section__aside">{plural(events.length, "record")}</span>
          </div>
          <ul className="timeline">
            {events.map((e) =>
              e.kind === "flight" ? (
                <li key={e.f.id} className={e.f.specialLivery?.trim() ? "is-livery" : undefined}>
                  <span className="dot dot--flown" />
                  <span className="timeline__date">{e.date ? dayMonthYear(e.date) : "No date"}</span>
                  <span className="timeline__what">
                    <Link to="/flights/$id" params={{ id: e.f.id }}>
                      Flew {e.f.flightNumber ?? ""} {textCode(ref.airport(e.f.fromAirportId), e.f.fromRaw)} → {textCode(ref.airport(e.f.toAirportId), e.f.toRaw)}
                    </Link>
                    {e.f.registration && e.f.registration !== reg && <span className="muted"> as {e.f.registration}</span>}
                  </span>
                  {e.f.specialLivery?.trim() && <LiveryNote name={liveries.find((l) => sameLivery(l, e.f.specialLivery)) ?? e.f.specialLivery} />}
                </li>
              ) : (
                <li key={e.s.id} className={e.s.specialLivery?.trim() ? "is-livery" : undefined}>
                  <span className="dot dot--spotted" />
                  <span className="timeline__date">{e.date ? dayMonthYear(e.date) : "No date"}</span>
                  <span className="timeline__what">
                    <Link to="/spotting/$id/edit" params={{ id: e.s.id }}>
                      Spotted at {airportWithCode(e.s.airportId, ref, e.s.airportRaw) || "an unknown place"}
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
                <dt>{liveries.length > 1 ? "Special liveries" : "Special livery"}</dt>
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
                {pasted.firstFlightMonth && !pasted.firstFlightDate && <p className="muted">The page gives only the month of the first flight ({pasted.firstFlightMonth}), and a date needs the day.</p>}
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
                      app.updateAirframe(a.id, pastedPatch);
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

/** A sighting's statuses on their own line: "Taking off, taxiing". */
const phaseList = (phases: string[]) => phases.map((p, i) => (i ? (PHASE_LABEL[p] ?? p).toLowerCase() : (PHASE_LABEL[p] ?? p))).join(", ");

/** A timeline record in a special livery: its name on a line under the record. */
function LiveryNote({ name }: { name: string }) {
  return (
    <span className="timeline__livery">
      <Icon name="paint-roller" />
      {liveryName(name)} livery
    </span>
  );
}
