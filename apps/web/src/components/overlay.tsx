// One tooltip and one toast for the whole app. d3 event handlers call showTip/hideTip/toast directly.

import { useEffect, useRef, useState } from "react";

let tipEl: HTMLDivElement | null = null;
/** What a tap on the tooltip opens, while it shows what a finger's tap opens. */
let tipOpen: (() => void) | null = null;

/**
 * Shows the tooltip at a point: below and to the right of a mouse's pointer, or for a finger (`touch`) above it and
 * centred on it, where the hand does not cover it, else below it when there is no room above. For a finger, `open` is
 * what a second tap on the same thing opens: a tap on the tooltip opens it too, a larger target than a thin route.
 */
export function showTip(html: string, x: number, y: number, touch = false, open?: () => void) {
  if (!tipEl) return;
  tipEl.innerHTML = html;
  tipOpen = touch && open ? open : null;
  tipEl.classList.toggle("is-tappable", !!tipOpen);
  tipEl.classList.add("is-on");
  const r = tipEl.getBoundingClientRect();
  let left = touch ? x - r.width / 2 : x + 14;
  let top = touch ? y - r.height - 36 : y + 14;
  if (touch) {
    left = Math.min(left, window.innerWidth - r.width - 8);
    if (top < 8) top = y + 36;
  } else {
    if (left + r.width > window.innerWidth - 8) left = x - r.width - 14;
    if (top + r.height > window.innerHeight - 8) top = y - r.height - 14;
  }
  tipEl.style.left = `${Math.max(8, left)}px`;
  tipEl.style.top = `${Math.max(8, top)}px`;
}

export function hideTip() {
  tipOpen = null;
  tipEl?.classList.remove("is-on");
}

/** A tap on the tooltip opens what it shows, when a finger's tap showed it with something to open (`showTip`). */
function openTip() {
  const open = tipOpen;
  if (!open) return;
  hideTip();
  open();
}

/**
 * Calls `away` when a finger touches the page outside `el` and the tooltip, to put away what a tap on `el` showed
 * before the page scrolls under the finger (a mouse puts it away on leaving). Returns the remover.
 */
export function whenTouchedOutside(el: Element, away: () => void): () => void {
  const down = (e: PointerEvent) => {
    const at = e.target as Node;
    if (e.pointerType !== "mouse" && !el.contains(at) && !tipEl?.contains(at)) away();
  };
  document.addEventListener("pointerdown", down);
  return () => document.removeEventListener("pointerdown", down);
}

/** Escape text for tooltip HTML. */
export function esc(s: unknown): string {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

let pushToast: ((text: string) => void) | null = null;

export function toast(text: string) {
  pushToast?.(text);
}

export function Overlays() {
  const tip = useRef<HTMLDivElement>(null);
  const [text, setText] = useState("");
  const [on, setOn] = useState(false);
  useEffect(() => {
    tipEl = tip.current;
    let timer: ReturnType<typeof setTimeout>;
    pushToast = (t) => {
      setText(t);
      setOn(true);
      clearTimeout(timer);
      timer = setTimeout(() => setOn(false), 2800);
    };
    const onScroll = () => hideTip();
    window.addEventListener("scroll", onScroll, { passive: true });
    // Only the full-screen element is drawn while one is full screen (the globe): the tooltip moves into it,
    // and back when it leaves.
    const home = tip.current!.parentElement!;
    const onFullscreen = () => {
      hideTip();
      const into = document.fullscreenElement ?? home;
      if (tip.current && tip.current.parentElement !== into) into.appendChild(tip.current);
    };
    document.addEventListener("fullscreenchange", onFullscreen);
    return () => {
      window.removeEventListener("scroll", onScroll);
      document.removeEventListener("fullscreenchange", onFullscreen);
      tipEl = null;
      pushToast = null;
    };
  }, []);
  return (
    <>
      <div className="tooltip" ref={tip} role="tooltip" onClick={openTip} />
      <div className={`toast${on ? " is-on" : ""}`} role="status" aria-live="polite">
        {text}
      </div>
    </>
  );
}
