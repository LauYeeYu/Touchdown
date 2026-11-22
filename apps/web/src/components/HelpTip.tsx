// Words about something on the page, in the app's tooltip: on hover for a mouse, on keyboard focus, and on a tap for a
// finger, since a phone has no hover and never shows a `title`. A second tap, or a tap anywhere else, puts them away: a
// phone's browser may not focus the button, so it cannot wait for the focus to leave. Screen readers get the same words
// as the button's description. `HelpTip` puts them behind a question mark beside a heading or a control; `Hint` on the
// words or swatch they are about, such as a legend's item.

import { useEffect, useId, useRef, type FocusEvent, type MouseEvent, type PointerEvent, type ReactNode } from "react";
import { Icon } from "../lib/icons.tsx";
import { esc, hideTip, showTip, whenTouchedOutside } from "./overlay.tsx";

/** The button's handlers and its description, for `text` in the app's tooltip. */
function useTip(text: string) {
  const id = useId();
  const ref = useRef<HTMLButtonElement>(null);
  // Shown by a tap, and whether the last press was a finger's.
  const tapped = useRef(false);
  const finger = useRef(false);
  const show = (el: HTMLElement) => {
    const r = el.getBoundingClientRect();
    showTip(esc(text), r.left - 6, r.bottom - 8);
  };
  const hide = () => {
    tapped.current = false;
    hideTip();
  };
  useEffect(() => whenTouchedOutside(ref.current!, () => tapped.current && hide()), []);
  return {
    props: {
      ref,
      type: "button" as const,
      "aria-describedby": id,
      onPointerDown: (e: PointerEvent) => (finger.current = e.pointerType !== "mouse"),
      onPointerEnter: (e: PointerEvent<HTMLButtonElement>) => e.pointerType === "mouse" && show(e.currentTarget),
      onPointerLeave: (e: PointerEvent) => e.pointerType === "mouse" && hideTip(),
      onFocus: (e: FocusEvent<HTMLButtonElement>) => show(e.currentTarget),
      onBlur: hide,
      onClick: (e: MouseEvent<HTMLButtonElement>) => {
        if (finger.current && tapped.current) return hide();
        tapped.current = finger.current;
        show(e.currentTarget);
      },
    },
    description: (
      <span id={id} className="visually-hidden">
        {text}
      </span>
    ),
  };
}

/**
 * A question mark that shows `text`. `touch`: only where there is no hover, beside a control whose own `title` says
 * the same to a mouse, as a tap on the control does what it is for.
 */
export function HelpTip({ label, text, touch = false }: { label: string; text: string; touch?: boolean }) {
  const tip = useTip(text);
  return (
    <>
      <button className={`help-tip${touch ? " help-tip--touch" : ""}`} aria-label={label} {...tip.props}>
        <Icon name="circle-help" />
      </button>
      {tip.description}
    </>
  );
}

/** Its content, which shows `text` when pointed at or tapped: a legend's item, a note beside a heading. */
export function Hint({ text, className = "", children }: { text: string; className?: string; children: ReactNode }) {
  const tip = useTip(text);
  return (
    <>
      <button className={`hint${className ? ` ${className}` : ""}`} {...tip.props}>
        {children}
      </button>
      {tip.description}
    </>
  );
}
