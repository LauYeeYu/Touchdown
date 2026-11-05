// A list to choose items from, as a file manager chooses files. A click chooses only the item. Ctrl-click (⌘-click on a
// Mac), or a click on the item's box, adds or removes it. Shift-click chooses every item from the last one clicked,
// and with Ctrl or ⌘ adds them to what is chosen. On a touch screen a tap adds or removes. From the keyboard: the
// arrows, Home and End move, Space adds or removes, Shift with an arrow or Space chooses up to the item, and Ctrl-A or
// ⌘-A chooses all (or none, when all are chosen). `PickAll` is the one button for all of it. The words around it
// (what is chosen, how to choose) are the caller's, and `pickHint` gives the platform for them.

import { useRef, useState, type KeyboardEvent, type MouseEvent, type ReactNode } from "react";
import { Icon } from "../lib/icons.tsx";

/** The device, for the words that say how to choose: a touch screen, a Mac (⌘) or another computer (Ctrl). */
export function pickHint(): { touch: "yes" | "no"; mac: "yes" | "no" } {
  const touch = typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches;
  const mac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.userAgent);
  return { touch: touch ? "yes" : "no", mac: mac ? "yes" : "no" };
}

/**
 * One button for all of a list, a box as each row has: empty when nothing is chosen, a dash when some are, a tick
 * when all are. A click chooses all, or none when all are chosen.
 */
export function PickAll({ total, chosen, onAll, onNone, label }: { total: number; chosen: number; onAll: () => void; onNone: () => void; label: string }) {
  const all = total > 0 && chosen >= total;
  const state = all ? "true" : chosen > 0 ? "mixed" : "false";
  return (
    <button type="button" className="pick__all" role="checkbox" aria-checked={state} disabled={!total} onClick={all ? onNone : onAll}>
      <span className="pick__box" aria-hidden="true">
        {state === "true" ? <Icon name="check" /> : state === "mixed" ? <Icon name="minus" /> : null}
      </span>
      <span className="pick__all-label">{label}</span>
    </button>
  );
}

interface Modifiers {
  shiftKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
}

export function PickList<T>({ items, keyOf, chosen, onChange, label, render }: { items: T[]; keyOf: (item: T) => string; chosen: ReadonlySet<string>; onChange: (next: Set<string>) => void; label: string; render: (item: T) => ReactNode }) {
  const [anchor, setAnchor] = useState<number | null>(null);
  const [focus, setFocus] = useState(0);
  const rows = useRef<(HTMLLIElement | null)[]>([]);
  const touched = useRef(false);

  const range = (a: number, b: number) => items.slice(Math.min(a, b), Math.max(a, b) + 1).map(keyOf);

  function choose(i: number, m: Modifiers, toggle: boolean) {
    const key = keyOf(items[i]!);
    const adding = toggle || m.ctrlKey || m.metaKey;
    if (m.shiftKey && anchor !== null) {
      const next = new Set(adding ? chosen : []);
      for (const k of range(anchor, i)) next.add(k);
      onChange(next);
    } else if (adding) {
      const next = new Set(chosen);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      onChange(next);
      setAnchor(i);
    } else {
      onChange(new Set([key]));
      setAnchor(i);
    }
    setFocus(i);
  }

  function moveTo(i: number, extend: boolean) {
    const to = Math.max(0, Math.min(items.length - 1, i));
    setFocus(to);
    rows.current[to]?.focus();
    rows.current[to]?.scrollIntoView({ block: "nearest" });
    if (extend) {
      const from = anchor ?? focus;
      const next = new Set(chosen);
      for (const k of range(from, to)) next.add(k);
      onChange(next);
      if (anchor === null) setAnchor(from);
    }
  }

  function onKey(e: KeyboardEvent, i: number) {
    const k = e.key;
    if (k === "ArrowDown" || k === "ArrowUp") moveTo(i + (k === "ArrowDown" ? 1 : -1), e.shiftKey);
    else if (k === "Home" || k === "End") moveTo(k === "Home" ? 0 : items.length - 1, e.shiftKey);
    else if (k === " ") choose(i, { shiftKey: e.shiftKey, ctrlKey: true, metaKey: false }, true);
    else if ((k === "a" || k === "A") && (e.ctrlKey || e.metaKey)) onChange(chosen.size === items.length ? new Set() : new Set(items.map(keyOf)));
    else return;
    e.preventDefault();
  }

  return (
    <ul className="pick__list" role="listbox" aria-multiselectable="true" aria-label={label}>
      {items.map((item, i) => {
        const on = chosen.has(keyOf(item));
        return (
          <li
            key={keyOf(item)}
            ref={(el) => {
              rows.current[i] = el;
            }}
            className="pick__row"
            role="option"
            aria-selected={on}
            tabIndex={i === Math.min(focus, items.length - 1) ? 0 : -1}
            onPointerDown={(e) => {
              touched.current = e.pointerType === "touch";
            }}
            // Shift-click would otherwise select the text between.
            onMouseDown={(e: MouseEvent) => {
              if (e.shiftKey) e.preventDefault();
            }}
            onClick={(e) => choose(i, e, touched.current)}
            onKeyDown={(e) => onKey(e, i)}
          >
            <span
              className="pick__box"
              aria-hidden="true"
              onClick={(e) => {
                e.stopPropagation();
                choose(i, e, true);
              }}
            >
              {on && <Icon name="check" />}
            </span>
            {render(item)}
          </li>
        );
      })}
    </ul>
  );
}
