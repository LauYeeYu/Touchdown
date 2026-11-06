// One flight: the route at full size, the date, a sentence, the track map, dated local times, the aircraft.

import { useRef, useState } from "react";
import { useNavigate, useParams } from "@tanstack/react-router";
import { t } from "@touchdown/i18n";
import { Link, useReachable } from "../lib/link.tsx";
import { extensionPercent, routeExtension } from "@touchdown/core/view";
import { cityName, daysBetween, fitTrackFile, flightDay, guessSeatPosition, liveryName, parseDateTime, privateOf, readTrackFile, sameLivery, toUtcIso, trackChangeFor, trackFileName, trackKml, type Flight, type InboxChange } from "@touchdown/core";
import { download } from "../lib/download.ts";
import { useApp } from "../data/context.tsx";
import { sortedFlights } from "../lib/views.ts";
import { airportWithCode, primaryCode, secondaryCode } from "../lib/codes.ts";
import { mapFlights, trackIndex } from "../lib/mapdata.ts";
import { trackSamples } from "../lib/trackStatus.ts";
import { airlineLabel, CABIN_LABEL, clock, dateOnly, dayLong, dayMonthYear, dayShort, distance, durLong, localDay, modelLabel, offsetLabel, REASON_LABEL, shortAirport, TRACK_SOURCE, typeName } from "../lib/format.ts";
import { Icon } from "../lib/icons.tsx";
import { FlightMap } from "../components/maps.tsx";
import { ShareButton } from "../components/ShareDialog.tsx";
import { linkFor, useShares } from "../data/shares.ts";
import { GlobePanel } from "../components/GlobePanel.tsx";
import { MapStyleSwitch, useMapStyle } from "../components/MapStyle.tsx";
import { AltitudeChart } from "../components/charts.tsx";
import { Duration } from "../components/Duration.tsx";
import { Credit, Photo } from "../components/Photo.tsx";
import { flownIn, LiveryBand, photographedIn } from "../components/LiveryBand.tsx";
import { FindingList } from "../components/Findings.tsx";
import { toast } from "../components/overlay.tsx";
import { MenuButton } from "../components/Menu.tsx";
import { NotFound } from "./NotFound.tsx";
import { TimeCell } from "../components/TimeCell.tsx";
import { article, partOfDay } from "../lib/flightText.ts";
import { Name, voiceOf } from "../lib/voice.tsx";
import { tx } from "../lib/i18n.tsx";

/** A track file the user chose for the flight: what it would save, or why it cannot be used. */
type PickedTrack = { name: string; problem: string } | { name: string; read: number; change: Extract<InboxChange, { op: "track" }>; startKm: number | null; endKm: number | null; legs: number | null };

