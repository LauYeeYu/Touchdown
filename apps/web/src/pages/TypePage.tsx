// An aircraft type's page (docs/31-ui.md, "Aircraft types"), from Aircraft types and Compare: the type seen from above
// as a measured drawing (G11), a sentence of its size and what the log has of it, its figures from Wikipedia (docs/13,
// "Type figures"), its family's type codes side by side at one scale with each one's difference from this one, the
// family's history, the log's aircraft of the type, and where the figures and the drawing come from.

import { useMemo } from "react";
import { useParams } from "@tanstack/react-router";
import { t } from "@touchdown/i18n";
import { useApp } from "../data/context.tsx";
import { Link } from "../lib/link.tsx";
import { Icon } from "../lib/icons.tsx";
import { headline } from "../lib/i18n.tsx";
import { typeName } from "../lib/format.ts";
import { familyTypes, metres, typeFigures, weight } from "../lib/typeFigures.ts";
import { useTypeInfo } from "../lib/typeInfo.ts";
import { useVisitor } from "../lib/visitor.ts";
import { aircraftViews } from "../lib/views.ts";
import { Fact } from "../components/Facts.tsx";
import { drawingOf } from "../components/Silhouette.tsx";
import { TypeDrawing } from "../components/TypeDrawing.tsx";
import { TypeFamilyTable } from "../components/TypeFamilyTable.tsx";
import { TypeAircraft, TypeHistory, type History } from "../components/TypeSections.tsx";
import { NotFound } from "./NotFound.tsx";
import { hasTypePage, slugOf, useTypeCounts } from "../lib/typeEntries.ts";

export function TypePage() {
  const { code } = useParams({ from: "/types/$code" });
  const { app, version } = useApp();
  const { store, ref } = app;
  const info = useTypeInfo();
  const counts = useTypeCounts();
  // A visitor who is not signed in has no log: the page says nothing about one.
  const visitor = useVisitor();
  const type = ref.type(code);
  const aircraft = useMemo(() => aircraftViews(store).filter((v) => v.airframe.typeCode === code), [store, version, code]);
  if (!type || !hasTypePage(ref, code)) return <NotFound />;

  const name = typeName(code, ref);
  const fam = ref.family(type.familyId);
  const specs = info?.specs(code) ?? null;
  // The family's history from its article, else the type's own from Wikidata.
  const familyFacts = info?.facts(type.familyId) ?? null;
  const ownHistory = !familyFacts && !!specs && !!(specs.firstFlight || specs.introduced || specs.built !== null);
  const facts: History | null =
    familyFacts ?? (ownHistory ? { firstFlight: specs!.firstFlight, introduced: specs!.introduced, built: specs!.built, builtAsOf: null, status: null } : null);
  const planform = info?.planform(code, ref) ?? null;
  const drawing = drawingOf(code, info, ref);
  const rotor = planform?.shape.kind === "helicopter";
  const figures = typeFigures(rotor);
  const flown = counts.flown.get(code) ?? 0;
  const seenAircraft = aircraft.filter((v) => v.sightings.length > 0).length;
  // Every code of the family, once the figures are loaded.
  const siblings = fam && info ? familyTypes(ref, fam.id, info) : [];

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

      {fam && siblings.length > 1 && (
        <section className="section" aria-labelledby="family-title">
          <div className="section__head">
            <h2 className="section__title" id="family-title">
              <Link to="/types/families/$family" params={{ family: slugOf(fam.name) }}>
                {fam.name}
              </Link>
            </h2>
          </div>
          <TypeFamilyTable codes={siblings} current={code} counts={counts} visitor={visitor} rotor={rotor} />
        </section>
      )}

      <TypeHistory facts={facts} />
      <TypeAircraft aircraft={aircraft} title={t("aircraft.types.log.title", { count: aircraft.length })} />

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
        {specs?.article && (
          <>
            {t(specs.wikipedia || specs.wikidata?.figures ? "aircraft.types.source.wikipediaMore" : "aircraft.types.source.figures")}{" "}
            <a href={`https://en.wikipedia.org/w/index.php?title=${encodeURIComponent(specs.article.title.replace(/ /g, "_"))}&oldid=${specs.article.revision}`} target="_blank" rel="noopener">
              {specs.article.title}
            </a>
            {". "}
          </>
        )}
        {!specs?.wikipedia && !specs?.wikidata && !specs?.article && `${t("aircraft.types.source.none")} `}
        {drawing && planform && t("aircraft.types.source.drawing", { checked: planform.generic ? "generic" : drawing.checked ? "yes" : "no" })}
      </p>
    </div>
  );
}
