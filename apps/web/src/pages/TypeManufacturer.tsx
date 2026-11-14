// A manufacturer's aircraft types (docs/31-ui.md, "Aircraft types"), from the manufacturers on Aircraft types: its families and its
// types without one, by name with numbers in order (so a family's variants without one sit beside it), each with the year
// it first flew, and the roles among them to narrow the list.

import { useState } from "react";
import { useParams } from "@tanstack/react-router";
import type { TypeRole } from "@touchdown/core";
import { t } from "@touchdown/i18n";
import { Link } from "../lib/link.tsx";
import { Icon } from "../lib/icons.tsx";
import { headline } from "../lib/i18n.tsx";
import { useVisitor } from "../lib/visitor.ts";
import { useTypeCounts, useTypeEntries } from "../lib/typeEntries.ts";
import { useTypeInfo } from "../lib/typeInfo.ts";
import { useApp } from "../data/context.tsx";
import { TypeRow } from "../components/TypeRow.tsx";
import { NotFound } from "./NotFound.tsx";
import { ROLES } from "./Types.tsx";

export function TypeManufacturer() {
  const { manufacturer: slug } = useParams({ from: "/types/manufacturers/$manufacturer" });
  const { manufacturers } = useTypeEntries();
  const counts = useTypeCounts();
  const visitor = useVisitor();
  const { app } = useApp();
  const info = useTypeInfo();
  const [role, setRole] = useState<TypeRole | "all">("all");
  const manufacturer = manufacturers.find((m) => m.slug === slug);
  if (!manufacturer) return <NotFound />;

  const roles = ROLES.filter((r) => manufacturer.entries.some((e) => e.roles.includes(r)));
  // By name, as useTypeEntries orders them.
  const entries = manufacturer.entries.filter((e) => role === "all" || e.roles.includes(role));
  const codes = manufacturer.entries.flatMap((e) => e.codes);
  const flownTypes = codes.filter((c) => counts.flown.has(c)).length;
  const seenTypes = codes.filter((c) => counts.seen.has(c)).length;

  return (
    <div className={`page types type-manufacturer${visitor ? " types--visitor" : ""}`}>
      <nav className="crumbs">
        <Link to="/types">
          <Icon name="arrow-left" />
          {t("aircraft.types.title")}
        </Link>
      </nav>
      <h1 className="type-page__name">{manufacturer.name}</h1>
      <p className="type-page__lead">
        {headline(
          visitor || flownTypes + seenTypes === 0
            ? t("aircraft.types.manufacturer.lead", { codes: manufacturer.codes, families: manufacturer.families })
            : t("aircraft.types.manufacturer.leadLog", { codes: manufacturer.codes, families: manufacturer.families, flown: flownTypes, seen: seenTypes }),
        )}
      </p>
      {roles.length > 1 && (
        <div className="filters">
          <div className="chips" role="radiogroup" aria-label={t("aircraft.types.role")}>
            {(["all", ...roles] as const).map((r) => (
              <button key={r} type="button" role="radio" aria-checked={role === r} className="chip" onClick={() => setRole(r)}>
                {t("aircraft.types.role.option", { role: r })}
              </button>
            ))}
          </div>
        </div>
      )}
      {/* No silhouette column when none of its types has a drawing, and no log columns when the log has none of them. */}
      <ul className={`rows${entries.some((e) => info?.planform(e.drawn, app.ref)) ? "" : " type-rows--undrawn"}`}>
        {entries.map((e) => (
          <TypeRow key={e.key} entry={e} counts={!visitor && flownTypes + seenTypes > 0} firstFlight />
        ))}
      </ul>
    </div>
  );
}
