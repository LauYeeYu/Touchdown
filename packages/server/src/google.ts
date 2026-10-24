// Sign-in with Google (docs/33-accounts-and-sign-in.md, "Google"): OpenID Connect's authorisation-code flow with
// PKCE, run by the server. A sign-in under way is a row in google_logins, used once within 10 minutes, and a cookie
// ties it to the browser that started it.

import { b64url, hashToken, randomToken, sameString, sha256 } from "./crypto.ts";
import type { Database } from "./db.ts";

const AUTHORIZE = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN = "https://oauth2.googleapis.com/token";
const ISSUERS = ["https://accounts.google.com", "accounts.google.com"];
const LOGIN_MS = 10 * 60_000;
export const GOOGLE_COOKIE = "td_google";

/** Why a Google sign-in did not finish; the sign-in pages show a sentence for each. */
export type GoogleProblem = "cancelled" | "failed" | "expired";

export class GoogleError extends Error {
  readonly problem: GoogleProblem;
  constructor(problem: GoogleProblem, detail: string = problem) {
    super(detail);
    this.problem = problem;
  }
}

export interface GoogleConfig {
  clientId: string;
  clientSecret: string;
}

export interface GoogleLogin {
  next: string | null;
  invite: string | null;
  name: string | null;
  linkAccountId: string | null;
}

export interface GoogleIdentity {
  sub: string;
  email: string;
}

const iso = (ms: number) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");

function cookie(value: string, maxAgeS: number, secure: boolean) {
  return `${GOOGLE_COOKIE}=${value}; Path=/auth/google; HttpOnly; SameSite=Lax; Max-Age=${maxAgeS}${secure ? "; Secure" : ""}`;
}

export const clearGoogleCookie = (secure: boolean) => cookie("", 0, secure);

/** Begin: where to send the browser, and the cookie that ties the sign-in to it. */
export async function googleStart(db: Database, google: GoogleConfig, origin: string, login: GoogleLogin, now: number, secure: boolean) {
  const state = randomToken();
  const nonce = randomToken();
  const verifier = randomToken();
  await db.run("DELETE FROM google_logins WHERE expiresAt <= ?", [iso(now)]);
  await db.run("INSERT INTO google_logins (stateHash, nonce, verifier, next, invite, name, linkAccountId, expiresAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?)", [
    await hashToken(state),
    nonce,
    verifier,
    login.next,
    login.invite,
    login.name,
    login.linkAccountId,
    iso(now + LOGIN_MS),
  ]);
  const params = new URLSearchParams({
    client_id: google.clientId,
    redirect_uri: `${origin}/auth/google/callback`,
    response_type: "code",
    scope: "openid email",
    state,
    nonce,
    code_challenge: b64url(await sha256(verifier)),
    code_challenge_method: "S256",
    prompt: "select_account",
  });
  return { location: `${AUTHORIZE}?${params}`, cookie: cookie(state, LOGIN_MS / 1000, secure) };
}

/**
 * Finish: check that this browser started the sign-in, exchange the code, and check the ID token. It comes
 * straight from Google's token endpoint over HTTPS, so OpenID Connect lets the client trust its signature; the
 * claims are still checked.
 */
export async function googleFinish(
  db: Database,
  google: GoogleConfig,
  origin: string,
  url: URL,
  browserState: string | null,
  now: number,
  fetcher: typeof fetch,
): Promise<{ identity: GoogleIdentity; login: GoogleLogin }> {
  if (url.searchParams.get("error")) throw new GoogleError(url.searchParams.get("error") === "access_denied" ? "cancelled" : "failed", url.searchParams.get("error")!);
  const state = url.searchParams.get("state") ?? "";
  const code = url.searchParams.get("code") ?? "";
  if (!state || !code || !browserState || !sameString(state, browserState)) throw new GoogleError("expired", "state does not match this browser");
  const stateHash = await hashToken(state);
  const row = await db.first<GoogleLogin & { nonce: string; verifier: string; expiresAt: string }>("SELECT * FROM google_logins WHERE stateHash = ?", [stateHash]);
  await db.run("DELETE FROM google_logins WHERE stateHash = ?", [stateHash]);
  if (!row || row.expiresAt <= iso(now)) throw new GoogleError("expired", "no such sign-in under way");

  const res = await fetcher(TOKEN, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: google.clientId,
      client_secret: google.clientSecret,
      code,
      code_verifier: row.verifier,
      grant_type: "authorization_code",
      redirect_uri: `${origin}/auth/google/callback`,
    }).toString(),
  });
  if (!res.ok) throw new GoogleError("failed", `token endpoint answered ${res.status}`);
  const idToken = ((await res.json()) as { id_token?: string }).id_token;
  const claims = idToken ? decodeClaims(idToken) : null;
  if (!claims) throw new GoogleError("failed", "no readable ID token");
  const t = now / 1000;
  const audience = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!ISSUERS.includes(String(claims.iss)) || !audience.includes(google.clientId) || typeof claims.exp !== "number" || claims.exp < t - 60) {
    throw new GoogleError("failed", "ID token not for this site, or expired");
  }
  if (claims.nonce !== row.nonce) throw new GoogleError("failed", "nonce does not match");
  if (typeof claims.sub !== "string" || typeof claims.email !== "string" || claims.email_verified !== true) throw new GoogleError("failed", "no verified email address");
  return {
    identity: { sub: claims.sub, email: claims.email.toLowerCase() },
    login: { next: row.next, invite: row.invite, name: row.name, linkAccountId: row.linkAccountId },
  };
}

function decodeClaims(jwt: string): Record<string, unknown> | null {
  const part = jwt.split(".")[1];
  if (!part) return null;
  try {
    const b = atob(part.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (part.length % 4)) % 4));
    return JSON.parse(new TextDecoder().decode(Uint8Array.from(b, (c) => c.charCodeAt(0)))) as Record<string, unknown>;
  } catch {
    return null;
  }
}
