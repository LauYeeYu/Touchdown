// The server's request handler (docs/33-accounts-and-sign-in.md): the gate in front of every page and file, the
// sign-in pages, and the /auth/ requests for accounts, sessions and invitations. Standard web Request and Response
// only, so the same code runs in a Cloudflare Worker and in Node.

import { b64url, hashToken, newSalt, openToken, passwordHash, randomToken, sameString, sealToken, sha256, TOKEN_RE } from "./crypto.ts";
import { siteId, type Database } from "./db.ts";
import { clearGoogleCookie, DRIVE_FILE, GOOGLE_COOKIE, googleAccess, GoogleError, googleFinish, googlePurpose, googleRevoke, googleStart, type GoogleIdentity } from "./google.ts";
import { withHeaders } from "./headers.ts";

export interface ServerConfig {
  /** The site's addresses, such as https://touchdown.example.org; the first is used in links. */
  origins: string[];
  /** For /setup, the first account. */
  setupToken?: string;
  /** Sign-in with Google (step 4 of docs/33). */
  google?: { clientId: string; clientSecret: string };
  /** Mark cookies Secure. Off only for plain-http testing. */
  secureCookies?: boolean;
  /** Encrypts Standard mode's storage keys: 32 random bytes, base64. Standard is offered only with it and Google. */
  tokenKey?: string;
}

/** The version of Standard mode's terms (docs/32, "Terms"); the app shows its text. */
export const TERMS_VERSION = 1;

export interface Assets {
  fetch(request: Request): Promise<Response>;
}

export interface Server {
  db: Database;
  assets: Assets;
  config: ServerConfig;
  now?: () => number;
  /** For Google's token endpoint; tests pass their own. */
  fetch?: typeof fetch;
}

/** A time as stored: ISO 8601 in UTC, to the second (2026-10-24T09:15:00Z). Compares correctly as text. */
const toUtcIso = (ms: number) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");
const newId = () => crypto.randomUUID();

const DAY = 86_400_000;
const SESSION_DAYS = 30;
const INVITE_DAYS = 7;
const RESET_HOURS = 24;
const FREE_TRIES = 5;
const COOKIE = "td_session";
/** The command line's session lasts until it is signed out (docs/33, "The command line"). */
const CLI_FOREVER = "9999-12-31T00:00:00Z";
const CLI_CODE_MINUTES = 5;
/** What a command-line session may ask for: who it is, signing out, and Standard mode's access to Google Drive. */
const CLI_ALLOWED = new Set(["GET /auth/me", "POST /auth/signout", "GET /api/storage", "POST /api/storage/token"]);
/** The sign-in pages' own build; everything in it may be fetched without a session. */
export const SIGNIN_FILES = "/signin-files/";
const PUBLIC_PAGES = /^\/(signin|setup|join\/[^/]+|reset\/[^/]+)\/?$/;
/** The privacy policy and the terms: static pages built from PRIVACY.md and TERMS.md, open to anyone. */
const POLICY_PAGES = /^\/(privacy|terms)\/?$/;

interface Account {
  id: string;
  email: string;
  name: string;
  role: "owner" | "member";
  createdAt: string;
  lastSeenAt: string | null;
  failedSignins: number;
  lockedUntil: string | null;
}

interface Session {
  account: Account;
  tokenHash: string;
  /** The command line's session, sent as a bearer token rather than a cookie. */
  cli: boolean;
  /** A Set-Cookie value when the session was extended. */
  renewed: string | null;
}

// No TypeScript-only syntax in this package (such as constructor parameter properties): the Node server runs it
// with Node's own type stripping.
class Fail extends Error {
  readonly status: number;
  readonly headers: Record<string, string>;
  constructor(status: number, message: string, headers: Record<string, string> = {}) {
    super(message);
    this.status = status;
    this.headers = headers;
  }
}

// ---------- small helpers ----------

function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...headers } });
}

function cookieOf(request: Request, name: string): string | null {
  for (const part of (request.headers.get("Cookie") ?? "").split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return v.join("=");
  }
  return null;
}

/** The bearer token the command line sends, if any. */
function bearerOf(request: Request): string | null {
  const h = request.headers.get("Authorization");
  return h?.startsWith("Bearer ") ? h.slice(7).trim() : null;
}

/** Changes from a browser must come from the site's own pages. A bearer token is never sent by a browser on its own. */
function checkOrigin(request: Request, s: Server) {
  if (request.method === "GET" || request.method === "HEAD" || bearerOf(request)) return;
  const origin = request.headers.get("Origin");
  if (!origin || !s.config.origins.includes(origin)) throw new Fail(403, "Not allowed from here.");
}

/** The command line may only do what CLI_ALLOWED lists. */
function checkCli(session: Session | null, method: string, path: string) {
  if (session?.cli && !CLI_ALLOWED.has(`${method} ${path}`)) throw new Fail(403, "The command line cannot do this. Use the web app.");
}

function sessionCookie(token: string, s: Server, maxAgeS: number): string {
  return `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeS}${s.config.secureCookies === false ? "" : "; Secure"}`;
}

function plainPath(path: string): boolean {
  if (/%2f|%5c/i.test(path)) return false;
  let decoded: string;
  try {
    decoded = decodeURIComponent(path);
  } catch {
    return false;
  }
  return !decoded.split("/").includes("..") && !decoded.includes("\\");
}

