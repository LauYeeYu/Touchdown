// A question mark beside a heading, for what the heading means: its text shows in the app's tooltip on hover, on
// keyboard focus and on a tap (a phone has no hover). Screen readers get the same text as the button's description.

import { useId } from "react";
import { Icon } from "../lib/icons.tsx";
import { esc, hideTip, showTip } from "./overlay.tsx";

export function HelpTip({ label, text }: { label: string; text: string }) {
  const id = useId();
  const show = (el: HTMLElement) => {
    const r = el.getBoundingClientRect();
    showTip(esc(text), r.left - 6, r.bottom - 8);
  };
  return (
    <>
      <button
        type="button"
        className="help-tip"
        aria-label={label}
        aria-describedby={id}
        onPointerEnter={(e) => e.pointerType === "mouse" && show(e.currentTarget)}
        onPointerLeave={(e) => e.pointerType === "mouse" && hideTip()}
        onFocus={(e) => show(e.currentTarget)}
        onBlur={hideTip}
        onClick={(e) => show(e.currentTarget)}
      >
        <Icon name="circle-help" />
      </button>
      <span id={id} className="visually-hidden">
        {text}
      </span>
    </>
  );
}
