// Findings for one record or a list of records, with their fixes and "accept" for warnings.

import { useState, type ReactNode } from "react";
import { RULES, type Finding } from "@touchdown/core";
import { t } from "@touchdown/i18n";
import type { AppData } from "../data/app.ts";
import { useApp } from "../data/context.tsx";
import { Icon } from "../lib/icons.tsx";
import { AirportDialog } from "./AirportDialog.tsx";
import { toast } from "./overlay.tsx";

const SEVERITY_ICON = { error: "circle-x", warning: "triangle-alert", info: "info" } as const;

/** An airport code no table has, to add as the user's own: what the finding's record has in the field. */
function airportToAdd(f: Finding, app: AppData): string | null {
  if (f.ruleId !== "V-AIRPORT-KNOWN" || f.fixes.length || !app.airfieldsLoaded) return null;
  const r = f.records[0];
  const field = f.fields[0];
  if (r?.table === "sightings") return app.store.get("sightings", r.id)?.airportRaw ?? null;
  if (r?.table !== "flights") return null;
  const flight = app.store.get("flights", r.id);
  return (field === "toAirportId" ? flight?.toRaw : flight?.fromRaw) ?? null;
}

export function FindingItem({ f, showRule = false, readOnly = false, children }: { f: Finding; showRule?: boolean; readOnly?: boolean; children?: ReactNode }) {
  const { app } = useApp();
  const [adding, setAdding] = useState(false);
  const toAdd = readOnly ? null : airportToAdd(f, app);
  return (
    <li className={`finding finding--${f.severity}`}>
      <Icon name={SEVERITY_ICON[f.severity]} />
      <div className="finding__body">
        {showRule && <span className="finding__rule">{RULES[f.ruleId]?.title ?? f.ruleId}</span>}
        <p className="finding__text">{f.message}</p>
        {children}
        {!readOnly && (f.fixes.length > 0 || f.severity !== "error" || toAdd) && (
          <div className="finding__actions">
            {toAdd && (
              <button type="button" className="btn btn--quiet btn--small" onClick={() => setAdding(true)}>
                <Icon name="plus" />
                {t("issues.finding.addAirport", { code: toAdd })}
              </button>
            )}
            {f.fixes.map((fix) => (
              <button
                key={`${fix.field}:${String(fix.value)}`}
                type="button"
                className="btn btn--quiet btn--small"
                onClick={() => {
                  toast(app.applyFix(fix) ?? t("issues.finding.fixed"));
                }}
              >
                <Icon name="check" />
                {fix.label}
              </button>
            ))}
            {f.severity !== "error" && (
              <button
                type="button"
                className="btn btn--quiet btn--small"
                onClick={() => {
                  app.acceptFinding(f);
                  toast(t("issues.finding.accepted"));
                }}
              >
                {t("issues.finding.right")}
              </button>
            )}
          </div>
        )}
        {adding && toAdd && <AirportDialog raw={toAdd} onClose={() => setAdding(false)} />}
      </div>
    </li>
  );
}

/** `readOnly`: findings not in the log yet (a review), shown without their fixes and "This is right". */
export function FindingList({ findings, showRule = false, readOnly = false }: { findings: Finding[]; showRule?: boolean; readOnly?: boolean }) {
  return (
    <ul className="findings">
      {findings.map((f) => (
        <FindingItem key={`${f.ruleId}:${f.fingerprint}`} f={f} showRule={showRule} readOnly={readOnly} />
      ))}
    </ul>
  );
}
