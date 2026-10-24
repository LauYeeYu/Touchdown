// Settings → Account and People (docs/31-ui.md, Settings; docs/33-accounts-and-sign-in.md): the signed-in account,
// where it is signed in, signing out; and for the owner, invitations, reset links and removing someone.

import { useEffect, useState, type FormEvent } from "react";
import type { AppData } from "../data/app.ts";
import { account, AuthError, type Link, type Me, type OpenInvite, type Person } from "../data/account.ts";
import { MIN_PASSWORD, passwordProblem } from "../lib/passwordKey.ts";
import { momentLabel, plural } from "../lib/format.ts";
import { Icon } from "../lib/icons.tsx";
import { Field, TextInput } from "./form.tsx";
import { toast } from "./overlay.tsx";

const when = (iso: string | null) => (iso ? momentLabel(Date.parse(iso)) : "never");
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

function LinkBox({ link, note }: { link: Link; note: string }) {
  return (
    <div className="link-result">
      <span className="link-box">
        <code>{link.link}</code>
        <button
          type="button"
          className="icon-btn link-box__copy"
          aria-label="Copy the link"
          title="Copy the link"
          onClick={() => void navigator.clipboard?.writeText(link.link).then(() => toast("Link copied."), () => toast("Could not copy; select the link instead."))}
        >
          <Icon name="copy" />
        </button>
      </span>
      <small>{note}</small>
    </div>
  );
}

/** Sign out (docs/31, "Signing out"): the log leaves this browser once everything has reached the storage. */
async function signOut(app: AppData) {
  const c = app.connection;
  let keep = true;
  if (c && c.mode !== "local") {
    await app.sync?.run();
    const waiting = app.getSyncInfo()?.waiting ?? 0;
    if (waiting > 0) {
      if (!window.confirm(`${plural(waiting, "change has", "changes have")} not reached ${c.name} yet. Sign out anyway? They stay in this browser until you sign in here again.`)) return;
    } else keep = false;
  } else if (!window.confirm("Your log is kept only in this browser, so it stays here after you sign out. Sign out?")) {
    return;
  }
  try {
    await account.signOut();
  } catch (e) {
    toast(`Could not sign out: ${message(e)}`);
    return;
  }
  if (!keep) await app.removeThisBrowsersCopy();
  location.assign("/signin");
}

function PasswordForm({ me, onDone }: { me: Me; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const next = String(f.get("password") ?? "");
    const p = passwordProblem(next, String(f.get("repeat") ?? ""));
    if (p) return setProblem(p);
    setBusy(true);
    try {
      await account.changePassword(me.email, me.password ? String(f.get("current") ?? "") : null, next);
      toast("Password changed. Other devices are signed out.");
      onDone();
    } catch (err) {
      setProblem(message(err));
    }
    setBusy(false);
  };
  return (
    <form className="account-form" onSubmit={(e) => void submit(e)}>
      <input type="email" name="username" autoComplete="username" value={me.email} readOnly hidden />
      {me.password && (
        <Field label="Current password">
          <TextInput name="current" type="password" autoComplete="current-password" required />
        </Field>
      )}
      <Field label="New password" hint={`At least ${MIN_PASSWORD} characters.`}>
        <TextInput name="password" type="password" autoComplete="new-password" minLength={MIN_PASSWORD} required />
      </Field>
      <Field label="New password again">
        <TextInput name="repeat" type="password" autoComplete="new-password" minLength={MIN_PASSWORD} required />
      </Field>
      {problem && <p className="status-line status-line--error" role="alert"><Icon name="circle-x" /><span>{problem}</span></p>}
      <div className="button-row">
        <button type="submit" className="btn btn--primary btn--small" disabled={busy}>{busy ? "Saving…" : me.password ? "Change the password" : "Set a password"}</button>
        <button type="button" className="btn btn--ghost btn--small" onClick={onDone}>Cancel</button>
      </div>
    </form>
  );
}

function EmailForm({ me, onDone }: { me: Me; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true);
    try {
      await account.changeEmail(me.email, String(f.get("email") ?? "").trim(), String(f.get("current") ?? ""));
      toast("Email address changed. Other devices are signed out.");
      onDone();
    } catch (err) {
      setProblem(message(err));
    }
    setBusy(false);
  };
  return (
    <form className="account-form" onSubmit={(e) => void submit(e)}>
      <Field label="New email address">
        <TextInput name="email" type="email" autoComplete="email" required />
      </Field>
      <Field label="Current password" hint="Needed because the password is tied to the address.">
        <TextInput name="current" type="password" autoComplete="current-password" required />
      </Field>
      {problem && <p className="status-line status-line--error" role="alert"><Icon name="circle-x" /><span>{problem}</span></p>}
      <div className="button-row">
        <button type="submit" className="btn btn--primary btn--small" disabled={busy}>{busy ? "Saving…" : "Change the address"}</button>
        <button type="button" className="btn btn--ghost btn--small" onClick={onDone}>Cancel</button>
      </div>
    </form>
  );
}

