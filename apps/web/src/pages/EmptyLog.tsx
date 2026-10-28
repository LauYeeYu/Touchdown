// First run: nothing logged yet. Offer the import first, since most users arrive with an existing log.

import { Link } from "@tanstack/react-router";
import { useSyncInfo } from "../components/ModeChoice.tsx";
import { useApp } from "../data/context.tsx";
import { Icon } from "../lib/icons.tsx";

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
        <h1 className="lead">Your log has not been read from {sync.place} yet.</h1>
        <p className="status-line">
          <Icon name={sync.state === "syncing" ? "refresh-cw" : sync.adapter === "gdrive" ? "cloud-off" : "folder"} />
          <span>{sync.state === "syncing" ? "It is being read now, and shows here once it is in." : "It shows here once it is read. Until then, what you add is kept in this browser and merged with it."}</span>
        </p>
      </div>
    );
  }
  return (
    <div className="page">
      <div className="view-top" />
      <h1 className="lead">Your log is empty. Bring in what you already have, or start with one flight.</h1>
      <div className="start">
        <Link className="start__item start__item--main" to="/import">
          <Icon name="upload" />
          <span>
            <b>Import your log</b>
            <span>A my.flightradar24.com CSV export, or your flight and spotting spreadsheets as CSV or Excel files. Everything is checked before it is saved.</span>
          </span>
        </Link>
        <Link className="start__item" to="/flights/new">
          <Icon name="tickets-plane" />
          <span>
            <b>Add a flight</b>
            <span>Flight number and date first. The rest is optional.</span>
          </span>
        </Link>
        <Link className="start__item" to="/spotting/session">
          <Icon name="notebook-pen" />
          <span>
            <b>Log a spotting session</b>
            <span>Set the day and the airport once, then type registrations one after another.</span>
          </span>
        </Link>
      </div>
      <p className="status-line">
        <Icon name="hard-drive" />
        <span>{c && c.mode !== "local" ? `What you add is saved in this browser and synced through ${c.name}.` : "Your data stays in this browser. Export a backup from Settings at any time."}</span>
      </p>
    </div>
  );
}
