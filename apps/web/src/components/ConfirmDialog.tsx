// A question put to the user before a change, in the app's card (the Share dialog's, DESIGN.md "Confirmations"): what
// is asked, what the change does, the change's button and Cancel, with an optional picture of what changes beside the
// words. Cancel has the focus, so Enter pressed by mistake changes nothing, and Escape and the backdrop cancel too.
// The change runs from the dialog: it stays open while it runs, and says so there if it fails.

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { t } from "@touchdown/i18n";
import { useModal } from "../lib/dialog.ts";
import { Icon } from "../lib/icons.tsx";

interface Props {
  title: string;
  text: string;
  /** The change's button: says what it does ("Give stamp"). */
  action: string;
  art?: ReactNode;
  onConfirm: () => Promise<void>;
  onClose: () => void;
}

export function ConfirmDialog({ title, text, action, art, onConfirm, onClose }: Props) {
  const { ref, close, props } = useModal(onClose);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const id = useId();
  const cancel = useRef<HTMLButtonElement>(null);

  // Opening a dialog focuses its first button, the change's: Cancel takes it instead.
  useEffect(() => {
    ref.current?.showModal();
    cancel.current?.focus();
  }, [ref]);

  const confirm = async () => {
    setBusy(true);
    setProblem(null);
    try {
      await onConfirm();
      close();
    } catch (e) {
      setProblem(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  return (
    <dialog ref={ref} className="share-dialog confirm-dialog" {...props} aria-labelledby={`${id}-title`} aria-describedby={`${id}-text`}>
      <div className="confirm-dialog__body">
        {art && (
          <div className="confirm-dialog__art" aria-hidden="true">
            {art}
          </div>
        )}
        <div className="confirm-dialog__words">
          <h2 id={`${id}-title`} className="share-dialog__title">
            {title}
          </h2>
          <p id={`${id}-text`} className="share-dialog__text">
            {text}
          </p>
        </div>
      </div>
      {problem && <p className="field__hint field__hint--bad">{problem}</p>}
      <div className="share-dialog__foot">
        <button type="button" className="btn btn--primary btn--small" disabled={busy} onClick={() => void confirm()}>
          {busy && <Icon name="loader-circle" />}
          {action}
        </button>
        <button ref={cancel} type="button" className="btn btn--ghost btn--small" onClick={close}>
          {t("common.cancel")}
        </button>
      </div>
    </dialog>
  );
}