/** The site's own address for this request: the one it came to, when it is one of the site's. */
function siteOrigin(s: Server, url: URL): string {
  return s.config.origins.includes(url.origin) ? url.origin : (s.config.origins[0] ?? url.origin);
}

/** Where to go after signing in: a path on this site, nothing else. */
export function safeNext(next: string | null | undefined): string {
  return next && next.startsWith("/") && !next.startsWith("//") && !next.startsWith("/\\") ? next : "/";
}

function email(v: unknown): string {
  const e = typeof v === "string" ? v.trim().toLowerCase() : "";
  if (e.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) throw new Fail(400, "Enter a valid email address.");
  return e;
}

function name(v: unknown): string {
  const n = typeof v === "string" ? v.trim().replace(/\s+/g, " ") : "";
  if (!n || n.length > 80) throw new Fail(400, "Enter a name of up to 80 characters.");
  return n;
}

function key(v: unknown): string {
  if (typeof v !== "string" || !TOKEN_RE.test(v)) throw new Fail(400, "The password could not be read. Reload the page and try again.");
  return v;
}

function token(v: unknown): string {
  if (typeof v !== "string" || !TOKEN_RE.test(v)) throw new Fail(404, "This link is not valid.");
  return v;
}

async function body(request: Request): Promise<Record<string, unknown>> {
  const text = await request.text();
  if (text.length > 10_000) throw new Fail(413, "Too large.");
  try {
    const v = JSON.parse(text || "{}") as unknown;
    if (v && typeof v === "object" && !Array.isArray(v)) return v as Record<string, unknown>;
  } catch {
    // fall through
  }
  throw new Fail(400, "Not valid JSON.");
}

/** A short label for "signed in on": browser and system, nothing more. */
export function deviceLabel(ua: string | null): string {
  if (!ua) return "Unknown device";
  const browser = /Edg\//.test(ua) ? "Edge" : /Firefox\//.test(ua) ? "Firefox" : /Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : "A browser";
  const system = /iPhone|iPad/.test(ua) ? "iOS" : /Android/.test(ua) ? "Android" : /Mac OS X/.test(ua) ? "macOS" : /Windows/.test(ua) ? "Windows" : /Linux/.test(ua) ? "Linux" : "another system";
  return `${browser} on ${system}`;
}

// ---------- the handler ----------

export async function handle(request: Request, s: Server): Promise<Response> {
  const now = (s.now ?? Date.now)();
  const url = new URL(request.url);
  const path = url.pathname;
  // The gate decides by path, so a path must mean what it says: no dot segments or slashes hidden in escapes.
  if (!plainPath(path)) return withHeaders(json(400, { error: "Bad address." }), "/");
  try {
    const site = await siteId(s.db, randomToken, toUtcIso(now));
    if (path.startsWith("/auth/")) return withHeaders(await auth(request, s, url, now, site), path);

    const session = await currentSession(request, s, now);
    const done = (res: Response) => {
      const out = withHeaders(res, path);
      if (session?.renewed) out.headers.append("Set-Cookie", session.renewed);
      return out;
    };
    const policy = path.match(POLICY_PAGES)?.[1];
    if (policy) return done(await s.assets.fetch(new Request(new URL(`${SIGNIN_FILES}${policy}.html`, url), { headers: request.headers })));
    if (PUBLIC_PAGES.test(path)) {
      if (session && path.startsWith("/signin")) return done(Response.redirect(new URL(safeNext(url.searchParams.get("next")), url).toString(), 302));
      return done(await s.assets.fetch(new Request(new URL(`${SIGNIN_FILES}signin.html`, url), { headers: request.headers })));
    }
    if (path.startsWith(SIGNIN_FILES) || path === "/favicon.svg") return done(await s.assets.fetch(request));
    // The command line's session opens its few requests, not the app's pages and files.
    if (session?.cli && !path.startsWith("/api/")) return withHeaders(json(401, { error: "Sign in first." }), path);
    if (!session) {
      const page = request.method === "GET" && (request.headers.get("Accept") ?? "").includes("text/html");
      if (page) return withHeaders(Response.redirect(new URL(`/signin?next=${encodeURIComponent(path + url.search)}`, url).toString(), 302), path);
      return withHeaders(json(401, { error: "Sign in first." }), path);
    }
    if (path.startsWith("/api/storage")) return done(await storage(request, s, url, now, session));
    if (path.startsWith("/api/")) return done(json(404, { error: "Not found." }));
    return done(await s.assets.fetch(request));
  } catch (e) {
    if (e instanceof Fail) return withHeaders(json(e.status, { error: e.message }, e.headers), path);
    throw e;
  }
}

// ---------- sessions ----------

