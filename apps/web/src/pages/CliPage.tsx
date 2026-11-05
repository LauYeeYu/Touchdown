// The command line's pages (docs/33, "The command line"), shown on their own, before the app opens its log:
// - /cli/login: the user allows the command line on this computer; a one-time code goes to it on 127.0.0.1, and it
//   exchanges the code for its own session.
// - /cli/drive: in Private mode, this browser gets an hour's access to Touchdown's files in Google Drive and posts it
//   to the command line on 127.0.0.1. It never goes through Touchdown's server.
// Both only ever send to 127.0.0.1, at the port the command line is listening on.

import { useEffect, useState } from "react";
import { t } from "@touchdown/i18n";
import { call, whoAmI, type Me } from "../data/account.ts";
import { loadGoogle, requestDriveToken, SignInCancelled } from "../data/google.ts";
import { Icon } from "../lib/icons.tsx";
import { Wordmark } from "../components/Wordmark.tsx";

const params = new URLSearchParams(location.search);
const port = Number(params.get("port"));
const state = params.get("state") ?? "";
/** The request came from the command line as it makes it; anything else is refused. */
const wellFormed = Number.isInteger(port) && port >= 1024 && port <= 65535 && /^[A-Za-z0-9_-]{16,64}$/.test(state);
const loopback = `http://127.0.0.1:${port}/`;

/** Back to the command line by the address bar: what is sent is in the address, so only a one-time code or an error. */
function goBack(fields: Record<string, string>) {
  location.assign(`${loopback}?${new URLSearchParams({ ...fields, state })}`);
}

/** Back to the command line by a form, so the access is not left in the address or the history. */
function postBack(fields: Record<string, string>) {
  const form = document.createElement("form");
  form.method = "POST";
  form.action = loopback;
  for (const [name, value] of Object.entries({ ...fields, state })) {
    const input = document.createElement("input");
    input.type = "hidden";
    input.name = name;
    input.value = value;
    form.append(input);
  }
  document.body.append(form);
  form.submit();
}

function Frame({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <>
      <header className="masthead">
        <div className="page masthead__bar">
          <span className="wordmark">
            <Wordmark />
          </span>
        </div>
      </header>
      <main id="view" className="page page--form first-run">
        <div className="view-top" />
        <h1 className="lead">{title}</h1>
        {children}
      </main>
    </>
  );
}

function Problem({ text }: { text: string }) {
  return (
    <p className="status-line status-line--error" role="alert">
      <Icon name="circle-x" />
      <span>{text}</span>
    </p>
  );
}

function Login() {
  const challenge = params.get("challenge") ?? "";
  const system = params.get("system") ?? "";
  const [me, setMe] = useState<Me | "signed-out" | "offline" | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => void whoAmI().then(setMe), []);
  const valid = wellFormed && /^[A-Za-z0-9_-]{43}$/.test(challenge);

  const allow = async () => {
    setBusy(true);
    setError(null);
    try {
      const { code } = await call<{ code: string }>("POST", "/auth/cli/approve", { challenge, system });
      goBack({ code });
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  if (!valid) return <Frame title={t("settings.cli.login.title")}><Problem text={t("settings.cli.login.badAddress")} /></Frame>;
  if (me === null) return <Frame title={t("settings.cli.login.title")}><p className="form-sub">{t("settings.cli.login.checking")}</p></Frame>;
  if (me === "offline") return <Frame title={t("settings.cli.login.title")}><Problem text={t("settings.cli.login.offline")} /></Frame>;
  if (me === "signed-out") {
    return (
      <Frame title={t("settings.cli.login.title")}>
        <p className="form-sub">{t("settings.cli.login.signInFirst")}</p>
        <div className="button-row">
          <a className="btn btn--primary" href={`/signin?next=${encodeURIComponent(location.pathname + location.search)}`}>
            {t("settings.cli.login.signIn")}
          </a>
        </div>
      </Frame>
    );
  }
  return (
    <Frame title={t("settings.cli.login.title")}>
      <p>{t("settings.cli.login.asks", { named: system ? "yes" : "no", system, name: me.name, email: me.email })}</p>
      <p>{t("settings.cli.login.what")}</p>
      <p>{t("settings.cli.login.stays")}</p>
      {error && <Problem text={error} />}
      <div className="button-row">
        <button type="button" className="btn btn--primary" disabled={busy} onClick={() => void allow()}>
          {busy ? t("settings.cli.login.signingIn") : t("settings.cli.login.allow")}
        </button>
        <button type="button" className="btn btn--ghost" disabled={busy} onClick={() => goBack({ error: "cancelled" })}>
          {t("common.cancel")}
        </button>
      </div>
    </Frame>
  );
}

function Drive() {
  const account = params.get("account");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Ready before the click, so Google's window opens at once.
  useEffect(() => void loadGoogle().catch(() => undefined), []);

  const give = async () => {
    setBusy(true);
    setError(null);
    try {
      const t = await requestDriveToken(account);
      postBack({ access_token: t.token, expires_at: String(t.expiresAt), account: t.account });
    } catch (e) {
      if (!(e instanceof SignInCancelled)) setError((e as Error).message);
      setBusy(false);
    }
  };

  if (!wellFormed) return <Frame title={t("settings.cli.drive.title")}><Problem text={t("settings.cli.drive.badAddress")} /></Frame>;
  return (
    <Frame title={t("settings.cli.drive.title")}>
      <p>{t("settings.cli.drive.asks", { named: account ? "yes" : "no", account: account ?? "" })}</p>
      <p>{t("settings.cli.drive.how")}</p>
      {error && <Problem text={error} />}
      <div className="button-row">
        <button type="button" className="btn btn--primary" disabled={busy} onClick={() => void give()}>
          {busy ? t("settings.cli.drive.waiting") : t("settings.cli.drive.give")}
        </button>
        <button type="button" className="btn btn--ghost" disabled={busy} onClick={() => goBack({ error: "cancelled" })}>
          {t("common.cancel")}
        </button>
      </div>
    </Frame>
  );
}

export function CliPage() {
  if (location.pathname.startsWith("/cli/login")) return <Login />;
  if (location.pathname.startsWith("/cli/drive")) return <Drive />;
  return <Frame title={t("settings.cli.notFound.title")}><p className="form-sub">{t("settings.cli.notFound.text")}</p></Frame>;
}
