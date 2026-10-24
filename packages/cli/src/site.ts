// The command line's sign-in to the user's Touchdown site (docs/33, "The command line"), through the site's own
// sign-in, as a browser is signed in. `./touchdown login` opens the site's page /cli/login in the browser; the user
// allows it there; the page passes a one-time code to the command line on 127.0.0.1, and the command line exchanges
// it, with its PKCE verifier, for a session of its own. The session lasts until it is signed out. Its token is kept in
// data/private/ and never printed.

import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { dirname } from "node:path";
import { privatePath } from "./paths.ts";

export const SESSION_FILE = privatePath("touchdown-session.json");
/** The hosted site, signed in to when no other is given. A test keeps it equal to SITE_ORIGINS in apps/web/wrangler.jsonc. */
export const DEFAULT_SITE = "https://touchdown.amwhatiam.org";
const WAIT_MS = 5 * 60_000;

export interface SavedSession {
  /** The site's address, such as https://touchdown.example.org. */
  site: string;
  token: string;
  name: string;
  email: string;
  savedAt: string;
}

/** The command line is not signed in to its site, or no longer. */
export class NotSignedIn extends Error {}

const base64url = (b: Buffer) => b.toString("base64url");

export function savedSession(): SavedSession | null {
  try {
    const s = JSON.parse(readFileSync(SESSION_FILE, "utf8")) as Partial<SavedSession>;
    return typeof s.site === "string" && typeof s.token === "string" ? (s as SavedSession) : null;
  } catch {
    return null;
  }
}

function saveSession(s: SavedSession) {
  mkdirSync(dirname(SESSION_FILE), { recursive: true });
  writeFileSync(SESSION_FILE, JSON.stringify(s, null, 2) + "\n", { mode: 0o600 });
}

/** The site's address from what the user typed: https, or http only for this computer (the dev server). */
export function siteAddress(typed: string): string {
  let url: URL;
  try {
    url = new URL(/^[a-z]+:\/\//i.test(typed) ? typed : `https://${typed}`);
  } catch {
    throw new Error(`${typed} is not a web address.`);
  }
  const local = url.hostname === "127.0.0.1" || url.hostname === "localhost";
  if (url.protocol !== "https:" && !(local && url.protocol === "http:")) throw new Error("The site's address must start with https://.");
  return url.origin;
}

/** Opens the address in the browser; with TOUCHDOWN_NO_BROWSER=1 (a computer without one, or tests) it is only printed. */
export function openBrowser(url: string) {
  if (process.env.TOUCHDOWN_NO_BROWSER === "1") return;
  const [cmd, args] = process.platform === "darwin" ? ["open", [url]] : process.platform === "win32" ? ["cmd", ["/c", "start", "", url]] : ["xdg-open", [url]];
  try {
    spawn(cmd, args, { stdio: "ignore", detached: true }).on("error", () => undefined).unref();
  } catch {
    // The address is printed as well.
  }
}

const PAGE = (title: string, text: string) =>
  `<!doctype html><meta charset="utf-8"><title>${title}</title><body style="font:16px system-ui;margin:3em auto;max-width:32em"><h1 style="font-size:1.3em">${title}</h1><p>${text}</p>`;

/**
 * A page on 127.0.0.1 that receives the browser's answer, as an address (GET) or a form (POST), and only with the
 * state the command line made. Resolves to the fields sent.
 */
export function loopback(state: string): Promise<{ port: number; answer: Promise<URLSearchParams> }> {
  return new Promise((ready, failed) => {
    let settle!: (v: URLSearchParams) => void;
    let fail!: (e: Error) => void;
    const answer = new Promise<URLSearchParams>((res, rej) => {
      settle = res;
      fail = rej;
    });
    const server = createServer((req, res) => {
      if (new URL(req.url ?? "/", "http://127.0.0.1").pathname !== "/") {
        res.writeHead(404).end();
        return;
      }
      const chunks: Buffer[] = [];
      req.on("data", (c: Buffer) => chunks.push(c));
      req.on("end", () => {
        const fields = req.method === "POST" ? new URLSearchParams(Buffer.concat(chunks).toString("utf8")) : new URL(req.url ?? "/", "http://127.0.0.1").searchParams;
        if (fields.get("state") !== state) {
          res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" }).end(PAGE("Not for this command", "This answer does not belong to the command that is waiting. Run the command again."));
          return;
        }
        const ok = !fields.get("error");
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }).end(ok ? PAGE("Done", "You can close this tab and go back to the terminal.") : PAGE("Cancelled", "Nothing was given to the command line. You can close this tab."));
        clearTimeout(timer);
        server.close();
        settle(fields);
      });
    });
    const timer = setTimeout(() => {
      server.close();
      fail(new Error("No answer from the browser within 5 minutes. Run the command again."));
    }, WAIT_MS);
    server.on("error", failed);
    server.listen(0, "127.0.0.1", () => {
      const a = server.address();
      ready({ port: typeof a === "object" && a ? a.port : 0, answer });
    });
  });
}

