// Compare two aircraft types (docs/31-ui.md, "Aircraft types"): chosen by type code (`?a=A21N&b=B752`), drawn over
// each other at one scale, noses together on one centreline, the first filled and the second as its outline (G11), then
// each figure side by side as a pair of bars with the difference, and their families' history.

import { useMemo } from "react";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { t } from "@touchdown/i18n";
import { useApp } from "../data/context.tsx";
import { Link } from "../lib/link.tsx";
import { Icon } from "../lib/icons.tsx";
import { typeName } from "../lib/format.ts";
import { typeFigures } from "../lib/typeFigures.ts";
import { useTypeInfo, type TypeInfo } from "../lib/typeInfo.ts";
import { drawingOf } from "../components/Silhouette.tsx";
import { TypePicker } from "../components/TypePicker.tsx";
import { hasTypePage, useTypeCounts } from "../lib/typeEntries.ts";

/** The pair Compare starts with when the log has neither flights nor sightings. */
const START = ["A320", "B738"];

/** A type with any of the main figures to compare. */
function withFigures(info: TypeInfo | null, code: string): boolean {
  const s = info?.specs(code);
  return !!(s && (s.lengthM || s.spanM || s.mtowKg));
}

export function TypeCompare() {
  const search = useSearch({ from: "/types/compare" });
  const navigate = useNavigate();
  const { app } = useApp();
  const { ref } = app;
  const info = useTypeInfo();
  const counts = useTypeCounts();
  const unit = app.settings().distanceUnit ?? "km";

  // Every type with figures; the log's most flown and most seen to start with.
  const hasFigures = (code: string) => withFigures(info, code);
  const codes = useMemo(() => [...ref.types.values()].map((x) => x.designator).filter((c) => hasTypePage(ref, c) && withFigures(info, c)), [ref, info]);
  const byCount = (m: Map<string, number>) => [...m.entries()].sort((p, q) => q[1] - p[1]).map(([c]) => c).filter(hasFigures);
  // Without a log to start from (a visitor's page, or an empty log), two airliners most people know.
  const known = START.filter((c) => withFigures(info, c));
  const a = search.a && ref.type(search.a) ? search.a : (byCount(counts.flown)[0] ?? byCount(counts.seen)[0] ?? known[0] ?? codes[0]);
  const b = search.b && ref.type(search.b) ? search.b : (byCount(counts.flown).find((c) => c !== a) ?? byCount(counts.seen).find((c) => c !== a) ?? known.find((c) => c !== a) ?? codes.find((c) => c !== a));
  const choose = (next: { a?: string; b?: string }) => void navigate({ to: "/types/compare", search: { a, b, ...next }, replace: true });

  const sa = info?.specs(a) ?? null;
  const sb = info?.specs(b) ?? null;
  const da = drawingOf(a, info, ref);
  const db = drawingOf(b, info, ref);
  const na = a ? typeName(a, ref) : "";
  const nb = b ? typeName(b, ref) : "";
  const figures = typeFigures(unit);

  // One scale for both, the noses at the top on one centreline: the wider and the longer of the two decide the room.
  const ext = [da?.extent, db?.extent].filter((e): e is [number, number, number, number] => !!e);
  const half = Math.max(1, ...ext.map(([x0, , x1]) => Math.max(-x0, x1)));
  const tall = Math.max(1, ...ext.map(([, , , y1]) => y1));
  const pad = Math.max(half * 2, tall) * 0.05;

  return (
    <div className="page type-compare">
      <nav className="crumbs">
        <Link to="/types">
          <Icon name="arrow-left" />
          {t("aircraft.types.title")}
        </Link>
      </nav>
      <h1 className="type-page__name">{t("aircraft.types.compare.title")}</h1>
      <div className="type-compare__pick">
        <div className="figure-option">
          <span className="figure-option__label" id="compare-first">
            <span className="type-compare__swatch type-compare__swatch--a" />
            {t("aircraft.types.compare.first")}
          </span>
          <TypePicker value={a} codes={codes} onChange={(v) => choose({ a: v })} labelledBy="compare-first" />
        </div>
        <button type="button" className="icon-btn" aria-label={t("aircraft.types.compare.swap")} title={t("aircraft.types.compare.swap")} onClick={() => choose({ a: b, b: a })}>
          <Icon name="arrow-left-right" />
        </button>
        <div className="figure-option">
          <span className="figure-option__label" id="compare-second">
            <span className="type-compare__swatch type-compare__swatch--b" />
            {t("aircraft.types.compare.second")}
          </span>
          <TypePicker value={b} codes={codes} onChange={(v) => choose({ b: v })} labelledBy="compare-second" />
        </div>
      </div>

      {ext.length > 0 && (
        <figure className="type-compare__drawing">
          <svg viewBox={`${-half - pad} ${-pad} ${2 * (half + pad)} ${tall + 2 * pad}`} role="img" aria-label={t("aircraft.types.compare.drawing", { first: na, second: nb })}>
            {/* The second's outline drawn thick, its inside then covered in the panel's colour, so only its outer edge
                shows and not each part's; the first's soft fill over both. */}
            {db && <path className="type-compare__b" d={db.path} fillRule="nonzero" vectorEffect="non-scaling-stroke" />}
            {db && <path className="type-compare__b-inside" d={db.path} fillRule="nonzero" />}
            {da && <path className="type-compare__a" d={da.path} fillRule="nonzero" />}
          </svg>
          <figcaption>{t("aircraft.types.compare.scale")}</figcaption>
        </figure>
      )}

      {sa && sb && (
        <table className="table type-compare__table">
          <thead>
            <tr>
              <th scope="col" />
              <th scope="col">
                <Link to="/types/$code" params={{ code: a! }}>
                  {na}
                </Link>
              </th>
              <th scope="col" className="type-compare__bars-head" />
              <th scope="col">
                <Link to="/types/$code" params={{ code: b! }}>
                  {nb}
                </Link>
              </th>
              <th scope="col" className="num">
                {t("aircraft.types.compare.difference")}
              </th>
            </tr>
          </thead>
          <tbody>
            {figures.map((x) => {
              const va = x.value(sa);
              const vb = x.value(sb);
              if (!x.text(sa) && !x.text(sb)) return null;
              const most = Math.max(va ?? 0, vb ?? 0) || 1;
              return (
                <tr key={x.key}>
                  <th scope="row">{x.label}</th>
                  <td className="tabular">{x.text(sa) ?? "—"}</td>
                  <td className="type-compare__bars" aria-hidden="true">
                    <span className="type-compare__bar type-compare__bar--a" style={{ width: `${((va ?? 0) / most) * 100}%` }} />
                    <span className="type-compare__bar type-compare__bar--b" style={{ width: `${((vb ?? 0) / most) * 100}%` }} />
                  </td>
                  <td className="tabular">{x.text(sb) ?? "—"}</td>
                  <td className="num tabular">{va !== null && vb !== null ? x.diff(vb - va, va) : "—"}</td>
                </tr>
              );
            })}
            <tr>
              <th scope="row">{t("aircraft.types.figure.engines")}</th>
              <td>{sa.engines ?? "—"}</td>
              <td />
              <td>{sb.engines ?? "—"}</td>
              <td />
            </tr>
          </tbody>
        </table>
      )}
    </div>
  );
}
