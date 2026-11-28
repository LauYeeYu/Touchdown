// The storage is full (docs/25-photos.md, "Full storage"): opened once, at the first write it refuses. It says that
// the changes are kept in this browser and sent once there is space, and how to make space. Try again syncs again,
// and the dialog stays open, saying so, while the storage is still full.

import { useEffect, useId, useState } from "react";
import { t } from "@touchdown/i18n";
import { useModal } from "../lib/dialog.ts";
import { Icon } from "../lib/icons.tsx";

/** Google's page for the account's storage, which Google Drive, Gmail and Google Photos share: what fills it, and more of it. */
export const GOOGLE_STORAGE = "https://one.google.com/storage";

interface Props {
  place: string;
  /** Google Drive, rather than a directory on this computer. */
  drive: boolean;
  /** Sync again; resolves with whether the storage is still full. */
  tryAgain: () => Promise<boolean>;
  onClose: () => void;
}

export function FullStorageDialog({ place, drive, tryAgain, onClose }: Props) {
  const { ref, close, props } = useModal(onClose);
  const [busy, setBusy] = useState(false);
  const [still, setStill] = useState(false);
  const id = useId();

  useEffect(() => {
    ref.current?.showModal();
  }, [ref]);

  const again = async () => {
    setBusy(true);
    setStill(false);
    const full = await tryAgain();
    setBusy(false);
    if (full) setStill(true);
    else close();
  };

  return (
    <dialog ref={ref} className="share-dialog storage-dialog" {...props} aria-labelledby={`${id}-title`} aria-describedby={`${id}-text`}>
      <h2 id={`${id}-title`} className="share-dialog__title">
        {t("shell.full.title", { drive: drive ? "yes" : "no" })}
      </h2>
      <p id={`${id}-text`} className="share-dialog__text">
        {t("shell.full.text", { place })}
      </p>
      <p className="share-dialog__text">{drive ? t("shell.full.makeSpaceDrive") : t("shell.full.makeSpaceFolder", { place })}</p>
      {still && (
        <p className="field__hint field__hint--bad" role="status">
          {t("shell.full.still", { place })}
        </p>
      )}
      <div className="share-dialog__foot">
        <button type="button" className="btn btn--primary btn--small" disabled={busy} onClick={() => void again()}>
          {busy && <Icon name="loader-circle" />}
          {t("shell.note.tryAgain")}
        </button>
        {drive && (
          <a className="btn btn--ghost btn--small" href={GOOGLE_STORAGE} target="_blank" rel="noopener">
            {t("shell.full.manage")}
          </a>
        )}
        <button type="button" className="btn btn--ghost btn--small" onClick={close}>
          {t("shell.note.notNow")}
        </button>
      </div>
    </dialog>
  );
}
