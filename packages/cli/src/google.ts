// Google Drive for the command line (docs/21; docs/33, "The command line"). The access comes the way the web app's
// does, from the web app's own Google client, so the command line reaches the same Touchdown folder:
// - Standard mode: the site gives it, as it gives the browser, with the command line's session.
// - Private mode: the user's browser gets it from Google on the page /cli/drive and posts it to the command line on
//   127.0.0.1, never through the site. It lasts about an hour and is kept in data/private/ until then, never printed;
//   after that the command line opens the page again.

import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { SignInNeeded, type DriveAuth } from "@touchdown/storage";
import { privatePath } from "./paths.ts";
import { NotSignedIn, savedSession, siteFetch, viaBrowser } from "./site.ts";

export const ACCESS_FILE = privatePath("google-access.json");
/** An access this close to its end is not used: a command started with it could fail halfway. */
const MARGIN_MS = 2 * 60_000;

export interface Access {
  account: string;
  accessToken: string;
  /** Milliseconds. */
  expiresAt: number;
}

const usable = (a: Access | null, account: string | null): a is Access => !!a && a.expiresAt - MARGIN_MS > Date.now() && (!account || a.account === account);

/** Standard mode: an hour's access from the site, as the browser gets it. */
export class StandardDriveAuth implements DriveAuth {
  private access: Access | null = null;
  private readonly doFetch?: typeof fetch;

  constructor(doFetch?: typeof fetch) {
    this.doFetch = doFetch;
  }

  async token(): Promise<string> {
    if (usable(this.access, null)) return this.access.accessToken;
    let res: Response;
    try {
      res = await siteFetch("/api/storage/token", { method: "POST" }, this.doFetch);
    } catch (e) {
      if (e instanceof NotSignedIn) throw new SignInNeeded(e.message);
      throw e;
    }
    const body = (await res.json().catch(() => ({}))) as { accessToken?: string; expiresAt?: string; account?: string; error?: string };
    if (res.status === 404 || res.status === 409) throw new SignInNeeded(`${body.error ?? "Standard mode is not connected."} Then choose the storage again: ./touchdown storage drive`);
    if (!res.ok || !body.accessToken) throw new Error(body.error ?? `The site did not give access to Google Drive (${res.status}).`);
    this.access = { account: body.account ?? "", accessToken: body.accessToken, expiresAt: Date.parse(body.expiresAt ?? "") || Date.now() + 50 * 60_000 };
    return body.accessToken;
  }

  refused(token: string): void {
    if (this.access?.accessToken === token) this.access = null;
  }
}

function savedAccess(file: string): Access | null {
  try {
    const a = JSON.parse(readFileSync(file, "utf8")) as Partial<Access>;
    return typeof a.accessToken === "string" && typeof a.account === "string" && typeof a.expiresAt === "number" ? (a as Access) : null;
  } catch {
    return null;
  }
}

/** Private mode: an hour's access handed over by the user's browser, kept until it runs out. */
export class BrowserDriveAuth implements DriveAuth {
  /** The account holding the log; null the first time, when the user picks it in Google's window. */
  readonly account: string | null;
  private readonly opts: { say?: (line: string) => void; file?: string; handOver?: (account: string | null, say?: (line: string) => void) => Promise<Access> };

  constructor(account: string | null, opts: BrowserDriveAuth["opts"] = {}) {
    this.account = account;
    this.opts = opts;
  }

  private get file() {
    return this.opts.file ?? ACCESS_FILE;
  }

  async token(): Promise<string> {
    const saved = savedAccess(this.file);
    if (usable(saved, this.account)) return saved.accessToken;
    const a = await (this.opts.handOver ?? handOver)(this.account, this.opts.say);
    if (this.account && a.account !== this.account) throw new SignInNeeded(`Google Drive access came for ${a.account}, but the log is in the Google Drive of ${this.account}. Run the command again and choose ${this.account}.`);
    mkdirSync(dirname(this.file), { recursive: true });
    writeFileSync(this.file, JSON.stringify(a) + "\n", { mode: 0o600 });
    return a.accessToken;
  }

  refused(token: string): void {
    if (savedAccess(this.file)?.accessToken === token) rmSync(this.file, { force: true });
  }

  /** The account the access is for: the one the user picked the first time. */
  async signedInAccount(): Promise<string> {
    await this.token();
    return savedAccess(this.file)!.account;
  }
}

/** Opens /cli/drive in the browser and waits for the access it posts back. */
async function handOver(account: string | null, say: (line: string) => void = (l) => console.error(l)): Promise<Access> {
  const s = savedSession();
  if (!s) throw new SignInNeeded("The command line is not signed in to Touchdown. Sign in with ./touchdown login.");
  say(account ? `The command line needs an hour's access to Google Drive (${account}).` : "The command line needs an hour's access to Google Drive.");
  const f = await viaBrowser(s.site, "/cli/drive", account ? { account } : {}, say);
  if (f.get("error")) throw new SignInNeeded("Google Drive access was not given: cancelled in the browser.");
  const accessToken = f.get("access_token");
  const expiresAt = Number(f.get("expires_at"));
  const given = f.get("account");
  if (!accessToken || !given || !Number.isFinite(expiresAt)) throw new Error("The browser's answer could not be read. Run the command again.");
  return { account: given, accessToken, expiresAt };
}

/** Forget the access kept for Private mode. Google's permission stays, so the web app keeps syncing. */
export function forgetDriveAccess(): void {
  rmSync(ACCESS_FILE, { force: true });
}
