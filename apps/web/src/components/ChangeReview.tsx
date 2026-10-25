// The review of a change file (docs/34, "The review"): changes made on the command line to records in the log,
// each with what it would do, before and after. The user takes or leaves each one; a change to a record edited since
// is left unless the user takes it. Import applies the changes taken as one import, which can be undone.

import { useMemo, useState } from "react";
import type { ChangeStatus, InboxChange } from "@touchdown/core";
import { planChanges, takeByDefault, type PlannedChange, type PlannedLine } from "@touchdown/core/view";
import { useApp } from "../data/context.tsx";
import { codeStyle } from "../lib/codes.ts";
import { plural } from "../lib/format.ts";
import { Icon } from "../lib/icons.tsx";
import { FindingList } from "./Findings.tsx";

/** Edits show every field as before → after; the others name what they do. */
const AS_EDIT = new Set<InboxChange["op"]>(["edit", "airframe", "family", "settings"]);

function Line({ p, l }: { p: PlannedChange; l: PlannedLine }) {
  if (AS_EDIT.has(p.change.op) || (l.before && l.after)) {
    return (
      <li className="suggestion__change">
        <span className="suggestion__field">{l.label}</span> <span className="suggestion__old">{l.before || "empty"}</span> <Icon name="arrow-right" className="icon suggestion__arrow" /> <b>{l.after || "empty"}</b>
      </li>
    );
  }
  return (
    <li className="suggestion__change">
      <span className="suggestion__field">{l.label}</span> {l.after ? <b>{l.after}</b> : <span className="suggestion__old">{l.before}</span>}
    </li>
  );
}

export interface ChangeReviewProps {
  fileName: string;
  /** What the file is, for the heading: "Changes from the command line, 24 Oct 2026 at 15:30". */
  label: string;
  /** The command that made it: "./touchdown edit". */
  madeBy: string | null;
  changes: InboxChange[];
  /** From the inbox: it can be discarded there. */
  fromInbox: boolean;
  onBack: () => void;
  onImported: (applied: number, batchId: string, messages: string[]) => void;
  onDiscard: () => void;
}

export function ChangeReview({ fileName, label, madeBy, changes, fromInbox, onBack, onImported, onDiscard }: ChangeReviewProps) {
  const { app, version } = useApp();
  // What the user chose, by change; the rest follow takeByDefault.
  const [chosen, setChosen] = useState<Map<number, boolean>>(new Map());
  const take = (i: number, status: ChangeStatus) => chosen.get(i) ?? takeByDefault(i, status);
  const settings = app.settings();
  const plan = useMemo(
    () => planChanges(app.store, app.ref, changes, { codes: codeStyle(), unit: settings.distanceUnit, models: settings.modelNaming, showPrivate: true, take }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [app, version, changes, chosen],
  );
  const usable = (p: PlannedChange) => p.status === "pending" || p.status === "changed";
  const taken = plan.changes.filter((p) => usable(p) && take(p.index, p.status));
  const changedSince = plan.changes.filter((p) => p.status === "changed").length;
  const nothing = plan.changes.length - plan.open;

  const commit = () => {
    const r = app.applyChanges(changes, take, fileName);
    onImported(r.applied, r.batchId, r.messages);
  };

  return (
    <div className="page page--wide">
      <nav className="crumbs" aria-label="Back">
        <button type="button" className="link-btn" onClick={onBack}>
          <Icon name="arrow-left" /> Choose another file
        </button>
      </nav>
      <h1 className="form-title">Review {label.charAt(0).toLowerCase() + label.slice(1)}</h1>
      <p className="lead lead--flight">
        {plural(plan.changes.length, "change")} to records in your log{madeBy ? `, made with ${madeBy}` : ""}
        {plan.open < plan.changes.length ? `: ${plan.open} still to make, ${nothing} with nothing left to do` : ""}.
        {changedSince > 0 && ` ${plural(changedSince, "record was", "records were")} changed after the change was made: ${changedSince === 1 ? "it is" : "they are"} left as ${changedSince === 1 ? "it is" : "they are"} unless you tick ${changedSince === 1 ? "it" : "them"}.`}
      </p>
      <ul className="changes">
        {plan.changes.map((p) => {
          const on = usable(p) && take(p.index, p.status);
          return (
            <li key={p.index} className={`change${on ? "" : " is-off"}`}>
              <label className="change__head">
                <input type="checkbox" checked={on} disabled={!usable(p)} onChange={(e) => setChosen((prev) => new Map(prev).set(p.index, e.target.checked))} />
                <span className="change__action">{p.action}</span>
                <span className="change__title">{p.title}</span>
              </label>
              {p.note && (
                <p className="change__note">
                  <Icon name={p.status === "changed" ? "triangle-alert" : "info"} />
                  <span>
                    {p.note}
                    {p.status === "changed" && " Tick it to make the change anyway; what was changed since is kept where the change does not touch it."}
                  </span>
                </p>
              )}
              {p.lines.length > 0 && (
                <ul className="change__lines">
                  {p.lines.map((l) => (
                    <Line key={l.field} p={p} l={l} />
                  ))}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
      {plan.findings.length > 0 && (
        <section className="section">
          <div className="section__head">
            <h2 className="section__title">What the checks will say</h2>
            <span className="section__aside">{plural(plan.findings.length, "finding")} these changes bring</span>
          </div>
          <FindingList findings={plan.findings} showRule readOnly />
        </section>
      )}
      <div className="commit-bar">
        <p>
          {plural(taken.length, "change")} will be made{taken.length < plan.open ? `, ${plan.open - taken.length} left out` : ""}. Nothing changes until you import; the import can be undone in the history.
        </p>
        <div className="commit-bar__actions">
          {fromInbox && (
            <button type="button" className="btn btn--ghost" onClick={onDiscard}>
              Discard this file
            </button>
          )}
          <button type="button" className="btn btn--primary" onClick={commit} disabled={!taken.length}>
            <Icon name="check" />
            Import {plural(taken.length, "change")}
          </button>
        </div>
      </div>
    </div>
  );
}
