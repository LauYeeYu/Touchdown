// Google sign-in for Private mode's Google Drive (docs/12, "Google Drive details"): Google Identity Services' token
// flow, in a popup. A token lasts an hour and is kept in this browser until then, never on a server. Browsers open the
// popup only on a click, so the user's next click renews it once the hour is nearly over (renewal.ts). When that cannot
// finish without the user, sync waits until they sign in again.

import { t } from "@touchdown/i18n";
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
        /** "": Google asks the user only what it must (signing in, the first permission); else it closes by itself. */
        prompt?: string;
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
    script.onload = () => (window.google ? resolve(window.google) : reject(new Error(t("data.google.notLoaded"))));
    script.onerror = () => reject(new Error(t("data.google.loadFailed")));
    document.head.append(script);
  }).catch((e: unknown) => {
    loading = null;
    throw e;
  });
  return loading;
}

export interface SavedToken {
  token: string;
  expiresAt: number;
  account: string;
}

/** Tokens for one Google account, or for whichever account the user picks when `account` is null. */
export class GoogleSignIn implements DriveAuth {
  private saved: SavedToken | null = null;
  /** Google's window while it is open: a second sign-in waits for it rather than opening another. */
  private asking: Promise<string> | null = null;

  constructor(readonly account: string | null) {}

  private usable(s: SavedToken | null): s is SavedToken {
    return !!s && s.expiresAt - MARGIN_MS > Date.now() && this.ours(s);
  }

  private ours(s: SavedToken): boolean {
    return !this.account || s.account === this.account;
  }

  private async stored(): Promise<SavedToken | null> {
    return ((await db.meta.get(KEY))?.value as SavedToken | undefined) ?? null;
  }

  async token(): Promise<string> {
    // Another tab may have signed in since.
    if (!this.usable(this.saved)) this.saved = await this.stored();
    if (this.usable(this.saved)) return this.saved.token;
    throw new SignInNeeded(t("data.google.signInAgain"));
  }

  /** When the token in hand ends, as last read; null without one. A click decides with it at once (renewal.ts). */
  expiresAt(): number | null {
    return this.saved && this.ours(this.saved) ? this.saved.expiresAt : null;
  }

  /** Read the saved token again, and take it when it lasts longer: another tab may have renewed it. */
  async refresh(): Promise<void> {
    const s = await this.stored();
    if (s && this.ours(s) && s.expiresAt > (this.saved?.expiresAt ?? 0)) this.saved = s;
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

  /**
   * Sign in in Google's popup; call it from a click. Returns the account's email address. While Google's window is
   * open, another call waits for it.
   */
  signIn(): Promise<string> {
    // Not async: Google's window opens within this call, inside the click.
    this.asking ??= this.ask().finally(() => (this.asking = null));
    return this.asking;
  }

  private async ask(): Promise<string> {
    const { token, expiresAt, account } = await requestDriveToken(this.account, { quiet: !!this.account });
    this.saved = { token, expiresAt, account };
    await db.meta.put({ key: KEY, value: this.saved });
    return account;
  }
}

/**
 * An hour's access to Touchdown's files in Google Drive, from Google's popup; call it from a click. With `account`,
 * signing in as another account is refused. `quiet` (Private mode's sync, for the log's account): Google asks only
 * what it must, so while the user is signed in its window closes by itself. Nothing is kept: GoogleSignIn keeps it
 * for sync, and the command line's page (/cli/drive) passes it on.
 */
export async function requestDriveToken(account: string | null, { quiet = false } = {}): Promise<SavedToken> {
  const google = window.google ?? (await loadGoogle());
  const response = await new Promise<TokenResponse>((resolve, reject) => {
    google.accounts.oauth2
      .initTokenClient({
        client_id: GOOGLE_CLIENT_ID,
        scope: SCOPE,
        login_hint: account ?? undefined,
        prompt: quiet ? "" : undefined,
        callback: resolve,
        error_callback: (e) =>
          reject(
            e.type === "popup_closed"
              ? new SignInCancelled()
              : new Error(e.type === "popup_failed_to_open" ? t("data.google.popupBlocked") : (e.message ?? t("data.google.failed"))),
          ),
      })
      .requestAccessToken();
  });
  if (response.error === "access_denied") throw new Error(t("data.google.denied"));
  if (response.error || !response.access_token) throw new Error(response.error_description ?? response.error ?? t("data.google.notSignedIn"));
  if (!google.accounts.oauth2.hasGrantedAllScopes(response, SCOPE)) {
    throw new Error(t("data.google.needsDrive"));
  }
  const token = response.access_token;
  const expiresAt = Date.now() + Number(response.expires_in ?? 3600) * 1000;
  const signedIn = await new GoogleDrive({ token: async () => token, refused: () => {} }).account();
  if (account && signedIn !== account) {
    throw new Error(t("data.google.otherAccount", { signedIn, account }));
  }
  return { token, expiresAt, account: signedIn };
}

/** Forget this browser's token when it stops using Google Drive. Google's permission stays, so other devices keep syncing. */
export async function forgetGoogleToken(): Promise<void> {
  await db.meta.delete(KEY);
}