async function currentSession(request: Request, s: Server, now: number): Promise<Session | null> {
  const bearer = bearerOf(request);
  const t = bearer ?? cookieOf(request, COOKIE);
  if (!t || !TOKEN_RE.test(t)) return null;
  const tokenHash = await hashToken(t);
  const row = await s.db.first<Account & { sCreatedAt: string; lastUsedAt: string; expiresAt: string; kind: string | null }>(
    `SELECT a.*, s.lastUsedAt, s.expiresAt, s.kind FROM sessions s JOIN accounts a ON a.id = s.accountId WHERE s.tokenHash = ?`,
    [tokenHash],
  );
  if (!row) return null;
  // A command line's token works only as a bearer token, a browser's only as its cookie.
  const cli = row.kind === "cli";
  if (cli !== !!bearer) return null;
  const nowIso = toUtcIso(now);
  if (row.expiresAt <= nowIso) {
    await s.db.run("DELETE FROM sessions WHERE tokenHash = ?", [tokenHash]);
    return null;
  }
  const { lastUsedAt: _l, expiresAt: _e, sCreatedAt: _c, kind: _k, ...account } = row;
  let renewed: string | null = null;
  // Extended at most once a day, so most requests cost one read. The command line's session does not run out.
  if (Date.parse(row.lastUsedAt) < now - DAY) {
    await s.db.batch([
      { sql: "UPDATE sessions SET lastUsedAt = ?, expiresAt = ? WHERE tokenHash = ?", params: [nowIso, cli ? CLI_FOREVER : toUtcIso(now + SESSION_DAYS * DAY), tokenHash] },
      { sql: "UPDATE accounts SET lastSeenAt = ? WHERE id = ?", params: [nowIso, account.id] },
    ]);
    if (!cli) renewed = sessionCookie(t, s, SESSION_DAYS * 86_400);
  }
  return { account, tokenHash, cli, renewed };
}

/** A new session for the account; returns the Set-Cookie value. */
async function startSession(s: Server, accountId: string, request: Request, now: number): Promise<string> {
  const t = randomToken();
  const nowIso = toUtcIso(now);
  await s.db.batch([
    {
      sql: "INSERT INTO sessions (tokenHash, accountId, createdAt, lastUsedAt, expiresAt, device) VALUES (?, ?, ?, ?, ?, ?)",
      params: [await hashToken(t), accountId, nowIso, nowIso, toUtcIso(now + SESSION_DAYS * DAY), deviceLabel(request.headers.get("User-Agent"))],
    },
    { sql: "UPDATE accounts SET lastSeenAt = ?, failedSignins = 0, lockedUntil = NULL WHERE id = ?", params: [nowIso, accountId] },
  ]);
  return sessionCookie(t, s, SESSION_DAYS * 86_400);
}

// ---------- /auth/ ----------

