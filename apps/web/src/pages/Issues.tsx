// Issues (docs/31-ui.md): fields changed on two devices, to choose which to keep (docs/12), then every open finding,
// grouped by rule, with the records involved, the suggested fix, and "this is right" for warnings. Accepted warnings
// are listed separately so they can be reopened.

import { useMemo } from "react";
import { Link } from "@tanstack/react-router";
import { flightDay, PRIVATE_FIELDS, RULES, type Finding, type RecordRef, type Row, type TableName } from "@touchdown/core";
import { useApp } from "../data/context.tsx";
import type { AppData } from "../data/app.ts";
import { dayMonthYear, FIELD_LABEL, momentLabel, plural } from "../lib/format.ts";
import { Icon } from "../lib/icons.tsx";
import { FindingItem } from "../components/Findings.tsx";
import { Tabs } from "../components/Tabs.tsx";
import { useViewState } from "../lib/viewState.ts";
import { orderIssues } from "../lib/issueOrder.ts";
import { aircraftViews } from "../lib/views.ts";

type Sev = "error" | "warning" | "info";

function RecordLink({ r, app }: { r: RecordRef; app: AppData }) {
  if (r.table === "flights") {
    const f = app.store.get("flights", r.id);
    if (!f) return null;
    const d = flightDay(f);
    return (
      <Link to="/flights/$id" params={{ id: r.id }}>
        {f.flightNumber ?? "Flight"}
        {d ? `, ${dayMonthYear(d)}` : ""}
      </Link>
    );
  }
  if (r.table === "sightings") {
    const s = app.store.get("sightings", r.id);
    if (!s) return null;
    return (
      <Link to="/spotting/$id/edit" params={{ id: r.id }}>
        {s.registration ?? "Sighting"}
        {s.seenOn ? `, ${dayMonthYear(s.seenOn)}` : ""}
      </Link>
    );
  }
  return null;
}

/** A finding's date, for its place in its group: its first record's day. */
function findingDate(f: Finding, app: AppData): string {
  const r = f.records[0];
  if (r?.table === "flights") {
    const flight = app.store.get("flights", r.id);
    return (flight && (flightDay(flight) ?? flight.scheduledDate)) ?? "";
  }
  if (r?.table === "sightings") return app.store.get("sightings", r.id)?.seenOn ?? "";
  return "";
}

function sentence(conflicts: number, errors: number, warnings: number): string {
  const c = conflicts ? `${plural(conflicts, "field was", "fields were")} changed on two devices` : "";
  const e = errors ? `${plural(errors, "entry", "entries")} ${errors === 1 ? "looks" : "look"} wrong` : "";
  const w = warnings ? `${plural(warnings, "entry", "entries")} ${warnings === 1 ? "is" : "are"} worth a look` : "";
  const parts = [c, e, w].filter(Boolean);
  const text = parts.length > 2 ? `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}` : parts.join(" and ");
  return text.charAt(0).toUpperCase() + text.slice(1) + ".";
}

const PRIVATE = new Set(PRIVATE_FIELDS.map((f) => f.split(".")[1]!));

/** A value from a sync conflict (JSON text), as the page shows it. */
function conflictValue(field: string, json: string | null): string {
  if (PRIVATE.has(field)) return "(private)";
  const v = json === null ? null : (JSON.parse(json) as unknown);
  if (v === null || v === "") return "—";
  if (typeof v === "boolean") return v ? "Yes" : "No";
  return String(v);
}

/** Where a change was made: this browser, the command line, or another device. */
function deviceName(by: string | null, app: AppData): string {
  if (by === app.store.deviceId) return "this device";
  if (by?.startsWith("cli_")) return "the command line";
  return "another device";
}

const madeOn = (by: string | null, at: string | null, app: AppData) => `${deviceName(by, app)}${at ? `, ${momentLabel(Date.parse(at))}` : ""}`;

/** The record a sync conflict is about. */
function ConflictRecord({ c, app }: { c: Row<"sync_conflicts">; app: AppData }) {
  const table = c.tableName as TableName;
  if (table === "flights" || table === "sightings") return <RecordLink r={{ table, id: c.recordId }} app={app} />;
  if (table === "airframes") {
    const v = aircraftViews(app.store).find((x) => x.airframe.id === c.recordId);
    return v ? (
      <Link to="/aircraft/$id" params={{ id: c.recordId }}>
        {v.registration ?? "Aircraft"}
      </Link>
    ) : null;
  }
  if (table === "settings") return <Link to="/settings">Settings</Link>;
  if (table === "saved_views") return <>Saved view “{app.store.get("saved_views", c.recordId)?.name ?? ""}”</>;
  if (table === "operator_overrides") return <>Your operator “{app.store.get("operator_overrides", c.recordId)?.name ?? ""}”</>;
  if (table === "family_overrides") return <>Family of {app.store.get("family_overrides", c.recordId)?.designator ?? "a type"}</>;
  if (table === "issue_acks") return <>An accepted warning</>;
  return <>{table.replace(/_/g, " ")}</>;
}

