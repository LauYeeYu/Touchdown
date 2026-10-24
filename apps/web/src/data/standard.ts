// Standard mode in the browser (docs/32-modes-and-sharing.md, "Connecting storage"): the server keeps the key to
// the user's Google Drive, and the browser asks it for short-lived access for its own sync, instead of Google's
// popup. The key itself never reaches the browser.

import { SignInNeeded, type DriveAuth } from "@touchdown/storage";
import { AuthError, call } from "./account.ts";

export interface StandardStatus {
  /** The site offers Standard (it has the encryption key and Google configured). */
  available: boolean;
  termsVersion: number;
  /** The current terms were accepted. */
  accepted: boolean;
  connected: boolean;
  /** The Google account the key belongs to. */
  account: string | null;
  status: "ok" | "broken" | null;
}

export const standard = {
  status: () => call<StandardStatus>("GET", "/api/storage"),
  accept: (version: number) => call("POST", "/api/storage/terms", { version }),
  /** Revoke the key with Google and delete it, with the terms accepted. */
  disconnect: () => call("POST", "/api/storage/disconnect"),
  /** Where to send the browser to connect Google Drive; it comes back to `back` with ?storage=connected. */
  connectUrl: (back: string) => `/api/storage/connect?next=${encodeURIComponent(back)}`,
};

/** What a `storage-error` on the way back from connecting means. */
export const STANDARD_ERRORS: Record<string, string> = {
  terms: "Accept the terms first.",
  cancelled: "Google Drive was not connected.",
  "no-drive": "Google Drive was not connected: tick the box for Google Drive on Google's screen, so Touchdown can use its folder.",
  "no-key": "Google did not give Touchdown a lasting key. Try again.",
  expired: "Connecting took too long, or began in another browser. Try again.",
  failed: "Connecting Google Drive did not work. Try again.",
  unavailable: "Standard mode is not available on this site.",
};

/** One access token for the whole page, kept in memory until shortly before it ends. */
let cached: { token: string; expiresAt: number } | null = null;
const MARGIN_MS = 2 * 60_000;

export class ServerDriveAuth implements DriveAuth {
  async token(): Promise<string> {
    if (cached && cached.expiresAt - MARGIN_MS > Date.now()) return cached.token;
    try {
      const r = await call<{ accessToken: string; expiresAt: string }>("POST", "/api/storage/token");
      cached = { token: r.accessToken, expiresAt: Date.parse(r.expiresAt) };
      return cached.token;
    } catch (e) {
      // No key on the server (Standard was left on another device) or one Google no longer accepts.
      if (e instanceof AuthError && (e.status === 404 || e.status === 409 || e.status === 401)) throw new SignInNeeded(e.message);
      throw e;
    }
  }

  refused(token: string) {
    if (cached?.token === token) cached = null;
  }

  async ready(): Promise<boolean> {
    try {
      await this.token();
      return true;
    } catch (e) {
      if (e instanceof SignInNeeded) return false;
      throw e;
    }
  }
}
