// The pages anyone can open (docs/33-accounts-and-sign-in.md): sign in, join with an invitation, set a new password
// with a reset link, and set up the first account. Built on their own (vite.signin.config.ts), with no app code,
// and served by the server without a session.

import { StrictMode, useEffect, useState, type FormEvent, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { t } from "@touchdown/i18n";
import "../styles/app.css";
import { Icon } from "../lib/icons.tsx";
import { MIN_PASSWORD, passwordKey, passwordProblem } from "../lib/passwordKey.ts";
import { Wordmark } from "../components/Wordmark.tsx";
import { startLanguage } from "../lib/i18n.tsx";

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
function errorText(code: string): string | null {
  const errors: Record<string, string> = {
    "google-cancelled": t("signin.errors.googleCancelled"),
    "google-failed": t("signin.errors.googleFailed"),
    "google-expired": t("signin.errors.googleExpired"),
    "google-no-account": t("signin.errors.googleNoAccount"),
    "google-taken": t("signin.errors.googleTaken"),
    "email-taken": t("signin.errors.emailTaken"),
    invite: t("signin.errors.invite"),
  };
  return errors[code] ?? null;
}

const errorFromUrl = () => errorText(new URLSearchParams(location.search).get("error") ?? "");

/** Where to go after signing in: a path on this site, nothing else. */
function next(): string {
  const n = new URLSearchParams(location.search).get("next");
  return n && n.startsWith("/") && !n.startsWith("//") && !n.startsWith("/\\") ? n : "/";
}

async function request<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
  try {
    const res = await fetch(path, { method, headers: body ? { "Content-Type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined, credentials: "same-origin" });
    const data = (await res.json().catch(() => ({}))) as T & { error?: string };
    return res.ok ? { ok: true, data } : { ok: false, error: data.error ?? t("signin.errors.status", { status: res.status }) };
  } catch {
    return { ok: false, error: t("signin.errors.offline") };
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
          <a href="/privacy">{t("signin.privacy")}</a> · <a href="/terms">{t("signin.terms")}</a>
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
      <p className="signin__or">{t("signin.or")}</p>
      <div className="button-row">
        <button
          type="button"
          className="btn btn--quiet"
          onClick={() => {
            const q = query();
            if (q !== null) location.assign(`/auth/google/start?${q}`);
          }}
        >
          {t("signin.google")}
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
    <Frame title={t("signin.signIn.title")}>
      <form className="signin__form" onSubmit={onSubmit}>
        <Input label={t("signin.field.email")} name="email" type="email" autoComplete="username" autoFocus />
        <Input label={t("signin.field.password")} name="password" type="password" autoComplete="current-password" />
        <Problem text={problem} />
        <div className="button-row">
          <button type="submit" className="btn btn--primary" disabled={busy}>
            {busy ? t("signin.signIn.busy") : t("signin.signIn.submit")}
          </button>
        </div>
      </form>
      <GoogleButton site={site} query={() => `next=${encodeURIComponent(next())}`} />
      <p className="form-sub signin__note">{t("signin.signIn.note")}</p>
    </Frame>
  );
}

function NewPassword() {
  return (
    <>
      <Input label={t("signin.field.password")} name="password" type="password" autoComplete="new-password" minLength={MIN_PASSWORD} />
      <Input label={t("signin.field.repeat")} name="repeat" type="password" autoComplete="new-password" minLength={MIN_PASSWORD} />
      <p className="form-sub">{t("signin.password.rule", { min: MIN_PASSWORD })}</p>
    </>
  );
}

function Join({ site, token }: { site: Site; token: string }) {
  const [invite, setInvite] = useState<Invite | null | string>(null);
  useEffect(() => {
    void request<Invite>("GET", `/auth/invite/${encodeURIComponent(token)}`).then((r) => setInvite(r.ok ? (r.data.purpose === "join" ? r.data : t("signin.errors.notInvitation")) : r.error));
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
  if (invite === null) return <Frame title={t("signin.join.title")}>{null}</Frame>;
  if (typeof invite === "string") return <Frame title={t("signin.join.title")} sub={invite}>{null}</Frame>;
  return (
    <Frame title={t("signin.join.title")} sub={t("signin.join.sub")}>
      <form className="signin__form" onSubmit={onSubmit}>
        <Input label={t("signin.field.name")} name="name" autoComplete="name" maxLength={80} autoFocus />
        <Input label={t("signin.field.email")} name="email" type="email" autoComplete="username" />
        <NewPassword />
        <Problem text={problem} />
        <div className="button-row">
          <button type="submit" className="btn btn--primary" disabled={busy}>
            {busy ? t("signin.join.busy") : t("signin.join.submit")}
          </button>
        </div>
      </form>
      <GoogleButton
        site={site}
        query={() => {
          const name = (document.querySelector<HTMLInputElement>("input[name=name]")?.value ?? "").trim();
          if (!name) {
            setProblem(t("signin.errors.nameFirst"));
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
    void request<Invite>("GET", `/auth/invite/${encodeURIComponent(token)}`).then((r) => setInvite(r.ok ? (r.data.purpose === "reset" ? r.data : t("signin.errors.notReset")) : r.error));
  }, [token]);
  const { busy, problem, onSubmit } = useSubmit(async (f) => {
    if (typeof invite !== "object" || !invite?.email) return t("signin.errors.notValid");
    const p = passwordProblem(text(f, "password"), text(f, "repeat"));
    if (p) return p;
    const r = await request("POST", "/auth/reset", { token, key: await passwordKey(text(f, "password"), invite.email, site.siteId) });
    if (!r.ok) return r.error;
    location.assign("/");
    return null;
  });
  if (invite === null) return <Frame title={t("signin.reset.title")}>{null}</Frame>;
  if (typeof invite === "string") return <Frame title={t("signin.reset.title")} sub={invite}>{null}</Frame>;
  return (
    <Frame title={t("signin.reset.title")} sub={t("signin.reset.sub", { email: invite.email ?? "" })}>
      <form className="signin__form" onSubmit={onSubmit}>
        <input type="email" name="username" autoComplete="username" value={invite.email ?? ""} readOnly hidden />
        <NewPassword />
        <Problem text={problem} />
        <div className="button-row">
          <button type="submit" className="btn btn--primary" disabled={busy}>
            {busy ? t("signin.reset.busy") : t("signin.reset.submit")}
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
      <Frame title={t("signin.setup.title")} sub={t("signin.setup.done")}>
        <div className="button-row">
          <a className="btn btn--primary" href="/signin">
            {t("signin.signIn.submit")}
          </a>
        </div>
      </Frame>
    );
  }
  return (
    <Frame title={t("signin.setup.title")} sub={t("signin.setup.sub")}>
      <form className="signin__form" onSubmit={onSubmit}>
        <Input label={t("signin.field.setupToken")} name="setupToken" type="password" autoComplete="off" autoFocus />
        <Input label={t("signin.field.name")} name="name" autoComplete="name" maxLength={80} />
        <Input label={t("signin.field.email")} name="email" type="email" autoComplete="username" />
        <NewPassword />
        <Problem text={problem} />
        <div className="button-row">
          <button type="submit" className="btn btn--primary" disabled={busy}>
            {busy ? t("signin.setup.busy") : t("signin.setup.submit")}
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

void startLanguage().then(() =>
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <Page />
    </StrictMode>,
  ),
);
