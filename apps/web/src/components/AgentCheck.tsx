// The agent check on the Import page (docs/22-agent-verification.md): save a request, run `touchdown check` on it,
// load the result; then each row shows the agent's suggestions with Use and Dismiss. Nothing changes until a
// suggestion is used, and the import is still reviewed and committed as one batch.

import { useRef, useState } from "react";
import { readCheckResult, type AgentField, type AgentRecordResult, type CheckRequest, type CheckResultFile, type RefIndex } from "@touchdown/core";
import { sentenceGap, t } from "@touchdown/i18n";
import { SOURCE_REPOSITORY } from "../config.ts";
import { Icon } from "../lib/icons.tsx";
import { download } from "../lib/download.ts";
import { toast } from "./overlay.tsx";
import { tx } from "../lib/i18n.tsx";

export type Choice = "used" | "dismissed";
export const choiceKey = (recordId: string, field: string) => `${recordId}|${field}`;

const CHECKER_NAME = { claude: "Claude Code", codex: "Codex" } as const;

/** The fields' names, read from the messages each time one is asked for. */
export const AGENT_FIELD_LABEL: Record<AgentField, string> = {
  get typeCode() {
    return t("import.agent.field.typeCode");
  },
  get model() {
    return t("import.agent.field.model");
  },
  get registration() {
    return t("import.agent.field.registration");
  },
  get operator() {
    return t("import.agent.field.operator");
  },
  get airline() {
    return t("import.agent.field.airline");
  },
  get airport() {
    return t("import.agent.field.airport");
  },
  get from() {
    return t("import.agent.field.from");
  },
  get to() {
    return t("import.agent.field.to");
  },
  get date() {
    return t("import.agent.field.date");
  },
  get flightNumber() {
    return t("import.agent.field.flightNumber");
  },
  get livery() {
    return t("import.agent.field.livery");
  },
  get specialLivery() {
    return t("import.agent.field.specialLivery");
  },
  get phase() {
    return t("import.agent.field.phase");
  },
  get notes() {
    return t("import.agent.field.notes");
  },
};

interface PanelProps {
  batchId: string;
  /** Built when the user saves it, from the rows as read (before any suggestion is used). */
  request: () => CheckRequest;
  ref: RefIndex;
  result: CheckResultFile | null;
  counts: { suggestions: number; rows: number; used: number; dismissed: number; highPending: number };
  onResult: (r: CheckResultFile | null) => void;
  onUseHigh: () => void;
  onShow: () => void;
}

export function AgentCheckPanel({ batchId, request, ref, result, counts, onResult, onUseHigh, onShow }: PanelProps) {
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const name = `touchdown-check-${batchId}`;
  // The agent, its rules and whether notes are sent are the CLI's settings on that computer (docs/22).
  const command = `./touchdown check ~/Downloads/${name}.json`;

  const load = async (file: File) => {
    setError(null);
    try {
      const r = readCheckResult(JSON.parse(await file.text()), request(), ref);
      if ("error" in r) setError(r.error);
      else {
        onResult(r.result);
        if (r.dropped) toast(t("import.agent.dropped", { count: r.dropped }));
      }
    } catch {
      setError(t("import.agent.notResult", { name: file.name }));
    }
  };

  const loader = (
    <input
      ref={fileInput}
      type="file"
      accept=".json,application/json"
      className="visually-hidden"
      onChange={(e) => {
        const f = e.target.files?.[0];
        if (f) void load(f);
        e.target.value = "";
      }}
    />
  );

  if (result) {
    const failed = result.failed.reduce((n, f) => n + f.recordIds.length, 0);
    return (
      <section className="agent-panel" aria-labelledby="agent-title">
        <h2 className="agent-panel__title" id="agent-title">
          {t("import.agent.title")}
        </h2>
        <p className="agent-panel__lead">
          {t("import.agent.result", {
            checker: CHECKER_NAME[result.checker],
            checked: result.checked,
            withModel: result.model ? "yes" : "no",
            model: result.model ?? "",
            found: counts.suggestions ? "yes" : "no",
            suggestions: counts.suggestions,
            rows: counts.rows,
            chosen: counts.used + counts.dismissed > 0 ? "yes" : "no",
            used: counts.used,
            dismissed: counts.dismissed,
          })}
        </p>
        {(result.rejected.length > 0 || failed > 0) && (
          <p className="agent-panel__note">
            {result.rejected.length > 0 && `${t("import.agent.rejected", { count: result.rejected.length })}${sentenceGap()}`}
            {failed > 0 && t("import.agent.failed", { count: failed })}
          </p>
        )}
        <div className="button-row">
          {counts.highPending > 0 && (
            <button type="button" className="btn btn--quiet btn--small" onClick={onUseHigh}>
              <Icon name="check" />
              {t("import.agent.useHigh", { count: counts.highPending })}
            </button>
          )}
          {counts.suggestions > 0 && (
            <button type="button" className="btn btn--ghost btn--small" onClick={onShow}>
              {t("import.agent.showRows")}
            </button>
          )}
          <button type="button" className="btn btn--ghost btn--small" onClick={() => fileInput.current?.click()}>
            <Icon name="upload" />
            {t("import.agent.loadAnother")}
          </button>
          <button type="button" className="btn btn--ghost btn--small" onClick={() => onResult(null)}>
            {t("import.agent.remove")}
          </button>
        </div>
        {loader}
        {error && <p className="agent-panel__error" role="alert">{error}</p>}
      </section>
    );
  }

  return (
    <section className="agent-panel" aria-labelledby="agent-title">
      <h2 className="agent-panel__title" id="agent-title">
        {t("import.agent.start.title")}
      </h2>
      <p className="agent-panel__lead">{t("import.agent.start.lead")}</p>
      <p className="agent-panel__note">
        {tx(
          "import.agent.start.setup",
          {
            clone: <code>git clone {SOURCE_REPOSITORY}</code>,
            cd: <code>cd Touchdown</code>,
            install: <code>npm install</code>,
            agent: <code>./touchdown agent</code>,
            npmRun: <code>npm run touchdown --</code>,
            launcher: <code>./touchdown</code>,
          },
          {
            link: (text) => (
              <a href={`${SOURCE_REPOSITORY}#set-up`} target="_blank" rel="noreferrer">
                {text}
              </a>
            ),
          },
        )}
      </p>
      <ol className="agent-steps">
        <li>
          <span className="agent-steps__text">{t("import.agent.start.saveStep")}</span>
          <button
            type="button"
            className="btn btn--quiet btn--small"
            onClick={() => {
              download(`${name}.json`, JSON.stringify(request(), null, 2), "application/json");
              setSaved(true);
            }}
          >
            <Icon name="download" />
            {saved ? t("import.agent.start.saveAgain") : t("import.agent.start.save")}
          </button>
        </li>
        <li>
          <span className="agent-steps__text">{t("import.agent.start.runStep")}</span>
          <span className="agent-command">
            <code>{command}</code>
            <button
              type="button"
              className="icon-btn agent-command__copy"
              aria-label={t("import.agent.start.copy")}
              title={t("import.agent.start.copy")}
              onClick={() => void navigator.clipboard?.writeText(command).then(() => toast(t("import.agent.start.copied")), () => toast(t("import.agent.start.copyFailed")))}
            >
              <Icon name="copy" />
            </button>
          </span>
        </li>
        <li>
          <span className="agent-steps__text">{t("import.agent.start.loadStep", { file: `${name}.result.json` })}</span>
          <button type="button" className="btn btn--quiet btn--small" onClick={() => fileInput.current?.click()}>
            <Icon name="upload" />
            {t("import.agent.start.load")}
          </button>
        </li>
      </ol>
      <p className="agent-panel__note">{tx("import.agent.start.sent", { notesOn: <code>./touchdown agent notes on</code>, agent: <code>./touchdown agent</code> })}</p>
      {loader}
      {error && <p className="agent-panel__error" role="alert">{error}</p>}
    </section>
  );
}

