// Getting started (docs/31-ui.md, "Getting started"): the first steps for someone new to Touchdown, such as a friend
// the owner invited. Each step is a short text beside a diagram of what it does, drawn from the app's own parts (its
// icons, tonal surfaces, the map's track and great circle, a finding, the Add menu), so the page can be read at a
// glance. The diagrams repeat the text, so screen readers skip them.

import { useId, type ReactNode } from "react";
import { sentenceGap, t } from "@touchdown/i18n";
import { Link } from "../lib/link.tsx";
import { Icon, type IconName } from "../lib/icons.tsx";
import { useApp } from "../data/context.tsx";
import { dateOnly, FIELD_LABEL } from "../lib/format.ts";
import { tx } from "../lib/i18n.tsx";

type Mode = "standard" | "private" | "local";
const modeName = (m: Mode): string => ({ standard: t("guide.mode.standard"), private: t("guide.mode.private"), local: t("guide.mode.local") })[m];

export function Guide() {
  const { app } = useApp();
  const mode: Mode = app.connection?.mode ?? "local";
  return (
    <div className="page guide">
      <div className="view-top" />
      <h1 className="form-title">{t("guide.title")}</h1>
      <p className="guide__intro">{t("guide.intro")}</p>

      <Step title={t("guide.modes.title")} figure={<ModesFigure current={mode} />}>
        <p>{t("guide.modes.browser")}</p>
        <p>{t("guide.modes.difference")}</p>
        <p>{tx("guide.modes.selected", { mode: modeName(mode) }, { b: (text) => <b>{text}</b>, link: (text) => <Link to="/settings">{text}</Link> })}</p>
      </Step>

      <Step title={t("guide.myfr24.title")} figure={<MyFr24Figure />}>
        <ol className="guide__steps">
          <li>
            {t("guide.myfr24.export")}{sentenceGap()}
            <a href="https://my.flightradar24.com/settings/export" target="_blank" rel="noopener">
              {t("guide.myfr24.exportLink")}
              <Icon name="external-link" />
            </a>
          </li>
          <li>{tx("guide.myfr24.import", {}, { link: (text) => <Link to="/import">{text}</Link> })}</li>
          <li>{t("guide.myfr24.review")}</li>
        </ol>
      </Step>

      <Step title={t("guide.spreadsheet.title")} figure={<SpreadsheetFigure />}>
        <p>{t("guide.spreadsheet.layout")}</p>
        <p>{t("guide.spreadsheet.columns")}</p>
      </Step>

      <Step title={t("guide.add.title")} figure={<AddFigure />}>
        <p>{t("guide.add.button")}</p>
        <ul className="guide__points">
          <li>{tx("guide.add.flight", {}, { link: (text) => <Link to="/flights/new">{text}</Link> })}</li>
          <li>{tx("guide.add.session", {}, { link: (text) => <Link to="/spotting/session">{text}</Link> })}</li>
        </ul>
      </Step>

      <Step title={t("guide.tracks.title")} figure={<TrackFigure />}>
        <p>{t("guide.tracks.greatCircle")}</p>
        <ul className="guide__points">
          <li>{t("guide.tracks.fr24")}</li>
          <li>{t("guide.tracks.missing")}</li>
        </ul>
      </Step>

      <Step title={t("guide.issues.title")} figure={<IssueFigure />}>
        <p>{tx("guide.issues.list", {}, { link: (text) => <Link to="/issues">{text}</Link> })}</p>
        <p>{t("guide.issues.fix")}</p>
      </Step>

      <Step title={t("guide.sharing.title")} figure={<ShareFigure />}>
        <p>{t("guide.sharing.how")}</p>
        <ul className="guide__points">
          <li>{t("guide.sharing.anyone")}</li>
          <li>{t("guide.sharing.preview")}</li>
          <li>{t("guide.sharing.private")}</li>
        </ul>
      </Step>

      <Step title={t("guide.export.title")} figure={<ExportFigure />}>
        <p>{tx("guide.export.text", {}, { link: (text) => <Link to="/settings">{text}</Link> })}</p>
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
function modeRows(): { label: string; values: Record<Mode, string> }[] {
  const yes = t("guide.modes.figure.yes");
  const no = t("guide.modes.figure.no");
  return [
    { label: t("guide.modes.figure.kept"), values: { standard: t("guide.modes.figure.kept.standard"), private: t("guide.modes.figure.kept.private"), local: t("guide.modes.figure.kept.local") } },
    { label: t("guide.modes.figure.devices"), values: { standard: yes, private: yes, local: no } },
    { label: t("guide.modes.figure.links"), values: { standard: yes, private: no, local: no } },
    { label: t("guide.modes.figure.google"), values: { standard: t("guide.modes.figure.google.standard"), private: t("guide.modes.figure.google.private"), local: t("guide.modes.figure.google.local") } },
    { label: t("guide.modes.figure.server"), values: { standard: yes, private: no, local: no } },
  ];
}

/** The three modes side by side, the selected one in the selection container. A phone-wide panel lists them one under another. */
function ModesFigure({ current }: { current: Mode }) {
  const rows = modeRows();
  const no = t("guide.modes.figure.no");
  const name = (m: Mode) => (
    <>
      {modeName(m)}
      {m === current && <span className="gpill">{t("guide.modes.figure.selected")}</span>}
    </>
  );
  const value = (text: string) => <span className={text === no ? "gcmp__no" : undefined}>{text}</span>;
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
          {rows.map((r) => (
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
            {rows.map((r) => (
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
      <Node n={1} icon="download" label="myFR24" sub={t("guide.myfr24.figure.menu")} />
      <Arrow label={t("guide.myfr24.figure.file")} />
      <Node n={2} icon="upload" label={t("guide.myfr24.figure.import")} sub={t("guide.myfr24.figure.import.sub")} />
      <Arrow />
      <Node n={3} icon="list-checks" label={t("guide.myfr24.figure.review")} sub={t("guide.myfr24.figure.review.sub")} />
      <Arrow />
      <Node icon="tickets-plane" label={t("guide.myfr24.figure.log")} sub={t("guide.myfr24.figure.log.sub")} strong />
    </span>
  );
}

/** As the Import page's column step shows it: each column's header over a sample, and the field it holds. */
function columns(): [string, string, string | null][] {
  return [
    [t("guide.spreadsheet.figure.date"), dateOnly("2025-03-14", { day: "2-digit", month: "2-digit", year: "numeric" }), FIELD_LABEL.scheduledDate!],
    [t("guide.spreadsheet.figure.flight"), "BA9001", FIELD_LABEL.flightNumber!],
    [t("guide.spreadsheet.figure.from"), "LHR", FIELD_LABEL.fromAirportId!],
    [t("guide.spreadsheet.figure.remarks"), t("guide.spreadsheet.figure.remarks.sample"), null],
  ];
}

function SpreadsheetFigure() {
  return (
    <div className="gcols">
      {columns().map(([head, sample, field]) => (
        <div key={head} className={`gcols__row${field ? "" : " is-unclear"}`}>
          <span className="gcols__head">
            <b>{head}</b>
            <span>{sample}</span>
          </span>
          <Arrow />
          {field ? <span className="gcols__field">{field}</span> : <span className="gcols__ask">{t("guide.spreadsheet.figure.unclear")}</span>}
        </div>
      ))}
    </div>
  );
}

/** The Add menu as the + button opens it. */
function AddFigure() {
  const items: [IconName, string, string][] = [
    ["tickets-plane", t("guide.add.figure.flight"), t("guide.add.figure.flight.sub")],
    ["camera", t("guide.add.figure.sighting"), t("guide.add.figure.sighting.sub")],
    ["notebook-pen", t("guide.add.figure.session"), t("guide.add.figure.session.sub")],
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
          {t("guide.tracks.figure.track")}
        </span>
        <span>
          <i className="glegend__gc" />
          {t("guide.tracks.figure.greatCircle")}
        </span>
      </span>
      <span className="gflow">
        <Node icon="file" label={t("guide.tracks.figure.file")} sub={t("guide.tracks.figure.file.sub")} />
        <Arrow />
        <Node icon="route" label={t("guide.tracks.figure.add")} sub={t("guide.tracks.figure.add.sub")} />
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
        <span className="gfinding__rule">{t("guide.issues.figure.rule")}</span>
        <span className="gfinding__text">{t("guide.issues.figure.text", { flight: "BA9001", date: "2025-03-14" })}</span>
        <span className="gfinding__fix">
          <Icon name="check" />
          {t("guide.issues.figure.fix", { date: "2025-03-15" })}
        </span>
      </span>
    </div>
  );
}

function ShareFigure() {
  return (
    <div className="gshare">
      <span className="gflow gflow--wide">
        <Node icon="tickets-plane" label={t("guide.sharing.figure.record")} sub={t("guide.sharing.figure.record.sub")} />
        <Arrow />
        <Node icon="link" label={t("guide.sharing.figure.link")} sub="/p/…" />
        <Arrow />
        <Node icon="globe" label={t("guide.sharing.figure.page")} sub={t("guide.sharing.figure.page.sub")} />
      </span>
      <span className="gnote">
        <span>
          <Icon name="lock" />
          {t("guide.sharing.figure.private")}
        </span>
        <span>
          <Icon name="map" />
          {t("guide.sharing.figure.preview")}
        </span>
        <span>
          <Icon name="cloud" />
          {t("guide.sharing.figure.mode")}
        </span>
      </span>
    </div>
  );
}

function ExportFigure() {
  const outs: [IconName, string, string][] = [
    ["download", t("guide.export.figure.backup"), t("guide.export.figure.backup.sub")],
    ["file", "CSV", t("guide.export.figure.csv.sub")],
    ["table", t("guide.export.figure.sheet"), t("guide.export.figure.sheet.sub")],
    ["tickets-plane", t("guide.export.figure.myfr24"), t("guide.export.figure.myfr24.sub")],
  ];
  return (
    <div className="gfan">
      <Node icon="settings" label={t("guide.export.figure.settings")} strong />
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