async function auth(request: Request, s: Server, url: URL, now: number, site: string): Promise<Response> {
  const path = url.pathname;
  const method = request.method;
  const nowIso = toUtcIso(now);
  // The command line exchanges its one-time code here; it holds no cookie, so there is nothing to forge.
  if (method === "POST" && path === "/auth/cli/token") return cliToken(request, s, now);
  // Anything that changes something must come from the site's own pages.
  checkOrigin(request, s);
  const session = await currentSession(request, s, now);
  checkCli(session, method, path);
  const signedIn = () => {
    if (!session) throw new Fail(401, "Sign in first.");
    return session;
  };
  const owner = () => {
    const me = signedIn();
    if (me.account.role !== "owner") throw new Fail(403, "Only the owner can do this.");
    return me;
  };
  const withRenewal = (res: Response) => {
    if (session?.renewed) res.headers.append("Set-Cookie", session.renewed);
    return res;
  };

  if (method === "GET" && path === "/auth/site") {
    const ownerRow = await s.db.first("SELECT id FROM accounts WHERE role = 'owner' LIMIT 1");
    return withRenewal(json(200, { siteId: site, setupNeeded: !ownerRow, google: !!s.config.google, standard: standardOn(s), signedIn: !!session }));
  }

  if (method === "POST" && path === "/auth/setup") {
    const b = await body(request);
    if (await s.db.first("SELECT id FROM accounts WHERE role = 'owner' LIMIT 1")) throw new Fail(404, "Not found.");
    const expected = s.config.setupToken ?? "";
    if (expected.length < 16 || typeof b.setupToken !== "string" || !sameString(b.setupToken, expected)) throw new Fail(403, "The setup secret is not right.");
    const id = await createAccount(s, { email: email(b.email), name: name(b.name), role: "owner", key: key(b.key) }, nowIso);
    return json(200, { ok: true }, { "Set-Cookie": await startSession(s, id, request, now) });
  }

  if (method === "POST" && path === "/auth/signin") {
    const b = await body(request);
    const e = email(b.email);
    const k = key(b.key);
    const row = await s.db.first<Account & { salt: string | null; hash: string | null }>(
      "SELECT a.*, p.salt, p.hash FROM accounts a LEFT JOIN password_credentials p ON p.accountId = a.id WHERE a.email = ?",
      [e],
    );
    const wrong = new Fail(401, "Wrong email or password.");
    if (!row) {
      await passwordHash(newSalt(), k); // about the same work as for an existing account
      throw wrong;
    }
    if (row.lockedUntil && row.lockedUntil > nowIso) {
      const s2 = Math.ceil((Date.parse(row.lockedUntil) - now) / 1000);
      throw new Fail(429, `Too many wrong passwords. Try again in ${s2 < 90 ? `${s2} seconds` : `${Math.ceil(s2 / 60)} minutes`}.`, { "Retry-After": String(s2) });
    }
    if (!row.salt || !row.hash || !sameString(await passwordHash(row.salt, k), row.hash)) {
      const failed = row.failedSignins + 1;
      const wait = failed >= FREE_TRIES ? Math.min(30_000 * 2 ** (failed - FREE_TRIES), 15 * 60_000) : 0;
      await s.db.run("UPDATE accounts SET failedSignins = ?, lockedUntil = ? WHERE id = ?", [failed, wait ? toUtcIso(now + wait) : null, row.id]);
      throw wrong;
    }
    return json(200, { ok: true }, { "Set-Cookie": await startSession(s, row.id, request, now) });
  }

  const inviteMatch = path.match(/^\/auth\/invite\/([^/]+)$/);
  if (method === "GET" && inviteMatch) {
    const inv = await openInvite(s, token(inviteMatch[1]), null, nowIso);
    const acc = inv.accountId ? await s.db.first<Account>("SELECT * FROM accounts WHERE id = ?", [inv.accountId]) : null;
    return json(200, { purpose: inv.purpose, email: acc?.email ?? null, name: acc?.name ?? null });
  }

  if (method === "POST" && path === "/auth/join") {
    const b = await body(request);
    const t = token(b.invite);
    const inv = await openInvite(s, t, "join", nowIso);
    const id = await createAccount(s, { email: email(b.email), name: name(b.name), role: "member", key: key(b.key) }, nowIso, inv.id);
    return json(200, { ok: true }, { "Set-Cookie": await startSession(s, id, request, now) });
  }

  if (method === "POST" && path === "/auth/reset") {
    const b = await body(request);
    const inv = await openInvite(s, token(b.token), "reset", nowIso);
    const k = key(b.key);
    const salt = newSalt();
    await s.db.batch([
      { sql: "INSERT OR REPLACE INTO password_credentials (accountId, salt, hash, updatedAt) VALUES (?, ?, ?, ?)", params: [inv.accountId, salt, await passwordHash(salt, k), nowIso] },
      { sql: "UPDATE invites SET usedAt = ?, usedBy = ? WHERE id = ?", params: [nowIso, inv.accountId, inv.id] },
      // A new password ends every session.
      { sql: "DELETE FROM sessions WHERE accountId = ?", params: [inv.accountId] },
    ]);
    return json(200, { ok: true }, { "Set-Cookie": await startSession(s, inv.accountId!, request, now) });
  }

  if (method === "POST" && path === "/auth/signout") {
    if (session) await s.db.run("DELETE FROM sessions WHERE tokenHash = ?", [session.tokenHash]);
    return json(200, { ok: true }, { "Set-Cookie": sessionCookie("", s, 0) });
  }

  if (method === "POST" && path === "/auth/signout-others") {
    const me = signedIn();
    const n = await s.db.run("DELETE FROM sessions WHERE accountId = ? AND tokenHash <> ?", [me.account.id, me.tokenHash]);
    return withRenewal(json(200, { ended: n }));
  }

  // One device signed out from Settings, by its id from /auth/me.
  if (method === "POST" && path === "/auth/sessions/end") {
    const me = signedIn();
    const b = await body(request);
    const id = typeof b.id === "string" ? b.id : "";
    const n = await s.db.run("DELETE FROM sessions WHERE accountId = ? AND tokenHash = ?", [me.account.id, id]);
    if (id === me.tokenHash) return json(200, { ended: n }, { "Set-Cookie": sessionCookie("", s, 0) });
    return withRenewal(json(200, { ended: n }));
  }

  // The user allows the command line on their computer (the page /cli/login): a one-time code for its challenge,
  // which the page passes to the command line on 127.0.0.1 and which it exchanges at /auth/cli/token.
  if (method === "POST" && path === "/auth/cli/approve") {
    const me = signedIn();
    const b = await body(request);
    if (typeof b.challenge !== "string" || !TOKEN_RE.test(b.challenge)) throw new Fail(400, "The command line's request could not be read. Run ./touchdown login again.");
    const system = typeof b.system === "string" && ["macOS", "Windows", "Linux"].includes(b.system) ? b.system : "another system";
    const code = randomToken();
    await s.db.batch([
      { sql: "DELETE FROM cli_logins WHERE expiresAt <= ?", params: [nowIso] },
      {
        sql: "INSERT INTO cli_logins (codeHash, accountId, challenge, system, createdAt, expiresAt) VALUES (?, ?, ?, ?, ?, ?)",
        params: [await hashToken(code), me.account.id, b.challenge, system, nowIso, toUtcIso(now + CLI_CODE_MINUTES * 60_000)],
      },
    ]);
    return withRenewal(json(200, { code }));
  }

  if (method === "GET" && path === "/auth/me") {
    const me = signedIn();
    const a = me.account;
    const [pw, google, sessions] = await Promise.all([
      s.db.first("SELECT accountId FROM password_credentials WHERE accountId = ?", [a.id]),
      s.db.first<{ email: string }>("SELECT email FROM google_identities WHERE accountId = ?", [a.id]),
      s.db.all<{ tokenHash: string; device: string; createdAt: string; lastUsedAt: string; kind: string | null }>("SELECT tokenHash, device, createdAt, lastUsedAt, kind FROM sessions WHERE accountId = ? ORDER BY lastUsedAt DESC", [a.id]),
    ]);
    return withRenewal(
      json(200, {
        id: a.id,
        name: a.name,
        email: a.email,
        role: a.role,
        password: !!pw,
        google: google?.email ?? null,
        // A session's id is the hash of its token, which does not open it.
        sessions: sessions.map((x) => ({ id: x.tokenHash, device: x.device, cli: x.kind === "cli", createdAt: x.createdAt, lastUsedAt: x.lastUsedAt, current: x.tokenHash === me.tokenHash })),
      }),
    );
  }

  if (method === "POST" && path === "/auth/name") {
    const me = signedIn();
    const b = await body(request);
    await s.db.run("UPDATE accounts SET name = ? WHERE id = ?", [name(b.name), me.account.id]);
    return withRenewal(json(200, { ok: true }));
  }

  if (method === "POST" && (path === "/auth/password" || path === "/auth/email")) {
    const me = signedIn();
    const b = await body(request);
    const cred = await s.db.first<{ salt: string; hash: string }>("SELECT salt, hash FROM password_credentials WHERE accountId = ?", [me.account.id]);
    // Setting a first password (an account made with Google) needs no current one.
    if (cred && !sameString(await passwordHash(cred.salt, key(b.key)), cred.hash)) throw new Fail(401, "The current password is not right.");
    const newKey = key(b.newKey);
    const salt = newSalt();
    const statements = [
      { sql: "INSERT OR REPLACE INTO password_credentials (accountId, salt, hash, updatedAt) VALUES (?, ?, ?, ?)", params: [me.account.id, salt, await passwordHash(salt, newKey), nowIso] },
      { sql: "DELETE FROM sessions WHERE accountId = ? AND tokenHash <> ?", params: [me.account.id, me.tokenHash] },
    ];
    if (path === "/auth/email") {
      const e = email(b.email);
      const taken = await s.db.first<{ id: string }>("SELECT id FROM accounts WHERE email = ?", [e]);
      if (taken && taken.id !== me.account.id) throw new Fail(409, "Another account uses this address.");
      statements.unshift({ sql: "UPDATE accounts SET email = ? WHERE id = ?", params: [e, me.account.id] });
    }
    await s.db.batch(statements);
    return withRenewal(json(200, { ok: true }));
  }

  // ---------- Google ----------

  if (method === "GET" && path === "/auth/google/start") {
    const google = s.config.google;
    if (!google) throw new Fail(404, "Google sign-in is not set up on this site.");
    const invite = url.searchParams.get("invite");
    const typed = url.searchParams.get("name")?.trim().replace(/\s+/g, " ").slice(0, 80) || null;
    const start = await googleStart(s.db, google, siteOrigin(s, url), {
      purpose: "signin",
      next: safeNext(url.searchParams.get("next")),
      invite: invite && TOKEN_RE.test(invite) ? invite : null,
      name: typed,
      linkAccountId: url.searchParams.get("link") ? signedIn().account.id : null,
    }, now, s.config.secureCookies !== false);
    return new Response(null, { status: 302, headers: { Location: start.location, "Set-Cookie": start.cookie, "Cache-Control": "no-store" } });
  }

  if (method === "GET" && path === "/auth/google/callback") {
    const google = s.config.google;
    if (!google) throw new Fail(404, "Google sign-in is not set up on this site.");
    const go = (to: string, cookie?: string) => {
      const res = new Response(null, { status: 302, headers: { Location: new URL(to, url).toString(), "Cache-Control": "no-store" } });
      res.headers.append("Set-Cookie", clearGoogleCookie(s.config.secureCookies !== false));
      if (cookie) res.headers.append("Set-Cookie", cookie);
      return res;
    };
    const started = await googlePurpose(s.db, url);
    const storageBack = (code: string) => withParam(safeNext(started?.next), "storage-error", code);
    let identity: GoogleIdentity;
    let login;
    let refreshToken: string | null;
    let scope: string;
    try {
      ({ identity, login, refreshToken, scope } = await googleFinish(s.db, google, siteOrigin(s, url), url, cookieOf(request, GOOGLE_COOKIE), now, s.fetch ?? ((i, init) => fetch(i, init))));
    } catch (e) {
      if (e instanceof GoogleError) return go(started?.purpose === "storage" ? storageBack(e.problem) : `/signin?error=google-${e.problem}`);
      throw e;
    }

    if (login.purpose === "storage") {
      if (!login.linkAccountId || !standardOn(s)) return go(storageBack("failed"));
      // The user may untick Drive on Google's screen, and Google gives a lasting key only with consent.
      if (!scope.split(" ").includes(DRIVE_FILE)) return go(storageBack("no-drive"));
      if (!refreshToken) return go(storageBack("no-key"));
      await saveStorageKey(s, login.linkAccountId, identity.email, scope, refreshToken, nowIso);
      // The Google account connected for Standard also signs in, unless the account has one already or another
      // account uses this one.
      const [mine, taken] = await Promise.all([
        s.db.first("SELECT sub FROM google_identities WHERE accountId = ?", [login.linkAccountId]),
        s.db.first("SELECT accountId FROM google_identities WHERE sub = ?", [identity.sub]),
      ]);
      if (!mine && !taken) await s.db.run("INSERT INTO google_identities (accountId, sub, email, linkedAt) VALUES (?, ?, ?, ?)", [login.linkAccountId, identity.sub, identity.email, nowIso]);
      return go(withParam(safeNext(login.next), "storage", "connected"));
    }
    const owner = await s.db.first<{ accountId: string }>("SELECT accountId FROM google_identities WHERE sub = ?", [identity.sub]);

    if (login.linkAccountId) {
      if (owner && owner.accountId !== login.linkAccountId) return go("/settings?error=google-taken");
      await s.db.run("INSERT OR REPLACE INTO google_identities (accountId, sub, email, linkedAt) VALUES (?, ?, ?, ?)", [login.linkAccountId, identity.sub, identity.email, nowIso]);
      return go("/settings");
    }

    if (login.invite) {
      const back = `/join/${login.invite}`;
      if (owner) return go(`${back}?error=google-taken`);
      let inviteId: string;
      try {
        inviteId = (await openInvite(s, login.invite, "join", nowIso)).id;
        const id = await createAccount(s, { email: identity.email, name: login.name ?? identity.email.split("@")[0]!, role: "member", google: identity }, nowIso, inviteId);
        return go("/", await startSession(s, id, request, now));
      } catch (e) {
        if (e instanceof Fail) return go(`${back}?error=${e.status === 409 ? "email-taken" : "invite"}`);
        throw e;
      }
    }

    if (!owner) return go("/signin?error=google-no-account");
    return go(safeNext(login.next), await startSession(s, owner.accountId, request, now));
  }

  if (method === "DELETE" && path === "/auth/google") {
    const me = signedIn();
    if (!(await s.db.first("SELECT accountId FROM password_credentials WHERE accountId = ?", [me.account.id]))) throw new Fail(400, "Set a password first, or you could not sign in any more.");
    await s.db.run("DELETE FROM google_identities WHERE accountId = ?", [me.account.id]);
    return withRenewal(json(200, { ok: true }));
  }

  // ---------- owner ----------

  if (method === "GET" && path === "/auth/people") {
    owner();
    const people = await s.db.all<Account & { hasPassword: number; googleEmail: string | null }>(
      `SELECT a.*, (p.accountId IS NOT NULL) AS hasPassword, g.email AS googleEmail
       FROM accounts a LEFT JOIN password_credentials p ON p.accountId = a.id LEFT JOIN google_identities g ON g.accountId = a.id
       ORDER BY a.role = 'owner' DESC, a.name`,
    );
    const invites = await s.db.all<{ id: string; note: string | null; createdAt: string; expiresAt: string }>(
      "SELECT id, note, createdAt, expiresAt FROM invites WHERE purpose = 'join' AND usedAt IS NULL AND expiresAt > ? ORDER BY createdAt DESC",
      [nowIso],
    );
    return withRenewal(
      json(200, {
        people: people.map((p) => ({ id: p.id, name: p.name, email: p.email, role: p.role, password: !!p.hasPassword, google: p.googleEmail, createdAt: p.createdAt, lastSeenAt: p.lastSeenAt })),
        invites,
      }),
    );
  }

  if (method === "POST" && path === "/auth/invites") {
    const me = owner();
    const b = await body(request);
    const note = typeof b.note === "string" ? b.note.trim().slice(0, 80) || null : null;
    const link = await makeInvite(s, url, "join", null, note, me.account.id, now, INVITE_DAYS * DAY);
    return withRenewal(json(200, link));
  }

  const inviteDelete = path.match(/^\/auth\/invites\/([^/]+)$/);
  if (method === "DELETE" && inviteDelete) {
    owner();
    await s.db.run("DELETE FROM invites WHERE id = ? AND usedAt IS NULL", [inviteDelete[1]!]);
    return withRenewal(json(200, { ok: true }));
  }

  const personReset = path.match(/^\/auth\/people\/([^/]+)\/reset$/);
  if (method === "POST" && personReset) {
    const me = owner();
    const acc = await s.db.first<Account>("SELECT * FROM accounts WHERE id = ?", [personReset[1]!]);
    if (!acc) throw new Fail(404, "No such person.");
    // One open reset link per person: a new one replaces the old.
    await s.db.run("DELETE FROM invites WHERE purpose = 'reset' AND accountId = ? AND usedAt IS NULL", [acc.id]);
    return withRenewal(json(200, await makeInvite(s, url, "reset", acc.id, null, me.account.id, now, RESET_HOURS * 3_600_000)));
  }

  const personDelete = path.match(/^\/auth\/people\/([^/]+)$/);
  if (method === "DELETE" && personDelete) {
    const me = owner();
    const id = personDelete[1]!;
    if (id === me.account.id) throw new Fail(400, "The owner cannot remove their own account.");
    await dropStorageKey(s, id);
    await removeAccount(s, id);
    return withRenewal(json(200, { ok: true }));
  }

  throw new Fail(404, "Not found.");
}

