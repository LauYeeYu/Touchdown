// The loading screen (docs/31-ui.md, "Opening"; styles in public/boot.css). Its progress bar is a final approach:
// an aircraft follows the glide path down to the runway. index.html shows the same screen while the app's code
// loads, the aircraft creeping about a third of the way; this one carries it on from where it is, flying on
// smoothly towards each step's progress as the step finishes, says which step is running and lands it. Then the
// runway turns gold and runs out to both edges of the screen, and the screen opens along it over the first page,
// the top lifting away and the bottom dropping.

import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { t } from "@touchdown/i18n";

/** The glide path's length in pixels (boot.css): the aircraft at 100% is this far along it. */
const PATH = 186;

/** How far the page's own bar got before the app's code ran: 0 to 1. */
export function waitingProgress(): number {
  const craft = document.querySelector<HTMLElement>(".boot__bar--waiting .boot__craft");
  return craft ? Math.min(1, (parseFloat(getComputedStyle(craft).translate) || 0) / PATH) : 0;
}

// A Boeing 747 from the side, nose to the right, gear down; the main wheels are at 48.6% across, on the bottom edge.
const PLANE = "M1.2 7.2 3.8 6.5 2.6.6h2.8L12.4 6.6H28.6C30.6 6.6 31.6 5 33.8 5H42.2C45 5 47.4 7 47.7 9.2C47.9 10.3 46.9 10.9 45.4 11.05 44.8 11.1 44.4 11.1 44 11.1H31L29.4 11.5H20.6L19 11.1H12.6C9.6 11.1 5.6 9.2 1.2 7.6ZM1.6 7.1 8.6 7.2 9.6 7.9 2.4 8.1ZM18.8 9.35 30.6 10.55 25 11.35 17.6 9.85ZM25.6 11.6H30.2A1 1 0 0 1 30.2 13.6H25.6A1 1 0 0 1 25.6 11.6ZM27.4 10.8H29.4V11.8H27.4ZM19.4 10.9H23A.9.9 0 0 1 23 12.7H19.4A.9.9 0 0 1 19.4 10.9ZM20.6 10.3H22.4V11.1H20.6ZM23 11.2H23.7V14.2H23ZM42.2 11H42.85V14.3H42.2Z";

// The aircraft flies legs along the path, each an animation of its box's `translate` and its gold's `scale`, which
// the browser runs off the main thread, so it keeps flying while the first page is being drawn. Each time a step
// reports, a new leg starts from where it is, at the speed it is going, towards a point AHEAD of the progress reported
// (a share of the way still to fly), over LEG_MS: it closes on the progress, then creeps on, slowing, and never stops,
// jumps or goes back. Once the page is ready a last leg lands it, by the distance left (LAND_MS), slowing as it
// touches down.
const AHEAD = 0.4;
const LEG_MS = 1400;
const LAND_MS = (left: number) => Math.min(850, Math.max(350, 250 + left * 650));
/** The steepest a leg may start (its easing's first slope); a faster aircraft gets a shorter leg instead. */
const STEEPEST = 4;

// After touchdown: the aircraft raises its nose and rolls (LANDING_MS), then the runway runs out to the edges and the
// screen opens along it (OPENING_MS). The durations are boot.css's.
const LANDING_MS = 160;
const OPENING_MS = 160 + 520;
const still = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** A cubic Bézier easing, as CSS draws one, for working out where a leg's aircraft is and how fast it is going. */
function bezier(x1: number, y1: number, x2: number, y2: number): (x: number) => number {
  const cx = 3 * x1;
  const bx = 3 * (x2 - x1) - cx;
  const ax = 1 - cx - bx;
  const cy = 3 * y1;
  const by = 3 * (y2 - y1) - cy;
  const ay = 1 - cy - by;
  const sx = (t: number) => ((ax * t + bx) * t + cx) * t;
  const sy = (t: number) => ((ay * t + by) * t + cy) * t;
  return (x) => {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    let lo = 0;
    let hi = 1;
    let t = x;
    for (let i = 0; i < 24; i++) {
      t = (lo + hi) / 2;
      if (sx(t) < x) lo = t;
      else hi = t;
    }
    return sy(t);
  };
}

