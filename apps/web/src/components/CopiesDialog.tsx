// Settings › Data › Backup › Daily copies: the copies of the log Touchdown keeps in the user's storage (docs/12,
// "Daily copies"), newest first, each to download or restore. The share dialog's card.

import { useEffect, useRef, useState } from "react";
import { dayMonthYear } from "@touchdown/core/view";
import { t } from "@touchdown/i18n";
import type { StorageCopies } from "../data/sync.ts";
import { download } from "../lib/download.ts";
import { Icon } from "../lib/icons.tsx";

export function CopiesDialog({ copies, place, onRestore, onClose }: { copies: StorageCopies; place: string; onRestore: (data: Uint8Array) => void; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [list, setList] = useState<{ name: string; day: string }[] | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    dialog.current?.showModal();
    copies.list().then(setList, (e: Error) => setProblem(e.message));
  }, [copies]);

  /** The copy's file, or null with the reason shown. */
  const read = async (name: string) => {
    setBusy(name);
    try {
      const data = await copies.read(name);
      if (!data) setProblem(t("settings.copies.gone"));
      return data;
    } catch (e) {
      setProblem((e as Error).message);
      return null;
    } finally {
      setBusy(null);
    }
  };

  return (
    <dialog ref={dialog} className="share-dialog copies-dialog" aria-labelledby="copies-title" onClose={onClose} onCancel={onClose}>
      <h2 id="copies-title" className="share-dialog__title">
        {t("settings.copies.title")}
      </h2>
      <p className="share-dialog__text">{t("settings.copies.intro", { place })}</p>
      {problem && <p className="field__hint field__hint--bad">{t("settings.copies.failed", { problem })}</p>}
      {list === null && !problem && <p className="share-dialog__meta">{t("settings.copies.reading")}</p>}
      {list?.length === 0 && <p className="share-dialog__meta">{t("settings.copies.none")}</p>}
      {!!list?.length && (
        <ul className="copies">
          {list.map((c) => (
            <li key={c.name} className="copies__item">
              <span className="copies__day">{dayMonthYear(c.day)}</span>
              <span className="copies__actions">
                <button
                  type="button"
                  className="btn btn--quiet btn--small"
                  disabled={busy !== null}
                  aria-label={t("settings.copies.downloadLabel", { date: dayMonthYear(c.day) })}
                  onClick={async () => {
                    const data = await read(c.name);
                    if (data) download(c.name, data as BlobPart, "application/zip");
                  }}
                >
                  <Icon name={busy === c.name ? "loader-circle" : "download"} />
                  {t("settings.copies.download")}
                </button>
                <button
                  type="button"
                  className="btn btn--quiet btn--small"
                  disabled={busy !== null}
                  aria-label={t("settings.copies.restoreLabel", { date: dayMonthYear(c.day) })}
                  onClick={async () => {
                    const data = await read(c.name);
                    if (data) onRestore(data);
                  }}
                >
                  <Icon name="rotate-ccw" />
                  {t("settings.copies.restore")}
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}
      <div className="share-dialog__foot">
        <button type="button" className="btn btn--ghost btn--small" onClick={onClose}>
          {t("common.done")}
        </button>
      </div>
    </dialog>
  );
}
