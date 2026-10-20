// The loading screen (docs/31-ui.md, "Opening"; styles in public/boot.css). index.html shows the same screen
// while the app's code loads, its bar creeping towards a third; this one carries the same bar on as each step
// of opening the log finishes, says which step is running, fills the bar and fades out over the first page.

import type { CSSProperties } from "react";

/** How far the page's own bar got before the app's code ran: 0 to 1. */
export function waitingProgress(): number {
  const bar = document.querySelector<HTMLElement>(".boot__bar--waiting");
  const fill = bar?.querySelector<HTMLElement>(".boot__fill");
  if (!bar || !fill) return 0;
  return fill.getBoundingClientRect().width / Math.max(1, bar.getBoundingClientRect().width);
}

export function Boot({ progress, text, done = false }: { progress: number; text: string; done?: boolean }) {
  const pct = Math.round(Math.min(1, Math.max(0, progress)) * 100);
  return (
    <div className={`boot${done ? " boot--done" : ""}`} aria-busy={!done}>
      <p className="boot__mark">TOUCHDOWN</p>
      <div className="boot__bar boot__bar--steps" role="progressbar" aria-label="Opening Touchdown" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} style={{ "--p": `${pct}%` } as CSSProperties}>
        <span className="boot__fill" />
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
