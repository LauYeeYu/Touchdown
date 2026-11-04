// Getting started (docs/31-ui.md, "Getting started"): the first steps for someone new to Touchdown, such as a friend
// the owner invited. The modes, bringing in a myFR24 export or a spreadsheet, adding flights and sightings, tracks,
// issues, sharing and taking the log elsewhere, each with a link to the page that does it.

import { Link } from "../lib/link.tsx";
import { Icon } from "../lib/icons.tsx";
import { useApp } from "../data/context.tsx";

const MODE_NAME = { standard: "Standard", private: "Private", local: "Local" } as const;

export function Guide() {
  const { app } = useApp();
  const mode = app.connection?.mode ?? "local";
  return (
    <div className="page page--form guide">
      <div className="view-top" />
      <h1 className="form-title">Getting started</h1>
      <p>Touchdown keeps the flights you have flown and the aircraft you have photographed, and works out statistics from them. This page goes through the first steps.</p>

      <h2 className="form-section">Modes</h2>
      <p>
        Your log is kept in this browser and, in two of the three modes, synced through storage you own. This browser is in {MODE_NAME[mode]} mode. Change it at any time in <Link to="/settings">Settings</Link>, under Sync mode.
      </p>
      <ul>
        <li>
          <b>Standard</b> syncs through a Touchdown folder in your Google Drive. Touchdown's server keeps a key to that folder, so your other browsers sync without signing in to Google every hour, and you can share links to your log.
        </li>
        <li>
          <b>Private</b> syncs through your Google Drive or a folder on this computer, with access only your browsers hold. Nothing can be shared.
        </li>
        <li>
          <b>Local</b> keeps the log in this browser only. Export a backup from Settings now and then, since no other copy is kept.
        </li>
      </ul>

      <h2 className="form-section">Your flights from myFR24</h2>
      <ol>
        <li>
          On my.flightradar24.com, open Settings › Export and download your flights as a CSV file.{" "}
          <a href="https://my.flightradar24.com/settings/export" target="_blank" rel="noopener">
            Open myFR24's export
            <Icon name="external-link" />
          </a>
        </li>
        <li>
          Open <Link to="/import">Import</Link> here and choose that file. Touchdown reads it as myFR24 wrote it and checks every row before anything is saved.
        </li>
        <li>Look through what the check found, such as a registration that does not fit the aircraft type or a time that cannot be right, then import. An import can be undone from the Import page.</li>
      </ol>

      <h2 className="form-section">A spreadsheet</h2>
      <p>A flight or spotting log kept in a spreadsheet comes in the same way, as a CSV or Excel file, in any layout. The Import page works out which column holds what and asks about the columns it is unsure of.</p>

      <h2 className="form-section">Adding flights and sightings</h2>
      <p>
        Use the + button at the top of each page. A <Link to="/flights/new">flight</Link> needs its flight number and date first, and the rest is optional. A <Link to="/spotting/session">spotting session</Link> takes the day and the airport once, then one registration after another.
      </p>

      <h2 className="form-section">Recorded tracks</h2>
      <p>A flight is drawn as the great circle between its airports until it has a recorded track. With a Flightradar24 subscription, download a flight's track as CSV or KML and add it on the flight's page, under Add track. The Flights page lists the flights without one, as a file to send to someone who can find them.</p>

      <h2 className="form-section">Issues</h2>
      <p>
        <Link to="/issues">Issues</Link> lists what looks wrong in the log, such as a registration that does not fit its aircraft type or a flight that lands before it takes off. Fix each one, or accept it when it is right as it is.
      </p>

      <h2 className="form-section">Sharing</h2>
      <p>In Standard mode, share a flight, a sighting or an aircraft from its page, or your whole log from Home. Shared links, in the menu at the top, lists them. Anyone with a link can open it, read only, until you stop it. Ticket numbers and booking references are never in a link.</p>

      <h2 className="form-section">Taking your log elsewhere</h2>
      <p>
        <Link to="/settings">Settings</Link>, under Data, makes a backup of everything, each table as CSV, a Google Sheet with a tab for each table, and a file of your flights for myFR24's import.
      </p>
    </div>
  );
}
