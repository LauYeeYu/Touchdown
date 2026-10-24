// Findings for one record or a list of records, with their fixes and "accept" for warnings.

import type { ReactNode } from "react";
import { RULES, type Finding } from "@touchdown/core";
import { useApp } from "../data/context.tsx";
import { Icon } from "../lib/icons.tsx";
import { toast } from "./overlay.tsx";

const SEVERITY_ICON = { error: "circle-x", warning: "triangle-alert", info: "info" } as const;

export function FindingItem({ f, showRule = false, children }: { f: Finding; showRule?: boolean; children?: ReactNode }) {
  const { app } = useApp();
  return (
    <li className={`finding finding--${f.severity}`}>
      <Icon name={SEVERITY_ICON[f.severity]} />
      <div className="finding__body">
        {showRule && <span className="finding__rule">{RULES[f.ruleId]?.title ?? f.ruleId}</span>}
        <p className="finding__text">{f.message}</p>
        {children}
        {(f.fixes.length > 0 || f.severity !== "error") && (
          <div className="finding__actions">
            {f.fixes.map((fix) => (
              <button
                key={`${fix.field}:${String(fix.value)}`}
                type="button"
                className="btn btn--quiet btn--small"
                onClick={() => {
                  toast(app.applyFix(fix) ?? "Fixed. The raw value you typed is kept.");
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
                  toast("Accepted. It comes back if these values change.");
                }}
              >
                This is right
              </button>
            )}
          </div>
        )}
      </div>
    </li>
  );
}

export function FindingList({ findings, showRule = false }: { findings: Finding[]; showRule?: boolean }) {
  return (
    <ul className="findings">
      {findings.map((f) => (
        <FindingItem key={`${f.ruleId}:${f.fingerprint}`} f={f} showRule={showRule} />
      ))}
    </ul>
  );
}
