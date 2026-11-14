// Aircraft types (docs/31-ui.md, "Aircraft types"), from the More menu: every ICAO type code, the curated families
// grouped (docs/13, "Type figures"). It opens on the manufacturers: the airliners' best known as cards, then every one from
// A to Z, each leading to its page. A search, or the list view, shows the types themselves by manufacturer, a few
// hundred at a time as the page scrolls. "In your log" and a role narrow both.

import { useEffect, useMemo, useRef, useState } from "react";
import type { TypeRole } from "@touchdown/core";
import { t } from "@touchdown/i18n";
import { Link } from "../lib/link.tsx";
import { Icon } from "../lib/icons.tsx";
import { headline } from "../lib/i18n.tsx";
import { useVisitor } from "../lib/visitor.ts";
import { useTypeInfo } from "../lib/typeInfo.ts";
import { useApp } from "../data/context.tsx";
import { fold, manufacturerSlug, useTypeCounts, useTypeEntries, type TypeEntry, type TypeManufacturer } from "../lib/typeEntries.ts";
import { Select } from "../components/Select.tsx";
import { Silhouette } from "../components/Silhouette.tsx";
import { TypeRow } from "../components/TypeRow.tsx";

export const ROLES: TypeRole[] = ["airliner", "business", "light", "helicopter", "military", "other"];
/** The manufacturers shown as cards, the airliners' best known, in alphabetical order: by their addresses. */
const POPULAR = ["airbus", "boeing", "bombardier", "comac", "embraer", "lockheed", "mcdonnell-douglas"];
/** Rows added each time the list's end comes into view. */
const STEP = 200;

/** A manufacturer's counts: "15 types · 2 families". */
export const manufacturerCounts = (m: { codes: number; families: number }) =>
  [t("aircraft.types.count", { count: m.codes }), m.families > 0 && t("aircraft.types.manufacturer.families", { count: m.families })].filter(Boolean).join(" · ");

/** The letter a manufacturer is filed under, without accents; a digit or a sign under #. */
const letterOf = (name: string) => {
  const c = name.normalize("NFKD").replace(/[̀-ͯ]/g, "").charAt(0).toUpperCase();
  return /[A-Z]/.test(c) ? c : "#";
};

