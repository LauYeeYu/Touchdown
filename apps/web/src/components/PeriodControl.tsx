// Period control (docs/31-ui.md): segmented buttons while they fit, at most the three most recent years
// plus "All time"; older years in an "Earlier" menu; one menu button on very narrow screens. The selected
// segment is shown by fill and check, and every segment reserves room for its longest label, so the
// control never changes width when the selection changes.

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Icon } from "../lib/icons.tsx";

const label = (y: string) => (y === "all" ? "All time" : y);

interface Props {
  year: string;
  years: string[];
  onChange: (y: string) => void;
}

function Segments({ year, years, k, onPick, onMenu, menuOpen, triggerRef }: {
  year: string;
  years: string[];
  k: number;
  onPick?: (y: string) => void;
  onMenu?: () => void;
  menuOpen?: boolean;
  triggerRef?: React.Ref<HTMLButtonElement>;
}) {
  if (k === 0) {
    return (
      <div className="segmented" role="group" aria-label="Period">
        <button type="button" className="seg seg--menu" aria-haspopup="menu" aria-expanded={!!menuOpen} aria-pressed="true" onClick={onMenu} ref={triggerRef}>
          <Icon name="check" className="seg__check" />
          <span className="seg__label" data-ghost="All time">
            <span>{label(year)}</span>
          </span>
          <Icon name="chevron-down" className="seg__chev" />
        </button>
      </div>
    );
  }
  const recent = years.slice(-k);
  const earlier = years.slice(0, years.length - recent.length);
  const pickedEarlier = earlier.includes(year);
  const ghost = earlier.reduce((a, b) => (a.length >= b.length ? a : b), "Earlier");
  return (
    <div className="segmented" role="group" aria-label="Period">
      {earlier.length > 0 && (
        <button type="button" className="seg seg--menu" aria-haspopup="menu" aria-expanded={!!menuOpen} aria-pressed={pickedEarlier} onClick={onMenu} ref={triggerRef}>
          <Icon name="check" className="seg__check" />
          <span className="seg__label" data-ghost={ghost}>
            <span>{pickedEarlier ? year : "Earlier"}</span>
          </span>
          <Icon name="chevron-down" className="seg__chev" />
        </button>
      )}
      {[...recent, "all"].map((y) => (
        <button key={y} type="button" className="seg" data-year={y} aria-pressed={y === year} onClick={() => onPick?.(y)}>
          <Icon name="check" className="seg__check" />
          {label(y)}
        </button>
      ))}
    </div>
  );
}

export function PeriodControl({ year, years, onChange }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const measure = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const maxK = Math.min(3, years.length);
  const [k, setK] = useState(maxK);
  const [open, setOpen] = useState(false);
  const key = years.join(",");

  useLayoutEffect(() => {
    const fit = () => {
      if (!host.current || !measure.current) return;
      const avail = host.current.clientWidth;
      const kids = [...measure.current.children] as HTMLElement[];
      let best = 0;
      for (let i = 0; i < kids.length; i++) {
        if (kids[i]!.getBoundingClientRect().width <= avail) {
          best = maxK - i;
          break;
        }
      }
      setK(best);
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(host.current!);
    return () => ro.disconnect();
  }, [key, maxK]);

  const recent = k ? years.slice(-k) : [];
  const menuYears = k === 0 ? [...years, "all"].reverse() : years.slice(0, years.length - recent.length).reverse();

  useEffect(() => {
    if (!open) return;
    const items = [...(menu.current?.querySelectorAll<HTMLButtonElement>(".menu__item") ?? [])];
    (items.find((i) => i.getAttribute("aria-checked") === "true") ?? items[0])?.focus();
    const outside = (e: PointerEvent) => {
      if (!menu.current?.contains(e.target as Node) && !trigger.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", outside, true);
    return () => document.removeEventListener("pointerdown", outside, true);
  }, [open]);

  const pick = (y: string) => {
    setOpen(false);
    if (y !== year) onChange(y);
  };

  const onMenuKey = (e: React.KeyboardEvent) => {
    const items = [...(menu.current?.querySelectorAll<HTMLButtonElement>(".menu__item") ?? [])];
    const i = items.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      items[(i + (e.key === "ArrowDown" ? 1 : items.length - 1)) % items.length]?.focus();
    } else if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
      trigger.current?.focus();
    } else if (e.key === "Tab") setOpen(false);
  };

  if (!years.length) return <div className="period-host" ref={host} />;

  return (
    <div className="period-host" ref={host}>
      <div className="period-measure" ref={measure} aria-hidden="true">
        {Array.from({ length: maxK }, (_, i) => (
          <Segments key={i} year={year} years={years} k={maxK - i} />
        ))}
      </div>
      <div className="period">
        <Segments year={year} years={years} k={k} onPick={pick} onMenu={() => setOpen((o) => !o)} menuOpen={open} triggerRef={trigger} />
        {open && menuYears.length > 0 && (
          <div className="menu" role="menu" aria-label={k === 0 ? "Period" : "Earlier years"} ref={menu} onKeyDown={onMenuKey} style={{ left: trigger.current?.offsetLeft ?? 0 }}>
            {menuYears.map((y) => (
              <button key={y} type="button" role="menuitemradio" className="menu__item" aria-checked={y === year} onClick={() => pick(y)}>
                <Icon name="check" className="menu__check" />
                {label(y)}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
