// A family's type codes side by side (docs/31-ui.md, "Aircraft types"), on a type's page and on the family's own: each
// drawn to one scale, with its figures, its engines and what the log has of it, and on a type's page each figure's
// difference from that type's. A code without figures (the 787-3, never built) has dashes.

import { t } from "@touchdown/i18n";
import { useApp } from "../data/context.tsx";
import { Link } from "../lib/link.tsx";
import { nf, typeName } from "../lib/format.ts";
import { typeFigures } from "../lib/typeFigures.ts";
import { noFigures, useTypeInfo } from "../lib/typeInfo.ts";
import type { TypeCounts } from "../lib/typeEntries.ts";
import { Silhouette } from "./Silhouette.tsx";

/** `current`: the type whose page this is, which the others' differences are from; null on the family's page. */
export function TypeFamilyTable({ codes, current, counts, visitor, rotor }: { codes: string[]; current: string | null; counts: TypeCounts; visitor: boolean; rotor: boolean }) {
  const { app } = useApp();
  const { ref } = app;
  const info = useTypeInfo();
  const figures = typeFigures(rotor);
  const figuresOf = (c: string) => info?.specs(c) ?? noFigures(c);
  const compared = current !== null && !!info?.specs(current);
  // Drawn to one scale: the largest fills the column's width.
  const largest = Math.max(1, ...codes.map((c) => Math.max(info?.specs(c)?.spanM ?? 0, info?.specs(c)?.lengthM ?? 0)));
  const scale = 84 / largest;
  return (
    <>
      {/* On a type's page: how many codes and what they are compared with. The family's own page says it in its lead. */}
      {current && <p className="type-family__intro">{t("aircraft.types.family.intro", { count: codes.length, name: typeName(current, ref), compared: compared ? "yes" : "no" })}</p>}
      <div className="table-scroll">
        {/* Equal columns, at least 112px each, the figures' names kept in view while the codes scroll on a phone. */}
        <table className="table type-family" style={{ minWidth: 160 + codes.length * 112 }}>
          <colgroup>
            <col className="type-family__label-col" />
            {codes.map((c) => (
              <col key={c} />
            ))}
          </colgroup>
          <thead>
            <tr>
              <th scope="col" />
              {codes.map((c) => (
                <th key={c} scope="col">
                  <Link to="/types/$code" params={{ code: c }} className="type-family__head" aria-current={c === current ? "page" : undefined}>
                    <span className="type-family__shape">
                      <Silhouette code={c} scale={scale} />
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
              const own = current ? x.value(figuresOf(current)) : null;
              if (!codes.some((c) => x.text(figuresOf(c)))) return null;
              return (
                <tr key={x.key}>
                  <th scope="row">{x.label}</th>
                  {codes.map((c) => {
                    const s = figuresOf(c);
                    const v = x.value(s);
                    // The difference only where there is one: a figure the same as this type's has none under it.
                    const diff = c !== current && v !== null && own !== null ? x.diff(v - own, own) : null;
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
              {codes.map((c) => (
                <td key={c} className="type-family__engines">
                  {figuresOf(c).engines ?? "—"}
                </td>
              ))}
            </tr>
            {!visitor && (
              <tr>
                <th scope="row">{t("aircraft.types.family.inLog")}</th>
                {codes.map((c) => (
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
    </>
  );
}
