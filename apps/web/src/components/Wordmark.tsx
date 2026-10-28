// The wordmark in the top bar (DESIGN.md, "Wordmark"): the airliner touching down on its gold ground line, and the
// name. Under the mouse pointer the aircraft lands again: it comes in on the approach from the left, flares, touches
// down with a puff of tyre smoke and settles. With reduced motion it stays still.

import { useLayoutEffect, useRef } from "react";
import { AIRLINER, AIRLINER_TRANSFORM, GROUND, MARK_VIEWBOX } from "../lib/wordmark.ts";

const LANDING_MS = 1500;
/** When the wheels meet the runway, as a share of the landing. */
const TOUCH = 0.82;

// The aircraft turns about its main wheels; the ground line stays. It slips back out of sight, reappears on a
// shallow approach, raises its nose in the flare, touches down and settles, the gear taking its weight.
const LANDING: Keyframe[] = [
  { transform: "none", opacity: 1, easing: "ease-in" },
  { transform: "translate(-3px, -1.5px) rotate(2deg)", opacity: 0, offset: 0.1 },
  { transform: "translate(-16px, -6px) rotate(4deg)", opacity: 0, offset: 0.11, easing: "linear" },
  { transform: "translate(-11px, -4px) rotate(4deg)", opacity: 1, offset: 0.3, easing: "cubic-bezier(0.3, 0, 0.6, 1)" },
  { transform: "translate(-2px, -0.8px) rotate(1deg)", offset: 0.7, easing: "ease-out" },
  { transform: "translate(-0.6px, 0) rotate(-2deg)", offset: TOUCH, easing: "ease-in-out" },
  { transform: "translate(-0.2px, 0.35px) rotate(-0.5deg)", offset: 0.9, easing: "ease-out" },
  { transform: "none", opacity: 1 },
];
const SMOKE: Keyframe[] = [
  { opacity: 0, transform: "scale(0.4)" },
  { opacity: 0.5, transform: "scale(1)", offset: 0.25 },
  { opacity: 0, transform: "scale(1.6)" },
];

export function Wordmark() {
  const plane = useRef<SVGGElement>(null);
  const smoke = useRef<SVGGElement>(null);

  useLayoutEffect(() => {
    const g = plane.current;
    const host = g?.closest(".wordmark");
    if (!g || !host) return;
    const land = (e: Event) => {
      if ((e as PointerEvent).pointerType !== "mouse" || g.getAnimations().length) return;
      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
      g.animate(LANDING, { duration: LANDING_MS });
      for (const puff of smoke.current?.children ?? []) puff.animate(SMOKE, { duration: 450, delay: LANDING_MS * TOUCH, easing: "ease-out" });
    };
    host.addEventListener("pointerenter", land);
    return () => host.removeEventListener("pointerenter", land);
  }, []);

  return (
    <>
      <svg className="wordmark__mark" viewBox={MARK_VIEWBOX} aria-hidden="true">
        <path className="wordmark__ground" d={GROUND} />
        <g ref={smoke} className="wordmark__smoke">
          <circle cx="13.6" cy="23.2" r="1.4" />
          <circle cx="11.2" cy="23.5" r="1.1" />
        </g>
        <g ref={plane} className="wordmark__plane">
          <path fill="currentColor" transform={AIRLINER_TRANSFORM} d={AIRLINER} />
        </g>
      </svg>
      <span>Touchdown</span>
    </>
  );
}