export function AccountSection({ app }: { app: AppData }) {
  const [me, setMe] = useState<Me | null | "signed-out">(null);
  const [editing, setEditing] = useState<"name" | "email" | "password" | null>(null);
  const [name, setName] = useState("");
  const [googleOn, setGoogleOn] = useState(false);
  useEffect(() => {
    void account.google().then(setGoogleOn, () => setGoogleOn(false));
    // Back from connecting Google with an account that belongs to someone else here.
    const params = new URLSearchParams(location.search);
    if (params.get("error") === "google-taken") toast("That Google account is connected to another account here.");
  }, []);
  const load = () =>
    void account
      .me()
      .then(setMe)
      .catch((e: unknown) => setMe(e instanceof AuthError && e.status === 401 ? "signed-out" : null));
  useEffect(load, []);
  const done = () => {
    setEditing(null);
    load();
  };

  if (me === null) return null;
  if (me === "signed-out") {
    // Only in development: the hosted site opens the app only for a signed-in account.
    return (
      <>
        <h2 className="form-section">Account</h2>
        <p className="form-sub">
          Not signed in (development). <a href="/signin?next=%2Fsettings">Sign in</a>
        </p>
      </>
    );
  }
  return (
    <>
      <h2 className="form-section">Account</h2>
      <ul className="rows overrides">
        <li className="history-row">
          <span>
            {me.name}
            <small>{me.role === "owner" ? "Owner of this site" : "Name"}</small>
          </span>
          <button type="button" className="btn btn--quiet btn--small" onClick={() => { setName(me.name); setEditing(editing === "name" ? null : "name"); }}>Change</button>
        </li>
        {editing === "name" && (
          <li>
            <form
              className="inline-form"
              onSubmit={(e) => {
                e.preventDefault();
                void account.rename(name).then(done, (err: unknown) => toast(message(err)));
              }}
            >
              <Field label="Name" wide>
                <TextInput value={name} onChange={(e) => setName(e.target.value)} maxLength={80} required autoComplete="name" />
              </Field>
              <button type="submit" className="btn btn--quiet btn--small">Save</button>
            </form>
          </li>
        )}
        <li className="history-row">
          <span>
            {me.email}
            <small>Email address</small>
          </span>
          {me.password && <button type="button" className="btn btn--quiet btn--small" onClick={() => setEditing(editing === "email" ? null : "email")}>Change</button>}
        </li>
        {editing === "email" && <li><EmailForm me={me} onDone={done} /></li>}
        <li className="history-row">
          <span>
            {me.password ? "Password set" : "No password"}
            <small>Password</small>
          </span>
          <button type="button" className="btn btn--quiet btn--small" onClick={() => setEditing(editing === "password" ? null : "password")}>{me.password ? "Change" : "Set one"}</button>
        </li>
        {editing === "password" && <li><PasswordForm me={me} onDone={done} /></li>}
        {(me.google || googleOn) && (
          <li className="history-row">
            <span>
              {me.google ?? "Not connected"}
              <small>Google sign-in</small>
            </span>
            {me.google ? (
              me.password && (
                <button type="button" className="btn btn--quiet btn--small" onClick={() => void account.disconnectGoogle().then(load, (e: unknown) => toast(message(e)))}>
                  Remove
                </button>
              )
            ) : (
              <a className="btn btn--quiet btn--small" href="/auth/google/start?link=1">
                Connect
              </a>
            )}
          </li>
        )}
      </ul>

      <h3 className="form-subsection">Signed in on</h3>
      <ul className="rows overrides">
        {me.sessions.map((s) => (
          <li key={s.id} className="history-row">
            <span>
              {s.device}
              {s.current ? " (this browser)" : ""}
              <small>Last used {when(s.lastUsedAt)}</small>
            </span>
            {!s.current && (
              <span className="history-row__actions">
                <button
                  type="button"
                  className="btn btn--ghost btn--small"
                  onClick={() =>
                    void account.endSession(s.id).then(
                      () => {
                        toast(`${s.device} is signed out.`);
                        load();
                      },
                      (err: unknown) => toast(message(err)),
                    )
                  }
                >
                  Sign out
                </button>
              </span>
            )}
          </li>
        ))}
      </ul>
      <div className="button-row">
        <button type="button" className="btn btn--quiet btn--small" onClick={() => void signOut(app)}>
          Sign out
        </button>
        {me.sessions.length > 1 && (
          <button
            type="button"
            className="btn btn--quiet btn--small"
            onClick={() =>
              void account.signOutOthers().then(
                (r) => {
                  toast(`${plural(r.ended, "other device was", "other devices were")} signed out.`);
                  load();
                },
                (err: unknown) => toast(message(err)),
              )
            }
          >
            Sign out everywhere else
          </button>
        )}
      </div>
      {me.role === "owner" && <PeopleSection me={me} />}
    </>
  );
}