/** One leg: from and to (0 to 1), its start on the document's timeline, its length and its easing. */
interface Leg {
  from: number;
  to: number;
  start: number;
  ms: number;
  ease: (x: number) => number;
}

/** Where a leg's aircraft is at `now`, and its speed (the path's share a millisecond). */
function along(leg: Leg, now: number): [number, number] {
  const x = Math.min(1, Math.max(0, (now - leg.start) / leg.ms));
  const at = leg.from + (leg.to - leg.from) * leg.ease(x);
  if (x >= 1) return [at, 0];
  const a = Math.max(0, x - 0.002);
  const b = Math.min(1, x + 0.002);
  return [at, ((leg.to - leg.from) * (leg.ease(b) - leg.ease(a))) / (b - a) / leg.ms];
}

/** Where the screen opens: the runway's middle and height on the screen, and its share of the screen's width. */
interface Seam {
  x: number;
  y: number;
  from: number;
}

/** `onGone`: once `done`, when the screen has gone and the page under it should stop drawing it. */
export function Boot({ progress, text, done = false, label = t("ui.boot.label"), onGone }: { progress: number; text: string; done?: boolean; label?: string; onGone?: () => void }) {
  const gone = useRef(onGone);
  useEffect(() => {
    gone.current = onGone;
  });
  const screen = useRef<HTMLDivElement>(null);
  const craft = useRef<HTMLSpanElement>(null);
  const fill = useRef<HTMLSpanElement>(null);
  // Where the aircraft starts: where the page's own bar had got to, else the progress first reported.
  const [from] = useState(() => waitingProgress() || Math.min(1, Math.max(0, progress)));
  const leg = useRef<Leg>({ from, to: from, start: 0, ms: 1, ease: (x) => x });
  const legs = useRef<Animation[]>([]);
  const [landed, setLanded] = useState(false);
  const [seam, setSeam] = useState<Seam | null>(null);
  /** Starts a leg to `to` over about `ms`, from where the aircraft is and at its speed; the leg it was flying ends. */
  const fly = (to: number, ms: number): Animation | null => {
    if (!craft.current || !fill.current) return null;
    const now = document.timeline.currentTime as number;
    const [at, speed] = along(leg.current, now);
    if (to - at < 0.0005) return null;
    // The easing's first slope matches the aircraft's speed; a leg that would start steeper than STEEPEST is shortened.
    const length = (speed * ms) / (to - at) > STEEPEST ? (STEEPEST * (to - at)) / speed : ms;
    const y1 = Math.min(0.2 * STEEPEST, ((speed * length) / (to - at)) * 0.2);
    const timing: KeyframeAnimationOptions = { duration: length, easing: `cubic-bezier(0.2, ${y1.toFixed(3)}, 0.3, 1)`, fill: "forwards" };
    const flown = [craft.current.animate([{ translate: `${at * PATH}px 0` }, { translate: `${to * PATH}px 0` }], timing), fill.current.animate([{ scale: `${at} 1` }, { scale: `${to} 1` }], timing)];
    for (const a of flown) a.startTime = now;
    for (const a of legs.current) a.cancel();
    legs.current = flown;
    leg.current = { from: at, to, start: now, ms: length, ease: bezier(0.2, y1, 0.3, 1) };
    return flown[0]!;
  };
  // Legs start before the browser paints, so each reaches the compositor in the next frame, before the first page's own
  // work can hold up the main thread; started later, a leg would arrive late and the aircraft would jump.
  // Each step reported: a leg towards a point ahead of it. With reduced motion the bar jumps to each step instead.
  useLayoutEffect(() => {
    if (done || still()) return;
    const target = Math.min(1, Math.max(0, progress));
    fly(target + (0.97 - target) * AHEAD, LEG_MS);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [progress, done]);
  // Ready: the last leg lands it, and with reduced motion the screen goes at once.
  useLayoutEffect(() => {
    if (!done) {
      setLanded(false);
      setSeam(null);
      return;
    }
    if (still()) return gone.current?.();
    const last = fly(1, LAND_MS(1 - along(leg.current, document.timeline.currentTime as number)[0]));
    if (!last) return setLanded(true);
    last.finished.then(
      () => setLanded(true),
      () => {},
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [done]);
  useEffect(() => () => legs.current.forEach((a) => a.cancel()), []);
  // On the runway: then the screen opens along it.
  useEffect(() => {
    if (!landed) return;
    const timers = [
      setTimeout(() => {
        const runway = screen.current?.querySelector(".boot__runway")?.getBoundingClientRect();
        if (!runway) return gone.current?.();
        setSeam({ x: runway.left + runway.width / 2, y: runway.top + runway.height / 2, from: runway.width / window.innerWidth });
      }, LANDING_MS),
      setTimeout(() => gone.current?.(), LANDING_MS + OPENING_MS),
    ];
    return () => timers.forEach(clearTimeout);
  }, [landed]);
  const pct = Math.round(Math.min(1, Math.max(0, progress)) * 100);
  // The aircraft's place as drawn: fixed while its legs fly it, so a new render does not undo them.
  const p = seam ? 1 : still() ? pct / 100 : from;
  const content = (hidden: boolean): ReactNode => (
    <>
      <p className="boot__mark">Touchdown</p>
      <div className="boot__bar" role={hidden ? undefined : "progressbar"} aria-label={hidden ? undefined : label} aria-valuemin={hidden ? undefined : 0} aria-valuemax={hidden ? undefined : 100} aria-valuenow={hidden ? undefined : pct}>
        <span className="boot__ground" />
        <span className="boot__runway" />
        <span className="boot__glide">
          <span ref={hidden ? undefined : fill} className="boot__fill" style={{ scale: `${p} 1` }} />
          <span ref={hidden ? undefined : craft} className="boot__craft" style={{ translate: `${p * PATH}px 0` }}>
            <svg className="boot__plane" viewBox="0 0 48 15.8" aria-hidden="true">
              <path fill="currentColor" d={PLANE} />
              <circle fill="currentColor" cx="22.45" cy="14.85" r="0.95" />
              <circle fill="currentColor" cx="24.25" cy="14.85" r="0.95" />
              <circle fill="currentColor" cx="42.5" cy="14.95" r="0.85" />
            </svg>
          </span>
        </span>
      </div>
      <p className="boot__text" aria-live={hidden ? undefined : "polite"}>
        {text}
      </p>
    </>
  );
  if (seam) {
    // The screen twice, cut along the runway: the half above lifts away, the half below drops.
    const at = { "--seam-x": `${seam.x}px`, "--seam-y": `${seam.y}px`, "--seam-from": seam.from } as CSSProperties;
    return (
      <>
        <div className="boot boot--done boot--landed boot--half boot--top" style={at} aria-hidden="true">
          {content(true)}
        </div>
        <div className="boot boot--done boot--landed boot--half boot--bottom" style={at} aria-hidden="true">
          {content(true)}
        </div>
        <span className="boot__seam" style={at} />
      </>
    );
  }
  return (
    <div ref={screen} className={`boot${done ? " boot--done" : ""}${landed ? " boot--landed" : ""}`} aria-busy={!done}>
      {content(false)}
    </div>
  );
}

/** Opening the app offline in a browser with no account to open: the copy offline is only for one signed in here. */
export class OfflineWithoutAccount extends Error {
  constructor() {
    super(t("ui.boot.offlineWithoutAccount"));
  }
}

export function BootError({ message, title = t("ui.boot.error") }: { message: string; title?: string }) {
  return (
    <div className="boot" role="alert">
      <p className="boot__mark">Touchdown</p>
      <h1 className="boot__error">{title}</h1>
      <p className="boot__text">{message}</p>
    </div>
  );
}
