// The pages anyone can open (docs/33-accounts-and-sign-in.md): sign in, join with an invitation, set a new password
// with a reset link, and set up the first account. Built on their own (vite.signin.config.ts), with no app code,
// and served by the server without a session.

import { StrictMode, useEffect, useState, type FormEvent, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import "../styles/app.css";
import { Icon } from "../lib/icons.tsx";
import { MIN_PASSWORD, passwordKey, passwordProblem } from "../lib/passwordKey.ts";
import { Wordmark } from "../components/Wordmark.tsx";

interface Site {
  siteId: string;
  setupNeeded: boolean;
  google: boolean;
  signedIn: boolean;
}

interface Invite {
  purpose: "join" | "reset";
  email: string | null;
  name: string | null;
}

/** What went wrong on the way back from Google or with an invitation (the server's ?error= codes). */
const ERRORS: Record<string, string> = {
  "google-cancelled": "Google sign-in was cancelled.",
  "google-failed": "Google sign-in did not work. Try again.",
  "google-expired": "The Google sign-in took too long, or began in another browser. Try again.",
  "google-no-account": "No account here uses this Google account. Sign in with your password and connect Google in Settings, or ask the owner for an invitation.",
  "google-taken": "This Google account already has an account here. Sign in instead.",
  "email-taken": "An account with this Google address exists already. Sign in instead.",
  invite: "This invitation is no longer valid. Ask the owner for a new one.",
};

const errorFromUrl = () => ERRORS[new URLSearchParams(location.search).get("error") ?? ""] ?? null;

/** Where to go after signing in: a path on this site, nothing else. */
function next(): string {
  const n = new URLSearchParams(location.search).get("next");
  return n && n.startsWith("/") && !n.startsWith("//") && !n.startsWith("/\\") ? n : "/";
}

async function request<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
  try {
    const res = await fetch(path, { method, headers: body ? { "Content-Type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined, credentials: "same-origin" });
    const data = (await res.json().catch(() => ({}))) as T & { error?: string };
    return res.ok ? { ok: true, data } : { ok: false, error: data.error ?? `Something went wrong (${res.status}). Try again.` };
  } catch {
    return { ok: false, error: "The site could not be reached. Check the connection and try again." };
  }
}

function Frame({ title, sub, children }: { title: string; sub?: ReactNode; children: ReactNode }) {
  return (
    <>
      <header className="masthead">
        <div className="page masthead__bar">
          <span className="wordmark">
            <Wordmark />
          </span>
        </div>
      </header>
      <main id="view" className="page page--form signin">
        <div className="view-top" />
        <h1 className="lead">{title}</h1>
        {sub && <p className="form-sub">{sub}</p>}
        {children}
        <p className="signin__policies">
          <a href="/privacy">Privacy policy</a> · <a href="/terms">Terms of service</a>
        </p>
      </main>
    </>
  );
}

function Problem({ text }: { text: string | null }) {
  if (!text) return null;
  return (
    <p className="status-line status-line--error" role="alert">
      <Icon name="circle-x" />
      <span>{text}</span>
    </p>
  );
}

function Input({ label, ...props }: { label: string } & React.ComponentProps<"input">) {
  return (
    <label className="field field--wide">
      <span className="field__label">{label}</span>
      <input className="input" spellCheck={false} required {...props} />
    </label>
  );
}

/** `query` gives the address's query, worked out on the click; null keeps the user here. */
function GoogleButton({ site, query }: { site: Site; query: () => string | null }) {
  if (!site.google) return null;
  return (
    <>
      <p className="signin__or">or</p>
      <div className="button-row">
        <button
          type="button"
          className="btn btn--quiet"
          onClick={() => {
            const q = query();
            if (q !== null) location.assign(`/auth/google/start?${q}`);
          }}
        >
          Continue with Google
        </button>
      </div>
    </>
  );
}

/** A form that turns the password into its key before sending; `send` gets the key. */
function useSubmit(send: (form: FormData) => Promise<string | null>) {
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(errorFromUrl);
  const onSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setBusy(true);
    setProblem(null);
    const p = await send(new FormData(e.currentTarget));
    setProblem(p);
    setBusy(false);
  };
  return { busy, problem, setProblem, onSubmit: (e: FormEvent<HTMLFormElement>) => void onSubmit(e) };
}

const text = (f: FormData, k: string) => String(f.get(k) ?? "");

function SignIn({ site }: { site: Site }) {
  const { busy, problem, onSubmit } = useSubmit(async (f) => {
    const email = text(f, "email");
    const r = await request("POST", "/auth/signin", { email, key: await passwordKey(text(f, "password"), email, site.siteId) });
    if (!r.ok) return r.error;
    location.assign(next());
    return null;
  });
  return (
    <Frame title="Sign in">
      <form className="signin__form" onSubmit={onSubmit}>
        <Input label="Email address" name="email" type="email" autoComplete="username" autoFocus />
        <Input label="Password" name="password" type="password" autoComplete="current-password" />
        <Problem text={problem} />
        <div className="button-row">
          <button type="submit" className="btn btn--primary" disabled={busy}>
            {busy ? "Signing in…" : "Sign in"}
          </button>
        </div>
      </form>
      <GoogleButton site={site} query={() => `next=${encodeURIComponent(next())}`} />
      <p className="form-sub signin__note">New here? You need an invitation link from the person who runs this site. Forgot your password? Ask them for a reset link.</p>
    </Frame>
  );
}

function NewPassword() {
  return (
    <>
      <Input label="Password" name="password" type="password" autoComplete="new-password" minLength={MIN_PASSWORD} />
      <Input label="Password again" name="repeat" type="password" autoComplete="new-password" minLength={MIN_PASSWORD} />
      <p className="form-sub">At least {MIN_PASSWORD} characters. It never leaves this browser: only a key made from it is sent.</p>
    </>
  );
}

function Join({ site, token }: { site: Site; token: string }) {
  const [invite, setInvite] = useState<Invite | null | string>(null);
  useEffect(() => {
    void request<Invite>("GET", `/auth/invite/${encodeURIComponent(token)}`).then((r) => setInvite(r.ok ? (r.data.purpose === "join" ? r.data : "This link is not an invitation.") : r.error));
  }, [token]);
  const { busy, problem, setProblem, onSubmit } = useSubmit(async (f) => {
    const p = passwordProblem(text(f, "password"), text(f, "repeat"));
    if (p) return p;
    const email = text(f, "email");
    const r = await request("POST", "/auth/join", { invite: token, name: text(f, "name"), email, key: await passwordKey(text(f, "password"), email, site.siteId) });
    if (!r.ok) return r.error;
    location.assign("/");
    return null;
  });
  if (invite === null) return <Frame title="Join Touchdown">{null}</Frame>;
  if (typeof invite === "string") return <Frame title="Join Touchdown" sub={invite}>{null}</Frame>;
  return (
    <Frame title="Join Touchdown" sub="You have an invitation. Make your account.">
      <form className="signin__form" onSubmit={onSubmit}>
        <Input label="Your name" name="name" autoComplete="name" maxLength={80} autoFocus />
        <Input label="Email address" name="email" type="email" autoComplete="username" />
        <NewPassword />
        <Problem text={problem} />
        <div className="button-row">
          <button type="submit" className="btn btn--primary" disabled={busy}>
            {busy ? "Making your account…" : "Make my account"}
          </button>
        </div>
      </form>
      <GoogleButton
        site={site}
        query={() => {
          const name = (document.querySelector<HTMLInputElement>("input[name=name]")?.value ?? "").trim();
          if (!name) {
            setProblem("Enter your name first. Google is used only to sign in.");
            return null;
          }
          return `invite=${encodeURIComponent(token)}&name=${encodeURIComponent(name)}`;
        }}
      />
    </Frame>
  );
}

function Reset({ site, token }: { site: Site; token: string }) {
  const [invite, setInvite] = useState<Invite | null | string>(null);
  useEffect(() => {
    void request<Invite>("GET", `/auth/invite/${encodeURIComponent(token)}`).then((r) => setInvite(r.ok ? (r.data.purpose === "reset" ? r.data : "This link is not a reset link.") : r.error));
  }, [token]);
  const { busy, problem, onSubmit } = useSubmit(async (f) => {
    if (typeof invite !== "object" || !invite?.email) return "This link is not valid.";
    const p = passwordProblem(text(f, "password"), text(f, "repeat"));
    if (p) return p;
    const r = await request("POST", "/auth/reset", { token, key: await passwordKey(text(f, "password"), invite.email, site.siteId) });
    if (!r.ok) return r.error;
    location.assign("/");
    return null;
  });
  if (invite === null) return <Frame title="New password">{null}</Frame>;
  if (typeof invite === "string") return <Frame title="New password" sub={invite}>{null}</Frame>;
  return (
    <Frame title="New password" sub={`For ${invite.email}. Setting it signs you out everywhere else.`}>
      <form className="signin__form" onSubmit={onSubmit}>
        <input type="email" name="username" autoComplete="username" value={invite.email ?? ""} readOnly hidden />
        <NewPassword />
        <Problem text={problem} />
        <div className="button-row">
          <button type="submit" className="btn btn--primary" disabled={busy}>
            {busy ? "Saving…" : "Set the password"}
          </button>
        </div>
      </form>
    </Frame>
  );
}

function Setup({ site }: { site: Site }) {
  const { busy, problem, onSubmit } = useSubmit(async (f) => {
    const p = passwordProblem(text(f, "password"), text(f, "repeat"));
    if (p) return p;
    const email = text(f, "email");
    const r = await request("POST", "/auth/setup", { setupToken: text(f, "setupToken"), name: text(f, "name"), email, key: await passwordKey(text(f, "password"), email, site.siteId) });
    if (!r.ok) return r.error;
    location.assign("/");
    return null;
  });
  if (!site.setupNeeded) {
    return (
      <Frame title="Set up Touchdown" sub="This site is set up already.">
        <div className="button-row">
          <a className="btn btn--primary" href="/signin">
            Sign in
          </a>
        </div>
      </Frame>
    );
  }
  return (
    <Frame title="Set up Touchdown" sub="Make the owner's account. The owner invites everyone else.">
      <form className="signin__form" onSubmit={onSubmit}>
        <Input label="Setup secret" name="setupToken" type="password" autoComplete="off" autoFocus />
        <Input label="Your name" name="name" autoComplete="name" maxLength={80} />
        <Input label="Email address" name="email" type="email" autoComplete="username" />
        <NewPassword />
        <Problem text={problem} />
        <div className="button-row">
          <button type="submit" className="btn btn--primary" disabled={busy}>
            {busy ? "Setting up…" : "Make the owner's account"}
          </button>
        </div>
      </form>
    </Frame>
  );
}

function Page() {
  const [site, setSite] = useState<Site | string | null>(null);
  useEffect(() => {
    void request<Site>("GET", "/auth/site").then((r) => setSite(r.ok ? r.data : r.error));
  }, []);
  if (site === null) return null;
  if (typeof site === "string") return <Frame title="Touchdown" sub={site}>{null}</Frame>;
  const [, page, token] = location.pathname.split("/");
  if (page === "join" && token) return <Join site={site} token={token} />;
  if (page === "reset" && token) return <Reset site={site} token={token} />;
  if (page === "setup") return <Setup site={site} />;
  if (site.signedIn) {
    location.replace(next());
    return null;
  }
  return <SignIn site={site} />;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Page />
  </StrictMode>,
);
