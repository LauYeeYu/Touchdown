// Getting started (docs/31-ui.md, "Getting started"): the first steps for someone new to Touchdown, such as a friend
// the owner invited. Each step is a short text beside a diagram of what it does, drawn from the app's own parts (its
// icons, tonal surfaces, the map's track and great circle, a finding, the Add menu), so the page can be read at a
// glance. The diagrams repeat the text, so screen readers skip them.

import { useId, type ReactNode } from "react";
import { Link } from "../lib/link.tsx";
import { Icon, type IconName } from "../lib/icons.tsx";
import { useApp } from "../data/context.tsx";

type Mode = "standard" | "private" | "local";
const MODE_NAME: Record<Mode, string> = { standard: "Standard", private: "Private", local: "Local" };

export function Guide() {
  const { app } = useApp();
  const mode: Mode = app.connection?.mode ?? "local";
  return (
    <div className="page guide">
      <div className="view-top" />
      <h1 className="form-title">Getting started</h1>
      <p className="guide__intro">Touchdown keeps the flights you have flown and the aircraft you have photographed, and works out statistics from them. These are the first steps.</p>

      <Step title="Modes" figure={<ModesFigure current={mode} />}>
        <p>Your log is always in this browser. Standard and Private also keep it in storage you own, so your other devices sync with it.</p>
        <p>The difference is who can open that copy. In Standard, Touchdown's server can, so it can show the links you share and you connect Google Drive only once. In Private, only your own browsers can.</p>
        <p>
          You selected <b>{MODE_NAME[mode]}</b> mode. Change it in <Link to="/settings">Settings</Link>, under Sync mode.
        </p>
      </Step>

      <Step title="Your flights from myFR24" figure={<MyFr24Figure />}>
        <ol className="guide__steps">
          <li>
            On my.flightradar24.com, open Settings › Export and download the CSV file.{" "}
            <a href="https://my.flightradar24.com/settings/export" target="_blank" rel="noopener">
              Open myFR24's export
              <Icon name="external-link" />
            </a>
          </li>
          <li>
            Open <Link to="/import">Import</Link> here and choose the file. Every row is checked before anything is saved.
          </li>
          <li>Look through what the checks found, then import. An import can be undone.</li>
        </ol>
      </Step>

      <Step title="A spreadsheet" figure={<SpreadsheetFigure />}>
        <p>A flight or spotting log kept in a spreadsheet comes in through Import too, as a CSV or Excel file, in any layout.</p>
        <p>Import works out which column holds what, and asks about the columns it is unsure of.</p>
      </Step>

      <Step title="Adding flights and sightings" figure={<AddFigure />}>
        <p>Use the + button at the top of every page.</p>
        <ul className="guide__points">
          <li>
            A <Link to="/flights/new">flight</Link> needs its flight number and date first. The rest is optional.
          </li>
          <li>
            A <Link to="/spotting/session">spotting session</Link> takes the day and the airport once, then one registration after another.
          </li>
        </ul>
      </Step>

      <Step title="Recorded tracks" figure={<TrackFigure />}>
        <p>A flight is drawn as the great circle between its airports until it has a recorded track.</p>
        <ul className="guide__points">
          <li>With a Flightradar24 subscription, download a flight's track as CSV or KML and add it on the flight's page, under Add track.</li>
          <li>The Flights page lists the flights without one, as a file to send to someone who can find them.</li>
        </ul>
      </Step>

      <Step title="Issues" figure={<IssueFigure />}>
        <p>
          <Link to="/issues">Issues</Link> lists what looks wrong in the log, such as a registration that does not fit its aircraft type or times out of order.
        </p>
        <p>Use the fix it suggests. A warning that is right as it is can be marked “This is right”.</p>
      </Step>

      <Step title="Sharing" figure={<ShareFigure />}>
        <p>In Standard mode, share a flight, a sighting or an aircraft from its page, or your whole log from Home. Shared links, in the menu at the top, lists them.</p>
        <ul className="guide__points">
          <li>Anyone with a link can open it, read only, until you stop it.</li>
          <li>Ticket numbers and booking references are never in a link.</li>
        </ul>
      </Step>

      <Step title="Taking your log elsewhere" figure={<ExportFigure />}>
        <p>
          <Link to="/settings">Settings</Link>, under Data, makes a backup of everything, each table as CSV, a Google Sheet with a tab for each table, and a file of your flights for myFR24's import.
        </p>
      </Step>
    </div>
  );
}

