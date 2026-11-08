// The signed-in account (docs/33-accounts-and-sign-in.md), from the server's /auth/ requests. Passwords are turned
// into keys here before they are sent (lib/passwordKey.ts).

import { t } from "@touchdown/i18n";
import { passwordKey } from "../lib/passwordKey.ts";

export interface Me {
  id: string;
  name: string;
  email: string;
  role: "owner" | "member";
  password: boolean;
  /** When the password was set or last changed. */
  passwordChangedAt: string | null;
  google: string | null;
  /** The interface's language chosen in Settings, kept with the account for share links (docs/33); null for none. */
  language: string | null;
  /** `id` names a session for signing it out; `cli` marks the command line's. */
  sessions: { id: string; device: string; cli: boolean; createdAt: string; lastUsedAt: string; current: boolean }[];
}

export interface Person {
  id: string;
  name: string;
  email: string;
  role: "owner" | "member";
  password: boolean;
  google: string | null;
  createdAt: string;
  lastSeenAt: string | null;
  /** When the owner suspended them: they cannot sign in, and their links stop, until reinstated. */
  suspendedAt: string | null;
}

export interface OpenInvite {
  id: string;
  note: string | null;
  createdAt: string;
  expiresAt: string;
}

export interface Link {
  id: string;
  link: string;
  expiresAt: string;
}

export class AuthError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export async function call<T>(method: "GET" | "POST" | "DELETE", path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, { method, headers: body ? { "Content-Type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined, credentials: "same-origin" });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new AuthError(res.status, data.error ?? t("data.request.failed", { status: res.status }));
  return data;
}

/** The last account signed in on this browser, so the app can open its log offline. */
const LAST_ACCOUNT = "td-account";

/** Who is signed in: the account, "signed-out", or "offline" when the server cannot be reached. */
export async function whoAmI(): Promise<Me | "signed-out" | "offline"> {
  try {
    const me = await call<Me>("GET", "/auth/me");
    try {
      localStorage.setItem(LAST_ACCOUNT, me.id);
    } catch {
      // storage unavailable: the app still opens, only not offline
    }
    return me;
  } catch (e) {
    return e instanceof AuthError && e.status === 401 ? "signed-out" : "offline";
  }
}

export function lastAccount(): string | null {
  try {
    return localStorage.getItem(LAST_ACCOUNT);
  } catch {
    return null;
  }
}

/** Signed out: offline, the app no longer opens this account's log. */
export function forgetAccount(): void {
  try {
    localStorage.removeItem(LAST_ACCOUNT);
  } catch {
    // storage unavailable: nothing was kept
  }
}

let siteId: Promise<string> | null = null;
const site = () => (siteId ??= call<{ siteId: string }>("GET", "/auth/site").then((s) => s.siteId));

export const account = {
  me: () => call<Me>("GET", "/auth/me"),
  google: () => call<{ google: boolean }>("GET", "/auth/site").then((s) => s.google),
  rename: (name: string) => call("POST", "/auth/name", { name }),
  setLanguage: (language: string | null) => call("POST", "/auth/language", { language }),
  async changePassword(email: string, current: string | null, next: string) {
    const id = await site();
    return call("POST", "/auth/password", { key: current === null ? undefined : await passwordKey(current, email, id), newKey: await passwordKey(next, email, id) });
  },
  async changeEmail(oldEmail: string, newEmail: string, password: string) {
    const id = await site();
    return call("POST", "/auth/email", { key: await passwordKey(password, oldEmail, id), email: newEmail, newKey: await passwordKey(password, newEmail, id) });
  },
  disconnectGoogle: () => call("DELETE", "/auth/google"),
  signOut: () => call("POST", "/auth/signout"),
  signOutOthers: () => call<{ ended: number }>("POST", "/auth/signout-others"),
  endSession: (id: string) => call<{ ended: number }>("POST", "/auth/sessions/end", { id }),
  people: () => call<{ people: Person[]; invites: OpenInvite[] }>("GET", "/auth/people"),
  invite: (note: string) => call<Link>("POST", "/auth/invites", { note }),
  withdraw: (id: string) => call("DELETE", `/auth/invites/${encodeURIComponent(id)}`),
  resetLink: (id: string) => call<Link>("POST", `/auth/people/${encodeURIComponent(id)}/reset`),
  remove: (id: string) => call("DELETE", `/auth/people/${encodeURIComponent(id)}`),
  suspend: (id: string) => call("POST", `/auth/people/${encodeURIComponent(id)}/suspend`),
  reinstate: (id: string) => call("POST", `/auth/people/${encodeURIComponent(id)}/reinstate`),
};
