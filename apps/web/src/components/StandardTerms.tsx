// Standard mode's terms (docs/32-modes-and-sharing.md, "Terms"), in a dialog that opens when the user chooses Standard,
// at first run or in Settings, so they cannot be scrolled past: nothing else on the page can be used until the user
// accepts or says not now. Version 2 adds share links: a user who accepted version 1 accepts it before their first
// link (the Share dialog opens it).

import { useEffect, useRef } from "react";

export const TERMS_VERSION = 2;

export function StandardTerms({
  open,
  busy,
  problem,
  onAccept,
  onDecline,
  acceptLabel = "Accept and connect Google Drive",
  busyLabel = "Going to Google…",
}: {
  open: boolean;
  busy: boolean;
  problem?: string | null;
  onAccept: () => void;
  onDecline: () => void;
  acceptLabel?: string;
  busyLabel?: string;
}) {
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
          Standard mode: Touchdown's access to your Google Drive
        </h2>
        <p>Read these terms before you go on. Standard mode starts only once you accept them.</p>
        <p>In Standard mode, Touchdown's server keeps a key to your Google Drive, so the links you share keep working while you are offline, your devices sync without asking you to sign in to Google every hour, and a new device picks up your log once you sign in to Touchdown.</p>
        <p>
          <b>Files the server can open.</b> With the key, the server can open the files Touchdown created in your Google Drive (the Touchdown folder), not your other files. That is your whole log, including ticket numbers and booking references if you entered them. The person who runs this site could technically use the key.
        </p>
        <p>
          <b>Use of the key.</b> To give your own browser short-lived access for its sync, and to read the parts of your log a link you made shows, when someone opens that link. The server does not read, copy, analyse or keep your log for anything else.
        </p>
        <p>
          <b>Protection of the key.</b> The key is encrypted, and the encryption key is kept apart from the database. Both are with Cloudflare, which hosts this site. Nothing is passed on to anyone unless the law requires it. The <a href="/privacy" target="_blank" rel="noopener">privacy policy</a> has the details.
        </p>
        <p>
          <b>People who see your links.</b> Anyone who has one of your links can open it, without signing in, until you stop sharing it. They see only that link's page, with the notes and photo links on it. Ticket numbers and booking references are kept apart in your Google Drive and never go into a link.
        </p>
        <p>
          <b>Stopping.</b> Stop a link on the Shared links page at any time. Switch to Private or Local in Settings, and every link stops at once, the key is revoked with Google and deleted from the server. You can also remove Touchdown's access in your Google account.
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
            {busy ? busyLabel : acceptLabel}
          </button>
          <button type="button" className="btn btn--ghost" disabled={busy} onClick={onDecline}>
            Not now
          </button>
        </div>
      </div>
    </dialog>
  );
}
