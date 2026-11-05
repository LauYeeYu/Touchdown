// Standard mode's terms (docs/32-modes-and-sharing.md, "Terms"), in a dialog that opens when the user chooses Standard,
// at first run or in Settings, so they cannot be scrolled past: nothing else on the page can be used until the user
// accepts or says not now. Version 2 adds share links: a user who accepted version 1 accepts it before their first
// link (the Share dialog opens it).

import { useEffect, useRef, type ReactNode } from "react";
import { t } from "@touchdown/i18n";
import { tx } from "../lib/i18n.tsx";

export const TERMS_VERSION = 2;

const b = (text: ReactNode) => <b>{text}</b>;

export function StandardTerms({
  open,
  busy,
  problem,
  onAccept,
  onDecline,
  acceptLabel = t("account.terms.accept"),
  busyLabel = t("account.terms.going"),
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
          {t("account.terms.title")}
        </h2>
        <p>{t("account.terms.intro")}</p>
        <p>{t("account.terms.key")}</p>
        <p>{tx("account.terms.files", {}, { b })}</p>
        <p>{tx("account.terms.use", {}, { b })}</p>
        <p>
          {tx("account.terms.protection", {}, {
            b,
            link: (text) => (
              <a href="/privacy" target="_blank" rel="noopener">
                {text}
              </a>
            ),
          })}
        </p>
        <p>{tx("account.terms.viewers", {}, { b })}</p>
        <p>{tx("account.terms.stopping", {}, { b })}</p>
        <p>{tx("account.terms.changes", {}, { b })}</p>
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
            {t("account.terms.notNow")}
          </button>
        </div>
      </div>
    </dialog>
  );
}