/** The page on the site for the command line, opened in the browser; resolves to what the browser sent back. */
export async function viaBrowser(site: string, path: string, query: Record<string, string>, say: (line: string) => void): Promise<URLSearchParams> {
  const state = base64url(randomBytes(16));
  const { port, answer } = await loopback(state);
  const url = `${site}${path}?${new URLSearchParams({ ...query, port: String(port), state })}`;
  say("Opening Touchdown in your browser. If it does not open, go to:");
  say(url);
  openBrowser(url);
  return answer;
}

const SYSTEM = process.platform === "darwin" ? "macOS" : process.platform === "win32" ? "Windows" : "Linux";

/** Sign the command line in to the site: the user allows it in the browser. */
export async function login(site: string, say: (line: string) => void, doFetch: typeof fetch = (i, init) => fetch(i, init)): Promise<SavedSession> {
  const verifier = base64url(randomBytes(32));
  const challenge = base64url(createHash("sha256").update(verifier).digest());
  const fields = await viaBrowser(site, "/cli/login", { challenge, system: SYSTEM }, say);
  if (fields.get("error")) throw new Error("Not signed in: cancelled in the browser.");
  const res = await doFetch(`${site}/auth/cli/token`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code: fields.get("code"), verifier }) });
  const body = (await res.json().catch(() => ({}))) as { token?: string; name?: string; email?: string; error?: string };
  if (!res.ok || !body.token) throw new Error(body.error ?? `The site did not sign the command line in (${res.status}).`);
  const s: SavedSession = { site, token: body.token, name: body.name ?? "", email: body.email ?? "", savedAt: new Date().toISOString() };
  saveSession(s);
  return s;
}

/** A request to the site with the command line's session. */
export async function siteFetch(path: string, init: RequestInit = {}, doFetch: typeof fetch = (i, x) => fetch(i, x)): Promise<Response> {
  const s = savedSession();
  if (!s) throw new NotSignedIn("The command line is not signed in to Touchdown. Sign in with ./touchdown login.");
  const res = await doFetch(`${s.site}${path}`, { ...init, headers: { ...(init.headers as Record<string, string>), Authorization: `Bearer ${s.token}`, Accept: "application/json" } });
  if (res.status === 401) throw new NotSignedIn("The command line is no longer signed in to Touchdown (signed out in Settings?). Sign in again with ./touchdown login.");
  return res;
}

/** Sign out: the session ends on the site and its token is deleted here. */
export async function logout(doFetch?: typeof fetch): Promise<boolean> {
  if (!savedSession()) return false;
  await siteFetch("/auth/signout", { method: "POST" }, doFetch).catch(() => null);
  if (existsSync(SESSION_FILE)) rmSync(SESSION_FILE);
  return true;
}

export const LOGIN_HELP = `Usage: ./touchdown login [SITE]
       ./touchdown logout

Signs the command line in to Touchdown, as a browser is signed in: a page opens in your browser, where you
allow it. Without SITE it signs in to ${DEFAULT_SITE}; SITE chooses another, such as the dev
server (http://127.0.0.1:5173). The sign-in lasts until you sign it
out, with ./touchdown logout or in the web app under Settings, Signed in on. It is kept in
data/private/touchdown-session.json.

With it, ./touchdown storage drive reaches the log in your Google Drive the way the web app does.`;

/** `./touchdown login [SITE]` */
export async function loginCommand(args: string[], say: (line: string) => void): Promise<void> {
  if (args.includes("--help") || args.includes("-h") || args.length > 1) {
    console.log(LOGIN_HELP);
    process.exit(args.length > 1 ? 1 : 0);
  }
  const current = savedSession();
  const site = siteAddress(args[0] ?? DEFAULT_SITE);
  if (current?.site === site) {
    const me = await siteFetch("/auth/me").catch(() => null);
    if (me?.ok) {
      console.log(`Signed in to ${site} as ${current.name} (${current.email}) already. ./touchdown logout signs out.`);
      return;
    }
  }
  const s = await login(site, say);
  console.log(`Signed in to ${site} as ${s.name} (${s.email}). The command line stays signed in until ./touchdown logout, or until you sign it out in Settings.`);
}

/** `./touchdown logout` */
export async function logoutCommand(): Promise<void> {
  const { forgetDriveAccess } = await import("./google.ts");
  forgetDriveAccess();
  console.log((await logout()) ? "Signed out: the command line's session has ended." : "The command line was not signed in.");
}
