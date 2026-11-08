// A modal dialog's backdrop: a click outside the card closes it, as Escape does. Only a click that starts and ends
// outside counts, so selecting text in the card and letting go outside it closes nothing, and a click outside while a
// list in the card is open (a select's options) closes that list only.

import { useEffect, useRef, type MouseEvent, type PointerEvent } from "react";

/** Handlers for a modal `<dialog>`: `close` runs on a click on its backdrop. */
export function useBackdropClose(close: () => void) {
  const downOutside = useRef(false);
  const listOpen = useRef(false);

  // Whether a list was open when the press began, noted before anything else hears it: a select closes its list on
  // the same press, before the dialog's own handler runs.
  useEffect(() => {
    const note = () => {
      listOpen.current = !!document.querySelector(":popover-open");
    };
    window.addEventListener("pointerdown", note, true);
    return () => window.removeEventListener("pointerdown", note, true);
  }, []);

  // The backdrop belongs to the dialog element: a click there targets the dialog itself, outside its box.
  const outside = (e: MouseEvent<HTMLDialogElement>) => {
    if (e.target !== e.currentTarget) return false;
    const r = e.currentTarget.getBoundingClientRect();
    return e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom;
  };
  return {
    onPointerDown: (e: PointerEvent<HTMLDialogElement>) => {
      downOutside.current = outside(e) && !listOpen.current;
    },
    onClick: (e: MouseEvent<HTMLDialogElement>) => {
      if (downOutside.current && outside(e)) close();
      downOutside.current = false;
    },
  };
}
