// Motion that keeps a change from jarring (DESIGN.md, "Motion"): only where the change would otherwise jump, short, and
// never in the way. With reduced motion, everything here is instant.

import { useLayoutEffect, useRef } from "react";

const still = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** A box's rows: a list's items or a table's body rows. */
const rowsOf = (box: HTMLElement) => [...box.querySelectorAll(":scope > li, :scope tbody > tr")];

/**
 * A box whose height follows its content smoothly when the reader asks for more or less of it ("Show all", "Show
 * fewer"): from the height it had to the height it now needs, as a disclosure opens (280ms, 220ms to close), so what
 * is below slides instead of jumping. The rows it opens to fade in as it does (`.grow-in`). `key` is what the reader
 * changed; other changes (a new period) are instant.
 */
export function useGrow<T extends HTMLElement>(key: unknown) {
  const ref = useRef<T>(null);
  const last = useRef<number | null>(null);
  const before = useRef<Set<Element>>(new Set());
  useLayoutEffect(() => {
    const box = ref.current;
    if (!box) return;
    const from = last.current;
    const to = box.offsetHeight;
    if (from === null || from === to || still()) return;
    const added = to > from ? rowsOf(box).filter((row) => !before.current.has(row)) : [];
    for (const row of added) row.classList.add("grow-in");
    box.style.height = `${from}px`;
    box.style.overflow = "hidden";
    box.getBoundingClientRect();
    box.style.transition = `height ${to > from ? 280 : 220}ms cubic-bezier(0.16, 1, 0.3, 1)`;
    box.style.height = `${to}px`;
    let running = true;
    const stop = () => {
      running = false;
      clearTimeout(timer);
      box.removeEventListener("transitionend", onEnd);
      box.style.height = "";
      box.style.overflow = "";
      box.style.transition = "";
      for (const row of added) row.classList.remove("grow-in");
    };
    const finish = () => {
      stop();
      last.current = box.offsetHeight;
    };
    // Only the box's own height: a ranked bar moving to a new length ends a transition too, and the event bubbles.
    const onEnd = (e: TransitionEvent) => {
      if (e.target === box && e.propertyName === "height") finish();
    };
    box.addEventListener("transitionend", onEnd);
    const timer = setTimeout(finish, 400);
    // The reader's next change, before this one ends or after. By now React has put in the new rows, so the box's own
    // height is already the next one: measured here, the next change would start where it ends and not move. Mid-way,
    // the height on screen (the inline one) is where it starts. Once ended, `finish` has measured it.
    return () => {
      if (!running) return;
      last.current = box.getBoundingClientRect().height;
      stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  // The height and rows after every other change, so the next one starts from what is on screen.
  useLayoutEffect(() => {
    const box = ref.current;
    if (!box) return;
    if (!box.style.height) last.current = box.offsetHeight;
    before.current = new Set(rowsOf(box));
  });
  return ref;
}
