// First run: nothing logged yet. Offer the import first, since most users arrive with an existing log.

import { t } from "@touchdown/i18n";
import { Link } from "../lib/link.tsx";
import { useSyncInfo } from "../components/ModeChoice.tsx";
import { useApp } from "../data/context.tsx";
import { Icon } from "../lib/icons.tsx";
import { tx } from "../lib/i18n.tsx";

export function EmptyLog() {
  const { app } = useApp();
  const c = app.connection;
  const sync = useSyncInfo(app);
  // The log is in the storage but not read into this browser yet (a new browser, or reading it stopped): not empty.
  // The bar above says why, and what to do.
  if (sync && !sync.tables) {
    return (
      <div className="page">
        <div className="view-top" />
        <h1 className="lead">{t("shell.emptyLog.notRead", { place: sync.place })}</h1>
        <p className="status-line">
          <Icon name={sync.state === "syncing" ? "refresh-cw" : sync.state === "offline" ? "wifi-off" : sync.adapter === "gdrive" ? "cloud-off" : "folder"} />
          <span>{sync.state === "syncing" ? t("shell.emptyLog.reading") : t("shell.emptyLog.readLater")}</span>
        </p>
      </div>
    );
  }
  return (
    <div className="page">
      <div className="view-top" />
      <h1 className="lead">{t("shell.emptyLog.title")}</h1>
      <div className="start">
        <Link className="start__item start__item--main" to="/import">
          <Icon name="upload" />
          <span>
            <b>{t("shell.emptyLog.import.title")}</b>
            <span>{t("shell.emptyLog.import.text")}</span>
          </span>
        </Link>
        <Link className="start__item" to="/flights/new">
          <Icon name="tickets-plane" />
          <span>
            <b>{t("shell.emptyLog.flight.title")}</b>
            <span>{t("shell.emptyLog.flight.text")}</span>
          </span>
        </Link>
        <Link className="start__item" to="/spotting/session">
          <Icon name="notebook-pen" />
          <span>
            <b>{t("shell.emptyLog.session.title")}</b>
            <span>{t("shell.emptyLog.session.text")}</span>
          </span>
        </Link>
      </div>
      <p className="status-line">
        <Icon name="circle-help" />
        <span>{tx("shell.emptyLog.guide", {}, { link: (text) => <Link to="/guide">{text}</Link> })}</span>
      </p>
      <p className="status-line">
        <Icon name="hard-drive" />
        <span>{c && c.mode !== "local" ? t("shell.emptyLog.synced", { name: c.name }) : t("shell.emptyLog.local")}</span>
      </p>
    </div>
  );
}
