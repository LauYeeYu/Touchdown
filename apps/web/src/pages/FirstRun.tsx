// First run (docs/31, "First run"; docs/32): where the log lives, asked once per browser before the app opens.
// Standard, the recommended mode, is preselected where the site offers it: its terms in a dialog (when Standard is
// chosen, or on Continue), then Google's page through Touchdown's server. Private syncs through Google Drive or a folder on this computer; Local keeps it here.

import { useEffect, useState } from "react";
import { toUtcIso } from "@touchdown/core";
import type { AppData } from "../data/app.ts";
import { chooseStorage, type StorageKind } from "../data/connection.ts";
import { canUseFolders } from "../data/folder.ts";
import { loadGoogle } from "../data/google.ts";
import { standard, STANDARD_ERRORS, type StandardStatus } from "../data/standard.ts";
import { Icon } from "../lib/icons.tsx";
import { LocalWarning, ModeChoice, STORAGE_BUTTON, STORAGE_NOTE, StorageChoice, type Mode } from "../components/ModeChoice.tsx";
import { StandardTerms } from "../components/StandardTerms.tsx";
import { Wordmark } from "../components/Wordmark.tsx";

export const STANDARD_UNAVAILABLE = "Not available on this site.";
export const FOLDERS_ONLY_HERE = "Needs Chrome or Edge on a computer.";

/** A `storage-error` from the way back from Google, taken off the address once read. */
export function takeStandardError(): string | null {
  const params = new URLSearchParams(location.search);
  const code = params.get("storage-error");
  if (!code) return null;
  params.delete("storage-error");
  history.replaceState(history.state, "", location.pathname + (params.size ? `?${params}` : "") + location.hash);
  return STANDARD_ERRORS[code] ?? STANDARD_ERRORS.failed!;
}

/** Accept the terms (if not yet) and go to Google's page through the server; it comes back to `back`. */
export async function connectStandard(st: StandardStatus, back: string): Promise<string | null> {
  try {
    if (!st.accepted) await standard.accept(st.termsVersion);
  } catch (e) {
    return (e as Error).message;
  }
  location.assign(standard.connectUrl(back));
  return null;
}

export function FirstRun({ app, onDone }: { app: AppData; onDone: () => void }) {
  const [std, setStd] = useState<StandardStatus | null>(null);
  const [mode, setMode] = useState<Mode>("private");
  const [storage, setStorage] = useState<StorageKind>("gdrive");
  const [understood, setUnderstood] = useState(false);
  const [termsOpen, setTermsOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Standard is preselected where the site offers it (docs/32, "Choosing a mode at first run").
  useEffect(() => {
    const back = takeStandardError();
    if (back) setError(back);
    void standard.status().then(
      (s) => {
        setStd(s);
        if (s.available) setMode("standard");
      },
      () => setStd(null),
    );
  }, []);

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
          <span className="wordmark">
            <Wordmark />
          </span>
        </div>
      </header>
      <main id="view" className="page page--form first-run">
        <div className="view-top" />
        <h1 className="lead">Sync mode</h1>
        <p className="form-sub">You can change it later in Settings.</p>
        <ModeChoice
          value={mode}
          onChange={(m) => {
            setMode(m);
            setError(null);
            if (m === "standard") setTermsOpen(true);
          }}
          unavailable={std?.available ? {} : { standard: STANDARD_UNAVAILABLE }}
        />
        {std && (
          <StandardTerms
            open={termsOpen && mode === "standard"}
            busy={!!busy}
            problem={termsOpen ? error : null}
            onAccept={() => {
              setBusy("Going to Google…");
              void connectStandard(std, "/").then((p) => {
                if (p) {
                  setError(p);
                  setBusy(null);
                }
              });
            }}
            onDecline={() => {
              setTermsOpen(false);
              setError(null);
              setMode("private");
            }}
          />
        )}
        {mode === "private" && (
          <>
            <h2 className="form-section">Storage</h2>
            <StorageChoice value={storage} onChange={setStorage} unavailable={canUseFolders() ? {} : { localfs: FOLDERS_ONLY_HERE }} />
            <p className="form-sub">{STORAGE_NOTE[storage]}</p>
          </>
        )}
        {mode === "local" && <LocalWarning understood={understood} onChange={setUnderstood} />}
        {error && !termsOpen && (
          <p className="status-line status-line--error" role="alert">
            <Icon name="circle-x" />
            <span>{error}</span>
          </p>
        )}
        <div className="button-row">
          <button
            type="button"
            className="btn btn--primary"
            disabled={!!busy || (mode === "local" && !understood)}
            onClick={() => (mode === "standard" ? setTermsOpen(true) : void go())}
          >
            {busy ?? (mode === "private" ? STORAGE_BUTTON[storage] : "Continue")}
          </button>
        </div>
      </main>
    </>
  );
}
