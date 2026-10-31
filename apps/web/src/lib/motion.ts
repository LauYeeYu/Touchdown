// Motion that keeps a change from jarring (DESIGN.md, "Motion"): only where the change would otherwise jump, short, and
// never in the way. With reduced motion, everything here is instant.

import { useLayoutEffect, useRef } from "react";

const still = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * A box whose height follows its content smoothly when the reader asks for more or less of it ("Show all", "Show
 * fewer"): from the height it had to the height it now needs, as a disclosure opens (280ms, 220ms to close), so what
 * is below slides instead of jumping. `key` is what the reader changed; other changes (a new period) are instant.
 */
export function useGrow<T extends HTMLElement>(key: unknown) {
  const ref = useRef<T>(null);
  const last = useRef<number | null>(null);
  useLayoutEffect(() => {
    const box = ref.current;
    if (!box) return;
    const from = last.current;
    const to = box.offsetHeight;
    if (from === null || from === to || still()) return;
    box.style.height = `${from}px`;
    box.style.overflow = "hidden";
    box.getBoundingClientRect();
    box.style.transition = `height ${to > from ? 280 : 220}ms cubic-bezier(0.16, 1, 0.3, 1)`;
    box.style.height = `${to}px`;
    const end = () => {
      box.style.height = "";
      box.style.overflow = "";
      box.style.transition = "";
      box.removeEventListener("transitionend", end);
      last.current = box.offsetHeight;
    };
    box.addEventListener("transitionend", end);
    const timer = setTimeout(end, 400);
    return () => {
      clearTimeout(timer);
      end();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  // The height after every other change, so the next one starts from what is on screen.
  useLayoutEffect(() => {
    if (ref.current && !ref.current.style.height) last.current = ref.current.offsetHeight;
  });
  return ref;
}
