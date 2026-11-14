// A family's page (docs/31-ui.md, "Aircraft types"), from a family's row on Aircraft types or a manufacturer's page and
// from the family on a type's page: its name and manufacturer, a sentence of its type codes and what the log has of
// them, the codes side by side at one scale, its history, the log's aircraft of its types and where it comes from.

import { useMemo } from "react";
import { useParams } from "@tanstack/react-router";
import { t } from "@touchdown/i18n";
import { useApp } from "../data/context.tsx";
import { Link } from "../lib/link.tsx";
import { Icon } from "../lib/icons.tsx";
import { headline } from "../lib/i18n.tsx";
import { useVisitor } from "../lib/visitor.ts";
import { aircraftViews } from "../lib/views.ts";
import { useTypeInfo } from "../lib/typeInfo.ts";
import { slugOf, useTypeCounts, useTypeEntries } from "../lib/typeEntries.ts";
import { TypeFamilyTable } from "../components/TypeFamilyTable.tsx";
import { TypeAircraft, TypeHistory } from "../components/TypeSections.tsx";
import { NotFound } from "./NotFound.tsx";

export function TypeFamily() {
  const { family: slug } = useParams({ from: "/types/families/$family" });
  const { app, version } = useApp();
  const { store, ref } = app;
  const info = useTypeInfo();
  const counts = useTypeCounts();
  // A visitor who is not signed in has no log: the page says nothing about one.
  const visitor = useVisitor();
  const { entries } = useTypeEntries();
  const entry = entries.find((e) => e.family && slugOf(e.family.name) === slug);
  const codes = entry?.codes ?? [];
  const aircraft = useMemo(() => aircraftViews(store).filter((v) => v.airframe.typeCode && codes.includes(v.airframe.typeCode)), [store, version, codes]);
  if (!entry?.family) return <NotFound />;

  const fam = entry.family;
  const facts = info?.facts(fam.id) ?? null;
  const year = entry.firstFlight?.slice(0, 4) ?? "none";
  const flownTypes = codes.filter((c) => counts.flown.has(c)).length;
  const seenTypes = codes.filter((c) => counts.seen.has(c)).length;
  const rotor = info?.planform(entry.drawn, ref)?.shape.kind === "helicopter";

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
          <h1 className="type-page__name">{fam.name}</h1>
          <p className="type-page__codes">
            <Link to="/types/manufacturers/$manufacturer" params={{ manufacturer: slugOf(fam.manufacturer) }}>
              {fam.manufacturer}
            </Link>
          </p>
        </div>
        <Link className="btn btn--quiet btn--small" to="/types/compare" search={{ a: entry.main }}>
          <Icon name="arrow-left-right" />
          {t("aircraft.types.compare")}
        </Link>
      </header>
      <p className="type-page__lead">
        {headline(
          visitor || flownTypes + seenTypes === 0
            ? t("aircraft.types.family.lead", { codes: codes.length, year })
            : t("aircraft.types.family.leadLog", { codes: codes.length, year, flown: flownTypes, seen: seenTypes }),
        )}
      </p>

      {info && (
        <section className="section" aria-labelledby="family-codes-title">
          <div className="section__head">
            <h2 className="section__title" id="family-codes-title">
              {t("aircraft.types.family.codes")}
            </h2>
          </div>
          <TypeFamilyTable codes={codes} current={null} counts={counts} visitor={visitor} rotor={rotor} />
        </section>
      )}

      <TypeHistory facts={facts} />
      <TypeAircraft aircraft={aircraft} title={t("aircraft.types.family.aircraft", { count: aircraft.length })} />

      <p className="type-page__source">
        {facts && (
          <>
            {t("aircraft.types.source.history")}{" "}
            <a href={`https://en.wikipedia.org/w/index.php?title=${encodeURIComponent(facts.article.replace(/ /g, "_"))}&oldid=${facts.revision}`} target="_blank" rel="noopener">
              {facts.article}
            </a>
            {". "}
          </>
        )}
        {t("aircraft.types.source.family")}
      </p>
    </div>
  );
}
