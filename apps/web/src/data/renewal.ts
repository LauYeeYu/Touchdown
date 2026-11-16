// Private mode's Google Drive access, renewed on the user's next click (docs/12, "Google Drive details"). Google gives a
// page an hour's access and nothing to renew it with, and browsers open Google's window only inside a click. So once the
// hour is nearly over, or over, the next click anywhere in the app asks Google again, for the log's account and without
// a prompt: while the user is signed in to Google and has allowed Touchdown, the window opens and closes by itself.
// Nothing is tried offline: the first click once the connection is back renews. When Google needs the user (to sign
// in or choose an account), or its window was closed or blocked, no click tries again until access comes another way,
// and the "Sign in" bar stays.

/** The access is renewed once it has less than this left. */
export const RENEW_MS = 10 * 60_000;

/**
 * Only Private mode's Google Drive renews on a click: Standard's access comes from Touchdown's server, a directory on
 * this computer needs none, and Local has nothing to renew.
 */
export function renewsOnClick(c: { mode: string; adapter?: string }): boolean {
  return c.mode === "private" && c.adapter === "gdrive";
}

/** The renewal for a connection that renews on a click (`renewsOnClick`), listening on `target`; null for the others. */
export function clickRenewal(c: { mode: string; adapter?: string }, target: EventTarget, r: Renewal): ClickRenewal | null {
  return renewsOnClick(c) ? new ClickRenewal(target, r) : null;
}

export interface Renewal {
  /** When the access in hand ends, in milliseconds since the epoch; null when there is none. */
  expiresAt(): number | null;
  /** The network can be reached: the browser says so, and sync did not just fail for want of it. */
  online(): boolean;
  /** Google's script is loaded, so its window can open inside the click. */
  canAsk(): boolean;
  /** Ask Google, inside the click. Rejects when Google needs the user, or its window was closed or blocked. */
  renew(): Promise<unknown>;
  /** The access was renewed. */
  renewed(): void;
  /** The renewal did not finish without the user. */
  failed(e: unknown): void;
  now?(): number;
}

/** A click on `target` (the document) renews the access when it is due; `stop` removes the listener. */
export class ClickRenewal {
  private open = false;
  /** The access's end when a renewal failed: no click tries again until it changes. */
  private failedFor: number | null | undefined = undefined;

  constructor(
    private readonly target: EventTarget,
    private readonly r: Renewal,
  ) {
    // In the capture phase, so the click reaches it whatever it lands on, before the page acts on it.
    target.addEventListener("click", this.onClick, { capture: true });
  }

  /** A click now asks Google: the access ends within RENEW_MS or has ended, no renewal is open, and the network is there. */
  due(): boolean {
    if (this.open || !this.r.online() || !this.r.canAsk()) return false;
    const end = this.r.expiresAt();
    if (this.failedFor !== undefined && this.failedFor === end) return false;
    return end === null || end - (this.r.now?.() ?? Date.now()) < RENEW_MS;
  }

  private readonly onClick = () => {
    if (!this.due()) return;
    const end = this.r.expiresAt();
    this.open = true;
    let asked: Promise<unknown>;
    try {
      // Called inside the click: the browser lets Google's window open only there.
      asked = this.r.renew();
    } catch (e) {
      asked = Promise.reject(e);
    }
    asked.then(
      () => {
        this.open = false;
        this.failedFor = undefined;
        this.r.renewed();
      },
      (e: unknown) => {
        this.open = false;
        // Offline, the next click once the connection is back tries again.
        if (this.r.online()) this.failedFor = end;
        this.r.failed(e);
      },
    );
  };

  stop() {
    this.target.removeEventListener("click", this.onClick, { capture: true });
  }
}
