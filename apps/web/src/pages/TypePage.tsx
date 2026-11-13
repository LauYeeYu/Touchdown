// An aircraft type's page (docs/31-ui.md, "Aircraft types"), from Aircraft types and Compare: the type seen from above
// as a measured drawing (G11), a sentence of its size and what the log has of it, its figures from Wikipedia (docs/13,
// "Type figures"), its family's type codes side by side at one scale with each one's difference from this one, the
// family's history, the log's aircraft of the type, and where the figures and the drawing come from.

import { useMemo } from "react";
import type { FamilyFacts } from "@touchdown/core";
import { useParams } from "@tanstack/react-router";
import { t } from "@touchdown/i18n";
import { useApp } from "../data/context.tsx";
import { Link } from "../lib/link.tsx";
import { Icon } from "../lib/icons.tsx";
import { headline } from "../lib/i18n.tsx";
import { dateOnly, nf, typeName } from "../lib/format.ts";
import { familyTypes, metres, typeFigures, weight } from "../lib/typeFigures.ts";
import { useTypeInfo } from "../lib/typeInfo.ts";
import { useVisitor } from "../lib/visitor.ts";
import { aircraftViews } from "../lib/views.ts";
import { Fact } from "../components/Facts.tsx";
import { drawingOf, Silhouette } from "../components/Silhouette.tsx";
import { TypeDrawing } from "../components/TypeDrawing.tsx";
import { NotFound } from "./NotFound.tsx";
import { hasTypePage, useTypeCounts } from "../lib/typeEntries.ts";

/** A date the infobox gives as a day, a month or a year, as the app writes dates. */
const historyDate = (d: string) => (d.length === 10 ? dateOnly(d, { day: "numeric", month: "short", year: "numeric" }) : d.length === 7 ? dateOnly(`${d}-01`, { month: "long", year: "numeric" }) : d);

