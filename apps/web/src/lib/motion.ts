// Motion that keeps a change from jarring (DESIGN.md, "Motion"): only where the change would otherwise jump, short, and
// never in the way. With reduced motion, everything here is instant.

import { useEffect, useLayoutEffect, useRef, type RefObject } from "react";
import { foldedPanel, planformPath, type Pt } from "./silhouette.ts";
import { reducedMotion } from "./reducedMotion.ts";


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
    if (from === null || from === to || reducedMotion()) return;
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

/**
 * A moving part of a type's drawing, as drawn (components/Silhouette.tsx, lib/silhouette.ts `Moving`): a proprotor's
 * `path` its disc edge on, as drawn, and `blades` about the origin, which `proprotorAt` puts in place, and a folding
 * wing's `outline` spread, which `foldedPanel` draws at its angle.
 */
export type TypeMove =
  | { kind: "rotor"; path: string; at: [number, number]; dir: 1 | -1 }
  | { kind: "swing"; path: string; at: [number, number]; angle: number }
  | { kind: "fold"; path: string; outline: Pt[]; hinge: number; thick: number }
  | { kind: "stow"; path: string }
  | { kind: "nacelle"; path: string; at: [number, number]; front: number; back: number; wide: number }
  | { kind: "proprotor"; path: string; blades: string; at: [number, number]; reach: number; dir: 1 | -1 };

/**
 * What a type's moving parts do (docs/31, "Aircraft types"): move while it is hovered (`animated`), or hold still as
 * drawn (`rest`) or where a hover takes them (`moved`), its rotors then spinning.
 */
export type Pose = "animated" | "rest" | "moved";

/**
 * The two poses a type's drawing holds, by what moves in it: wings spread and folded (`fold`), spread and swept back
 * (`swing`), foreplanes extended and retracted (`stow`), a tiltrotor's nacelles forward and upright (`tilt`), or a
 * helicopter's rotors stopped and spinning (`rotor`). Null for a drawing with nothing that moves.
 */
export type Poses = "fold" | "swing" | "stow" | "tilt" | "rotor";

export function posesOf(moves: TypeMove[]): Poses | null {
  const first = moves.find((m) => m.kind !== "rotor" && m.kind !== "proprotor") ?? moves[0];
  if (!first) return null;
  return first.kind === "nacelle" || first.kind === "proprotor" ? "tilt" : first.kind;
}

const n3 = (v: number) => +v.toFixed(3);

/**
 * A tiltrotor's proprotor's blades `up` of the way from forward to upright (0 to 1), turned `angle` degrees: the hub
 * coming back over the spar as the nacelle rises, the disc they turn in opening from edge on to round.
 */
function proprotorAt(m: Extract<TypeMove, { kind: "proprotor" }>, up: number, angle: number): string {
  const tilt = (up * Math.PI) / 2;
  return `translate(${n3(m.at[0])} ${n3(m.at[1] - m.reach * Math.cos(tilt))}) scale(1 ${n3(Math.sin(tilt))}) rotate(${angle.toFixed(2)})`;
}

/**
 * How far up a tiltrotor's nacelle turns before its proprotor shows as blades: nearly level, a turning proprotor is a
 * disc edge on, as a propeller is drawn, its blades a line too thin to see.
 */
const BLADES_FROM = 0.15;

/**
 * A tiltrotor's nacelle `up` of the way from forward to upright: from above, as long as its length shows at that angle
 * and its width as it rises, its middle coming back over the spar, so upright it is a circle as wide as it is.
 */
function nacelleAt(m: Extract<TypeMove, { kind: "nacelle" }>, up: number): string {
  const tilt = (up * Math.PI) / 2;
  const [length, mid] = [m.back - m.front, (m.front + m.back) / 2];
  const shown = length * Math.cos(tilt) + m.wide * Math.sin(tilt);
  return `translate(0 ${n3(m.at[1] + (mid - m.at[1]) * Math.cos(tilt))}) scale(1 ${n3(shown / length)}) translate(0 ${n3(-mid)})`;
}

/** A rotor at speed, degrees a second: a turn in about 0.9 seconds, which the eye can still follow. */
const ROTOR_SPEED = 400;
/**
 * How quickly each part answers, as an exponential's time constant in seconds: a rotor spins up in about a second and
 * coasts to a stop in about two and a half, a swing wing sweeps back in about half a second, as the one easing does,
 * and spreads again a little quicker, folding wings fold up as quickly and spread as quickly, foreplanes fold away in a
 * third of a second, and a tiltrotor's nacelles turn up in about three quarters of a second and down a little quicker.
 */
const TIMES = { rotorUp: 0.35, rotorDown: 0.6, swingIn: 0.16, swingOut: 0.12, foldUp: 0.16, foldDown: 0.12, stow: 0.1, tiltUp: 0.22, tiltDown: 0.16 };

