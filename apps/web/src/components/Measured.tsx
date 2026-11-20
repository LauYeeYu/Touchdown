// A type's figure with the same figure in other units (docs/31-ui.md, "Aircraft types"): "76.25 m", and "250 ft 2 in"
// in the app's tooltip, under it, while the pointer is over it, or after a tap (a phone has no hover) until the next
// one. Screen readers read the other units after the figure.

import { list, t } from "@touchdown/i18n";
import { esc, hideTip, showTip } from "./overlay.tsx";

export function Measured({ text, others }: { text: string; others: string[] }) {
  if (!others.length) return <>{text}</>;
  const show = (el: HTMLElement) => {
    const r = el.getBoundingClientRect();
    showTip(`<strong>${others.map(esc).join(" · ")}</strong>`, r.left - 6, r.bottom - 8);
  };
  return (
    <span
      className="measured"
      onPointerEnter={(e) => e.pointerType === "mouse" && show(e.currentTarget)}
      onPointerLeave={(e) => e.pointerType === "mouse" && hideTip()}
      onPointerUp={(e) => {
        if (e.pointerType === "mouse") return;
        show(e.currentTarget);
        // The next tap anywhere puts it away.
        setTimeout(() => document.addEventListener("pointerdown", hideTip, { once: true, capture: true }));
      }}
    >
      {text}
      <span className="visually-hidden"> {t("aircraft.types.otherUnits", { units: list(others, "unit") })}</span>
    </span>
  );
}