/** A new account, with a password key or a Google identity (or both). */
/**
 * The command line exchanges the one-time code for its session, proving with the PKCE verifier that it is the program
 * that asked. The code works once and for a few minutes. Returns the session token, which the command line keeps.
 */
async function cliToken(request: Request, s: Server, now: number): Promise<Response> {
  const b = await body(request);
  const code = typeof b.code === "string" && TOKEN_RE.test(b.code) ? b.code : null;
  const verifier = typeof b.verifier === "string" && /^[A-Za-z0-9._~-]{43,128}$/.test(b.verifier) ? b.verifier : null;
  if (!code || !verifier) throw new Fail(400, "The sign-in could not be read. Run ./touchdown login again.");
  const codeHash = await hashToken(code);
  const row = await s.db.first<{ accountId: string; challenge: string; system: string; expiresAt: string }>("SELECT accountId, challenge, system, expiresAt FROM cli_logins WHERE codeHash = ?", [codeHash]);
  await s.db.run("DELETE FROM cli_logins WHERE codeHash = ?", [codeHash]);
  const nowIso = toUtcIso(now);
  if (!row || row.expiresAt <= nowIso || !sameString(b64url(await sha256(verifier)), row.challenge)) throw new Fail(400, "This sign-in has run out or does not match. Run ./touchdown login again.");
  const a = await s.db.first<{ name: string; email: string }>("SELECT name, email FROM accounts WHERE id = ?", [row.accountId]);
  if (!a) throw new Fail(400, "This account no longer exists.");
  const t = randomToken();
  await s.db.batch([
    {
      sql: "INSERT INTO sessions (tokenHash, accountId, createdAt, lastUsedAt, expiresAt, device, kind) VALUES (?, ?, ?, ?, ?, ?, 'cli')",
      params: [await hashToken(t), row.accountId, nowIso, nowIso, CLI_FOREVER, `Command line on ${row.system}`],
    },
    { sql: "UPDATE accounts SET lastSeenAt = ? WHERE id = ?", params: [nowIso, row.accountId] },
  ]);
  return json(200, { token: t, name: a.name, email: a.email });
}

