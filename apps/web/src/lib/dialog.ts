// A modal dialog's backdrop: a click outside the card closes it, as Escape does. Only a click that starts and ends
// outside counts, so selecting text in the card and letting go outside it closes nothing, and a click outside while a
// list in the card is open (a select's options) closes that list only.
//
// A dialog arrives and leaves with a short fade (app.css, "Dialogs arriving and leaving"): its arrival is CSS alone,
// and `leave` holds it on the screen while it fades out, before it closes and its page takes it away.

import { useCallback, useEffect, useRef, type MouseEvent, type PointerEvent, type SyntheticEvent } from "react";

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

/** Milliseconds a dialog takes to leave (app.css, `[data-leaving]`). */
export const LEAVE_MS = 160;

/**
 * Close a modal dialog as it leaves: the card and its backdrop fade out (`data-leaving`), then it closes and `then`
 * runs. At once with reduced motion, or when it is not open. Asked again while it leaves, it does nothing more.
 */
export function leave(d: HTMLDialogElement | null, then?: () => void) {
  if (!d?.open) return then?.();
  if (d.hasAttribute("data-leaving")) return;
  const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  d.setAttribute("data-leaving", "");
  window.setTimeout(
    () => {
      // Cleared in the same moment it closes, so it arrives again as new if it is opened again.
      d.removeAttribute("data-leaving");
      d.close();
      then?.();
    },
    still ? 0 : LEAVE_MS,
  );
}

/**
 * A modal dialog that leaves before its page takes it away: `ref` for the `<dialog>`, `close` for everything that
 * closes it (its buttons, a save), and `props` for Escape and the backdrop, which leave the same way. `onClose` runs
 * once, after it has left. Escape, a close or a click that comes up from a dialog inside it (React passes events on
 * through its tree, as from the image dialog over the Share dialog) is that dialog's, not this one's.
 */
export function useModal(onClose: () => void) {
  const ref = useRef<HTMLDialogElement>(null);
  const latest = useRef(onClose);
  useEffect(() => {
    latest.current = onClose;
  });
  const gone = useRef(false);
  const end = useCallback(() => {
    if (gone.current) return;
    gone.current = true;
    latest.current();
  }, []);
  const close = useCallback(() => leave(ref.current, end), [end]);
  const backdrop = useBackdropClose(close);
  const own = (e: SyntheticEvent<HTMLDialogElement>) => e.target === e.currentTarget;
  const props = {
    ...backdrop,
    onCancel: (e: SyntheticEvent<HTMLDialogElement>) => {
      if (!own(e)) return;
      e.preventDefault();
      close();
    },
    // Closed some other way (the browser), without leaving: the page still takes it away.
    onClose: (e: SyntheticEvent<HTMLDialogElement>) => {
      if (own(e)) end();
    },
  };
  return { ref, close, props };
}