export function Types() {
  const { entries, manufacturers } = useTypeEntries();
  const counts = useTypeCounts();
  // A visitor who is not signed in has no log: every type, and no counts.
  const visitor = useVisitor();
  const [q, setQ] = useState("");
  // Every type to start with: "In your log" narrows it.
  const [show, setShow] = useState<"log" | "all">("all");
  const [role, setRole] = useState<TypeRole | "all">("all");
  const [view, setView] = useState<"manufacturers" | "list">("manufacturers");

  const needle = fold(q.trim());
  const shown = useMemo(
    () => entries.filter((e) => (show === "all" || e.flown + e.seen > 0) && (role === "all" || e.roles.includes(role)) && (!needle || e.text.includes(needle))),
    [entries, show, role, needle],
  );
  // A search lists the types it finds, whatever the view.
  const listing = !!needle || view === "list";

  const codes = entries.reduce((n, e) => n + e.codes.length, 0);
  const families = entries.filter((e) => e.family).length;
  const flownTypes = [...counts.flown.keys()].filter((c) => entries.some((e) => e.codes.includes(c))).length;
  const seenTypes = [...counts.seen.keys()].filter((c) => entries.some((e) => e.codes.includes(c))).length;

  return (
    <div className={`page types${visitor ? " types--visitor" : ""}`}>
      <h1 className="lead">
        {headline(visitor ? t("aircraft.types.lead.visitor", { families, codes }) : t("aircraft.types.lead", { families, codes, flown: flownTypes, seen: seenTypes }))}
      </h1>
      <div className="filters" role="search">
        <label className="search">
          <span className="visually-hidden">{t("aircraft.types.search")}</span>
          <Icon name="search" />
          <input className="input" type="search" placeholder={t("aircraft.types.searchPlaceholder")} value={q} onChange={(e) => setQ(e.target.value)} autoComplete="off" />
        </label>
        <div className="chips" role="radiogroup" aria-label={t("aircraft.types.view")}>
          {(["manufacturers", "list"] as const).map((k) => (
            <button key={k} type="button" role="radio" aria-checked={(listing ? "list" : "manufacturers") === k} className="chip" onClick={() => setView(k)} disabled={!!needle}>
              {t("aircraft.types.view.option", { view: k })}
            </button>
          ))}
        </div>
        <Select value={role} onChange={setRole} label={t("aircraft.types.role")} options={(["all", ...ROLES] as const).map((r) => ({ value: r, label: t("aircraft.types.role.option", { role: r }) }))} />
        {!visitor && (
          <div className="chips" role="radiogroup" aria-label={t("aircraft.types.show")}>
            {(["all", "log"] as const).map((k) => (
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
      {!shown.length ? <p className="types__empty">{t("aircraft.types.none")}</p> : listing ? <TypeList entries={shown} counts={!visitor} /> : <Manufacturers entries={shown} all={manufacturers} />}
    </div>
  );
}

/** The manufacturers of the entries shown: the popular ones as cards with three of their types drawn, then every one A to Z. */
function Manufacturers({ entries, all }: { entries: TypeEntry[]; all: TypeManufacturer[] }) {
  const { app } = useApp();
  const info = useTypeInfo();
  const manufacturers = useMemo(() => {
    const of = new Map(all.map((m) => [m.name, m]));
    const by = new Map<string, { manufacturer: TypeManufacturer; entries: TypeEntry[]; codes: number; families: number }>();
    for (const e of entries) {
      const m = by.get(e.manufacturer) ?? by.set(e.manufacturer, { manufacturer: of.get(e.manufacturer)!, entries: [], codes: 0, families: 0 }).get(e.manufacturer)!;
      m.entries.push(e);
      m.codes += e.codes.length;
      if (e.family) m.families++;
    }
    return [...by.values()];
  }, [entries, all]);
  // Those of them the filters leave any types of.
  const main = POPULAR.map((slug) => manufacturers.find((m) => m.manufacturer.slug === slug)).filter((m) => m !== undefined);
  const letters = new Map<string, typeof manufacturers>();
  for (const m of manufacturers) letters.set(letterOf(m.manufacturer.name), [...(letters.get(letterOf(m.manufacturer.name)) ?? []), m]);
  // A card draws the same three of the manufacturer's types whatever the log has: those with a drawing and the most codes.
  const drawn = (list: TypeEntry[]) =>
    list
      .filter((e) => info?.planform(e.usual, app.ref))
      .sort((a, b) => b.codes.length - a.codes.length)
      .slice(0, 3);
  const sortedLetters = [...letters.entries()].sort((a, b) => (a[0] === "#" ? 1 : b[0] === "#" ? -1 : a[0].localeCompare(b[0])));
  return (
    <>
      <section className="section" aria-labelledby="manufacturers-main">
        <div className="section__head">
          <h2 className="section__title" id="manufacturers-main">
            {t("aircraft.types.manufacturers.main")}
          </h2>
        </div>
        <ul className="manufacturer-cards">
          {main.map((m) => (
            <li key={m.manufacturer.slug}>
              <Link className="manufacturer-card" to="/types/manufacturers/$manufacturer" params={{ manufacturer: m.manufacturer.slug }}>
                <span className="manufacturer-card__shapes" aria-hidden="true">
                  {drawn(m.entries).map((e) => (
                    <Silhouette key={e.key} code={e.usual} size={44} />
                  ))}
                </span>
                <b>{m.manufacturer.name}</b>
                <span className="manufacturer-card__count">{manufacturerCounts(m)}</span>
              </Link>
            </li>
          ))}
        </ul>
      </section>
      <section className="section" aria-labelledby="manufacturers-all">
        <div className="section__head">
          <h2 className="section__title" id="manufacturers-all">
            {t("aircraft.types.manufacturers.all")}
          </h2>
        </div>
        {/* A row of the letters, each leading to its manufacturers: the index is long. */}
        <nav className="manufacturer-letters" aria-label={t("aircraft.types.manufacturers.letters")}>
          {sortedLetters.map(([letter]) => (
            <a key={letter} href={`#manufacturers-${letter}`}>
              {letter}
            </a>
          ))}
        </nav>
        <div className="manufacturer-index">
          {sortedLetters.map(([letter, list]) => (
            <div key={letter} className="manufacturer-index__letter" id={`manufacturers-${letter}`}>
              <h3>{letter}</h3>
              <ul>
                {list.map((m) => (
                  <li key={m.manufacturer.slug}>
                    <Link to="/types/manufacturers/$manufacturer" params={{ manufacturer: m.manufacturer.slug }}>
                      {m.manufacturer.name}
                    </Link>
                    <span className="manufacturer-index__count tabular">{m.codes}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </section>
    </>
  );
}

/** The entries by manufacturer, a few hundred at a time: more come as the list's end scrolls into view. */
function TypeList({ entries, counts }: { entries: TypeEntry[]; counts: boolean }) {
  const [limit, setLimit] = useState(STEP);
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => setLimit(STEP), [entries]);
  useEffect(() => {
    const el = end.current;
    if (!el) return;
    const io = new IntersectionObserver((seen) => {
      if (seen.some((s) => s.isIntersecting)) setLimit((l) => l + STEP);
    }, { rootMargin: "800px" });
    io.observe(el);
    return () => io.disconnect();
  }, [limit, entries]);
  const manufacturers: { name: string; entries: TypeEntry[] }[] = [];
  for (const e of entries.slice(0, limit)) {
    const last = manufacturers[manufacturers.length - 1];
    if (last?.name === e.manufacturer) last.entries.push(e);
    else manufacturers.push({ name: e.manufacturer, entries: [e] });
  }
  return (
    <>
      <div className="cols type-row" aria-hidden="true">
        <span />
        <span>{t("aircraft.types.cols.family")}</span>
        <span>{t("aircraft.types.cols.figures")}</span>
        {counts && <span className="num">{t("aircraft.cols.flights")}</span>}
        {counts && <span className="num">{t("aircraft.cols.sightings")}</span>}
      </div>
      {manufacturers.map((m) => (
        <section key={m.name} className="types__manufacturer" aria-label={m.name}>
          <h2 className="types__manufacturer-title">
            <Link to="/types/manufacturers/$manufacturer" params={{ manufacturer: manufacturerSlug(m.name) }}>
              {m.name}
            </Link>
          </h2>
          <ul className="rows">
            {m.entries.map((e) => (
              <TypeRow key={e.key} entry={e} counts={counts} />
            ))}
          </ul>
        </section>
      ))}
      {limit < entries.length && (
        <div ref={end} className="types__more">
          <button type="button" className="btn btn--quiet" onClick={() => setLimit((l) => l + STEP)}>
            {t("aircraft.types.list.more")}
          </button>
        </div>
      )}
    </>
  );
}