async function createAccount(
  s: Server,
  a: { email: string; name: string; role: "owner" | "member"; key?: string; google?: GoogleIdentity },
  nowIso: string,
  inviteId?: string,
): Promise<string> {
  if (await s.db.first("SELECT id FROM accounts WHERE email = ?", [a.email])) throw new Fail(409, "An account with this address exists already. Sign in instead.");
  const id = newId();
  const statements: { sql: string; params: (string | number | null)[] }[] = [{ sql: "INSERT INTO accounts (id, email, name, role, createdAt) VALUES (?, ?, ?, ?, ?)", params: [id, a.email, a.name, a.role, nowIso] }];
  if (a.key) {
    const salt = newSalt();
    statements.push({ sql: "INSERT INTO password_credentials (accountId, salt, hash, updatedAt) VALUES (?, ?, ?, ?)", params: [id, salt, await passwordHash(salt, a.key), nowIso] });
  }
  if (a.google) statements.push({ sql: "INSERT INTO google_identities (accountId, sub, email, linkedAt) VALUES (?, ?, ?, ?)", params: [id, a.google.sub, a.google.email, nowIso] });
  // Marking the invitation used in the same transaction, only while it is still open, makes it single-use even
  // when two people open it at once.
  if (inviteId) statements.push({ sql: "UPDATE invites SET usedAt = ?, usedBy = ? WHERE id = ? AND usedAt IS NULL", params: [nowIso, id, inviteId] });
  await s.db.batch(statements);
  if (inviteId) {
    const used = await s.db.first<{ usedBy: string }>("SELECT usedBy FROM invites WHERE id = ?", [inviteId]);
    if (used?.usedBy !== id) {
      await removeAccount(s, id);
      throw new Fail(410, "This invitation has been used.");
    }
  }
  return id;
}