export function FlightDetail() {
  const { id } = useParams({ from: "/flights/$id" });
  const { app } = useApp();
  const { store, ref } = app;
  const navigate = useNavigate();
  const reachable = useReachable();
  // A share link leaves out what changes the log or is private (docs/32, "The public page"). Its sentences are about
  // a whole log's owner by name, or on a link to one record about nobody (lib/voice.tsx).
  const shared = app.readOnly;
  const voice = voiceOf(app);
  const who = voice.kind === "named" ? <Name name={voice.name} /> : null;
  const settings = app.settings();
  const unit = settings.distanceUnit ?? "km";
  const [showTicket, setShowTicket] = useState(false);
  const [picked, setPicked] = useState<PickedTrack | null>(null);
  const trackInput = useRef<HTMLInputElement>(null);
  const mapStyle = useMapStyle();
  const shareList = useShares(app.connection?.mode === "standard");

  const all = sortedFlights(store, ref);
  const idx = all.findIndex((v) => v.f.id === id);
  if (idx < 0) return <NotFound what={shared ? t("flights.notFound.link") : t("flights.notFound.log")} back={{ to: "/flights", label: t("flights.allFlights") }} />;
  const v = all[idx]!;
  const f: Flight = v.f;
  // Kept in the flight's private row (docs/32, "Private data").
  const { ticketNumber } = privateOf(store, f.id);
  const prev = all[idx - 1];
  const next = all[idx + 1];
  const A = ref.airport(f.fromAirportId);
  const B = ref.airport(f.divertedToAirportId ?? f.toAirportId);
  const airframe = store.get("airframes", f.airframeId);
  const track = trackIndex(store).get(f.id) ?? null;
  // The recorded positions with what was recorded at each, for the map's and the globe's hover.
  const samples = track ? trackSamples(store, f.id) : [];
  const takeoffMs = f.takeoffAt ? Date.parse(f.takeoffAt) : NaN;
  const takeoff = Number.isNaN(takeoffMs) ? null : takeoffMs / 1000;
  // The route as the maps draw it: the recorded stretches and the gaps between them.
  const mark = A && B ? mapFlights([v], ref, unit, new Set(), store, Infinity)[0]! : null;
  const trackRow = store.all("tracks").find((t) => t.flightId === f.id);
  const findings = app.findingsFor("flights", f.id);
  const onThis = f.airframeId ? all.filter((o) => o.f.airframeId === f.airframeId) : [v];
  const spotted = f.airframeId ? store.all("sightings").filter((s) => s.airframeId === f.airframeId).sort((a, b) => (a.seenOn ?? "").localeCompare(b.seenOn ?? "")) : [];
  const built = airframe?.firstFlightDate?.slice(0, 4) ?? null;
  const age = built && v.day ? Number(v.day.slice(0, 4)) - Number(built) : null;
  const typeText = f.model ? modelLabel(f.model, f.typeCode, ref, settings.modelNaming ?? "standard") : typeName(f.typeCode, ref);
  const day = v.day;
  // A special livery takes the stage: the band under the sentence shows the aircraft's photo, so its card does not.
  const livery = f.specialLivery?.trim() ? liveryName(f.specialLivery) : null;
  const spottedInLivery = spotted.filter((s) => sameLivery(s.specialLivery, f.specialLivery));

  const landDays = f.takeoffAt && f.landingAt ? daysBetween(localDay(f.takeoffAt)!, localDay(f.landingAt)!) : 0;
  const slipped = f.takeoffAt && f.scheduledDate ? daysBetween(f.scheduledDate, localDay(f.takeoffAt)!) : 0;
  const tPart = f.takeoffAt ? partOfDay(f.takeoffAt) : null;
  const kind = !tPart ? "plain" : landDays >= 1 && (tPart === "evening" || tPart === "night") ? "overnight" : (v.min ?? 0) >= 600 ? "longHaul" : tPart;
  const landing = !f.landingAt ? "none" : landDays === 0 ? "sameDay" : landDays === 1 ? "nextDay" : "later";
  const guessed = !f.seatPosition ? guessSeatPosition(f.seat, ref.familyIdOf(f.typeCode)) : null;

  const scrollToAircraft = () => {
    document.getElementById("aircraft")?.scrollIntoView({ behavior: "smooth", block: "start" });
    const card = document.getElementById("aircraft-card");
    if (card) {
      card.classList.remove("is-flash");
      void card.offsetWidth;
      card.classList.add("is-flash");
    }
  };
  const phraseProps = {
    role: "button" as const,
    tabIndex: 0,
    onClick: scrollToAircraft,
    onKeyDown: (e: React.KeyboardEvent) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        scrollToAircraft();
      }
    },
  };

  // The flight in a sentence: its number, else "the flight", and its date when known.
  const subject = { numbered: f.flightNumber ? "yes" : "no", flight: f.flightNumber ?? "", dated: day ? "yes" : "no", date: day ? dayMonthYear(day) : "" };
  const remove = () => {
    const linked = linkFor(shareList, "flight", f.id) ? "yes" : "no";
    if (!window.confirm(t("flights.detail.delete.confirm", { ...subject, linked }))) return;
    app.deleteRecord("flights", f.id);
    toast(t("flights.detail.delete.done"));
    navigate({ to: "/flights" });
  };

  // A recorded track from a file (docs/23, "Sources"): checked against the flight and shown before it is saved,
  // then saved as a one-change import, so the Import page's history can undo it.
  const pickTrack = async (file: File) => {
    const read = readTrackFile(file.name, await file.text());
    if ("error" in read) return setPicked({ name: file.name, problem: read.error });
    const fit = fitTrackFile(read.points, f, ref);
    if ("problem" in fit) return setPicked({ name: file.name, problem: fit.problem });
    setPicked({ name: file.name, read: fit.points.length, change: trackChangeFor(f.id, { ...read, points: fit.points }, fit.coverage), startKm: fit.startKm, endKm: fit.endKm, legs: fit.legs });
  };
  const saveTrack = () => {
    if (!picked || "problem" in picked) return;
    app.applyChanges([picked.change], () => true, picked.name);
    setPicked(null);
    toast(trackRow ? t("flights.detail.track.replacedToast") : t("flights.detail.track.savedToast"));
  };
  const dropTrack = () => {
    if (!window.confirm(t("flights.detail.track.removeConfirm", subject))) return;
    app.applyChanges([{ op: "removeTrack", flightId: f.id }], () => true, t("flights.detail.track.removedBatch", subject));
    toast(t("flights.detail.track.removedToast"));
  };
  const chooseTrack = () => trackInput.current?.click();
  // The recorded track as KML: it opens in Google Earth in 3D and plays back there, and it reads back in here.
  const downloadTrack = () => {
    if (!trackRow || !A || !B) return;
    const points = store
      .all("track_points")
      .filter((p) => p.trackId === trackRow.id)
      .map((p) => ({ t: p.t, lat: p.lat, lon: p.lon, altitudeFt: p.altitudeFt, groundSpeedKt: p.groundSpeedKt, headingDeg: p.headingDeg }));
    const title = [f.flightNumber ?? t("flights.flight"), `${v.fromCode} → ${v.toCode}`, v.day ? dayMonthYear(v.day) : null].filter(Boolean).join(" · ");
    const name = trackFileName(f.flightNumber, A.iata ?? A.icao ?? v.fromCode, B.iata ?? B.icao ?? v.toCode, v.day, "kml");
    download(name, trackKml(points, { title, source: trackRow.attribution }), "application/vnd.google-earth.kml+xml");
  };
  const pickedPanel = picked && (
    <div className={`finding track-file${"problem" in picked ? " finding--error" : ""}`} role="status">
      <Icon name={"problem" in picked ? "circle-x" : "route"} />
      <div className="finding__body">
        <span className="finding__rule">{picked.name}</span>
        <p className="finding__text">{"problem" in picked ? t("flights.detail.track.unusable", { problem: picked.problem }) : trackSummary(picked)}</p>
        <div className="finding__actions">
          {!("problem" in picked) && (
            <button type="button" className="btn btn--primary btn--small" onClick={saveTrack}>
              <Icon name="check" />
              {trackRow ? t("flights.detail.track.replace") : t("flights.detail.track.save")}
            </button>
          )}
          <button type="button" className="btn btn--quiet btn--small" onClick={chooseTrack}>
            {t("flights.detail.track.another")}
          </button>
          <button type="button" className="btn btn--quiet btn--small" onClick={() => setPicked(null)}>
            {t("common.cancel")}
          </button>
        </div>
      </div>
    </div>
  );
  function trackSummary(p: Extract<PickedTrack, { change: unknown }>): string {
    const c = p.change;
    const first = toUtcIso(c.points[0]![0] * 1000);
    const last = toUtcIso(c.points[c.points.length - 1]![0] * 1000);
    const ends = c.coverage === "partial" && p.startKm !== null && p.endKm !== null;
    const source = TRACK_SOURCE[c.provider];
    const summary = t("flights.detail.track.summary", {
      coverage: ends ? "partialEnds" : c.coverage,
      startKm: ends ? Math.round(p.startKm!) : "",
      endKm: ends ? Math.round(p.endKm!) : "",
      from: v.fromCode,
      to: v.toCode,
      thinned: p.read > c.points.length ? "yes" : "no",
      read: p.read,
      kept: c.points.length,
      distance: distance(c.distanceKm, unit),
      date: dayMonthYear(first.slice(0, 10)),
      start: first.slice(11, 16),
      end: last.slice(11, 16),
      known: source ? "yes" : "no",
      source: source ?? "",
    });
    const cut = p.legs ? t("flights.detail.track.legs", { legs: p.legs }) : null;
    const old = trackRow?.provider ? TRACK_SOURCE[trackRow.provider] : undefined;
    const replaces = trackRow ? t("flights.detail.track.replaces", { known: old ? "yes" : "no", source: old ?? "" }) : null;
    return [summary, cut, replaces].filter(Boolean).join(" ");
  }

  const altitude =
    track && trackRow
      ? store
          .all("track_points")
          .filter((p) => p.trackId === trackRow.id && p.altitudeFt !== null)
          .sort((a, b) => a.seq - b.seq)
      : [];
  // The distance flown beyond the great circle, once its track's positions are in this browser.
  const extension = track ? routeExtension(store, ref, f) : null;
  const t0 = altitude[0]?.t ?? 0;
  const fromOffset = f.takeoffAt ? parseDateTime(f.takeoffAt)!.offsetMin : 0;

  // The route on a flat map or a globe, under the same legend row, in a box of the same height (430px, 280px when
  // narrow), so switching between them moves nothing. Both draw the great circle dashed beside a recorded track.
  const mapHead = (
    <>
      {track ? (
        <>
          <span className="legend__item" title={[t("flights.detail.legend.recordedTitle"), trackRow?.attribution].filter(Boolean).join(" ")}>
            <span className="swatch-line" />
            {t("flights.detail.recordedTrack")}
          </span>
          {!!mark?.gaps?.length && (
            <span className="legend__item" title={t("flights.detail.legend.gapTitle")}>
              <span className="swatch-line swatch-line--unrecorded" />
              {t("flights.legend.notRecorded")}
            </span>
          )}
          <span className="legend__item">
            <span className="swatch-line swatch-line--faint" />
            {t("flights.detail.legend.greatCircle")}
          </span>
        </>
      ) : (
        <span className="legend__item" title={trackRow && !shared ? t("flights.detail.legend.syncTitle") : undefined}>
          <span className="swatch-line" />
          {trackRow ? (shared ? t("flights.detail.legend.loading") : t("flights.detail.legend.notHere")) : t("flights.detail.legend.none")}
        </span>
      )}
      <MapStyleSwitch value={mapStyle.style} onChange={mapStyle.set} />
    </>
  );
  // The airports as the route's heading reads them out, or nothing for an unknown one.
  const heroFrom = shortAirport(f.fromAirportId, ref) || f.fromRaw || "";
  const heroTo = shortAirport(f.toAirportId, ref) || f.toRaw || "";
  const routeWhat = { numbered: subject.numbered, flight: subject.flight, from: A ? shortAirport(A.id, ref) : "", to: B ? shortAirport(B.id, ref) : "" };
  const routeMap =
    !A || !B ? null : mapStyle.style === "globe" ? (
      <GlobePanel
        className="globe-panel--route"
        flights={mark ? [mark] : []}
        spots={[]}
        greatCircles={track ? [[[A.lon, A.lat], [B.lon, B.lat]]] : undefined}
        samples={samples}
        takeoff={takeoff}
        head={mapHead}
        label={t("flights.detail.map.globe", routeWhat)}
        onAirportClick={reachable("/airports/$id", undefined) ? (airport) => navigate({ to: "/airports/$id", params: { id: airport } }) : undefined}
      />
    ) : (
      <div className="map-wrap">
        <div className="legend">{mapHead}</div>
        <FlightMap from={[A.lon, A.lat]} to={[B.lon, B.lat]} fromCode={primaryCode(A)} toCode={primaryCode(B)} line={mark?.line ?? []} gaps={mark?.gaps} lone={mark?.lone} recorded={!!track} pending={!!trackRow && !track} samples={samples} takeoff={takeoff} onAirportClick={reachable("/airports/$id", undefined) ? (which) => navigate({ to: "/airports/$id", params: { id: which === "from" ? A.id : B.id } }) : undefined} label={t("flights.detail.map.flat", routeWhat)} />
      </div>
    );

  return (
    <div className="page">
      <nav className="crumbs" aria-label={t("flights.detail.nav")}>
        <Link to="/flights">
          <Icon name="arrow-left" /> {t("flights.allFlights")}
        </Link>
        <span className="crumbs__pager">
          {prev && (
            <Link to="/flights/$id" params={{ id: prev.f.id }} title={t("flights.detail.previous")}>
              <Icon name="arrow-left" />
              {prev.f.flightNumber ?? `${prev.fromCode} → ${prev.toCode}`}
            </Link>
          )}
          {next && (
            <Link to="/flights/$id" params={{ id: next.f.id }} title={t("flights.detail.next")}>
              {next.f.flightNumber ?? `${next.fromCode} → ${next.toCode}`}
              <Icon name="arrow-right" />
            </Link>
          )}
        </span>
      </nav>

      <div className="route-hero">
        <div className="route-hero__end">
          <h1 className="route-hero__code" aria-label={t("flights.detail.hero.from", { flight: f.flightNumber ?? t("flights.flight"), known: heroFrom ? "yes" : "no", airport: heroFrom })}>
            {primaryCode(A, f.fromRaw)}
          </h1>
          <p className="route-hero__place">
            {A ? (
              <Link className="route-hero__city route-hero__link" to="/airports/$id" params={{ id: A.id }}>
                {cityName(A) ?? A.name}
              </Link>
            ) : (
              <span className="route-hero__city">{f.fromRaw ?? t("flights.detail.hero.unknown")}</span>
            )}
            {A && <span className="route-hero__name">{A.name}</span>}
            {secondaryCode(A) && (
              <span className="route-hero__icao">
                <span className="route-hero__sep">{"\u00a0· "}</span>
                {secondaryCode(A)}
              </span>
            )}
          </p>
        </div>
        <div className="route-hero__mid" aria-hidden="true">
          <svg viewBox="0 0 200 56" preserveAspectRatio="none">
            <path className="arcline" d="M4 50 C 50 4, 150 4, 196 50" vectorEffect="non-scaling-stroke" />
          </svg>
          <div className="route-hero__stat">
            {v.min !== null && (
              <b>
                <Duration min={v.min} pad={false} />
              </b>
            )}
            {v.min !== null && v.km !== null && " · "}
            {v.km !== null && distance(v.km, unit)}
          </div>
        </div>
        <div className="route-hero__end route-hero__end--to">
          <p className="route-hero__code" aria-label={t("flights.detail.hero.to", { known: heroTo ? "yes" : "no", airport: heroTo })}>
            {primaryCode(B, f.toRaw)}
          </p>
          <p className="route-hero__place">
            {B ? (
              <Link className="route-hero__city route-hero__link" to="/airports/$id" params={{ id: B.id }}>
                {cityName(B) ?? B.name}
              </Link>
            ) : (
              <span className="route-hero__city">{f.toRaw ?? t("flights.detail.hero.unknown")}</span>
            )}
            {B && <span className="route-hero__name">{B.name}</span>}
            {secondaryCode(B) && (
              <span className="route-hero__icao">
                <span className="route-hero__sep">{"\u00a0· "}</span>
                {secondaryCode(B)}
              </span>
            )}
          </p>
        </div>
      </div>
      <div className="flight-date-row">
        <p className="flight-date">
          <b>{day ? dayLong(day) : t("flights.detail.noDate")}</b>
          {f.flightNumber && ` · ${f.flightNumber}`}
          {f.airlineId && ` · ${airlineLabel(f.airlineId, ref)}`}
        </p>
        {shared ? (
          samples.length > 1 && (
            <div className="actions">
              <button type="button" className="btn btn--quiet btn--small" onClick={downloadTrack}>
                <Icon name="download" />
                {t("flights.detail.track.kml")}
              </button>
            </div>
          )
        ) : (
          <div className="actions">
            <Link className="btn btn--quiet btn--small" to="/flights/$id/edit" params={{ id: f.id }}>
              <Icon name="pencil" />
              {t("common.edit")}
            </Link>
            <ShareButton kind="flight" subject={f.id} />
            {trackRow ? (
              <MenuButton
                className="btn btn--quiet btn--small"
                label={t("flights.detail.recordedTrack")}
                items={[
                  ...(samples.length > 1 ? [{ label: t("flights.detail.track.menu.download"), icon: <Icon name="download" />, onSelect: downloadTrack }] : []),
                  { label: t("flights.detail.track.menu.replace"), icon: <Icon name="upload" />, onSelect: chooseTrack },
                  { label: t("flights.detail.track.menu.remove"), icon: <Icon name="trash" />, onSelect: dropTrack },
                ]}
              >
                <Icon name="route" />
                {t("flights.detail.track.menu.button")}
              </MenuButton>
            ) : (
              <button type="button" className="btn btn--quiet btn--small" onClick={chooseTrack} title={t("flights.detail.track.add.title")}>
                <Icon name="route" />
                {t("flights.detail.track.add.label")}
              </button>
            )}
            <button type="button" className="btn btn--quiet btn--small" onClick={remove}>
              <Icon name="trash" />
              {t("common.delete")}
            </button>
            <input
              ref={trackInput}
              type="file"
              accept=".csv,.kml,.gpx,text/csv,application/vnd.google-earth.kml+xml,application/gpx+xml"
              className="visually-hidden"
              tabIndex={-1}
              aria-hidden="true"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void pickTrack(file);
                e.target.value = "";
              }}
            />
          </div>
        )}
      </div>

      <p className="lead lead--flight">
        {tx(
          "flights.detail.lead",
          {
            kind,
            airborne: v.min !== null ? "yes" : "no",
            duration: v.min !== null ? durLong(v.min) : "",
            aircraft: f.registration ? (typeText ? "both" : "reg") : typeText ? "type" : "none",
            reg: f.registration ?? "",
            article: typeText ? article(typeText) : "a",
            type: typeText,
            livery: livery && (f.registration || typeText) ? "yes" : "no",
            liveryName: livery ?? "",
            built: built ? "yes" : "no",
            year: built ?? "",
            landing: B ? landing : "none",
            city: B ? (cityName(B) ?? B.name) : "",
            landingPart: f.landingAt ? partOfDay(f.landingAt) : "",
            days: landDays,
          },
          {
            phrase: (text) => (
              <span className="phrase phrase--flown" {...phraseProps}>
                {text}
              </span>
            ),
          },
        )}
        {onThis.length > 1 && (
          <>
            {" "}
            {tx("flights.detail.flownOn", { voice: voice.kind, name: who, count: onThis.length })}
          </>
        )}{" "}
        {spotted[0] && (
          <span className="phrase phrase--spotted" {...phraseProps}>
            {tx("flights.detail.photographed", {
              voice: voice.kind,
              name: who,
              place: spotted[0].airportId ? "yes" : "no",
              city: spotted[0].airportId ? (cityName(ref.airport(spotted[0].airportId)) ?? shortAirport(spotted[0].airportId, ref)) : "",
              dated: spotted[0].seenOn ? "yes" : "no",
              date: spotted[0].seenOn ? dateOnly(spotted[0].seenOn, { day: "numeric", month: "long", year: "numeric" }) : "",
            })}
          </span>
        )}
      </p>

      {livery && (
        <LiveryBand
          names={[livery]}
          reg={f.registration}
          alt={t("flights.detail.livery.alt", { registered: f.registration ? "yes" : "no", reg: f.registration ?? "", type: typeText })}
          linked={!!(airframe && f.registration)}
          about={
            <>
              {airframe && f.registration ? (
                <Link className="stretch__link" to="/aircraft/$id" params={{ id: airframe.id }}>
                  {f.registration}
                </Link>
              ) : (
                f.registration
              )}
              {[typeText, f.airlineId && airlineLabel(f.airlineId, ref)].filter(Boolean).map((t) => ` · ${t}`)}
            </>
          }
          facts={[
            { label: t("flights.detail.livery.flownIn"), value: flownIn(onThis.filter((o) => sameLivery(o.f.specialLivery, f.specialLivery)).length, onThis.length) },
            ...(spottedInLivery.length ? [{ label: t("flights.detail.livery.photographedIn"), value: photographedIn(spottedInLivery.map((s) => s.seenOn)) }] : []),
          ]}
        />
      )}
      {pickedPanel}
      {routeMap}

      {(f.boardingAt || f.takeoffAt || f.landingAt || extension) && (
        <div className="times">
          {f.boardingAt && <TimeCell label={t("flights.detail.time.boarding")} dt={f.boardingAt} />}
          {f.takeoffAt && (
            <TimeCell
              label={t("flights.detail.time.takeoff", { code: v.fromCode })}
              dt={f.takeoffAt}
              extra={
                slipped > 0 &&
                f.scheduledDate && (
                  <p className="time__date">{tx("flights.detail.time.scheduled", { date: dateOnly(f.scheduledDate) }, { late: (text) => <span className="plus-day">{text}</span> })}</p>
                )
              }
            />
          )}
          {f.landingAt && (
            <div className="time">
              <p className="time__label">{t("flights.detail.time.landing", { code: v.toCode })}</p>
              <p className="time__clock">{clock(f.landingAt)}</p>
              <p className="time__date">
                {dayShort(localDay(f.landingAt)!)} · {offsetLabel(f.landingAt)}
                {landDays > 0 && <span className="plus-day">{t("flights.detail.time.plusDays", { count: landDays })}</span>}
              </p>
            </div>
          )}
          {v.min !== null && (
            <div className="time">
              <p className="time__label">{t("flights.detail.time.inAir")}</p>
              <p className="time__clock">
                <Duration min={v.min} />
              </p>
              <p className="time__date">{v.km !== null ? t("flights.detail.time.greatCircle", { distance: distance(v.km, unit) }) : ""}</p>
            </div>
          )}
          {extension && (
            <div className="time" title={t("flights.detail.extension.title", { minimum: extension.minimum ? "yes" : "no" })}>
              <p className="time__label">{t("flights.detail.extension.label")}</p>
              <p className="time__clock">{t("flights.detail.extension.value", { minimum: extension.minimum ? "yes" : "no", percent: extensionPercent(extension.percent) })}</p>
              <p className="time__date">{t("flights.detail.extension.detail", { flown: distance(extension.flownKm, unit), greatCircle: distance(extension.greatCircleKm, unit) })}</p>
            </div>
          )}
        </div>
      )}

      {altitude.length > 10 && (
        <section className="section" aria-labelledby="alt-title">
          <div className="section__head">
            <h2 className="section__title" id="alt-title">
              {t("flights.detail.altitude.title")}
            </h2>
            <span className="section__aside" title={trackRow?.attribution ?? undefined}>
              {t("common.count.points", { count: altitude.length })}
            </span>
          </div>
          <div className="chart">
            <AltitudeChart
              points={altitude.map((p) => {
                const local = new Date((p.t + fromOffset * 60) * 1000).toISOString().slice(11, 16);
                return { min: (p.t - t0) / 60, alt: p.altitudeFt ?? 0, gs: p.groundSpeedKt, clock: t("flights.detail.altitude.clock", { time: local, code: v.fromCode }) };
              })}
            />
          </div>
        </section>
      )}

      <section className="section detail-grid">
        <div id="aircraft">
          <div className="section__head">
            <h2 className="section__title">{t("flights.detail.aircraft.title")}</h2>
          </div>
          {/* The whole card opens the aircraft's page, as on Home; the flights listed in it keep their own links. */}
          <article className={`card aircraft-card${airframe ? " stretch" : ""}`} id="aircraft-card">
            {!livery && <Photo reg={f.registration} alt={`${f.registration ?? ""}, ${typeText}`} />}
            <div className="card__body">
              {airframe ? (
                <Link className="card__reg stretch__link" to="/aircraft/$id" params={{ id: airframe.id }}>
                  {f.registration ?? t("flights.detail.aircraft.noReg")}
                </Link>
              ) : (
                <span className="card__reg">{f.registration ?? t("flights.detail.aircraft.noReg")}</span>
              )}
              <span className="card__type">
                {typeText}
                {f.airlineId && ` · ${airlineLabel(f.airlineId, ref)}`}
              </span>
              <ul className="card__events">
                {onThis.map((o) => (
                  <li key={o.f.id}>
                    <span className="dot dot--flown" />
                    {/* One item beside the dot, so the date follows the link with no gap before its comma. */}
                    <span>
                      {o.f.id === f.id ? (
                        t("flights.detail.aircraft.thisFlight")
                      ) : (
                        <Link to="/flights/$id" params={{ id: o.f.id }}>
                          {o.f.flightNumber ?? t("flights.flight")} {o.fromCode} → {o.toCode}
                        </Link>
                      )}
                      {o.day && `, ${dayMonthYear(o.day)}`}
                    </span>
                  </li>
                ))}
                {spotted.map((s) => (
                  <li key={s.id}>
                    <span className="dot dot--spotted" />
                    {t("flights.detail.aircraft.spotted", { place: s.airportId ? "yes" : "no", airport: s.airportId ? airportWithCode(s.airportId, ref) : "" })}
                    {s.seenOn && `, ${dayMonthYear(s.seenOn)}`}
                  </li>
                ))}
              </ul>
              {airframe && (
                <p className="identity">
                  <Icon name="info" />
                  <span>
                    {t("flights.detail.aircraft.identity", {
                      aged: age !== null && built ? "yes" : "no",
                      built: built ?? "",
                      age: age ?? 0,
                      serial: airframe.provisional ? "unknown" : "known",
                      msn: airframe.msn ?? "",
                    })}
                  </span>
                </p>
              )}
              {!livery && <Credit reg={f.registration} />}
            </div>
          </article>
        </div>
        <div>
          <div className="section__head">
            <h2 className="section__title">{t("flights.detail.seat.title")}</h2>
          </div>
          <dl className="dl">
            <div>
              <dt>{t("flights.detail.seat.seat")}</dt>
              <dd>
                {f.seat ?? "—"}
                {f.seatPosition && <span className="muted"> · {t("flights.detail.seat.position", { position: f.seatPosition })}</span>}
                {guessed && <span className="muted"> · {t("flights.detail.seat.guess", { position: guessed })}</span>}
              </dd>
            </div>
            <div>
              <dt>{t("flights.detail.seat.cabin")}</dt>
              <dd>{f.cabinClass ? CABIN_LABEL[f.cabinClass] : "—"}</dd>
            </div>
            <div>
              <dt>{t("flights.detail.seat.fare")}</dt>
              <dd>
                {f.fareBrand ?? (f.bookingClass ? "" : "—")}
                {f.bookingClass && <span className="muted">{f.fareBrand ? " · " : ""}{t("flights.detail.seat.bookingClass", { code: f.bookingClass })}</span>}
              </dd>
            </div>
            {f.reason && (
              <div>
                <dt>{t("flights.detail.seat.reason")}</dt>
                <dd>{REASON_LABEL[f.reason]}</dd>
              </div>
            )}
            <div>
              <dt>{t("flights.detail.seat.flight")}</dt>
              <dd>
                {f.flightNumber ?? "—"}
                {f.flightNumber && ref.operator(f.airlineId)?.icao && <span className="muted"> · {ref.operator(f.airlineId)!.icao}{f.flightNumber.replace(/^[A-Z0-9]{2}/, "")}</span>}
              </dd>
            </div>
            <div>
              <dt>{t("flights.detail.seat.airports")}</dt>
              <dd>
                {[A?.iata, A?.icao].filter(Boolean).join(" / ") || f.fromRaw} → {[B?.iata, B?.icao].filter(Boolean).join(" / ") || f.toRaw}
              </dd>
            </div>
            {(f.departureGate || f.departureTerminal) && (
              <div>
                <dt>{t("flights.detail.seat.gate")}</dt>
                <dd>
                  {f.departureTerminal && `${t("flights.detail.seat.terminal", { terminal: f.departureTerminal })} · `}
                  {f.departureGate}
                </dd>
              </div>
            )}
            {(f.specialLivery || f.livery) && (
              <div>
                <dt>{t("flights.detail.seat.livery")}</dt>
                <dd>
                  {livery ?? f.livery}
                  {livery && <span className="muted"> · {t("flights.detail.seat.special")}</span>}
                </dd>
              </div>
            )}
            {!shared && (
              <div>
                <dt>{t("flights.detail.seat.ticket")}</dt>
                <dd>
                  {!ticketNumber ? (
                    <span className="muted">{t("flights.detail.seat.notRecorded")}</span>
                  ) : showTicket ? (
                    <>
                      {ticketNumber}{" "}
                      <button type="button" className="link-btn" onClick={() => setShowTicket(false)}>
                        {t("flights.detail.seat.hide")}
                      </button>
                    </>
                  ) : (
                    <>
                      <span className="muted">{t("flights.detail.seat.hidden")}</span>{" "}
                      <button type="button" className="link-btn" onClick={() => setShowTicket(true)}>
                        {t("flights.detail.seat.show")}
                      </button>
                    </>
                  )}
                </dd>
              </div>
            )}
          </dl>
          {f.notes && (
            <>
              <h3 className="subhead">{t("flights.detail.notes")}</h3>
              <p className="notes">{f.notes}</p>
            </>
          )}
          <h3 className="subhead">{t("flights.detail.source.title")}</h3>
          <p className="status-line">
            <Icon name="info" />
            <span>{t("flights.detail.source.text", { source: f.sourceKind ?? "manual" })}</span>
          </p>
          {findings.length ? (
            <FindingList findings={findings} />
          ) : (
            <p className="status-line status-line--good">
              <Icon name="circle-check" />
              <span>{t("flights.detail.checksPassed")}</span>
            </p>
          )}
        </div>
      </section>

      <nav className="pager-foot" aria-label={t("flights.detail.pager")}>
        {prev ? (
          <Link className="prev" to="/flights/$id" params={{ id: prev.f.id }}>
            <small>{t("flights.detail.previous")}</small>
            <span>
              {prev.f.flightNumber ?? t("flights.flight")} · {prev.fromCode} → {prev.toCode}
            </span>
          </Link>
        ) : (
          <span />
        )}
        {next && (
          <Link className="next" to="/flights/$id" params={{ id: next.f.id }}>
            <small>{t("flights.detail.next")}</small>
            <span>
              {next.f.flightNumber ?? t("flights.flight")} · {next.fromCode} → {next.toCode}
            </span>
          </Link>
        )}
      </nav>
    </div>
  );
}

export function flightTitle(f: Flight): string {
  return [f.flightNumber, flightDay(f)].filter(Boolean).join(" · ");
}
