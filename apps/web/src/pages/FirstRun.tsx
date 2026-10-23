// First run (docs/31, "First run"; docs/32): where the log lives, asked once per browser before the app opens.
// Standard, the recommended mode, needs the hosted site's sharing (phase 8); until then Private is preselected.
// Google Drive comes next; for now Private syncs through a folder on this computer.

import { useState } from "react";
import { toUtcIso } from "@touchdown/core";
import type { AppData } from "../data/app.ts";
import { canUseFolders, holdsLog, pickFolder } from "../data/folder.ts";
import { Icon } from "../lib/icons.tsx";
import { LocalWarning, ModeChoice, type Mode } from "../components/ModeChoice.tsx";

export const STANDARD_LATER = "Comes with sharing, in a later version.";
export const FOLDERS_ONLY_HERE = "For now, Private syncs through a folder, which needs Chrome or Edge on a computer. Google Drive comes next.";

export function FirstRun({ app, onDone }: { app: AppData; onDone: () => void }) {
  const folders = canUseFolders();
  const [mode, setMode] = useState<Mode>(folders ? "private" : "local");
  const [understood, setUnderstood] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const go = async () => {
    setError(null);
    const since = toUtcIso(Date.now());
    if (mode === "local") {
      await app.connect({ mode: "local", since });
      onDone();
      return;
    }
    let picked;
    try {
      picked = await pickFolder();
    } catch (e) {
      setError(`The folder could not be opened: ${(e as Error).message}`);
      return;
    }
    if (!picked) return;
    setBusy((await holdsLog(picked.folder)) ? `Reading your log from ${picked.name}…` : `Setting up ${picked.name}…`);
    await app.connect({ mode: "private", adapter: "localfs", folder: picked.folder, name: picked.name, since });
    const info = app.getSyncInfo();
    if (info?.state === "failed") {
      setError(`Touchdown could not use ${picked.name}: ${info.error}`);
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
        <ModeChoice value={mode} onChange={setMode} unavailable={{ standard: STANDARD_LATER, ...(!folders && { private: FOLDERS_ONLY_HERE }) }} />
        {mode === "private" && <p className="form-sub">Choose a folder on this computer. Inside Dropbox, OneDrive, iCloud Drive or Google Drive for desktop, it carries your log to your other computers. Touchdown keeps its files in a Touchdown folder there.</p>}
        {mode === "local" && <LocalWarning understood={understood} onChange={setUnderstood} />}
        {error && (
          <p className="status-line status-line--error" role="alert">
            <Icon name="circle-x" />
            <span>{error}</span>
          </p>
        )}
        <div className="button-row">
          <button type="button" className="btn btn--primary" disabled={!!busy || (mode === "local" && !understood)} onClick={() => void go()}>
            {busy ?? (mode === "private" ? "Choose a folder" : "Continue")}
          </button>
        </div>
      </main>
    </>
  );
}