async function removeAccount(s: Server, id: string) {
  await s.db.batch([
    { sql: "DELETE FROM sessions WHERE accountId = ?", params: [id] },
    { sql: "DELETE FROM cli_logins WHERE accountId = ?", params: [id] },
    { sql: "DELETE FROM password_credentials WHERE accountId = ?", params: [id] },
    { sql: "DELETE FROM google_identities WHERE accountId = ?", params: [id] },
    { sql: "DELETE FROM invites WHERE accountId = ?", params: [id] },
    { sql: "DELETE FROM storage_connections WHERE accountId = ?", params: [id] },
    { sql: "DELETE FROM consents WHERE accountId = ?", params: [id] },
    { sql: "DELETE FROM accounts WHERE id = ?", params: [id] },
  ]);
}

async function makeInvite(s: Server, url: URL, purpose: "join" | "reset", accountId: string | null, note: string | null, createdBy: string, now: number, validMs: number) {
  const t = randomToken();
  const id = newId();
  const expiresAt = toUtcIso(now + validMs);
  await s.db.run("INSERT INTO invites (id, tokenHash, purpose, accountId, note, createdBy, createdAt, expiresAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?)", [
    id,
    await hashToken(t),
    purpose,
    accountId,
    note,
    createdBy,
    toUtcIso(now),
    expiresAt,
  ]);
  const base = s.config.origins[0] ?? url.origin;
  return { id, link: `${base}/${purpose}/${t}`, expiresAt };
}

async function openInvite(s: Server, t: string, purpose: "join" | "reset" | null, nowIso: string) {
  const inv = await s.db.first<{ id: string; purpose: "join" | "reset"; accountId: string | null; expiresAt: string; usedAt: string | null }>(
    "SELECT id, purpose, accountId, expiresAt, usedAt FROM invites WHERE tokenHash = ?",
    [await hashToken(t)],
  );
  if (!inv || (purpose && inv.purpose !== purpose)) throw new Fail(404, "This link is not valid.");
  if (inv.usedAt) throw new Fail(410, "This link has been used.");
  if (inv.expiresAt <= nowIso) throw new Fail(410, "This link has expired. Ask the owner for a new one.");
  return inv;
}

// ---------- Standard mode: the storage key (docs/32, "Connecting storage") ----------

const standardOn = (s: Server) => !!(s.config.google && s.config.tokenKey);

function withParam(path: string, key: string, value: string): string {
  return `${path}${path.includes("?") ? "&" : "?"}${key}=${encodeURIComponent(value)}`;
}

interface StorageRow {
  id: string;
  accountId: string;
  externalAccount: string | null;
  tokenCiphertext: string;
  tokenIv: string;
  status: "ok" | "broken";
}

