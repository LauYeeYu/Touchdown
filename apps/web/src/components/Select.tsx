// A select drawn as the site's own menu (DESIGN.md, "Selects" and "Menus"): a button showing the chosen option, and
// a listbox on the menu surface under it. The trigger keeps the native select's look (the `select` class and its
// chevron) and, like a native select, is as wide as its longest option unless its place sets a width. The list opens
// in the top layer (popover), so no scrolling box or dialog clips it, below the button or above it when there is
// more room there, inside a 16px margin from the screen's sides. Keys as a native select's: arrows, Home, End,
// Page Up and Down, typing to jump, Enter or Space to choose, Escape to close. onChange is called only when the
// value changes.

import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { Icon } from "../lib/icons.tsx";

export interface SelectOption<T extends string = string> {
  value: T;
  label: string;
  disabled?: boolean;
}

/** Options under a heading, as an optgroup. */
export interface SelectGroup<T extends string = string> {
  group: string;
  options: SelectOption<T>[];
}

export type SelectItem<T extends string = string> = SelectOption<T> | SelectGroup<T>;

interface Props<T extends string> {
  value: T;
  options: readonly SelectItem<T>[];
  onChange: (value: T) => void;
  /** The control's name, as a native select's aria-label or label. */
  label?: string;
  /** Or the id of an element that names it. */
  labelledBy?: string;
  /** Classes for the button, after `select`. */
  className?: string;
}

const SIDE = 16; // from the screen's left and right edges
const EDGE = 12; // from its top and bottom
const GAP = 6; // between the button and the list
const MAX_HEIGHT = 434; // ten options and half of the next, so a longer list shows that it scrolls
const TYPE_PAUSE = 600; // ms between key presses that still add to the typed text

const isGroup = <T extends string>(i: SelectItem<T>): i is SelectGroup<T> => "group" in i;

type Start = "current" | "first" | "last" | { typed: string };

