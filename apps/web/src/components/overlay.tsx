// One tooltip and one toast for the whole app. d3 event handlers call showTip/hideTip/toast directly.

import { useEffect, useRef, useState } from "react";

let tipEl: HTMLDivElement | null = null;

export function showTip(html: string, x: number, y: number) {
  if (!tipEl) return;
  tipEl.innerHTML = html;
  tipEl.classList.add("is-on");
  const r = tipEl.getBoundingClientRect();
  let left = x + 14;
  let top = y + 14;
  if (left + r.width > window.innerWidth - 8) left = x - r.width - 14;
  if (top + r.height > window.innerHeight - 8) top = y - r.height - 14;
  tipEl.style.left = `${Math.max(8, left)}px`;
  tipEl.style.top = `${Math.max(8, top)}px`;
}

export function hideTip() {
  tipEl?.classList.remove("is-on");
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
      <div className="tooltip" ref={tip} role="tooltip" />
      <div className={`toast${on ? " is-on" : ""}`} role="status" aria-live="polite">
        {text}
      </div>
    </>
  );
}