/** One step: its text, and its diagram beside it (under it on a phone). */
function Step({ title, figure, children }: { title: string; figure: ReactNode; children: ReactNode }) {
  const id = useId();
  return (
    <section className="guide-step" aria-labelledby={id}>
      <div className="guide-step__text">
        <h2 className="guide-step__title" id={id}>
          {title}
        </h2>
        {children}
      </div>
      <div className="gfig" aria-hidden="true">
        {figure}
      </div>
    </section>
  );
}

/** A box in a diagram: an icon, a name and a line under it. */
function Node({ icon, label, sub, n, strong = false }: { icon: IconName; label: string; sub?: string; n?: number; strong?: boolean }) {
  return (
    <span className={`gnode${strong ? " gnode--strong" : ""}`}>
      {n !== undefined && <span className="gnode__n">{n}</span>}
      <Icon name={icon} />
      <span className="gnode__text">
        <span className="gnode__label">{label}</span>
        {sub && <span className="gnode__sub">{sub}</span>}
      </span>
    </span>
  );
}

/** The way between two boxes, with what goes along it. */
function Arrow({ label, both = false }: { label?: string; both?: boolean }) {
  return (
    <span className="garrow">
      <Icon name={both ? "arrow-left-right" : "arrow-right"} />
      {label && <span className="garrow__label">{label}</span>}
    </span>
  );
}

const MODE_ORDER: Mode[] = ["standard", "private", "local"];

/** What each mode does, row by row. "No" is muted, so the rows where Standard and Private part show at a glance. */
const MODE_ROWS: { label: string; values: Record<Mode, string> }[] = [
  { label: "Your log is kept", values: { standard: "In this browser and your Google Drive", private: "In this browser and your Google Drive or a directory", local: "In this browser only" } },
  { label: "Your other devices sync", values: { standard: "Yes", private: "Yes", local: "No" } },
  { label: "Share links", values: { standard: "Yes", private: "No", local: "No" } },
  { label: "Signing in to Google", values: { standard: "Once, to connect", private: "Every hour, with Google Drive", local: "Not needed" } },
  { label: "Touchdown's server can open your log", values: { standard: "Yes", private: "No", local: "No" } },
];

