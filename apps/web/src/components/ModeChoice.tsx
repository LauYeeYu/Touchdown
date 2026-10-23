// Where the log lives: the three data modes as one choice (docs/32-modes-and-sharing.md), at first run and in
// Settings, and the warning that comes with Local.

import { useSyncExternalStore } from "react";
import type { AppData } from "../data/app.ts";
import type { SyncInfo } from "../data/sync.ts";
import { Icon, type IconName } from "../lib/icons.tsx";

export type Mode = "standard" | "private" | "local";

const MODES: { value: Mode; icon: IconName; name: string; tag?: string; line: string }[] = [
  { value: "standard", icon: "share-2", name: "Standard", tag: "Recommended", line: "Sync and share links. Touchdown keeps a key to your storage." },
  { value: "private", icon: "lock", name: "Private", line: "For more privacy: sync across devices, Touchdown keeps no key, no sharing." },
  { value: "local", icon: "hard-drive", name: "Local", line: "For the most privacy: nothing leaves this browser. Export a backup to move it." },
];

/** `unavailable` says why a mode cannot be chosen here. */
export function ModeChoice({ value, onChange, unavailable = {} }: { value: Mode; onChange: (m: Mode) => void; unavailable?: Partial<Record<Mode, string>> }) {
  return (
    <div className="modes" role="radiogroup" aria-label="Where your log lives">
      {MODES.map((m) => {
        const why = unavailable[m.value];
        const on = value === m.value;
        return (
          <label key={m.value} className={`mode${on ? " mode--on" : ""}${why ? " mode--off" : ""}`}>
            <input type="radio" name="data-mode" className="visually-hidden" value={m.value} checked={on} disabled={!!why} onChange={() => onChange(m.value)} />
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
