// Settings → Account and People (docs/31-ui.md, Settings; docs/33-accounts-and-sign-in.md): the signed-in account,
// where it is signed in, signing out; and for the owner, invitations, reset links and removing someone.

import { useEffect, useState, type FormEvent } from "react";
import { t } from "@touchdown/i18n";
import type { AppData } from "../data/app.ts";
import { account, AuthError, type Link, type Me, type OpenInvite, type Person } from "../data/account.ts";
import { forgetOffline } from "../data/offline.ts";
import { MIN_PASSWORD, passwordProblem } from "../lib/passwordKey.ts";
import { momentDay, momentLabel } from "../lib/format.ts";
import { Icon } from "../lib/icons.tsx";
import { Field, TextInput } from "./form.tsx";
import { toast } from "./overlay.tsx";
import { invitationMessage } from "../lib/invitation.ts";
import { tx } from "../lib/i18n.tsx";

const when = (iso: string | null) => (iso ? momentLabel(Date.parse(iso)) : t("account.never"));
/** A day on this device's calendar: "3 Oct 2026". */
const day = (iso: string) => momentDay(new Date(iso).getTime());
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

function LinkBox({ link, note }: { link: Link; note: string }) {
  return (
    <div className="link-result">
      <span className="link-box">
        <code>{link.link}</code>
        <button
          type="button"
          className="icon-btn link-box__copy"
          aria-label={t("account.copyLink")}
          title={t("account.copyLink")}
          onClick={() => void navigator.clipboard?.writeText(link.link).then(() => toast(t("account.linkCopied")), () => toast(t("account.linkCopyFailed")))}
        >
          <Icon name="copy" />
        </button>
      </span>
      <small>{note}</small>
    </div>
  );
}

function InvitationMessage({ link }: { link: Link }) {
  const text = invitationMessage(link.link, when(link.expiresAt));
  return (
    <div className="invite-message">
      <small>{t("account.invitation.messageIntro")}</small>
      <textarea className="input textarea invite-message__text" readOnly rows={15} value={text} onFocus={(e) => e.currentTarget.select()} aria-label={t("account.invitation.messageLabel")} />
      <div className="button-row">
        <button type="button" className="btn btn--quiet btn--small" onClick={() => void navigator.clipboard?.writeText(text).then(() => toast(t("account.invitation.messageCopied")), () => toast(t("account.invitation.messageCopyFailed")))}>
          <Icon name="copy" />
          {t("account.invitation.copyMessage")}
        </button>
      </div>
    </div>
  );
}

/**
 * Sign out (docs/31, "Signing out"): the log leaves this browser once everything has reached the storage, and the app's
 * offline copy goes, so the log no longer opens here without signing in.
 */
