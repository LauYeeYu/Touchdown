// Where the log lives: the three data modes as one choice (docs/32-modes-and-sharing.md), at first run and in
// Settings; for Private, where it syncs; and the warning that comes with Local.

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
  { value: "standard", icon: "share-2", name: "Standard", tag: "Recommended", line: "Sync and share links. Touchdown keeps a key to your storage." },
  { value: "private", icon: "lock", name: "Private", line: "For more privacy: sync across devices, Touchdown keeps no key, no sharing." },
  { value: "local", icon: "hard-drive", name: "Local", line: "For the most privacy: nothing leaves this browser. Export a backup to move it." },
];

const STORAGES: Option<StorageKind>[] = [
  { value: "gdrive", icon: "cloud", name: "Google Drive", line: "On every device, phones included. Touchdown can open only the files it makes there." },
  { value: "localfs", icon: "folder", name: "A folder on this computer", line: "Inside Dropbox, OneDrive or iCloud Drive, it reaches your other computers." },
];

/** What each storage asks of the user, shown under the choice. */
export const STORAGE_NOTE: Record<StorageKind, string> = {
  gdrive: "Touchdown keeps your log in a Touchdown folder in your Google Drive. A sign-in lasts an hour; after that, changes wait in this browser until you sign in again, which takes a click.",
  localfs: "Choose a folder on this computer. Inside Dropbox, OneDrive, iCloud Drive or Google Drive for desktop, it carries your log to your other computers. Touchdown keeps its files in a Touchdown folder there.",
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
  return <Choice label="Where your log lives" name="data-mode" options={MODES} {...props} />;
}

/** Where Private mode syncs. */
export function StorageChoice(props: { value: StorageKind; onChange: (k: StorageKind) => void; unavailable?: Partial<Record<StorageKind, string>> }) {
  return <Choice label="Where Private syncs" name="storage" options={STORAGES} {...props} />;
}

/** Shown before the user chooses Local, and in Settings while it is chosen. */
export function LocalWarning({ understood, onChange }: { understood?: boolean; onChange?: (v: boolean) => void }) {
  return (
    <div className="local-warning">
      <p className="status-line">
        <Icon name="triangle-alert" />
        <span>Your log will be kept only in this browser. Clearing the browser's data, using a private window, resetting or losing the device deletes it, and no other copy exists. Export a backup now and then (Settings, Data).</span>
      </p>
      {onChange && (
        <label className="check check--block">
          <input type="checkbox" checked={!!understood} onChange={(e) => onChange(e.target.checked)} />
          I understand that this browser holds the only copy.
        </label>
      )}
    </div>
  );
}

/** The sync state in Private mode, or null in Local mode. */
export function useSyncInfo(app: AppData): SyncInfo | null {
  return useSyncExternalStore(app.subscribeSync, app.getSyncInfo);
}
