// Issues (docs/31-ui.md): every open finding, grouped by rule, with the records involved, the suggested fix,
// and "this is right" for warnings. Accepted warnings are listed separately so they can be reopened.

import { useMemo } from "react";
import { Link } from "@tanstack/react-router";
import { flightDay, RULES, type Finding, type RecordRef } from "@touchdown/core";
import { useApp } from "../data/context.tsx";
import type { AppData } from "../data/app.ts";
import { dayMonthYear, plural } from "../lib/format.ts";
import { Icon } from "../lib/icons.tsx";
import { FindingItem } from "../components/Findings.tsx";
import { Tabs } from "../components/Tabs.tsx";
import { useViewState } from "../lib/viewState.ts";
import { orderIssues } from "../lib/issueOrder.ts";

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

function sentence(errors: number, warnings: number): string {
  const e = errors ? `${plural(errors, "entry", "entries")} ${errors === 1 ? "looks" : "look"} wrong` : "";
  const w = warnings ? `${plural(warnings, "entry", "entries")} ${warnings === 1 ? "is" : "are"} worth a look` : "";
  const text = [e, w].filter(Boolean).join(" and ");
  return text.charAt(0).toUpperCase() + text.slice(1) + ".";
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
        {count("error") + count("warning") === 0
          ? "Nothing to review. Every check passed or was accepted."
          : sentence(count("error"), count("warning"))}
      </h1>
      <p className="form-sub">Checks never block saving. Fix what is wrong, or mark a warning as right; it comes back only if the values change.</p>
      <Tabs
        label="Issues"
        value={tab}
        onChange={setTab}
        items={[
          ["open", `Open (${open.length})`],
          ["accepted", `Accepted (${accepted.length})`],
        ]}
      />
      {tab === "open" && (
        <>
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
