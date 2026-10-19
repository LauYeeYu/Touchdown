// Paging for long lists: a page of items at a time, with previous / next and page numbers. The page goes back
// to the first one when the list itself changes (a new filter, a new period).

import { useEffect, useRef, useState } from "react";
import { nf } from "../lib/format.ts";
import { Icon } from "../lib/icons.tsx";

export function usePaging<T>(items: T[], size: number, resetKey: string) {
  const [page, setPage] = useState(1);
  const top = useRef<HTMLDivElement>(null);
  useEffect(() => setPage(1), [resetKey]);
  const pages = Math.max(1, Math.ceil(items.length / size));
  const current = Math.min(page, pages);
  const start = (current - 1) * size;
  const go = (p: number) => {
    setPage(Math.max(1, Math.min(pages, p)));
    // Back to the top of the list, not the top of the page.
    const el = top.current;
    if (el && el.getBoundingClientRect().top < 0) el.scrollIntoView({ block: "start" });
  };
  return { slice: items.slice(start, start + size), page: current, pages, start, total: items.length, size, go, top };
}

/** Page numbers to show: all when few, else the first, the last and a window around the current one. */
function pageList(page: number, pages: number): (number | "gap")[] {
  if (pages <= 7) return Array.from({ length: pages }, (_, i) => i + 1);
  const out: (number | "gap")[] = [1];
  const from = Math.max(2, page - 1);
  const to = Math.min(pages - 1, page + 1);
  if (from > 2) out.push("gap");
  for (let p = from; p <= to; p++) out.push(p);
  if (to < pages - 1) out.push("gap");
  out.push(pages);
  return out;
}

export function Pager({ paging, noun }: { paging: ReturnType<typeof usePaging<unknown>>; noun: [string, string] }) {
  const { page, pages, start, total, size, go } = paging;
  if (total <= size) return null;
  const end = Math.min(total, start + size);
  return (
    <nav className="pager" aria-label={`Pages of ${noun[1]}`}>
      <span className="pager__count">
        {nf.format(start + 1)}–{nf.format(end)} of {nf.format(total)} {total === 1 ? noun[0] : noun[1]}
      </span>
      <span className="pager__pages">
        <button type="button" className="icon-btn" onClick={() => go(page - 1)} disabled={page === 1} aria-label="Previous page">
          <Icon name="arrow-left" />
        </button>
        {pageList(page, pages).map((p, i) =>
          p === "gap" ? (
            <span key={`gap${i}`} className="pager__gap" aria-hidden="true">
              …
            </span>
          ) : (
            <button key={p} type="button" className="pager__num" aria-current={p === page ? "page" : undefined} onClick={() => go(p)} aria-label={`Page ${p}`}>
              {p}
            </button>
          ),
        )}
        <button type="button" className="icon-btn" onClick={() => go(page + 1)} disabled={page === pages} aria-label="Next page">
          <Icon name="arrow-right" />
        </button>
      </span>
    </nav>
  );
}