/** The agent's suggestions for one row, each with Use and Dismiss, and its note when it doubts the row without one. */
export function AgentSuggestions({ record, choices, onChoose }: { record: AgentRecordResult; choices: Map<string, Choice>; onChoose: (field: AgentField, c: Choice | null) => void }) {
  return (
    <ul className="suggestions" aria-label={t("import.agent.suggestions")}>
      {record.suggestions.map((s) => {
        const c = choices.get(choiceKey(record.recordId, s.field)) ?? null;
        return (
          <li key={s.field} className={`suggestion${c ? ` is-${c}` : ""}`}>
            <div className="suggestion__main">
              <p className="suggestion__change">
                <span className="suggestion__field">{AGENT_FIELD_LABEL[s.field]}</span> <span className="suggestion__old">{s.current || t("import.empty")}</span> <Icon name="arrow-right" className="icon suggestion__arrow" /> <b>{s.suggested || t("import.agent.clear")}</b>
              </p>
              <p className="suggestion__reason">
                {s.reason} <span className="suggestion__meta">{t("import.agent.meta", { confidence: s.confidence, basis: s.basis })}</span>
              </p>
            </div>
            <div className="suggestion__actions">
              {c === "used" ? (
                <>
                  <span className="suggestion__state">
                    <Icon name="check" />
                    {t("import.agent.used")}
                  </span>
                  <button type="button" className="btn btn--ghost btn--small" onClick={() => onChoose(s.field, null)}>
                    {t("common.undo")}
                  </button>
                </>
              ) : c === "dismissed" ? (
                <>
                  <span className="suggestion__state">{t("import.agent.dismissed")}</span>
                  <button type="button" className="btn btn--ghost btn--small" onClick={() => onChoose(s.field, null)}>
                    {t("common.undo")}
                  </button>
                </>
              ) : (
                <>
                  <button type="button" className="btn btn--quiet btn--small" onClick={() => onChoose(s.field, "used")}>
                    {t("import.agent.use")}
                  </button>
                  <button type="button" className="btn btn--ghost btn--small" onClick={() => onChoose(s.field, "dismissed")}>
                    {t("import.agent.dismiss")}
                  </button>
                </>
              )}
            </div>
          </li>
        );
      })}
      {record.note && !record.suggestions.length && (
        <li className="suggestion suggestion--note">
          <div className="suggestion__main">
            <p className="suggestion__reason">
              <span className="suggestion__field">{t("import.agent.agent")}</span> {record.note}
            </p>
          </div>
        </li>
      )}
    </ul>
  );
}
