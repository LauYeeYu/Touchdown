// First run: nothing logged yet. Offer the import first, since most users arrive with an existing log.

import { Link } from "@tanstack/react-router";
import { Icon } from "../lib/icons.tsx";

export function EmptyLog() {
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
          <Icon name="plane" />
          <span>
            <b>Add a flight</b>
            <span>Flight number and date first; the rest is optional.</span>
          </span>
        </Link>
        <Link className="start__item" to="/spotting/session">
          <Icon name="camera" />
          <span>
            <b>Log a spotting session</b>
            <span>Set the day and the airport once, then type registrations one after another.</span>
          </span>
        </Link>
      </div>
      <p className="status-line">
        <Icon name="hard-drive" />
        <span>Your data stays in this browser. Export a backup from Settings at any time; syncing to your Google Drive comes later.</span>
      </p>
    </div>
  );
}
