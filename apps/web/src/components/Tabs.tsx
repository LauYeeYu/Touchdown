// Tabs with Material's indicator: one 3px bar under the selected label that slides and resizes to the newly
// selected tab. Each label reserves the width of its bold form, so selecting a tab never moves the others.

import { useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { StableLabel } from "./StableLabel.tsx";

interface Props<K extends string> {
  items: [K, string][];
  value: K;
  onChange: (k: K) => void;
  label: string;
}

export function Tabs<K extends string>({ items, value, onChange, label }: Props<K>) {
  const list = useRef<HTMLDivElement>(null);
  const [bar, setBar] = useState<{ x: number; w: number } | null>(null);
  // No slide on the first placement, only when the selection changes afterwards.
  const [ready, setReady] = useState(false);
  const labels = items.map(([, t]) => t).join("|");

  useLayoutEffect(() => {
    const el = list.current;
    if (!el) return;
    const place = () => {
      const t = el.querySelector<HTMLElement>('[aria-selected="true"] .stable-label');
      if (!t) return;
      const lr = el.getBoundingClientRect();
      const tr = t.getBoundingClientRect();
      setBar({ x: tr.left - lr.left + el.scrollLeft, w: tr.width });
    };
    place();
    const ro = new ResizeObserver(place);
    ro.observe(el);
    return () => ro.disconnect();
  }, [value, labels]);

  useLayoutEffect(() => {
    if (!bar || ready) return;
    const id = requestAnimationFrame(() => setReady(true));
    return () => cancelAnimationFrame(id);
  }, [bar, ready]);

  const onKeyDown = (e: KeyboardEvent) => {
    const i = items.findIndex(([k]) => k === value);
    const next = e.key === "ArrowRight" ? i + 1 : e.key === "ArrowLeft" ? i - 1 : e.key === "Home" ? 0 : e.key === "End" ? items.length - 1 : null;
    if (next === null) return;
    e.preventDefault();
    const k = items[(next + items.length) % items.length]![0];
    onChange(k);
    list.current?.querySelector<HTMLElement>(`[data-key="${k}"]`)?.focus();
  };

  return (
    <div className={`tabs${ready ? " is-ready" : ""}`} role="tablist" aria-label={label} ref={list} onKeyDown={onKeyDown}>
      {items.map(([k, text]) => (
        <button key={k} type="button" role="tab" data-key={k} aria-selected={value === k} tabIndex={value === k ? 0 : -1} className="tab" onClick={() => onChange(k)}>
          <StableLabel text={text} />
        </button>
      ))}
      <span className="tabs__indicator" aria-hidden="true" style={bar ? { width: bar.w, transform: `translateX(${bar.x}px)` } : { opacity: 0 }} />
    </div>
  );
}
