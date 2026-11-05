// A ranked list: label, bar, number. The bar shows each count against the largest (styles: .ranked); the
// first few rows show, with "Show all" for the rest and a note of records the count could not include.

import { useState } from "react";
import type { Tally } from "@touchdown/core";
import { t } from "@touchdown/i18n";
import { nf } from "../lib/format.ts";
import { LeftOut } from "./Facts.tsx";
import { useGrow } from "../lib/motion.ts";

interface Props {
  title: string;
  t: Tally;
  label: (key: string) => string;
  /** A row's count with its noun, for the row's tooltip: `(n) => t("common.count.flights", { count: n })`. */
  count: (n: number) => string;
  limit?: number;
  color?: string;
  /** What a left-out record lacks: "airline" gives "3 records left out (no airline)". */
  missing: string;
}

export function Ranked({ title, t: tally, label, count, limit = 8, color = "var(--flown)", missing }: Props) {
  const [all, setAll] = useState(false);
  const items = all ? tally.items : tally.items.slice(0, limit);
  const max = tally.items[0]?.count ?? 1;
  // "Show all" opens the list as a disclosure opens, so the lists below slide down instead of jumping.
  const grow = useGrow<HTMLOListElement>(all);
  return (
    <section className="ranked">
      <h3 className="ranked__title">{title}</h3>
      {!tally.items.length ? (
        <p className="section__aside">{t("stats.ranked.nothing")}</p>
      ) : (
        <ol className="ranked__list" ref={grow}>
          {items.map((x) => (
            <li key={x.key} title={t("stats.ranked.tip", { label: label(x.key), count: count(x.count) })}>
              <span className="ranked__label">{label(x.key)}</span>
              <span className="ranked__bar" aria-hidden="true">
                <span style={{ width: `${(x.count / max) * 100}%`, background: color }} />
              </span>
              <span className="ranked__num tabular">{nf.format(x.count)}</span>
            </li>
          ))}
        </ol>
      )}
      <p className="ranked__foot">
        {tally.items.length > limit && (
          <button type="button" className="link-btn" onClick={() => setAll((a) => !a)}>
            {all ? t("stats.showFewer") : t("stats.showAll", { count: tally.items.length })}
          </button>
        )}
        <LeftOut m={tally} what={missing} />
      </p>
    </section>
  );
}
