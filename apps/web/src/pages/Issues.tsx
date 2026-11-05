// Issues (docs/31-ui.md): fields changed on two devices, to choose which to keep (docs/12), then every open finding,
// grouped by rule, with the records involved, the suggested fix, and "this is right" for warnings. Accepted warnings
// are listed separately so they can be reopened.

import { useMemo } from "react";
import { Link } from "@tanstack/react-router";
import { list, t } from "@touchdown/i18n";
import { flightDay, PRIVATE_FIELDS, RULES, type Finding, type RecordRef, type Row, type TableName } from "@touchdown/core";
import { useApp } from "../data/context.tsx";
import type { AppData } from "../data/app.ts";
import { dayMonthYear, FIELD_LABEL, momentLabel } from "../lib/format.ts";
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
        {d ? t("issues.record.dated", { name: f.flightNumber ?? t("issues.record.flight"), date: dayMonthYear(d) }) : (f.flightNumber ?? t("issues.record.flight"))}
      </Link>
    );
  }
  if (r.table === "sightings") {
    const s = app.store.get("sightings", r.id);
    if (!s) return null;
    return (
      <Link to="/spotting/$id/edit" params={{ id: r.id }}>
        {s.seenOn ? t("issues.record.dated", { name: s.registration ?? t("issues.record.sighting"), date: dayMonthYear(s.seenOn) }) : (s.registration ?? t("issues.record.sighting"))}
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
  const c = conflicts ? t("issues.lead.conflicts", { count: conflicts }) : "";
  const e = errors ? t("issues.lead.errors", { count: errors }) : "";
  const w = warnings ? t("issues.lead.warnings", { count: warnings }) : "";
  const text = list([c, e, w].filter(Boolean));
  return t("issues.lead.summary", { clauses: text.charAt(0).toUpperCase() + text.slice(1) });
}

const PRIVATE = new Set(PRIVATE_FIELDS.map((f) => f.split(".")[1]!));

/** A value from a sync conflict (JSON text), as the page shows it. */
function conflictValue(field: string, json: string | null): string {
  if (PRIVATE.has(field)) return t("issues.value.private");
  const v = json === null ? null : (JSON.parse(json) as unknown);
  if (v === null || v === "") return "—";
  if (typeof v === "boolean") return v ? t("issues.value.yes") : t("issues.value.no");
  return String(v);
}

/** Where a change was made: this browser, the command line, or another device. */
function deviceOf(by: string | null, app: AppData): "this" | "cli" | "other" {
  if (by === app.store.deviceId) return "this";
  if (by?.startsWith("cli_")) return "cli";
  return "other";
}

const madeOn = (by: string | null, at: string | null, app: AppData) => t("issues.device.made", { device: deviceOf(by, app), dated: at ? "yes" : "no", moment: at ? momentLabel(Date.parse(at)) : "" });

/** The record a sync conflict is about. */
function ConflictRecord({ c, app }: { c: Row<"sync_conflicts">; app: AppData }) {
  const table = c.tableName as TableName;
  if (table === "flights" || table === "sightings") return <RecordLink r={{ table, id: c.recordId }} app={app} />;
  if (table === "airframes") {
    const v = aircraftViews(app.store).find((x) => x.airframe.id === c.recordId);
    return v ? (
      <Link to="/aircraft/$id" params={{ id: c.recordId }}>
        {v.registration ?? t("issues.record.aircraft")}
      </Link>
    ) : null;
  }
  if (table === "settings") return <Link to="/settings">{t("issues.record.settings")}</Link>;
  if (table === "saved_views") return <>{t("issues.record.savedView", { name: app.store.get("saved_views", c.recordId)?.name ?? "" })}</>;
  if (table === "operator_overrides") return <>{t("issues.record.operator", { name: app.store.get("operator_overrides", c.recordId)?.name ?? "" })}</>;
  if (table === "family_overrides") {
    const designator = app.store.get("family_overrides", c.recordId)?.designator;
    return <>{t("issues.record.family", { known: designator ? "yes" : "no", designator: designator ?? "" })}</>;
  }
  if (table === "issue_acks") return <>{t("issues.record.ack")}</>;
  return <>{table.replace(/_/g, " ")}</>;
}

function ConflictItem({ c, app }: { c: Row<"sync_conflicts">; app: AppData }) {
  const row = app.store.peek(c.tableName as TableName, c.recordId) as Record<string, unknown> | null;
  const deleted = c.field === "deleted";
  const label = deleted ? t("issues.conflict.deletedLabel") : (FIELD_LABEL[c.field] ?? c.field);
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
          <p className="finding__text">{t("issues.conflict.deleted", { deletedOn: madeOn(c.otherBy, c.otherAt, app), changedOn: madeOn(c.keptBy, c.keptAt, app) })}</p>
        ) : (
          <dl className="conflict">
            <dt>{t("issues.conflict.inLog")}</dt>
            <dd>
              {conflictValue(c.field, now)}
              <span className="conflict__when"> · {now === c.keptValue ? madeOn(c.keptBy, c.keptAt, app) : t("issues.conflict.changedSince")}</span>
            </dd>
            <dt>{t("issues.conflict.other")}</dt>
            <dd>
              {conflictValue(c.field, c.otherValue)}
              <span className="conflict__when"> · {madeOn(c.otherBy, c.otherAt, app)}</span>
            </dd>
          </dl>
        )}
        <div className="finding__actions">
          <button type="button" className="btn btn--small btn--quiet" aria-label={deleted ? undefined : t("issues.conflict.keepLabel", { field: label.toLowerCase() })} onClick={() => app.resolveConflict(c.id, "kept")}>
            {deleted ? t("issues.conflict.keepEntry") : t("issues.conflict.keep")}
          </button>
          <button type="button" className="btn btn--small btn--ghost" aria-label={deleted ? undefined : t("issues.conflict.useOtherLabel", { field: label.toLowerCase() })} onClick={() => app.resolveConflict(c.id, "other")}>
            {deleted ? t("issues.conflict.deleteIt") : t("issues.conflict.useOther")}
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
          ? t("issues.lead.none")
          : sentence(conflicts.length, count("error"), count("warning"))}
      </h1>
      <p className="form-sub">{t("issues.lead.sub")}</p>
      <Tabs
        label={t("issues.title")}
        value={tab}
        onChange={setTab}
        items={[
          ["open", t("issues.tabs.open", { count: open.length + conflicts.length })],
          ["accepted", t("issues.tabs.accepted", { count: accepted.length })],
        ]}
      />
      {tab === "open" && (
        <>
          {conflicts.length > 0 && (
            <section className="section issue-group issue-group--conflicts">
              <div className="section__head">
                <h2 className="section__title">{t("issues.conflicts.title")}</h2>
                <span className="section__aside">{t("common.count.fields", { count: conflicts.length })}</span>
              </div>
              <p className="form-sub">{t("issues.conflicts.sub")}</p>
              <ul className="findings">
                {conflicts.map((c) => (
                  <ConflictItem key={c.id} c={c} app={app} />
                ))}
              </ul>
            </section>
          )}
          <div className="chips" role="group" aria-label={t("issues.severity.label")}>
            {(
              [
                ["error", t("issues.severity.error", { count: count("error") })],
                ["warning", t("issues.severity.warning", { count: count("warning") })],
                ["info", t("issues.severity.info", { count: count("info") })],
              ] as [Sev, string][]
            ).map(([s, l]) => (
              <button key={s} type="button" className="chip" aria-pressed={sev.has(s)} onClick={() => toggle(s)}>
                {l}
              </button>
            ))}
          </div>
          {!ordered.length && <p className="section__aside">{t("issues.empty")}</p>}
          {ordered.map(([rule, list]) => (
            <section className="section issue-group" key={rule}>
              <div className="section__head">
                <h2 className="section__title">{RULES[rule]?.title ?? rule}</h2>
                <span className="section__aside">
                  {t("common.count.findings", { count: list.length })} · {rule}
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
              {list.length > 50 && <p className="section__aside">{t("issues.more", { count: list.length - 50 })}</p>}
            </section>
          ))}
        </>
      )}
      {tab === "accepted" && (
        <ul className="findings">
          {!accepted.length && <p className="section__aside">{t("issues.accepted.none")}</p>}
          {accepted.map(({ finding, ackId }) => (
            <li key={ackId} className={`finding finding--${finding.severity}`}>
              <Icon name="circle-check" />
              <div className="finding__body">
                <span className="finding__rule">{RULES[finding.ruleId]?.title ?? finding.ruleId}</span>
                <p className="finding__text">{finding.message}</p>
                <div className="finding__actions">
                  <button type="button" className="btn btn--small btn--ghost" onClick={() => app.reopenFinding(ackId)}>
                    {t("issues.accepted.reopen")}
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