function ConflictItem({ c, app }: { c: Row<"sync_conflicts">; app: AppData }) {
  const row = app.store.peek(c.tableName as TableName, c.recordId) as Record<string, unknown> | null;
  const deleted = c.field === "deleted";
  const label = deleted ? "Deleted and changed" : (FIELD_LABEL[c.field] ?? c.field);
  const now = JSON.stringify(row?.[c.field] ?? null);
  return (
    <li className="finding finding--warning">
      <Icon name="merge" />
      <div className="finding__body">
        <span className="finding__rule">{label}</span>
        <p className="issue__records">
          <ConflictRecord c={c} app={app} />
        </p>
        {deleted ? (
          <p className="finding__text">
            Deleted on {madeOn(c.otherBy, c.otherAt, app)}, and changed on {madeOn(c.keptBy, c.keptAt, app)}, before either saw the other. The entry was kept with the changes.
          </p>
        ) : (
          <dl className="conflict">
            <dt>In your log</dt>
            <dd>
              {conflictValue(c.field, now)}
              <span className="conflict__when"> · {now === c.keptValue ? madeOn(c.keptBy, c.keptAt, app) : "changed since"}</span>
            </dd>
            <dt>The other change</dt>
            <dd>
              {conflictValue(c.field, c.otherValue)}
              <span className="conflict__when"> · {madeOn(c.otherBy, c.otherAt, app)}</span>
            </dd>
          </dl>
        )}
        <div className="finding__actions">
          <button type="button" className="btn btn--small btn--quiet" aria-label={deleted ? undefined : `Keep the ${label.toLowerCase()} in your log`} onClick={() => app.resolveConflict(c.id, "kept")}>
            {deleted ? "Keep the entry" : "Keep it"}
          </button>
          <button type="button" className="btn btn--small btn--ghost" aria-label={deleted ? undefined : `Use the other ${label.toLowerCase()}`} onClick={() => app.resolveConflict(c.id, "other")}>
            {deleted ? "Delete it" : "Use the other"}
          </button>
        </div>
      </div>
    </li>
  );
}

export function Issues() {
  const { app, version } = useApp();
  // Kept for Back (lib/viewState.ts).
  const [tab, setTab] = useViewState<"open" | "accepted">("tab", "open");
  const [sevList, setSev] = useViewState<Sev[]>("severities", ["error", "warning"]);
  const sev = new Set(sevList);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const open = useMemo(() => app.findings(), [app, version]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const accepted = useMemo(() => app.acceptedFindings(), [app, version]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const conflicts = useMemo(() => app.conflicts(), [app, version]);
  const count = (s: Sev) => open.filter((f) => f.severity === s).length;
  // A fixed order, so accepting or fixing a finding brings the next one into its place (lib/issueOrder.ts).
  const ordered = orderIssues(
    open.filter((f) => sev.has(f.severity)),
    (f) => findingDate(f, app),
  );
  const toggle = (s: Sev) => setSev((cur) => (cur.includes(s) ? cur.filter((x) => x !== s) : [...cur, s]));

  return (
    <div className="page">
      <div className="view-top" />
      <h1 className="lead">
        {conflicts.length + count("error") + count("warning") === 0
          ? "Nothing to review. Every check passed or was accepted."
          : sentence(conflicts.length, count("error"), count("warning"))}
      </h1>
      <p className="form-sub">Checks never block saving. Fix a mistake, or mark a warning as right. It comes back only if the values change.</p>
      <Tabs
        label="Issues"
        value={tab}
        onChange={setTab}
        items={[
          ["open", `Open (${open.length + conflicts.length})`],
          ["accepted", `Accepted (${accepted.length})`],
        ]}
      />
      {tab === "open" && (
        <>
          {conflicts.length > 0 && (
            <section className="section issue-group issue-group--conflicts">
              <div className="section__head">
                <h2 className="section__title">Changed on two devices</h2>
                <span className="section__aside">{plural(conflicts.length, "field")}</span>
              </div>
              <p className="form-sub">Each was changed on two devices before either saw the other's change. Your log has the later one. Choose which to keep.</p>
              <ul className="findings">
                {conflicts.map((c) => (
                  <ConflictItem key={c.id} c={c} app={app} />
                ))}
              </ul>
            </section>
          )}
          <div className="chips" role="group" aria-label="Severity">
            {(
              [
                ["error", "Errors"],
                ["warning", "Warnings"],
                ["info", "Notes"],
              ] as [Sev, string][]
            ).map(([s, l]) => (
              <button key={s} type="button" className="chip" aria-pressed={sev.has(s)} onClick={() => toggle(s)}>
                {l} ({count(s)})
              </button>
            ))}
          </div>
          {!ordered.length && <p className="section__aside">Nothing here.</p>}
          {ordered.map(([rule, list]) => (
            <section className="section issue-group" key={rule}>
              <div className="section__head">
                <h2 className="section__title">{RULES[rule]?.title ?? rule}</h2>
                <span className="section__aside">
                  {plural(list.length, "finding")} · {rule}
                </span>
              </div>
              <ul className="findings">
                {list.slice(0, 50).map((f) => (
                  <FindingItem key={f.fingerprint} f={f}>
                    <p className="issue__records">
                      {f.records.map((r, i) => (
                        <span key={`${r.table}:${r.id}`}>
                          {i > 0 && " · "}
                          <RecordLink r={r} app={app} />
                        </span>
                      ))}
                    </p>
                  </FindingItem>
                ))}
              </ul>
              {list.length > 50 && <p className="section__aside">And {list.length - 50} more of this kind.</p>}
            </section>
          ))}
        </>
      )}
      {tab === "accepted" && (
        <ul className="findings">
          {!accepted.length && <p className="section__aside">No accepted warnings.</p>}
          {accepted.map(({ finding, ackId }) => (
            <li key={ackId} className={`finding finding--${finding.severity}`}>
              <Icon name="circle-check" />
              <div className="finding__body">
                <span className="finding__rule">{RULES[finding.ruleId]?.title ?? finding.ruleId}</span>
                <p className="finding__text">{finding.message}</p>
                <div className="finding__actions">
                  <button type="button" className="btn btn--small btn--ghost" onClick={() => app.reopenFinding(ackId)}>
                    Reopen
                  </button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