async function signOut(app: AppData) {
  // The server ends the session, so signing out needs the network.
  if (navigator.onLine === false) {
    toast(t("account.signOut.offline"));
    return;
  }
  const c = app.connection;
  let keep = true;
  if (c && c.mode !== "local") {
    await app.sync?.run();
    const waiting = app.getSyncInfo()?.waiting ?? 0;
    if (waiting > 0) {
      if (!window.confirm(t("account.signOut.waiting", { count: waiting, place: c.name }))) return;
    } else keep = false;
  } else if (!window.confirm(t("account.signOut.localOnly"))) {
    return;
  }
  try {
    await account.signOut();
  } catch (e) {
    toast(t("account.signOut.failed", { problem: message(e) }));
    return;
  }
  await forgetOffline();
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
      toast(t("account.password.changed"));
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
        <Field label={t("account.password.current")}>
          <TextInput name="current" type="password" autoComplete="current-password" required />
        </Field>
      )}
      <Field label={t("account.password.new")} hint={t("account.password.minLength", { count: MIN_PASSWORD })}>
        <TextInput name="password" type="password" autoComplete="new-password" minLength={MIN_PASSWORD} required />
      </Field>
      <Field label={t("account.password.repeat")}>
        <TextInput name="repeat" type="password" autoComplete="new-password" minLength={MIN_PASSWORD} required />
      </Field>
      {problem && <p className="status-line status-line--error" role="alert"><Icon name="circle-x" /><span>{problem}</span></p>}
      <div className="button-row">
        <button type="submit" className="btn btn--primary btn--small" disabled={busy}>{busy ? t("account.saving") : me.password ? t("account.password.change") : t("account.password.set")}</button>
        <button type="button" className="btn btn--ghost btn--small" onClick={onDone}>{t("common.cancel")}</button>
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
      toast(t("account.email.changed"));
      onDone();
    } catch (err) {
      setProblem(message(err));
    }
    setBusy(false);
  };
  return (
    <form className="account-form" onSubmit={(e) => void submit(e)}>
      <Field label={t("account.email.new")}>
        <TextInput name="email" type="email" autoComplete="email" required />
      </Field>
      <Field label={t("account.password.current")} hint={t("account.email.currentHint")}>
        <TextInput name="current" type="password" autoComplete="current-password" required />
      </Field>
      {problem && <p className="status-line status-line--error" role="alert"><Icon name="circle-x" /><span>{problem}</span></p>}
      <div className="button-row">
        <button type="submit" className="btn btn--primary btn--small" disabled={busy}>{busy ? t("account.saving") : t("account.email.change")}</button>
        <button type="button" className="btn btn--ghost btn--small" onClick={onDone}>{t("common.cancel")}</button>
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
    if (params.get("error") === "google-taken") toast(t("account.google.taken"));
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
        <h2 className="form-section">{t("account.title")}</h2>
        <p className="form-sub">{tx("account.devSignedOut", {}, { link: (text) => <a href="/signin?next=%2Fsettings">{text}</a> })}</p>
      </>
    );
  }
  return (
    <>
      <h2 className="form-section">{t("account.title")}</h2>
      {/* Material's account lists: each item the thing and its value under it, in two cards side by side (one above the
          other on phones): the account's details and the ways to sign in to it. */}
      <div className="account-grid">
        <section aria-labelledby="account-profile">
          <h3 className="account-group" id="account-profile">
            {t("account.profile.title")}
          </h3>
          <ul className="account-card">
            <li className="account-item">
              <span className="account-item__text">
                {t("account.profile.name")}
                <small>{t("account.profile.nameRole", { name: me.name, role: me.role })}</small>
              </span>
              <button type="button" className="btn btn--quiet btn--small" onClick={() => { setName(me.name); setEditing(editing === "name" ? null : "name"); }}>{t("account.change")}</button>
            </li>
            {editing === "name" && (
              <li className="account-card__form">
                <form
                  className="inline-form"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void account.rename(name).then(done, (err: unknown) => toast(message(err)));
                  }}
                >
                  <Field label={t("account.profile.name")} wide>
                    <TextInput value={name} onChange={(e) => setName(e.target.value)} maxLength={80} required autoComplete="name" />
                  </Field>
                  <button type="submit" className="btn btn--quiet btn--small">{t("common.save")}</button>
                </form>
              </li>
            )}
            <li className="account-item">
              <span className="account-item__text">
                {t("account.email.title")}
                <small>{me.email}</small>
              </span>
              {me.password && <button type="button" className="btn btn--quiet btn--small" onClick={() => setEditing(editing === "email" ? null : "email")}>{t("account.change")}</button>}
            </li>
            {editing === "email" && <li className="account-card__form"><EmailForm me={me} onDone={done} /></li>}
          </ul>
        </section>
        <section aria-labelledby="account-signin">
          <h3 className="account-group" id="account-signin">
            {t("account.signIn.title")}
          </h3>
          <ul className="account-card">
            <li className="account-item">
              <span className="account-item__text">
                {t("account.password.title")}
                <small>{!me.password ? t("account.password.notSet") : me.passwordChangedAt ? t("account.password.lastChanged", { day: day(me.passwordChangedAt) }) : t("account.password.isSet")}</small>
              </span>
              <button type="button" className="btn btn--quiet btn--small" onClick={() => setEditing(editing === "password" ? null : "password")}>{me.password ? t("account.change") : t("account.password.setOne")}</button>
            </li>
            {editing === "password" && <li className="account-card__form"><PasswordForm me={me} onDone={done} /></li>}
            {(me.google || googleOn) && (
              <li className="account-item">
                <span className="account-item__text">
                  Google
                  <small>{me.google ?? t("account.google.notConnected")}</small>
                </span>
                {me.google ? (
                  me.password && (
                    <button type="button" className="btn btn--quiet btn--small" onClick={() => void account.disconnectGoogle().then(load, (e: unknown) => toast(message(e)))}>
                      {t("common.remove")}
                    </button>
                  )
                ) : (
                  <a className="btn btn--quiet btn--small" href="/auth/google/start?link=1">
                    {t("account.google.connect")}
                  </a>
                )}
              </li>
            )}
          </ul>
        </section>
      </div>

      <h3 className="form-subsection">{t("account.sessions.title")}</h3>
      <ul className="rows overrides">
        {me.sessions.map((s) => (
          <li key={s.id} className="history-row">
            <span>
              {t("account.sessions.device", { device: s.device, current: s.current ? "yes" : "no" })}
              <small>{t("account.sessions.lastUsed", { when: when(s.lastUsedAt) })}</small>
            </span>
            {!s.current && (
              <span className="history-row__actions">
                <button
                  type="button"
                  className="btn btn--ghost btn--small"
                  onClick={() =>
                    void account.endSession(s.id).then(
                      () => {
                        toast(t("account.sessions.ended", { device: s.device }));
                        load();
                      },
                      (err: unknown) => toast(message(err)),
                    )
                  }
                >
                  {t("account.signOut.button")}
                </button>
              </span>
            )}
          </li>
        ))}
      </ul>
      <div className="button-row">
        <button type="button" className="btn btn--quiet btn--small" onClick={() => void signOut(app)}>
          {t("account.signOut.button")}
        </button>
        {me.sessions.length > 1 && (
          <button
            type="button"
            className="btn btn--quiet btn--small"
            onClick={() =>
              void account.signOutOthers().then(
                (r) => {
                  toast(t("account.signOut.others.done", { count: r.ended }));
                  load();
                },
                (err: unknown) => toast(message(err)),
              )
            }
          >
            {t("account.signOut.others.button")}
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
      <h2 className="form-section">{t("account.people.title")}</h2>
      <p className="form-sub">{t("account.people.intro")}</p>
      <form
        className="inline-form"
        onSubmit={(e) => {
          e.preventDefault();
          void invite();
        }}
      >
        <Field label={t("account.people.noteLabel")} wide>
          <TextInput value={note} onChange={(e) => setNote(e.target.value)} maxLength={80} placeholder={t("account.people.notePlaceholder")} />
        </Field>
        <button type="submit" className="btn btn--quiet btn--small">
          {t("account.people.invite")}
        </button>
      </form>
      {made && (
        <>
          <LinkBox link={made.link} note={t("account.people.inviteNote", { named: made.for ? "yes" : "no", name: made.for, until: when(made.link.expiresAt) })} />
          <InvitationMessage link={made.link} />
        </>
      )}

      {data.invites.length > 0 && (
        <>
          <h3 className="form-subsection">{t("account.invites.title")}</h3>
          <ul className="rows overrides">
            {data.invites.map((i) => (
              <li key={i.id} className="history-row">
                <span>
                  {i.note || t("account.invites.untitled")}
                  <small>{t("account.invites.dates", { made: when(i.createdAt), until: when(i.expiresAt) })}</small>
                </span>
                <button type="button" className="btn btn--quiet btn--small" onClick={() => void account.withdraw(i.id).then(load, (e: unknown) => toast(message(e)))}>
                  {t("account.invites.withdraw")}
                </button>
              </li>
            ))}
          </ul>
        </>
      )}

      <h3 className="form-subsection">{t("account.members.title")}</h3>
      <ul className="rows overrides">
        {data.people.map((p) => (
          <li key={p.id} className="history-row">
            <span>
              {t("account.members.name", { name: p.name, role: p.role })}
              <small>{t("account.members.details", { email: p.email, methods: p.password && p.google ? "both" : p.password ? "password" : p.google ? "google" : "none", when: when(p.lastSeenAt) })}</small>
            </span>
            {p.id !== me.id && (
              <div className="button-row button-row--tight">
                <button type="button" className="btn btn--quiet btn--small" onClick={() => void account.resetLink(p.id).then((link) => setReset({ link, name: p.name }), (e: unknown) => toast(message(e)))}>
                  {t("account.members.resetLink")}
                </button>
                <button
                  type="button"
                  className="btn btn--quiet btn--small btn--danger"
                  onClick={() => {
                    if (!window.confirm(t("account.members.removeConfirm", { name: p.name }))) return;
                    void account.remove(p.id).then(() => {
                      toast(t("account.members.removed", { name: p.name }));
                      load();
                    }, (e: unknown) => toast(message(e)));
                  }}
                >
                  {t("common.remove")}
                </button>
              </div>
            )}
          </li>
        ))}
      </ul>
      {reset && <LinkBox link={reset.link} note={t("account.members.resetNote", { name: reset.name, until: when(reset.link.expiresAt) })} />}
    </>
  );
}
