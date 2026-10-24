// First run (docs/31, "First run"; docs/32): where the log lives, asked once per browser before the app opens.
// Standard, the recommended mode, needs the hosted site's sharing (phase 8); until then Private is preselected.
// Private syncs through Google Drive or a folder on this computer.

import { useEffect, useState } from "react";
import { toUtcIso } from "@touchdown/core";
import type { AppData } from "../data/app.ts";
import { chooseStorage, type StorageKind } from "../data/connection.ts";
import { canUseFolders } from "../data/folder.ts";
import { loadGoogle } from "../data/google.ts";
import { Icon } from "../lib/icons.tsx";
import { LocalWarning, ModeChoice, STORAGE_BUTTON, STORAGE_NOTE, StorageChoice, type Mode } from "../components/ModeChoice.tsx";

export const STANDARD_LATER = "Comes with sharing, in a later version.";
export const FOLDERS_ONLY_HERE = "Needs Chrome or Edge on a computer.";

export function FirstRun({ app, onDone }: { app: AppData; onDone: () => void }) {
  const [mode, setMode] = useState<Mode>("private");
  const [storage, setStorage] = useState<StorageKind>("gdrive");
  const [understood, setUnderstood] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Ready before the click, so Google's window opens at once.
  useEffect(() => {
    if (mode === "private" && storage === "gdrive") void loadGoogle().catch(() => undefined);
  }, [mode, storage]);

  const go = async () => {
    setError(null);
    if (mode === "local") {
      await app.connect({ mode: "local", since: toUtcIso(Date.now()) });
      onDone();
      return;
    }
    if (storage === "gdrive") setBusy("Waiting for Google…");
    let picked;
    try {
      picked = await chooseStorage(storage);
    } catch (e) {
      setError(`${storage === "gdrive" ? "Google Drive could not be connected" : "The folder could not be opened"}: ${(e as Error).message}`);
      setBusy(null);
      return;
    }
    if (!picked) {
      setBusy(null);
      return;
    }
    const { connection } = picked;
    setBusy(picked.holdsLog ? `Reading your log from ${connection.name}…` : `Setting up ${connection.name}…`);
    await app.connect(connection);
    const info = app.getSyncInfo();
    if (info?.state === "failed") {
      setError(`Touchdown could not use ${connection.name}: ${info.error}`);
      setBusy(null);
      return;
    }
    onDone();
  };

  return (
    <>
      <header className="masthead">
        <div className="page masthead__bar">
          <span className="wordmark">TOUCHDOWN</span>
        </div>
      </header>
      <main id="view" className="page page--form first-run">
        <div className="view-top" />
        <h1 className="lead">Where should your log live?</h1>
        <p className="form-sub">You can change this at any time in Settings.</p>
        <ModeChoice value={mode} onChange={setMode} unavailable={{ standard: STANDARD_LATER }} />
        {mode === "private" && (
          <>
            <h2 className="form-section">Sync through</h2>
            <StorageChoice value={storage} onChange={setStorage} unavailable={canUseFolders() ? {} : { localfs: FOLDERS_ONLY_HERE }} />
            <p className="form-sub">{STORAGE_NOTE[storage]}</p>
          </>
        )}
        {mode === "local" && <LocalWarning understood={understood} onChange={setUnderstood} />}
        {error && (
          <p className="status-line status-line--error" role="alert">
            <Icon name="circle-x" />
            <span>{error}</span>
          </p>
        )}
        <div className="button-row">
          <button type="button" className="btn btn--primary" disabled={!!busy || (mode === "local" && !understood)} onClick={() => void go()}>
            {busy ?? (mode === "private" ? STORAGE_BUTTON[storage] : "Continue")}
          </button>
        </div>
      </main>
    </>
  );
}
