// Standard mode's terms (docs/32-modes-and-sharing.md, "Terms"), in a dialog that opens when the user chooses Standard,
// at first run or in Settings, so they cannot be scrolled past: nothing else on the page can be used until the user
// accepts or says not now. Version 1 covers what is built: the server keeps a key to the user's Google Drive for
// sync. Share links will come with version 2, which asks again.

import { useEffect, useRef } from "react";

export const TERMS_VERSION = 1;

export function StandardTerms({ open, busy, problem, onAccept, onDecline }: { open: boolean; busy: boolean; problem?: string | null; onAccept: () => void; onDecline: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const body = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const d = dialog.current;
    if (!d) return;
    if (open && !d.open) {
      d.showModal();
      // Reading starts at the top of the text (the keys scroll it), not on its first link or the Accept button.
      body.current?.scrollTo(0, 0);
      body.current?.focus();
    }
    if (!open && d.open) d.close();
  }, [open]);

  return (
    <dialog
      ref={dialog}
      className="terms-dialog"
      aria-labelledby="terms-title"
      // Escape is "Not now".
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) onDecline();
      }}
    >
      <div className="terms-dialog__body" ref={body} tabIndex={-1}>
        <h2 id="terms-title" className="terms-dialog__title">
          Standard mode: what Touchdown can access
        </h2>
        <p>Read these terms before you go on. Standard mode starts only once you accept them.</p>
        <p>In Standard mode, Touchdown's server keeps a key to your Google Drive, so your devices sync without asking you to sign in to Google every hour, and a new device picks up your log once you sign in to Touchdown.</p>
        <p>
          <b>What the server can open.</b> With the key, the server can open the files Touchdown created in your Google Drive (the Touchdown folder), not your other files. That is your whole log, including ticket numbers and booking references if you entered them. The person who runs this site could technically use the key.
        </p>
        <p>
          <b>What it is used for.</b> Only to give your own browser short-lived access for its sync. The server does not read, copy, analyse or keep your log.
        </p>
        <p>
          <b>How it is protected.</b> The key is encrypted, and the encryption key is kept apart from the database. Both are with Cloudflare, which hosts this site. Nothing is passed on to anyone unless the law requires it. The <a href="/privacy" target="_blank" rel="noopener">privacy policy</a> has the details.
        </p>
        <p>
          <b>Stopping.</b> Switch to Private or Local in Settings at any time. The key is then revoked with Google and deleted from the server. You can also remove Touchdown's access in your Google account.
        </p>
        <p>
          <b>Changes.</b> If these terms change, you will be asked again before anything new applies.
        </p>
      </div>
      <div className="terms-dialog__foot">
        {problem && (
          <p className="status-line status-line--error" role="alert">
            <span>{problem}</span>
          </p>
        )}
        <div className="button-row">
          <button type="button" className="btn btn--primary" disabled={busy} onClick={onAccept}>
            {busy ? "Going to Google…" : "Accept and connect Google Drive"}
          </button>
          <button type="button" className="btn btn--ghost" disabled={busy} onClick={onDecline}>
            Not now
          </button>
        </div>
      </div>
    </dialog>
  );
}