function PeopleSection({ me }: { me: Me }) {
  const [data, setData] = useState<{ people: Person[]; invites: OpenInvite[] } | null>(null);
  const [note, setNote] = useState("");
  const [made, setMade] = useState<{ link: Link; for: string } | null>(null);
  const [reset, setReset] = useState<{ link: Link; name: string } | null>(null);
  const load = () => void account.people().then(setData, (e: unknown) => toast(message(e)));
  useEffect(load, []);
  if (!data) return null;

  const invite = async () => {
    try {
      const link = await account.invite(note.trim());
      setMade({ link, for: note.trim() });
      setNote("");
      load();
    } catch (e) {
      toast(message(e));
    }
  };

  return (
    <>
      <h2 className="form-section">People</h2>
      <p className="form-sub">Only people you invite can use this site. An invitation is a link you send yourself; it works once, for 7 days.</p>
      <form
        className="inline-form"
        onSubmit={(e) => {
          e.preventDefault();
          void invite();
        }}
      >
        <Field label="Who is it for? (only you see this)" wide>
          <TextInput value={note} onChange={(e) => setNote(e.target.value)} maxLength={80} placeholder="Sam" />
        </Field>
        <button type="submit" className="btn btn--quiet btn--small">
          Make an invitation link
        </button>
      </form>
      {made && <LinkBox link={made.link} note={`${made.for ? `For ${made.for}. ` : ""}Works once, until ${when(made.link.expiresAt)}.`} />}

      {data.invites.length > 0 && (
        <>
          <h3 className="form-subsection">Open invitations</h3>
          <ul className="rows overrides">
            {data.invites.map((i) => (
              <li key={i.id} className="history-row">
                <span>
                  {i.note || "Invitation"}
                  <small>Made {when(i.createdAt)}; works until {when(i.expiresAt)}</small>
                </span>
                <button type="button" className="btn btn--quiet btn--small" onClick={() => void account.withdraw(i.id).then(load, (e: unknown) => toast(message(e)))}>
                  Withdraw
                </button>
              </li>
            ))}
          </ul>
        </>
      )}

      <h3 className="form-subsection">Members</h3>
      <ul className="rows overrides">
        {data.people.map((p) => (
          <li key={p.id} className="history-row">
            <span>
              {p.name}
              {p.role === "owner" ? " (owner)" : ""}
              <small>
                {p.email}; {[p.password && "password", p.google && "Google"].filter(Boolean).join(" and ") || "no sign-in method"}; last signed in {when(p.lastSeenAt)}
              </small>
            </span>
            {p.id !== me.id && (
              <div className="button-row button-row--tight">
                <button type="button" className="btn btn--quiet btn--small" onClick={() => void account.resetLink(p.id).then((link) => setReset({ link, name: p.name }), (e: unknown) => toast(message(e)))}>
                  Reset link
                </button>
                <button
                  type="button"
                  className="btn btn--quiet btn--small btn--danger"
                  onClick={() => {
                    if (!window.confirm(`Remove ${p.name}? Their account and sign-ins end at once. Their log stays in their own storage.`)) return;
                    void account.remove(p.id).then(() => {
                      toast(`${p.name} was removed.`);
                      load();
                    }, (e: unknown) => toast(message(e)));
                  }}
                >
                  Remove
                </button>
              </div>
            )}
          </li>
        ))}
      </ul>
      {reset && <LinkBox link={reset.link} note={`For ${reset.name} to set a new password. Works once, until ${when(reset.link.expiresAt)}. Setting it signs them out everywhere.`} />}
    </>
  );
}