async function saveStorageKey(s: Server, accountId: string, externalAccount: string, scope: string, refreshToken: string, nowIso: string) {
  // One connection per account: connecting again replaces the key in the same row. The old key is not revoked,
  // because with Google that would also end the new one (it belongs to the same grant).
  const existing = await s.db.first<{ id: string }>("SELECT id FROM storage_connections WHERE accountId = ?", [accountId]);
  const id = existing?.id ?? newId();
  const sealed = await sealToken(s.config.tokenKey!, JSON.stringify({ refresh_token: refreshToken }), `${id}|${accountId}`);
  await s.db.run(
    `INSERT OR REPLACE INTO storage_connections
      (id, accountId, backend, format, location, externalAccount, scope, tokenCiphertext, tokenIv, tokenKeyId, tokenFormat, status, statusAt, createdAt, lastUsedAt)
     VALUES (?, ?, 'gdrive', 'json_tables', NULL, ?, ?, ?, ?, '1', 1, 'ok', ?, ?, NULL)`,
    [id, accountId, externalAccount, scope, sealed.ciphertext, sealed.iv, nowIso, nowIso],
  );
}

async function storageKey(s: Server, row: StorageRow): Promise<string> {
  const plain = await openToken(s.config.tokenKey!, { ciphertext: row.tokenCiphertext, iv: row.tokenIv }, `${row.id}|${row.accountId}`);
  return (JSON.parse(plain) as { refresh_token: string }).refresh_token;
}

/** Revoke the account's key with Google and delete it, with the terms accepted. */
async function dropStorageKey(s: Server, accountId: string) {
  const row = await s.db.first<StorageRow>("SELECT * FROM storage_connections WHERE accountId = ?", [accountId]);
  if (row && s.config.tokenKey) {
    try {
      await googleRevoke(await storageKey(s, row), s.fetch ?? ((i, init) => fetch(i, init)));
    } catch {
      // a key that cannot be opened cannot be used either; it is deleted below
    }
  }
  await s.db.batch([
    { sql: "DELETE FROM storage_connections WHERE accountId = ?", params: [accountId] },
    { sql: "DELETE FROM consents WHERE accountId = ?", params: [accountId] },
  ]);
}

async function storage(request: Request, s: Server, url: URL, now: number, session: Session): Promise<Response> {
  const path = url.pathname;
  const method = request.method;
  const me = session.account;
  const nowIso = toUtcIso(now);
  checkOrigin(request, s);
  checkCli(session, method, path);
  const row = await s.db.first<StorageRow>("SELECT * FROM storage_connections WHERE accountId = ?", [me.id]);

  if (method === "GET" && path === "/api/storage") {
    const accepted = await s.db.first("SELECT accountId FROM consents WHERE accountId = ? AND termsVersion = ?", [me.id, TERMS_VERSION]);
    return json(200, { available: standardOn(s), termsVersion: TERMS_VERSION, accepted: !!accepted, connected: !!row, account: row?.externalAccount ?? null, status: row?.status ?? null });
  }

  if (method === "POST" && path === "/api/storage/terms") {
    const b = await body(request);
    if (b.version !== TERMS_VERSION) throw new Fail(409, "These terms have changed. Reload the page to read the new ones.");
    await s.db.run("INSERT OR IGNORE INTO consents (accountId, termsVersion, acceptedAt) VALUES (?, ?, ?)", [me.id, TERMS_VERSION, nowIso]);
    return json(200, { ok: true });
  }

  if (method === "GET" && path === "/api/storage/connect") {
    const back = safeNext(url.searchParams.get("next"));
    const goBack = (code: string) => new Response(null, { status: 302, headers: { Location: new URL(withParam(back, "storage-error", code), url).toString(), "Cache-Control": "no-store" } });
    if (!standardOn(s)) return goBack("unavailable");
    if (!(await s.db.first("SELECT accountId FROM consents WHERE accountId = ? AND termsVersion = ?", [me.id, TERMS_VERSION]))) return goBack("terms");
    const start = await googleStart(s.db, s.config.google!, siteOrigin(s, url), { purpose: "storage", next: back, invite: null, name: null, linkAccountId: me.id }, now, s.config.secureCookies !== false);
    return new Response(null, { status: 302, headers: { Location: start.location, "Set-Cookie": start.cookie, "Cache-Control": "no-store" } });
  }

  if (method === "POST" && path === "/api/storage/token") {
    if (!row) throw new Fail(404, "Standard mode is not connected for this account.");
    if (row.status === "broken" || !standardOn(s)) throw new Fail(409, "The key to your Google Drive no longer works. Connect Google Drive again.");
    let access: Awaited<ReturnType<typeof googleAccess>>;
    try {
      access = await googleAccess(s.config.google!, await storageKey(s, row), s.fetch ?? ((i, init) => fetch(i, init)));
    } catch (e) {
      // Google down or refusing for another reason than the key: the app shows "Not synced" and tries again later.
      if (e instanceof GoogleError || e instanceof TypeError) throw new Fail(502, "Google did not answer. Touchdown tries again shortly.");
      throw e;
    }
    if (access === "broken") {
      await s.db.run("UPDATE storage_connections SET status = 'broken', statusAt = ? WHERE id = ?", [nowIso, row.id]);
      throw new Fail(409, "The key to your Google Drive no longer works. Connect Google Drive again.");
    }
    await s.db.run("UPDATE storage_connections SET lastUsedAt = ? WHERE id = ?", [nowIso, row.id]);
    return json(200, { accessToken: access.accessToken, expiresAt: toUtcIso(now + access.expiresIn * 1000), account: row.externalAccount });
  }

  if (method === "POST" && path === "/api/storage/disconnect") {
    await dropStorageKey(s, me.id);
    return json(200, { ok: true });
  }

  throw new Fail(404, "Not found.");
}
