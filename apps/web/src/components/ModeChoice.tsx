// Where the log lives: the three data modes as one choice (docs/32-modes-and-sharing.md), at first run and in
// Settings; for Private, its storage; and the warning that comes with Local.

import { useSyncExternalStore } from "react";
import type { AppData } from "../data/app.ts";
import type { StorageKind } from "../data/connection.ts";
import type { SyncInfo } from "../data/sync.ts";
import { Icon, type IconName } from "../lib/icons.tsx";

export type Mode = "standard" | "private" | "local";

interface Option<T> {
  value: T;
  icon: IconName;
  name: string;
  tag?: string;
  line: string;
}

const MODES: Option<Mode>[] = [
  { value: "standard", icon: "share-2", name: "Standard", tag: "Recommended", line: "Sync and share links." },
  { value: "private", icon: "lock", name: "Private", line: "Sync without sharing." },
  { value: "local", icon: "hard-drive", name: "Local", line: "No sync. Saved in this browser only." },
];

const STORAGES: Option<StorageKind>[] = [
  { value: "gdrive", icon: "cloud", name: "Google Drive", line: "Works on any device." },
  { value: "localfs", icon: "folder", name: "A folder on this computer", line: "Put it in Dropbox, OneDrive or iCloud Drive to sync other computers." },
];

/** What each storage asks of the user, shown under the choice. */
export const STORAGE_NOTE: Record<StorageKind, string> = {
  gdrive: "Touchdown makes a Touchdown folder in your Google Drive and can only open the files it creates. Each sign-in lasts an hour, then sync waits until you sign in again.",
  localfs: "Touchdown makes a Touchdown folder inside the folder you choose.",
};

export const STORAGE_BUTTON: Record<StorageKind, string> = { gdrive: "Connect Google Drive", localfs: "Choose a folder" };

/** A choice of cards; `unavailable` says why an option cannot be chosen here. */
function Choice<T extends string>({ label, name, options, value, onChange, unavailable = {} }: { label: string; name: string; options: Option<T>[]; value: T; onChange: (v: T) => void; unavailable?: Partial<Record<T, string>> }) {
  return (
    <div className="modes" role="radiogroup" aria-label={label}>
      {options.map((m) => {
        const why = unavailable[m.value];
        const on = value === m.value;
        return (
          <label key={m.value} className={`mode${on ? " mode--on" : ""}${why ? " mode--off" : ""}`}>
            <input type="radio" name={name} className="visually-hidden" value={m.value} checked={on} disabled={!!why} onChange={() => onChange(m.value)} />
            <Icon name={m.icon} />
            <span className="mode__text">
              <span className="mode__name">
                <b>{m.name}</b>
                {m.tag && <span className="mode__tag">{m.tag}</span>}
              </span>
              <span>{m.line}</span>
              {why && <small>{why}</small>}
            </span>
            <span className="mode__mark" aria-hidden="true">
              {on && <Icon name="check" />}
            </span>
          </label>
        );
      })}
    </div>
  );
}

export function ModeChoice(props: { value: Mode; onChange: (m: Mode) => void; unavailable?: Partial<Record<Mode, string>> }) {
  return <Choice label="Sync mode" name="data-mode" options={MODES} {...props} />;
}

/** Where Private mode syncs. */
export function StorageChoice(props: { value: StorageKind; onChange: (k: StorageKind) => void; unavailable?: Partial<Record<StorageKind, string>> }) {
  return <Choice label="Storage" name="storage" options={STORAGES} {...props} />;
}

/** Shown before the user chooses Local, and in Settings while it is chosen. */
export function LocalWarning({ understood, onChange }: { understood?: boolean; onChange?: (v: boolean) => void }) {
  return (
    <div className="local-warning">
      <p className="status-line">
        <Icon name="triangle-alert" />
        <span>Your log is kept only in this browser. Clearing the browser's data, using a private window or losing the device deletes it. Export a backup from Settings now and then.</span>
      </p>
      {onChange && (
        <label className="check check--block">
          <input type="checkbox" checked={!!understood} onChange={(e) => onChange(e.target.checked)} />
          I understand this browser holds the only copy.
        </label>
      )}
    </div>
  );
}

/** The sync state in Private mode, or null in Local mode. */
export function useSyncInfo(app: AppData): SyncInfo | null {
  return useSyncExternalStore(app.subscribeSync, app.getSyncInfo);
}
