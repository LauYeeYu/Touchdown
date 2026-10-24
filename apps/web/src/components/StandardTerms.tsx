// Standard mode's terms (docs/32-modes-and-sharing.md, "Terms"), shown when the user chooses Standard, at first run
// or in Settings. Version 1 covers what is built: the server keeps a key to the user's Google Drive for sync.
// Share links will come with version 2, which asks again.

export const TERMS_VERSION = 1;

export function StandardTerms({ busy, problem, onAccept, onDecline }: { busy: boolean; problem?: string | null; onAccept: () => void; onDecline: () => void }) {
  return (
    <section className="terms" aria-labelledby="terms-title">
      <h2 id="terms-title" className="form-section">
        Standard mode: what Touchdown can access
      </h2>
      <p>In Standard mode, Touchdown's server keeps a key to your Google Drive, so your devices sync without asking you to sign in to Google every hour, and a new device picks up your log once you sign in to Touchdown.</p>
      <p>
        <b>What the server can open.</b> With the key, the server can open the files Touchdown created in your Google Drive (the Touchdown folder), not your other files. That is your whole log, including ticket numbers and booking references if you entered them. The person who runs this site could technically use the key.
      </p>
      <p>
        <b>What it is used for.</b> Only to give your own browser short-lived access for its sync. The server does not read, copy, analyse or keep your log.
      </p>
      <p>
        <b>How it is protected.</b> The key is encrypted, and the encryption key is kept apart from the database. Both are with Cloudflare, which hosts this site. Nothing is passed on to anyone unless the law requires it. The <a href="/privacy">privacy policy</a> has the details.
      </p>
      <p>
        <b>Stopping.</b> Switch to Private or Local in Settings at any time. The key is then revoked with Google and deleted from the server. You can also remove Touchdown's access in your Google account.
      </p>
      <p>
        <b>Changes.</b> If these terms change, you will be asked again before anything new applies.
      </p>
      {problem && (
        <p className="status-line status-line--error" role="alert">
          <span>{problem}</span>
        </p>
      )}
      <div className="button-row">
        <button type="button" className="btn btn--primary" disabled={busy} onClick={onAccept}>
          {busy ? "Going to Google…" : "Accept and connect Google Drive"}
        </button>
        <button type="button" className="btn btn--ghost" onClick={onDecline}>
          Not now
        </button>
      </div>
    </section>
  );
}
