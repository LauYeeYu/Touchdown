// Aircraft types (docs/31-ui.md, "Aircraft types"), from the More menu: the reference data's families, by maker, each
// with its silhouette (G11), its type codes, the span of its main figures (from Wikipedia, docs/13, "Type figures") and
// how often the log has it, flown and seen. A family opens its most logged type's page.

import { useMemo, useState } from "react";
import { t } from "@touchdown/i18n";
import { useApp } from "../data/context.tsx";
import { Link } from "../lib/link.tsx";
import { Icon } from "../lib/icons.tsx";
import { headline } from "../lib/i18n.tsx";
import { nf } from "../lib/format.ts";
import { familyTypes, metres, metresBetween, spanOf } from "../lib/typeFigures.ts";
import { useTypeInfo } from "../lib/typeInfo.ts";
import { useVisitor } from "../lib/visitor.ts";
import { Silhouette } from "../components/Silhouette.tsx";

/** How often the log has each type code: flights flown on it, sightings of it. */
export function useTypeCounts() {
  const { app, version } = useApp();
  return useMemo(() => {
    const flown = new Map<string, number>();
    const seen = new Map<string, number>();
    for (const f of app.store.all("flights")) if (f.typeCode) flown.set(f.typeCode, (flown.get(f.typeCode) ?? 0) + 1);
    for (const s of app.store.all("sightings")) if (s.typeCode) seen.set(s.typeCode, (seen.get(s.typeCode) ?? 0) + 1);
    return { flown, seen };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [app.store, version]);
}

export function Types() {
  const { app } = useApp();
  const { ref } = app;
  const info = useTypeInfo();
  const counts = useTypeCounts();
  // A visitor who is not signed in has no log: every family, and no counts.
  const visitor = useVisitor();
  const [q, setQ] = useState("");

  const families = useMemo(
    () =>
      [...ref.families.values()]
        .map((fam) => {
          const codes = familyTypes(ref, fam.id, info);
          const flown = codes.reduce((n, c) => n + (counts.flown.get(c) ?? 0), 0);
          const seen = codes.reduce((n, c) => n + (counts.seen.get(c) ?? 0), 0);
          // The type a family opens: the one the log has most, else the first with figures, else the first. Its
          // drawing is that type's, else the next most logged type's that has one.
          const logged = [...codes].sort((a, b) => (counts.flown.get(b) ?? 0) + (counts.seen.get(b) ?? 0) - ((counts.flown.get(a) ?? 0) + (counts.seen.get(a) ?? 0)));
          const main = (flown + seen > 0 ? logged[0] : codes.find((c) => info?.specs(c)?.lengthM)) ?? codes[0];
          const drawn = [main, ...logged].find((c) => info?.planform(c, ref)) ?? main;
          return { fam, codes, flown, seen, main, drawn };
        })
        .filter((x) => x.codes.length > 0),
    [ref, counts, info],
  );
  const inLog = families.filter((x) => x.flown + x.seen > 0);
  const [show, setShow] = useState<"log" | "all">(() => (inLog.length && !visitor ? "log" : "all"));
  const flownTypes = new Set(families.flatMap((x) => x.codes.filter((c) => counts.flown.has(c)))).size;
  const seenTypes = new Set(families.flatMap((x) => x.codes.filter((c) => counts.seen.has(c)))).size;

  const needle = q.trim().toLowerCase().replace(/[\s-]+/g, "");
  const shown = families.filter((x) => (show === "all" || x.flown + x.seen > 0) && (!needle || [x.fam.name, x.fam.manufacturer, ...x.codes, ...x.codes.map((c) => ref.type(c)?.name ?? "")].join("|").toLowerCase().replace(/[\s-]+/g, "").includes(needle)));
  const makers = [...new Set(shown.map((x) => x.fam.manufacturer))];

  return (
    <div className={`page types${visitor ? " types--visitor" : ""}`}>
      <h1 className="lead">
        {headline(
          visitor
            ? t("aircraft.types.lead.visitor", { families: families.length, codes: families.reduce((n, x) => n + x.codes.length, 0) })
            : t("aircraft.types.lead", { families: families.length, codes: families.reduce((n, x) => n + x.codes.length, 0), flown: flownTypes, seen: seenTypes }),
        )}
      </h1>
      <div className="filters" role="search">
        <label className="search">
          <span className="visually-hidden">{t("aircraft.types.search")}</span>
          <Icon name="search" />
          <input className="input" type="search" placeholder={t("aircraft.types.searchPlaceholder")} value={q} onChange={(e) => setQ(e.target.value)} autoComplete="off" />
        </label>
        {!visitor && (
          <div className="chips" role="radiogroup" aria-label={t("aircraft.types.show")}>
            {(["log", "all"] as const).map((k) => (
              <button key={k} type="button" role="radio" aria-checked={show === k} className="chip" onClick={() => setShow(k)}>
                {t("aircraft.types.show.option", { show: k })}
              </button>
            ))}
          </div>
        )}
        <Link className="btn btn--quiet btn--small" to="/types/compare">
          <Icon name="arrow-left-right" />
          {t("aircraft.types.compare")}
        </Link>
      </div>
      {!shown.length ? (
        <p className="types__empty">{t("aircraft.types.none")}</p>
      ) : (
        <div className="cols type-row" aria-hidden="true">
          <span />
          <span>{t("aircraft.types.cols.family")}</span>
          <span>{t("aircraft.types.cols.figures")}</span>
          {!visitor && <span className="num">{t("aircraft.cols.flights")}</span>}
          {!visitor && <span className="num">{t("aircraft.cols.sightings")}</span>}
        </div>
      )}
      {makers.map((maker) => (
        <section key={maker} className="types__maker" aria-labelledby={`maker-${maker}`}>
          <h2 className="types__maker-title" id={`maker-${maker}`}>
            {maker}
          </h2>
          <ul className="rows">
            {shown
              .filter((x) => x.fam.manufacturer === maker)
              .map(({ fam, codes, flown, seen, main, drawn }) => {
                const specs = codes.map((c) => info?.specs(c) ?? null);
                const length = spanOf(specs.map((s) => s?.lengthM ?? null), metres, metresBetween);
                const seats = spanOf(specs.map((s) => s?.seatsTypical ?? s?.seatsMax ?? null), (n) => nf.format(n));
                return (
                  <li key={fam.id}>
                    <Link className="row type-row" to="/types/$code" params={{ code: main! }}>
                      <Silhouette code={drawn} size={52} className="type-row__shape" />
                      <span className="type-row__name">
                        <b>{fam.name}</b>
                        <span className="type-row__codes">{codes.join(" · ")}</span>
                      </span>
                      <span className="type-row__figures">
                        {[length && t("aircraft.types.row.length", { length }), seats && t("aircraft.types.row.seats", { seats })].filter(Boolean).join(" · ")}
                      </span>
                      {!visitor && (
                        <span className="row__num tabular">
                          {flown > 0 && <span className="dot dot--flown" />}
                          {flown || "—"}
                        </span>
                      )}
                      {!visitor && (
                        <span className="row__num tabular">
                          {seen > 0 && <span className="dot dot--spotted" />}
                          {seen || "—"}
                        </span>
                      )}
                    </Link>
                  </li>
                );
              })}
          </ul>
        </section>
      ))}
    </div>
  );
}