/**
 * A type's moving parts doing what they do (DESIGN.md, "Motion"): its rotors spin up and coast down, a swing wing sweeps
 * back to its swept angle and spreads again, folding wings fold up and spread again, foreplanes fold into the fuselage,
 * a tiltrotor's nacelles turn up, its proprotors spinning up as they do. `animated`, they move while what holds the
 * drawing is hovered or has the keyboard's focus: its row or card, its link or its figure. Held in a `pose`, they move
 * there and stay, and a page that opens in one shows it at once. Each moving part is a path of `svg` marked
 * `data-moving`, in the order of `moves`. For reduced motion nothing moves: a pose is taken at once, and rotors stay
 * still.
 */
export function useTypeMotion(svg: RefObject<SVGSVGElement | null>, moves: TypeMove[], pose: Pose = "animated") {
  const held = useRef(pose);
  const wake = useRef<(() => void) | null>(null);
  useEffect(() => {
    held.current = pose;
    wake.current?.();
  }, [pose]);
  useEffect(() => {
    const el = svg.current;
    if (!el || !moves.length) return;
    const instant = reducedMotion();
    const host = el.closest<HTMLElement | SVGElement>("a, tr, .card, figure") ?? el;
    const paths = [...el.querySelectorAll<SVGPathElement>("[data-moving]")];
    const about = (at: [number, number]) => `${+at[0].toFixed(3)} ${+at[1].toFixed(3)}`;
    // Each part's state: a rotor's angle and speed, or how far a wing or foreplane has gone, 0 to 1.
    const state = moves.map(() => ({ angle: 0, speed: 0, done: 0 }));
    let hovered = false;
    // The first frame takes the pose the page opens in at once.
    let snap = true;
    let frame = 0;
    let last = 0;
    const step = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const on = held.current === "animated" ? hovered && !instant : held.current === "moved";
      const at = instant || snap;
      snap = false;
      const ease = (tau: number) => (at ? 1 : 1 - Math.exp(-dt / tau));
      let moving = false;
      moves.forEach((m, i) => {
        const s = state[i]!;
        const path = paths[i];
        if (!path) return;
        if (m.kind === "rotor" || m.kind === "proprotor") {
          s.speed += ((on && !instant ? ROTOR_SPEED : 0) - s.speed) * ease(on ? TIMES.rotorUp : TIMES.rotorDown);
          if (!on && s.speed < 6) s.speed = 0;
          s.angle = (s.angle + s.speed * m.dir * dt) % 360;
          if (s.speed) moving = true;
          if (m.kind === "rotor") {
            path.setAttribute("transform", `rotate(${s.angle.toFixed(2)} ${about(m.at)})`);
            return;
          }
        }
        const target = on ? 1 : 0;
        const tau =
          m.kind === "stow" ? TIMES.stow
          : m.kind === "nacelle" || m.kind === "proprotor" ? (on ? TIMES.tiltUp : TIMES.tiltDown)
          : m.kind === "fold" ? (on ? TIMES.foldUp : TIMES.foldDown)
          : on ? TIMES.swingIn : TIMES.swingOut;
        s.done += (target - s.done) * ease(tau);
        if (Math.abs(target - s.done) < 0.002) s.done = target;
        else moving = true;
        // Turning up, the blades; nearly level again, the disc.
        if (m.kind === "proprotor") {
          const blades = s.done >= BLADES_FROM;
          path.setAttribute("d", blades ? m.blades : m.path);
          if (blades) path.setAttribute("transform", proprotorAt(m, s.done, s.angle));
          else path.removeAttribute("transform");
        }
        else if (m.kind === "nacelle" && s.done) path.setAttribute("transform", nacelleAt(m, s.done));
        // A folding wing's outline, as it shows at its angle.
        else if (m.kind === "fold") path.setAttribute("d", s.done ? planformPath(foldedPanel(m.outline, m.hinge, m.thick, s.done)) : m.path);
        else if (!s.done) path.removeAttribute("transform");
        else if (m.kind === "swing") path.setAttribute("transform", `rotate(${(m.angle * s.done).toFixed(2)} ${about(m.at)})`);
        // Folded in across the fuselage's centreline, at x = 0.
        else path.setAttribute("transform", `scale(${Math.max(0.001, 1 - s.done).toFixed(3)} 1)`);
      });
      frame = moving ? requestAnimationFrame(step) : 0;
    };
    const run = () => {
      if (!frame) {
        last = performance.now();
        frame = requestAnimationFrame(step);
      }
    };
    wake.current = run;
    run();
    const enter = () => {
      hovered = true;
      run();
    };
    const leave = () => {
      hovered = false;
      run();
    };
    // Focus within the host, as a link in a row or a card has it; leaving it for another part of the host is not leaving.
    const blur = (e: Event) => {
      if (!host.contains((e as FocusEvent).relatedTarget as Node | null)) leave();
    };
    host.addEventListener("pointerenter", enter);
    host.addEventListener("pointerleave", leave);
    host.addEventListener("focusin", enter);
    host.addEventListener("focusout", blur);
    return () => {
      wake.current = null;
      cancelAnimationFrame(frame);
      host.removeEventListener("pointerenter", enter);
      host.removeEventListener("pointerleave", leave);
      host.removeEventListener("focusin", enter);
      host.removeEventListener("focusout", blur);
    };
  }, [svg, moves]);
}