export function TypePage() {
  const { code } = useParams({ from: "/types/$code" });
  const { app, version } = useApp();
  const { store, ref } = app;
  const info = useTypeInfo();
  const counts = useTypeCounts();
  // A visitor who is not signed in has no log: the page says nothing about one.
  const visitor = useVisitor();
  const unit = app.settings().distanceUnit ?? "km";
  const type = ref.type(code);
  const aircraft = useMemo(() => aircraftViews(store).filter((v) => v.airframe.typeCode === code), [store, version, code]);
  if (!type || !hasTypePage(ref, code)) return <NotFound />;

  const name = typeName(code, ref);
  const fam = ref.family(type.familyId);
  const specs = info?.specs(code) ?? null;
  // The family's history from its article, else the type's own from Wikidata.
  const familyFacts = info?.facts(type.familyId) ?? null;
  const ownHistory = !familyFacts && !!specs && !!(specs.firstFlight || specs.introduced || specs.built !== null);
  const facts: Pick<FamilyFacts, "firstFlight" | "introduced" | "built" | "builtAsOf" | "status"> | null =
    familyFacts ?? (ownHistory ? { firstFlight: specs!.firstFlight, introduced: specs!.introduced, built: specs!.built, builtAsOf: null, status: null } : null);
  const planform = info?.planform(code, ref) ?? null;
  const drawing = drawingOf(code, info, ref);
  const rotor = planform?.shape.kind === "helicopter";
  const figures = typeFigures(unit, rotor);
  const flown = counts.flown.get(code) ?? 0;
  const seenAircraft = aircraft.filter((v) => v.sightings.length > 0).length;
  const codes = fam ? familyTypes(ref, fam.id, info) : [code];
  const siblings = codes.filter((c) => info?.specs(c));
  // The family's codes drawn to one scale: the largest fills the column's width.
  const largest = Math.max(1, ...siblings.map((c) => Math.max(info?.specs(c)?.spanM ?? 0, info?.specs(c)?.lengthM ?? 0)));
  const familyScale = 84 / largest;

  return (
    <div className="page type-page">
      <nav className="crumbs">
        <Link to="/types">
          <Icon name="arrow-left" />
          {t("aircraft.types.title")}
        </Link>
      </nav>
      <header className="type-page__head">
        <div>
          <h1 className="type-page__name">{name}</h1>
          <p className="type-page__codes">
            <span className="type-page__code">{code}</span>
            {fam && fam.name !== name && <span>{fam.name}</span>}
          </p>
        </div>
        <Link className="btn btn--quiet btn--small" to="/types/compare" search={{ a: code }}>
          <Icon name="arrow-left-right" />
          {t("aircraft.types.compare")}
        </Link>
      </header>
      {specs?.lengthM && specs.spanM ? (
        <p className="type-page__lead">
          {headline(
            t("aircraft.types.page.lead", { name, length: metres(specs.lengthM), span: metres(specs.spanM), rotor: rotor ? "yes" : "no", hasMtow: specs.mtowKg ? "yes" : "no", mtow: specs.mtowKg ? weight(specs.mtowKg) : "" }),
          )}
          {!visitor && ` ${t("aircraft.types.page.log", { flown, seen: seenAircraft })}`}
        </p>
      ) : (
        !visitor && <p className="type-page__lead">{t("aircraft.types.page.log", { flown, seen: seenAircraft })}</p>
      )}

      {drawing && planform && (
        <figure className="type-page__drawing">
          <TypeDrawing path={drawing.path} extent={drawing.extent} length={specs?.lengthM ?? null} span={specs?.spanM ?? null} rotor={rotor} label={t("aircraft.types.drawing.label", { name })} />
        </figure>
      )}

      {specs && (
        <dl className="facts type-page__facts">
          {figures
            .filter((x) => x.key !== "area" && x.key !== "sweep" && x.text(specs))
            .map((x) => (
              <Fact key={x.key} label={x.label} value={x.text(specs)} />
            ))}
          {specs.engines && <Fact label={t("aircraft.types.figure.engines")} value={specs.engines} />}
          {figures
            .filter((x) => (x.key === "area" || x.key === "sweep") && x.text(specs))
            .map((x) => (
              <Fact key={x.key} label={x.label} value={x.text(specs)} />
            ))}
        </dl>
      )}

      {fam && siblings.length > 1 && specs && (
        <section className="section" aria-labelledby="family-title">
          <div className="section__head">
            <h2 className="section__title" id="family-title">
              {fam.name}
            </h2>
          </div>
          <p className="type-family__intro">{t("aircraft.types.family.intro", { count: siblings.length, name })}</p>
          <div className="table-scroll">
            {/* Equal columns, at least 112px each, the figures' names kept in view while the codes scroll on a phone. */}
            <table className="table type-family" style={{ minWidth: 160 + siblings.length * 112 }}>
              <colgroup>
                <col className="type-family__label-col" />
                {siblings.map((c) => (
                  <col key={c} />
                ))}
              </colgroup>
              <thead>
                <tr>
                  <th scope="col" />
                  {siblings.map((c) => (
                    <th key={c} scope="col">
                      <Link to="/types/$code" params={{ code: c }} className="type-family__head" aria-current={c === code ? "page" : undefined}>
                        <span className="type-family__shape">
                          <Silhouette code={c} scale={familyScale} />
                        </span>
                        <b>{c}</b>
                        <span>{typeName(c, ref)}</span>
                      </Link>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {figures.map((x) => {
                  const own = x.value(specs);
                  if (!siblings.some((c) => x.text(info!.specs(c)!))) return null;
                  return (
                    <tr key={x.key}>
                      <th scope="row">{x.label}</th>
                      {siblings.map((c) => {
                        const s = info!.specs(c)!;
                        const v = x.value(s);
                        // The difference only where there is one: a figure the same as this type's has none under it.
                        const diff = c !== code && v !== null && own !== null ? x.diff(v - own, own) : null;
                        return (
                          <td key={c}>
                            <span className="tabular">{x.text(s) ?? "—"}</span>
                            {diff && diff !== "=" && <span className="type-family__diff tabular">{diff}</span>}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
                <tr>
                  <th scope="row">{t("aircraft.types.figure.engines")}</th>
                  {siblings.map((c) => (
                    <td key={c} className="type-family__engines">
                      {info!.specs(c)!.engines ?? "—"}
                    </td>
                  ))}
                </tr>
                {!visitor && (
                  <tr>
                    <th scope="row">{t("aircraft.types.family.inLog")}</th>
                    {siblings.map((c) => (
                      <td key={c}>
                        <span className="type-family__log tabular">
                          {(counts.flown.get(c) ?? 0) > 0 && (
                            <span>
                              <span className="dot dot--flown" />
                              {nf.format(counts.flown.get(c)!)}
                            </span>
                          )}
                          {(counts.seen.get(c) ?? 0) > 0 && (
                            <span>
                              <span className="dot dot--spotted" />
                              {nf.format(counts.seen.get(c)!)}
                            </span>
                          )}
                          {!counts.flown.get(c) && !counts.seen.get(c) && "—"}
                        </span>
                      </td>
                    ))}
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {facts && (facts.firstFlight || facts.introduced || facts.built || facts.status) && (
        <section className="section" aria-labelledby="history-title">
          <div className="section__head">
            <h2 className="section__title" id="history-title">
              {t("aircraft.types.history.title")}
            </h2>
          </div>
          <dl className="facts">
            {facts.firstFlight && <Fact label={t("aircraft.types.history.firstFlight")} value={historyDate(facts.firstFlight)} />}
            {facts.introduced && <Fact label={t("aircraft.types.history.introduced")} value={historyDate(facts.introduced)} />}
            {facts.built !== null && <Fact label={t("aircraft.types.history.built")} value={nf.format(facts.built)} detail={facts.builtAsOf ? t("aircraft.types.history.asOf", { date: historyDate(facts.builtAsOf) }) : undefined} />}
            {facts.status && <Fact label={t("aircraft.types.history.status")} value={facts.status} />}
          </dl>
        </section>
      )}

      {aircraft.length > 0 && (
        <section className="section" aria-labelledby="log-title">
          <div className="section__head">
            <h2 className="section__title" id="log-title">
              {t("aircraft.types.log.title", { count: aircraft.length })}
            </h2>
          </div>
          <ul className="type-aircraft">
            {aircraft.map((v) => (
              <li key={v.airframe.id}>
                <Link to="/aircraft/$id" params={{ id: v.airframe.id }}>
                  {v.registration ?? t("aircraft.noRegistration")}
                </Link>
                {v.flights.length > 0 && <span className="dot dot--flown" title={t("common.count.flights", { count: v.flights.length })} />}
                {v.sightings.length > 0 && <span className="dot dot--spotted" title={t("common.count.sightings", { count: v.sightings.length })} />}
              </li>
            ))}
          </ul>
        </section>
      )}

      <p className="type-page__source">
        {specs?.wikipedia && (
          <>
            {t("aircraft.types.source.figures")}{" "}
            <a href={`https://en.wikipedia.org/w/index.php?title=${encodeURIComponent(specs.wikipedia.article.replace(/ /g, "_"))}&oldid=${specs.wikipedia.revision}`} target="_blank" rel="noopener">
              {specs.wikipedia.article}
            </a>
            {". "}
          </>
        )}
        {/* Wikidata where the page shows something from it: figures Wikipedia lacks, or the type's own history. */}
        {specs?.wikidata && (specs.wikidata.figures || ownHistory) && (
          <>
            {t(specs.wikipedia ? "aircraft.types.source.wikidataMore" : "aircraft.types.source.wikidata")}{" "}
            <a href={`https://www.wikidata.org/w/index.php?title=${specs.wikidata.item}&oldid=${specs.wikidata.revision}`} target="_blank" rel="noopener">
              {specs.wikidata.label ?? specs.wikidata.item}
            </a>
            {". "}
          </>
        )}
        {!specs?.wikipedia && !specs?.wikidata && `${t("aircraft.types.source.none")} `}
        {drawing && planform && t("aircraft.types.source.drawing", { checked: planform.generic ? "generic" : drawing.checked ? "yes" : "no" })}
      </p>
    </div>
  );
}
