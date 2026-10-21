// The loading screen (docs/31-ui.md, "Opening"; styles in public/boot.css). Its progress bar is a final approach:
// an aircraft follows the glide path down to the runway. index.html shows the same screen while the app's code
// loads, the aircraft creeping a third of the way; this one carries it on as each step of opening the log
// finishes, says which step is running, lands it and fades out over the first page.

import type { CSSProperties } from "react";

/** How far the page's own bar got before the app's code ran: 0 to 1. */
export function waitingProgress(): number {
  const bar = document.querySelector<HTMLElement>(".boot__bar--waiting");
  return bar ? (parseFloat(getComputedStyle(bar).getPropertyValue("--p")) || 0) / 100 : 0;
}

// A Boeing 747 from the side, nose to the right, gear down; the main wheels are at 48.6% across, on the bottom edge.
const PLANE = "M1.2 7.2 3.8 6.5 2.6.6h2.8L12.4 6.6H28.6C30.6 6.6 31.6 5 33.8 5H42.2C45 5 47.4 7 47.7 9.2C47.9 10.3 46.9 10.9 45.4 11.05 44.8 11.1 44.4 11.1 44 11.1H31L29.4 11.5H20.6L19 11.1H12.6C9.6 11.1 5.6 9.2 1.2 7.6ZM1.6 7.1 8.6 7.2 9.6 7.9 2.4 8.1ZM18.8 9.35 30.6 10.55 25 11.35 17.6 9.85ZM25.6 11.6H30.2A1 1 0 0 1 30.2 13.6H25.6A1 1 0 0 1 25.6 11.6ZM27.4 10.8H29.4V11.8H27.4ZM19.4 10.9H23A.9.9 0 0 1 23 12.7H19.4A.9.9 0 0 1 19.4 10.9ZM20.6 10.3H22.4V11.1H20.6ZM23 11.2H23.7V14.2H23ZM42.2 11H42.85V14.3H42.2Z";

export function Boot({ progress, text, done = false }: { progress: number; text: string; done?: boolean }) {
  const pct = Math.round(Math.min(1, Math.max(0, progress)) * 100);
  return (
    <div className={`boot${done ? " boot--done" : ""}`} aria-busy={!done}>
      <p className="boot__mark">TOUCHDOWN</p>
      <div className="boot__bar boot__bar--steps" role="progressbar" aria-label="Opening Touchdown" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} style={{ "--p": `${pct}%` } as CSSProperties}>
        <span className="boot__ground" />
        <span className="boot__runway" />
        <span className="boot__glide">
          <span className="boot__fill" />
          <svg className="boot__plane" viewBox="0 0 48 15.8" aria-hidden="true">
            <path fill="currentColor" d={PLANE} />
            <circle fill="currentColor" cx="22.45" cy="14.85" r="0.95" />
            <circle fill="currentColor" cx="24.25" cy="14.85" r="0.95" />
            <circle fill="currentColor" cx="42.5" cy="14.95" r="0.85" />
          </svg>
        </span>
      </div>
      <p className="boot__text" aria-live="polite">
        {text}
      </p>
    </div>
  );
}

export function BootError({ message }: { message: string }) {
  return (
    <div className="boot" role="alert">
      <p className="boot__mark">TOUCHDOWN</p>
      <h1 className="boot__error">Touchdown could not open its local data.</h1>
      <p className="boot__text">{message}</p>
    </div>
  );
}
