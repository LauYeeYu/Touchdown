// Aircraft types (docs/31-ui.md, "Aircraft types"), from the More menu: every ICAO type code, the curated families
// grouped (docs/13, "Type figures"). It opens on the manufacturers: the best known of the role chosen as cards (the
// airliners' for every role), then every one from A to Z, each leading to its page. A search, or the list view, shows the types themselves by manufacturer, a few
// hundred at a time as the page scrolls. "In your log" and a role narrow both.

import { useEffect, useMemo, useRef } from "react";
import { POPULAR_MAKERS, withoutAccents, type TypeRole } from "@touchdown/core";
import { searchMatcher } from "@touchdown/core/view";
import { t } from "@touchdown/i18n";
import { Link } from "../lib/link.tsx";
import { Icon } from "../lib/icons.tsx";
import { headline } from "../lib/i18n.tsx";
import { useVisitor } from "../lib/visitor.ts";
import { useTypeInfo } from "../lib/typeInfo.ts";
import { useApp } from "../data/context.tsx";
import { useViewState } from "../lib/viewState.ts";
import { searched, slugOf, useTypeCounts, useTypeEntries, type TypeEntry, type TypeManufacturer } from "../lib/typeEntries.ts";
import { usePageTitle } from "../lib/title.ts";
import { Select } from "../components/Select.tsx";
import { Silhouette } from "../components/Silhouette.tsx";
import { TypeRow } from "../components/TypeRow.tsx";

export const ROLES: TypeRole[] = ["airliner", "business", "light", "helicopter", "military", "other"];
/** The types a card draws where they are chosen and of the role, in order: else the manufacturer's types with the most codes. */
const CARD_TYPES: Record<string, string[]> = {
  airbus: ["A320", "A333", "A388"],
  boeing: ["B744", "B752", "B763"],
  embraer: ["E75L", "E145", "E195"],
  ilyushin: ["IL14", "IL62", "IL96"],
  lockheed: ["SR71", "L101", "C5"],
  // The DC-8 is Douglas's, from before the merger.
  "mcdonnell-douglas": ["DC86", "DC93", "DC10"],
  tupolev: ["T144", "T154", "T204"],
};
/** Rows added each time the list's end comes into view. */
const STEP = 200;

/** A manufacturer's counts: "15 types · 2 families". */
export const manufacturerCounts = (m: { codes: number; families: number }) =>
  [t("aircraft.types.count", { count: m.codes }), m.families > 0 && t("aircraft.types.manufacturer.families", { count: m.families })].filter(Boolean).join(" · ");

/** The letter a manufacturer is filed under, without accents; a digit or a sign under #. */
const letterOf = (name: string) => {
  const c = withoutAccents(name).charAt(0).toUpperCase();
  return /[A-Z]/.test(c) ? c : "#";
};

export function Types() {
  usePageTitle(t("aircraft.types.title"));
  const all = useTypeEntries();
  const { entries, manufacturers } = all;
  const counts = useTypeCounts();
  // A visitor who is not signed in has no log: every type, and no counts.
  const visitor = useVisitor();
  // Kept with the visit, so Back from a type's page shows the list as it was left (docs/31, "Going back").
  const [q, setQ] = useViewState("q", "");
  // Every type to start with: "In your log" narrows it.
  const [show, setShow] = useViewState<"log" | "all">("show", "all", ["log", "all"]);
  const [role, setRole] = useViewState<TypeRole | "all">("role", "all", ["all", ...ROLES]);
  const [view, setView] = useViewState<"manufacturers" | "list">("view", "manufacturers", ["manufacturers", "list"]);

  const needle = q.trim();
  const search = useMemo(() => searchMatcher(needle), [needle]);
  const shown = useMemo(() => {
    const keep = (e: TypeEntry) => (show === "all" || e.flown + e.seen > 0) && (role === "all" || e.roles.includes(role));
    // A search finds the types it names too, each above its family (lib/typeEntries.ts, `searched`).
    return search ? searched(all, needle, keep) : entries.filter(keep);
  }, [all, entries, show, role, search]);
  // A search lists the types it finds, whatever the view.
  const listing = !!search || view === "list";

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
            <button key={k} type="button" role="radio" aria-checked={(listing ? "list" : "manufacturers") === k} className="chip" onClick={() => setView(k)} disabled={!!search}>
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
      {!shown.length ? <p className="types__empty">{t("aircraft.types.none")}</p> : listing ? <TypeList entries={shown} counts={!visitor} list={`${show}|${role}|${needle}`} /> : <Manufacturers entries={shown} all={manufacturers} role={role} />}
    </div>
  );
}

