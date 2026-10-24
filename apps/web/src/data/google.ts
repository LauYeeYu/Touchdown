// Google sign-in for Private mode's Google Drive (docs/12, "Google Drive details"): Google Identity Services' token
// flow, in a popup. A token lasts an hour and is kept in this browser until then, never on a server. After that,
// sync waits until the user signs in again: browsers open the popup only on a click.

import { GoogleDrive, SignInNeeded, type DriveAuth } from "@touchdown/storage";
import { db } from "./db.ts";
import { GOOGLE_CLIENT_ID } from "../config.ts";
const SCOPE = "https://www.googleapis.com/auth/drive.file";
const KEY = "googleToken";
/** A token this close to its end is not used: a sync started with it could fail halfway. */
const MARGIN_MS = 2 * 60_000;

interface TokenResponse {
  access_token?: string;
  expires_in?: number | string;
  scope?: string;
  error?: string;
  error_description?: string;
}

interface Gis {
  accounts: {
    oauth2: {
      initTokenClient(config: {
        client_id: string;
        scope: string;
        login_hint?: string;
        callback: (r: TokenResponse) => void;
        error_callback?: (e: { type: string; message?: string }) => void;
      }): { requestAccessToken(): void };
      hasGrantedAllScopes(r: TokenResponse, ...scopes: string[]): boolean;
    };
  };
}

declare global {
  interface Window {
    google?: Gis;
  }
}

/** The user closed Google's window. */
export class SignInCancelled extends Error {}

let loading: Promise<Gis> | null = null;

/** Load Google's sign-in script ahead of the click, so the popup opens straight away. */
export function loadGoogle(): Promise<Gis> {
  loading ??= new Promise<Gis>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://accounts.google.com/gsi/client";
    script.async = true;
    script.onload = () => (window.google ? resolve(window.google) : reject(new Error("Google sign-in did not load.")));
    script.onerror = () => reject(new Error("Google sign-in could not be loaded. Check the connection and try again."));
    document.head.append(script);
  }).catch((e: unknown) => {
    loading = null;
    throw e;
  });
  return loading;
}

interface SavedToken {
  token: string;
  expiresAt: number;
  account: string;
}

/** Tokens for one Google account, or for whichever account the user picks when `account` is null. */
export class GoogleSignIn implements DriveAuth {
  private saved: SavedToken | null = null;

  constructor(readonly account: string | null) {}

  private usable(s: SavedToken | null): s is SavedToken {
    return !!s && s.expiresAt - MARGIN_MS > Date.now() && (!this.account || s.account === this.account);
  }

  async token(): Promise<string> {
    // Another tab may have signed in since.
    if (!this.usable(this.saved)) this.saved = ((await db.meta.get(KEY))?.value as SavedToken | undefined) ?? null;
    if (this.usable(this.saved)) return this.saved.token;
    throw new SignInNeeded("Sign in to Google again to sync.");
  }

  refused(token: string) {
    if (this.saved?.token !== token) return;
    this.saved = null;
    void db.meta.delete(KEY);
  }

  /** Whether a token is at hand without asking the user. */
  async ready(): Promise<boolean> {
    try {
      await this.token();
      return true;
    } catch {
      return false;
    }
  }

  /** Sign in in Google's popup; call it from a click. Returns the account's email address. */
  async signIn(): Promise<string> {
    const google = window.google ?? (await loadGoogle());
    const response = await new Promise<TokenResponse>((resolve, reject) => {
      google.accounts.oauth2
        .initTokenClient({
          client_id: GOOGLE_CLIENT_ID,
          scope: SCOPE,
          login_hint: this.account ?? undefined,
          callback: resolve,
          error_callback: (e) =>
            reject(
              e.type === "popup_closed"
                ? new SignInCancelled()
                : new Error(e.type === "popup_failed_to_open" ? "The browser blocked Google's sign-in window. Allow pop-ups for this site and try again." : (e.message ?? "Google sign-in failed.")),
            ),
        })
        .requestAccessToken();
    });
    if (response.error === "access_denied") throw new Error("Google Drive was not connected: Touchdown was not allowed to use it.");
    if (response.error || !response.access_token) throw new Error(response.error_description ?? response.error ?? "Google did not sign you in.");
    if (!google.accounts.oauth2.hasGrantedAllScopes(response, SCOPE)) {
      throw new Error("Touchdown needs permission to use its files in Google Drive. Sign in again and tick the box for Google Drive.");
    }
    const token = response.access_token;
    const expiresAt = Date.now() + Number(response.expires_in ?? 3600) * 1000;
    const account = await new GoogleDrive({ token: async () => token, refused: () => {} }).account();
    if (this.account && account !== this.account) {
      throw new Error(`You signed in as ${account}, but this log is in the Google Drive of ${this.account}. Sign in as ${this.account}.`);
    }
    this.saved = { token, expiresAt, account };
    await db.meta.put({ key: KEY, value: this.saved });
    return account;
  }
}

/** Forget this browser's token when it stops using Google Drive. Google's permission stays, so other devices keep syncing. */
export async function forgetGoogleToken(): Promise<void> {
  await db.meta.delete(KEY);
}