export function Select<T extends string>({ value, options, onChange, label, labelledBy, className = "" }: Props<T>) {
  const id = useId();
  const labelId = labelledBy ?? `${id}-label`;
  const valueId = `${id}-value`;
  const listId = `${id}-list`;
  const trigger = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const start = useRef<Start>("current");
  const typed = useRef({ text: "", at: 0 });

  const flat = options.flatMap((i) => (isGroup(i) ? i.options : [i]));
  // A value no option has shows the first option, as a native select does.
  const current = flat.find((o) => o.value === value) ?? flat.find((o) => !o.disabled);
  const ghosts = [...new Set(flat.map((o) => o.label))];

  const optionEls = () => [...(list.current?.querySelectorAll<HTMLElement>("[role=option]") ?? [])];
  const enabled = (els: HTMLElement[], i: number) => i >= 0 && i < els.length && els[i]!.getAttribute("aria-disabled") !== "true";

  /** Show the option (scrolling the list only, never the page) and focus it. */
  const focusOption = (el: HTMLElement | undefined) => {
    const box = list.current;
    if (!el || !box) return;
    const pad = 6;
    if (el.offsetTop - pad < box.scrollTop) box.scrollTop = el.offsetTop - pad;
    else if (el.offsetTop + el.offsetHeight + pad > box.scrollTop + box.clientHeight) box.scrollTop = el.offsetTop + el.offsetHeight + pad - box.clientHeight;
    el.focus({ preventScroll: true });
  };

  /** The option the typed text leads to: the next one starting with it, or with its letter when one key is repeated. */
  const typeAhead = (key: string, from: number) => {
    const now = Date.now();
    const t = typed.current;
    t.text = now - t.at > TYPE_PAUSE ? key : t.text + key;
    t.at = now;
    const q = t.text.toLocaleLowerCase();
    const els = optionEls();
    const n = els.length;
    const starts = (i: number, s: string) => enabled(els, i) && (els[i]!.dataset.label ?? "").toLocaleLowerCase().startsWith(s);
    // A longer text may still match the option already reached; one letter moves on to the next.
    const first = q.length > 1 ? Math.max(from, 0) : from + 1;
    for (let k = 0; k < n; k++) {
      const i = (first + k + n) % n;
      if (starts(i, q)) return els[i];
    }
    if ([...q].every((c) => c === q[0])) {
      for (let k = 1; k <= n; k++) {
        const i = (from + k + n) % n;
        if (starts(i, q[0]!)) return els[i];
      }
    }
    return undefined;
  };

  /** Place the list under the button, or over it when that has more room; keep it on screen. */
  const place = () => {
    const t = trigger.current;
    const box = list.current;
    if (!t || !box) return;
    const r = t.getBoundingClientRect();
    const vv = window.visualViewport;
    const top = vv ? vv.offsetTop : 0;
    const bottom = vv ? vv.offsetTop + vv.height : window.innerHeight;
    const width = document.documentElement.clientWidth;
    box.style.maxWidth = `${width - 2 * SIDE}px`;
    box.style.minWidth = `${Math.min(r.width, width - 2 * SIDE)}px`;
    // Measured at full height, then put back where the list was scrolled to.
    const scrolled = box.scrollTop;
    box.style.maxHeight = "none";
    const natural = Math.min(box.offsetHeight, MAX_HEIGHT);
    const below = bottom - r.bottom - GAP - EDGE;
    const above = r.top - top - GAP - EDGE;
    const down = natural <= below || below >= above;
    const height = Math.max(Math.min(natural, down ? below : above), Math.min(natural, 120));
    box.style.maxHeight = `${height}px`;
    box.scrollTop = scrolled;
    box.style.top = `${down ? r.bottom + GAP : r.top - GAP - height}px`;
    box.style.left = `${Math.max(SIDE, Math.min(r.left, width - SIDE - box.offsetWidth))}px`;
    box.dataset.side = down ? "below" : "above";
  };

  const openWith = (s: Start) => {
    start.current = s;
    setOpen(true);
  };

  const close = (refocus: boolean) => {
    setOpen(false);
    if (refocus) trigger.current?.focus();
  };

  const choose = (o: SelectOption<T> | undefined) => {
    if (!o || o.disabled) return;
    close(true);
    if (o.value !== value) onChange(o.value);
  };

  // Opened: into the top layer, placed, the starting option focused.
  useLayoutEffect(() => {
    const box = list.current;
    if (!open || !box) return;
    try {
      box.showPopover();
    } catch {
      // Without the popover API the list is still fixed in place, above the page.
    }
    place();
    const els = optionEls();
    const s = start.current;
    const at = els.findIndex((el) => el.getAttribute("aria-selected") === "true");
    let target: HTMLElement | undefined;
    if (s === "first") target = els.find((_, i) => enabled(els, i));
    else if (s === "last") target = [...els].reverse().find((el) => el.getAttribute("aria-disabled") !== "true");
    else if (typeof s === "object") target = typeAhead(s.typed, at);
    target ??= enabled(els, at) ? els[at] : els.find((_, i) => enabled(els, i));
    // The chosen option sits in the middle of a list that scrolls, not at its edge.
    if (target && box.scrollHeight > box.clientHeight) box.scrollTop = target.offsetTop - (box.clientHeight - target.offsetHeight) / 2;
    if (target) focusOption(target);
    else box.focus({ preventScroll: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // While open: follow the button when the page scrolls or resizes, close on a press anywhere else.
  useEffect(() => {
    if (!open) return;
    let frame = 0;
    const follow = (e: Event) => {
      if (e.target instanceof Node && list.current?.contains(e.target)) return;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(place);
    };
    const outside = (e: PointerEvent) => {
      const t = e.target as Node;
      if (list.current?.contains(t) || trigger.current?.contains(t)) return;
      // The button's own label opens and closes it, as the button does.
      if ([...(trigger.current?.labels ?? [])].some((l) => l.contains(t))) return;
      close(false);
    };
    window.addEventListener("scroll", follow, true);
    window.addEventListener("resize", follow);
    window.visualViewport?.addEventListener("resize", follow);
    window.visualViewport?.addEventListener("scroll", follow);
    document.addEventListener("pointerdown", outside, true);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", follow, true);
      window.removeEventListener("resize", follow);
      window.visualViewport?.removeEventListener("resize", follow);
      window.visualViewport?.removeEventListener("scroll", follow);
      document.removeEventListener("pointerdown", outside, true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const printable = (e: React.KeyboardEvent) => e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey;

  const onTriggerKey = (e: React.KeyboardEvent) => {
    if (open) return;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") openWith("current");
    else if (e.key === "Home") openWith("first");
    else if (e.key === "End") openWith("last");
    else if (printable(e) && e.key !== " ") openWith({ typed: e.key });
    else return;
    e.preventDefault();
  };

  const onListKey = (e: React.KeyboardEvent) => {
    const els = optionEls();
    let i = els.indexOf(document.activeElement as HTMLElement);
    if (i < 0) i = els.findIndex((el) => el.getAttribute("aria-selected") === "true");
    /** The option `by` enabled options away, or the last one there is that way. */
    const step = (from: number, by: number) => {
      const dir = by > 0 ? 1 : -1;
      let to = -1;
      for (let k = from + dir, moved = 0; k >= 0 && k < els.length && moved < Math.abs(by); k += dir) {
        if (enabled(els, k)) {
          to = k;
          moved++;
        }
      }
      return to >= 0 ? els[to] : undefined;
    };
    const typing = Date.now() - typed.current.at < TYPE_PAUSE && typed.current.text !== "";
    if (e.key === "ArrowDown") focusOption(step(i, 1));
    else if (e.key === "ArrowUp") focusOption(step(i, -1));
    else if (e.key === "PageDown") focusOption(step(i, 10));
    else if (e.key === "PageUp") focusOption(step(i, -10));
    else if (e.key === "Home") focusOption(step(-1, 1));
    else if (e.key === "End") focusOption(step(els.length, -1));
    else if (e.key === "Enter" || (e.key === " " && !typing)) choose(flat[i]);
    else if (e.key === "Escape") {
      e.stopPropagation();
      close(true);
    } else if (e.key === "Tab") {
      // Focus goes on from the button, as it would from a native select.
      close(true);
      return;
    } else if (printable(e)) focusOption(typeAhead(e.key, i));
    else return;
    e.preventDefault();
  };

  const option = (o: SelectOption<T>) => {
    const selected = o === current;
    return (
      <div
        key={o.value}
        role="option"
        tabIndex={-1}
        className="menu__item select-menu__option"
        aria-selected={selected}
        aria-disabled={o.disabled || undefined}
        data-label={o.label}
        onClick={() => choose(o)}
        onPointerMove={(e) => {
          if (e.pointerType === "mouse" && !o.disabled && document.activeElement !== e.currentTarget) e.currentTarget.focus({ preventScroll: true });
        }}
      >
        <Icon name="check" className="menu__check" />
        <span className="select-menu__label">{o.label}</span>
      </div>
    );
  };

  return (
    <>
      <button
        ref={trigger}
        type="button"
        className={`select${className ? ` ${className}` : ""}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-labelledby={`${labelId} ${valueId}`}
        onClick={() => (open ? close(false) : openWith("current"))}
        onKeyDown={onTriggerKey}
      >
        <span className="select__value">
          <span id={valueId}>{current?.label ?? ""}</span>
          {ghosts.map((g) => (
            <span key={g} className="select__ghost" aria-hidden="true">
              {g}
            </span>
          ))}
        </span>
      </button>
      {!labelledBy && (
        <span id={labelId} hidden>
          {label}
        </span>
      )}
      {open && (
        <div
          ref={list}
          id={listId}
          role="listbox"
          tabIndex={-1}
          popover="manual"
          className="menu select-menu"
          aria-labelledby={labelId}
          onKeyDown={onListKey}
          // Inside a <label>, a press here must not reach the label, which would press the button again.
          onClick={(e) => e.preventDefault()}
          onBlur={(e) => {
            // Focus moved to another control closes it. Focus left to nothing, or to a box around the button (a press
            // on its text), is a press, which the press outside decides.
            const to = e.relatedTarget as Node | null;
            if (!to || list.current?.contains(to) || to.contains(trigger.current)) return;
            close(false);
          }}
        >
          {options.map((item, n) =>
            isGroup(item) ? (
              <div key={`group-${n}`} role="group" aria-labelledby={`${id}-group-${n}`} className="select-menu__group">
                <div id={`${id}-group-${n}`} className="select-menu__heading" role="presentation">
                  {item.group}
                </div>
                {item.options.map(option)}
              </div>
            ) : (
              option(item)
            ),
          )}
        </div>
      )}
    </>
  );
}