/**
 * The manufacturers of the entries shown: the popular ones of the role as cards with three of their types drawn, then
 * every one A to Z.
 */
function Manufacturers({ entries, all, role }: { entries: TypeEntry[]; all: TypeManufacturer[]; role: TypeRole | "all" }) {
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
  const letters = new Map<string, typeof manufacturers>();
  for (const m of manufacturers) letters.set(letterOf(m.manufacturer.name), [...(letters.get(letterOf(m.manufacturer.name)) ?? []), m]);
  // A card draws the same three types whatever the log has: those chosen for it, else the manufacturer's types with a
  // drawing and the most codes, each family by its usual type, else by its first of the role. A chosen type the filters
  // leave out gives its place to the next of these. Only a type of the role chosen, drawn with its family's shape or its
  // own: the usual shape of its kind may put its engines in the wrong place.
  const drawable = (code: string) => {
    const p = info?.planform(code, app.ref);
    return !!p && !p.generic && (role === "all" || info?.role(code, app.ref) === role);
  };
  const drawn = (slug: string, list: TypeEntry[]) => {
    const chosen = (CARD_TYPES[slug] ?? []).filter((c) => drawable(c) && entries.some((e) => e.codes.includes(c)));
    const rest = list
      .filter((e) => !e.codes.some((c) => chosen.includes(c)))
      .sort((a, b) => b.codes.length - a.codes.length)
      .flatMap((e) => [e.usual, ...e.codes].find(drawable) ?? []);
    return [...chosen, ...rest].slice(0, 3);
  };
  // The role's popular manufacturers the filters leave a type to draw of: none, and there are no cards.
  const main = POPULAR_MAKERS[role].flatMap((slug) => {
    const m = manufacturers.find((x) => x.manufacturer.slug === slug);
    const shapes = m ? drawn(slug, m.entries) : [];
    return m && shapes.length ? [{ ...m, shapes }] : [];
  });
  const sortedLetters = [...letters.entries()].sort((a, b) => (a[0] === "#" ? 1 : b[0] === "#" ? -1 : a[0].localeCompare(b[0])));
  return (
    <>
      {main.length > 0 && (
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
                  {/* The room of three types, at the card's left as its name: one or two are drawn in its middle. */}
                  <span className="manufacturer-card__shapes" aria-hidden="true">
                    {m.shapes.map((code) => (
                      <Silhouette key={code} code={code} size={44} />
                    ))}
                  </span>
                  <b>{m.manufacturer.name}</b>
                  <span className="manufacturer-card__count">{manufacturerCounts(m)}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
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

/**
 * The entries by manufacturer, a few hundred at a time: more come as the list's end scrolls into view. How many is kept
 * with the visit for the list it was for (`list`, the filters), so Back shows as many rows as were left and the page can
 * scroll back to where it was (docs/31, "Going back"). Another list starts with a few hundred.
 */
function TypeList({ entries, counts, list }: { entries: TypeEntry[]; counts: boolean; list: string }) {
  const [saved, setSaved] = useViewState("rows", { list, rows: STEP });
  const limit = saved.list === list ? saved.rows : STEP;
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = end.current;
    if (!el) return;
    const io = new IntersectionObserver((seen) => {
      if (seen.some((s) => s.isIntersecting)) setSaved({ list, rows: limit + STEP });
    }, { rootMargin: "800px" });
    io.observe(el);
    return () => io.disconnect();
  }, [limit, entries, list]);
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
            <Link to="/types/manufacturers/$manufacturer" params={{ manufacturer: slugOf(m.name) }}>
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
          <button type="button" className="btn btn--quiet" onClick={() => setSaved({ list, rows: limit + STEP })}>
            {t("aircraft.types.list.more")}
          </button>
        </div>
      )}
    </>
  );
}
