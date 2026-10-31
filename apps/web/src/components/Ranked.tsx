// A ranked list: label, bar, number. The bar shows each count against the largest (styles: .ranked); the
// first few rows show, with "Show all" for the rest and a note of records the count could not include.

import { useState } from "react";
import type { Tally } from "@touchdown/core";
import { nf, plural } from "../lib/format.ts";
import { LeftOut } from "./Facts.tsx";
import { useGrow } from "../lib/motion.ts";

interface Props {
  title: string;
  t: Tally;
  label: (key: string) => string;
  unit: [string, string];
  limit?: number;
  color?: string;
  /** What a left-out record lacks: "airline" gives "3 records left out (no airline)". */
  missing: string;
}

export function Ranked({ title, t, label, unit, limit = 8, color = "var(--flown)", missing }: Props) {
  const [all, setAll] = useState(false);
  const items = all ? t.items : t.items.slice(0, limit);
  const max = t.items[0]?.count ?? 1;
  // "Show all" opens the list as a disclosure opens, so the lists below slide down instead of jumping.
  const grow = useGrow<HTMLOListElement>(all);
  return (
    <section className="ranked">
      <h3 className="ranked__title">{title}</h3>
      {!t.items.length ? (
        <p className="section__aside">Nothing recorded.</p>
      ) : (
        <ol className="ranked__list" ref={grow}>
          {items.map((x) => (
            <li key={x.key} title={`${label(x.key)}: ${plural(x.count, unit[0], unit[1])}`}>
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
        {t.items.length > limit && (
          <button type="button" className="link-btn" onClick={() => setAll((a) => !a)}>
            {all ? "Show fewer" : `Show all ${t.items.length}`}
          </button>
        )}
        <LeftOut m={t} what={missing} />
      </p>
    </section>
  );
}
