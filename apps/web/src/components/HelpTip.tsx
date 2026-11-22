// A question mark beside a heading, for what the heading means: its text shows in the app's tooltip on hover, on
// keyboard focus and on a tap (a phone has no hover). A second tap, or a tap anywhere else, puts it away: a phone's
// browser may not focus the button, so it cannot wait for the focus to leave. Screen readers get the same text as the
// button's description.

import { useEffect, useId, useRef } from "react";
import { Icon } from "../lib/icons.tsx";
import { esc, hideTip, showTip, whenTouchedOutside } from "./overlay.tsx";

export function HelpTip({ label, text }: { label: string; text: string }) {
  const id = useId();
  const button = useRef<HTMLButtonElement>(null);
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
  useEffect(() => whenTouchedOutside(button.current!, () => tapped.current && hide()), []);
  return (
    <>
      <button
        type="button"
        ref={button}
        className="help-tip"
        aria-label={label}
        aria-describedby={id}
        onPointerDown={(e) => (finger.current = e.pointerType !== "mouse")}
        onPointerEnter={(e) => e.pointerType === "mouse" && show(e.currentTarget)}
        onPointerLeave={(e) => e.pointerType === "mouse" && hideTip()}
        onFocus={(e) => show(e.currentTarget)}
        onBlur={hide}
        onClick={(e) => {
          if (finger.current && tapped.current) return hide();
          tapped.current = finger.current;
          show(e.currentTarget);
        }}
      >
        <Icon name="circle-help" />
      </button>
      <span id={id} className="visually-hidden">
        {text}
      </span>
    </>
  );
}
