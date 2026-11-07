// A sighting on a shared link (docs/32-modes-and-sharing.md, "What a link shows"): the app has no page for one (a
// sighting opens in its form), so it is made here from the app's parts: the aircraft's photo, its registration, type
// and airline, where and when it was seen, in which statuses, and its livery.

import { useParams } from "@tanstack/react-router";
import { liveryName, phasesOf } from "@touchdown/core";
import { inSentence, list, t } from "@touchdown/i18n";
import { useApp } from "../data/context.tsx";
import { airportWithCode } from "../lib/codes.ts";
import { airlineLabel, dateOnly, PHASE_LABEL, TAG_LABEL, typeName } from "../lib/format.ts";
import { Icon } from "../lib/icons.tsx";
import { Link } from "../lib/link.tsx";
import { Credit, Photo } from "../components/Photo.tsx";
import { LiveryBand, photographedIn } from "../components/LiveryBand.tsx";
import { NotFound } from "../pages/NotFound.tsx";

export function SightingView() {
  const { id } = useParams({ strict: false }) as { id?: string };
  const { app } = useApp();
  const { store, ref } = app;
  const s = id ? store.get("sightings", id) : null;
  if (!s) return <NotFound what={t("share.sighting.notInLink")} back={{ to: "/spotting", label: t("share.nav.spotting") }} />;
  const a = store.get("airframes", s.airframeId);
  const typeText = s.model ? s.model : typeName(s.typeCode ?? a?.typeCode ?? null, ref);
  const place = s.spotName ?? airportWithCode(s.airportId, ref, s.airportRaw);
  const phases = phasesOf(store, s.id).map((p, i) => (i ? inSentence(PHASE_LABEL[p] ?? p) : (PHASE_LABEL[p] ?? p)));
  const livery = s.specialLivery?.trim() ? liveryName(s.specialLivery) : null;
  const tags = store.all("sighting_tags").filter((t) => t.sightingId === s.id && t.tag).map((t) => TAG_LABEL[t.tag!] ?? t.tag!);
  const photos = store.all("photo_links").filter((p) => p.ownerTable === "sightings" && p.ownerId === s.id && p.url);
  const day = s.seenOn ? dateOnly(s.seenOn, { day: "numeric", month: "long", year: "numeric" }) : null;
  const reg = s.registration ?? s.registrationRaw ?? "";

  return (
    <div className="page">
      <nav className="crumbs" aria-label={t("common.back")}>
        <Link to="/spotting">
          <Icon name="arrow-left" /> {t("share.nav.spotting")}
        </Link>
      </nav>
      <div className={`aircraft-hero${livery ? " aircraft-hero--livery" : ""}`}>
        <div>
          <h1 className="route-hero__code">
            {a ? (
              <Link className="route-hero__link" to="/aircraft/$id" params={{ id: a.id }}>
                {reg || t("share.sighting.noRegistration")}
              </Link>
            ) : (
              reg || t("share.sighting.noRegistration")
            )}
          </h1>
          <p className="flight-date">
            <b>{typeText || t("share.sighting.typeUnknown")}</b>
            {(s.operatorId || s.operatorRaw) && ` · ${s.operatorId ? airlineLabel(s.operatorId, ref) : s.operatorRaw}`}
          </p>
          <p className="lead lead--flight">
            {t("share.sighting.lead", {
              at: place ? "yes" : "no",
              place: place ?? "",
              on: day ? "yes" : "no",
              day: day ?? "",
              seen: phases.length ? "yes" : "no",
              phases: list(phases.map(inSentence), "unit"),
              inLivery: livery ? "yes" : "no",
              livery: livery ?? "",
            })}
          </p>
        </div>
        {!livery && (
          <figure className="aircraft-hero__photo card">
            <Photo reg={reg} alt={`${reg}, ${typeText}`} />
            <figcaption className="card__body">
              <Credit reg={reg} />
            </figcaption>
          </figure>
        )}
      </div>
      {livery && <LiveryBand names={[livery]} reg={reg || null} alt={`${reg}, ${typeText}`} about={typeText} facts={[{ label: t("share.sighting.photographedIn"), value: photographedIn([s.seenOn]) }]} />}

      <section className="section">
        <dl className="dl share-dl">
          {place && (
            <div>
              <dt>{t("share.sighting.place")}</dt>
              <dd>{place}</dd>
            </div>
          )}
          {day && (
            <div>
              <dt>{t("share.sighting.day")}</dt>
              <dd>
                {day}
                {s.seenAt && ` · ${s.seenAt.slice(11, 16)}`}
              </dd>
            </div>
          )}
          {phases.length > 0 && (
            <div>
              <dt>{t("share.sighting.seen")}</dt>
              <dd>{list(phases, "unit")}</dd>
            </div>
          )}
          {tags.length > 0 && (
            <div>
              <dt>{t("share.sighting.photo")}</dt>
              <dd>{list(tags, "unit")}</dd>
            </div>
          )}
          {a?.msn && (
            <div>
              <dt>{t("share.sighting.msn")}</dt>
              <dd>{a.msn}</dd>
            </div>
          )}
          {a?.firstFlightDate && (
            <div>
              <dt>{t("share.sighting.firstFlight")}</dt>
              <dd>{dateOnly(a.firstFlightDate, { day: "numeric", month: "short", year: "numeric" })}</dd>
            </div>
          )}
          {s.notes && (
            <div>
              <dt>{t("share.sighting.notes")}</dt>
              <dd className="share-notes">{s.notes}</dd>
            </div>
          )}
          {photos.length > 0 && (
            <div>
              <dt>{t("share.sighting.photos")}</dt>
              <dd>
                {photos.map((p) => (
                  <a key={p.id} href={p.url!} target="_blank" rel="noopener noreferrer" className="share-photo-link">
                    {p.label || t("share.sighting.photos")}
                  </a>
                ))}
              </dd>
            </div>
          )}
        </dl>
      </section>
    </div>
  );
}