/** The three modes side by side, the selected one in the selection container. A phone-wide panel lists them one under another. */
function ModesFigure({ current }: { current: Mode }) {
  const name = (m: Mode) => (
    <>
      {MODE_NAME[m]}
      {m === current && <span className="gpill">Selected</span>}
    </>
  );
  const value = (text: string) => <span className={text === "No" ? "gcmp__no" : undefined}>{text}</span>;
  return (
    <>
      <table className="gcmp">
        <thead>
          <tr>
            <td />
            {MODE_ORDER.map((m) => (
              <th key={m} className={m === current ? "is-current" : undefined}>
                {name(m)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {MODE_ROWS.map((r) => (
            <tr key={r.label}>
              <th>{r.label}</th>
              {MODE_ORDER.map((m) => (
                <td key={m} className={m === current ? "is-current" : undefined}>
                  {value(r.values[m])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="gcmp-list">
        {MODE_ORDER.map((m) => (
          <dl key={m} className={`gcmp-list__mode${m === current ? " is-current" : ""}`}>
            <span className="gcmp-list__name">{name(m)}</span>
            {MODE_ROWS.map((r) => (
              <div key={r.label}>
                <dt>{r.label}</dt>
                <dd>{value(r.values[m])}</dd>
              </div>
            ))}
          </dl>
        ))}
      </div>
    </>
  );
}

function MyFr24Figure() {
  return (
    <span className="gflow gflow--wide">
      <Node n={1} icon="download" label="myFR24" sub="Settings › Export" />
      <Arrow label="CSV file" />
      <Node n={2} icon="upload" label="Import" sub="checks every row" />
      <Arrow />
      <Node n={3} icon="list-checks" label="Review" sub="then import" />
      <Arrow />
      <Node icon="tickets-plane" label="Your log" sub="an import can be undone" strong />
    </span>
  );
}

/** As the Import page's column step shows it: each column's header over a sample, and the field it holds. */
const COLUMNS: [string, string, string | null][] = [
  ["Date", "14/03/2025", "Date"],
  ["Flt", "BA9001", "Flight number"],
  ["Dep", "LHR", "From"],
  ["Remarks", "upgraded", null],
];

function SpreadsheetFigure() {
  return (
    <div className="gcols">
      {COLUMNS.map(([head, sample, field]) => (
        <div key={head} className={`gcols__row${field ? "" : " is-unclear"}`}>
          <span className="gcols__head">
            <b>{head}</b>
            <span>{sample}</span>
          </span>
          <Arrow />
          {field ? <span className="gcols__field">{field}</span> : <span className="gcols__ask">Unclear, so Import asks you</span>}
        </div>
      ))}
    </div>
  );
}

/** The Add menu as the + button opens it. */
function AddFigure() {
  const items: [IconName, string, string][] = [
    ["tickets-plane", "Flight", "Flight number and date first"],
    ["camera", "Sighting", "One aircraft you saw"],
    ["notebook-pen", "Spotting session", "Day and airport once, then registrations"],
  ];
  return (
    <div className="gadd">
      <span className="gadd__button">
        <Icon name="plus" />
      </span>
      <span className="gadd__menu">
        {items.map(([icon, label, sub]) => (
          <span key={label} className="gadd__item">
            <Icon name={icon} />
            <span className="gnode__text">
              <span className="gnode__label">{label}</span>
              <span className="gnode__sub">{sub}</span>
            </span>
          </span>
        ))}
      </span>
    </div>
  );
}

/** A route as the flight map draws it: the great circle dashed, the recorded track in gold. New York on the left, London on the right, as a map has them. */
function TrackFigure() {
  return (
    <div className="gtrack">
      <div className="gtrack__map">
        <svg viewBox="0 0 520 150" preserveAspectRatio="xMidYMid meet">
          <path className="gtrack__gc" d="M40 120 Q260 0 480 120" />
          <path className="gtrack__halo" d="M40 120 C110 70 170 46 250 46 C335 46 410 72 480 120" />
          <path className="gtrack__line" d="M40 120 C110 70 170 46 250 46 C335 46 410 72 480 120" />
          <circle className="gtrack__ap" cx="40" cy="120" r="4.5" />
          <circle className="gtrack__ap" cx="480" cy="120" r="4.5" />
        </svg>
        <span className="gtrack__code" style={{ left: `${(40 / 520) * 100}%` }}>
          JFK
        </span>
        <span className="gtrack__code" style={{ left: `${(480 / 520) * 100}%` }}>
          LHR
        </span>
      </div>
      <span className="glegend">
        <span>
          <i className="glegend__track" />
          Recorded track
        </span>
        <span>
          <i className="glegend__gc" />
          Great circle, until a track is added
        </span>
      </span>
      <span className="gflow">
        <Node icon="file" label="Flightradar24 track" sub="CSV or KML" />
        <Arrow />
        <Node icon="route" label="Add track" sub="on the flight's page" />
      </span>
    </div>
  );
}

/** A finding as Issues shows it, with its suggested fix. */
function IssueFigure() {
  return (
    <div className="gfinding">
      <Icon name="circle-x" />
      <span className="gfinding__body">
        <span className="gfinding__rule">Times out of order</span>
        <span className="gfinding__text">BA9001 on 2025-03-14: takeoff is before boarding.</span>
        <span className="gfinding__fix">
          <Icon name="check" />
          Move takeoff and landing to the next day (2025-03-15)
        </span>
      </span>
    </div>
  );
}

function ShareFigure() {
  return (
    <div className="gshare">
      <span className="gflow gflow--wide">
        <Node icon="tickets-plane" label="A flight" sub="or sighting, aircraft, whole log" />
        <Arrow />
        <Node icon="link" label="A link" sub="/p/…" />
        <Arrow />
        <Node icon="globe" label="Read-only page" sub="for anyone with the link" />
      </span>
      <span className="gnote">
        <span>
          <Icon name="lock" />
          Ticket numbers and booking references stay out
        </span>
        <span>
          <Icon name="cloud" />
          Standard mode
        </span>
      </span>
    </div>
  );
}

function ExportFigure() {
  const outs: [IconName, string, string][] = [
    ["download", "Backup", "every table, as a .zip"],
    ["file", "CSV", "one table"],
    ["table", "Google Sheet", "a tab for each table"],
    ["tickets-plane", "myFR24 file", "for its import"],
  ];
  return (
    <div className="gfan">
      <Node icon="settings" label="Settings › Data" strong />
      <Arrow />
      <span className="gfan__outs">
        {outs.map(([icon, label, sub]) => (
          <span key={label} className="gfan__out">
            <Node icon={icon} label={label} sub={sub} />
          </span>
        ))}
      </span>
    </div>
  );
}
