// Where the log lives: the three data modes as one choice (docs/32-modes-and-sharing.md), at first run and in
// Settings; for Private, its storage; and the warning that comes with Local.

import { useSyncExternalStore } from "react";
import { t } from "@touchdown/i18n";
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

const modes = (): Option<Mode>[] => [
  { value: "standard", icon: "share-2", name: t("settings.mode.standard.name"), tag: t("settings.mode.standard.tag"), line: t("settings.mode.standard.line") },
  { value: "private", icon: "lock", name: t("settings.mode.private.name"), line: t("settings.mode.private.line") },
  { value: "local", icon: "hard-drive", name: t("settings.mode.local.name"), line: t("settings.mode.local.line") },
];

const storages = (): Option<StorageKind>[] => [
  { value: "gdrive", icon: "cloud", name: t("data.googleDrive"), line: t("settings.storage.gdrive.line") },
  { value: "localfs", icon: "folder", name: t("settings.storage.localfs.name"), line: t("settings.storage.localfs.line") },
];

/** What each storage asks of the user, shown under the choice. Read from the messages each time. */
export const STORAGE_NOTE: Record<StorageKind, string> = {
  get gdrive() {
    return t("settings.storage.gdrive.note");
  },
  get localfs() {
    return t("settings.storage.localfs.note");
  },
};

export const STORAGE_BUTTON: Record<StorageKind, string> = {
  get gdrive() {
    return t("settings.storage.gdrive.button");
  },
  get localfs() {
    return t("settings.storage.localfs.button");
  },
};

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
  return <Choice label={t("settings.syncMode")} name="data-mode" options={modes()} {...props} />;
}

/** Where Private mode syncs. */
export function StorageChoice(props: { value: StorageKind; onChange: (k: StorageKind) => void; unavailable?: Partial<Record<StorageKind, string>> }) {
  return <Choice label={t("settings.storage.title")} name="storage" options={storages()} {...props} />;
}

/** Shown before the user chooses Local, and in Settings while it is chosen. */
export function LocalWarning({ understood, onChange }: { understood?: boolean; onChange?: (v: boolean) => void }) {
  return (
    <div className="local-warning">
      <p className="status-line">
        <Icon name="triangle-alert" />
        <span>{t("settings.local.warning")}</span>
      </p>
      {onChange && (
        <label className="check check--block">
          <input type="checkbox" checked={!!understood} onChange={(e) => onChange(e.target.checked)} />
          {t("settings.local.understood")}
        </label>
      )}
    </div>
  );
}

/** The sync state in Private mode, or null in Local mode. */
export function useSyncInfo(app: AppData): SyncInfo | null {
  return useSyncExternalStore(app.subscribeSync, app.getSyncInfo);
}
