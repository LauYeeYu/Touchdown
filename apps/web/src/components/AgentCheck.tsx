// The agent check on the Import page (docs/22-agent-verification.md): save a request, run `touchdown check` on it,
// load the result; then each row shows the agent's suggestions with Use and Dismiss. Nothing changes until a
// suggestion is used, and the import is still reviewed and committed as one batch.

import { useRef, useState } from "react";
import { readCheckResult, type AgentField, type AgentRecordResult, type AgentSuggestion, type CheckRequest, type CheckResultFile, type RefIndex } from "@touchdown/core";
import { SOURCE_REPOSITORY } from "../config.ts";
import { Icon } from "../lib/icons.tsx";
import { plural } from "../lib/format.ts";
import { download } from "../lib/download.ts";
import { toast } from "./overlay.tsx";

export type Choice = "used" | "dismissed";
export const choiceKey = (recordId: string, field: string) => `${recordId}|${field}`;

const CHECKER_NAME = { claude: "Claude Code", codex: "Codex" } as const;

export const AGENT_FIELD_LABEL: Record<AgentField, string> = {
  typeCode: "Type code",
  model: "Model",
  registration: "Registration",
  operator: "Operator",
  airline: "Airline",
  airport: "Airport",
  from: "From",
  to: "To",
  date: "Date",
  flightNumber: "Flight number",
  livery: "Livery",
  specialLivery: "Special livery",
  phase: "Phase",
  notes: "Notes",
};

const BASIS: Record<AgentSuggestion["basis"], string> = {
  reference_data: "from the reference data",
  consistency: "from your other rows",
  model_knowledge: "from what the agent knows",
  lookup_data: "from a lookup",
  typed: "from what you typed",
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
        if (r.dropped) toast(`${plural(r.dropped, "suggestion")} did not pass Touchdown's checks and ${r.dropped === 1 ? "was" : "were"} left out.`);
      }
    } catch {
      setError(`${file.name} is not a check result.`);
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
          Agent check
        </h2>
        <p className="agent-panel__lead">
          {CHECKER_NAME[result.checker]} checked {plural(result.checked, "row")}
          {result.model ? ` (${result.model})` : ""}:{" "}
          {counts.suggestions ? (
            <>
              {plural(counts.suggestions, "suggestion")} on {plural(counts.rows, "row")}.
              {counts.used + counts.dismissed > 0 && ` ${counts.used} used, ${counts.dismissed} dismissed.`}
            </>
          ) : (
            "nothing to change."
          )}
        </p>
        {(result.rejected.length > 0 || failed > 0) && (
          <p className="agent-panel__note">
            {result.rejected.length > 0 && `${plural(result.rejected.length, "answer")} did not pass Touchdown's checks and ${result.rejected.length === 1 ? "is" : "are"} not shown. `}
            {failed > 0 && `${plural(failed, "row")} got no answer. Run the check again to cover them.`}
          </p>
        )}
        <div className="button-row">
          {counts.highPending > 0 && (
            <button type="button" className="btn btn--quiet btn--small" onClick={onUseHigh}>
              <Icon name="check" />
              Use the {plural(counts.highPending, "high-confidence suggestion")}
            </button>
          )}
          {counts.suggestions > 0 && (
            <button type="button" className="btn btn--ghost btn--small" onClick={onShow}>
              Show those rows
            </button>
          )}
          <button type="button" className="btn btn--ghost btn--small" onClick={() => fileInput.current?.click()}>
            <Icon name="upload" />
            Load another result
          </button>
          <button type="button" className="btn btn--ghost btn--small" onClick={() => onResult(null)}>
            Remove the check
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
        Check with an agent
      </h2>
      <p className="agent-panel__lead">The Touchdown command runs Claude Code or Codex on your computer. It looks for values that are well-formed but wrong, such as a type that does not fit the model or a livery spelled two ways, and suggests corrections. Nothing changes until you use one.</p>
      <p className="agent-panel__note">
        The command runs in the Touchdown directory: a copy of Touchdown's code on your computer. To set it up once, with Node.js 22 or later, run <code>git clone {SOURCE_REPOSITORY}</code>, then <code>cd Touchdown</code> and <code>npm install</code>. Sign in to Claude Code or Codex, and choose it with <code>./touchdown agent</code>. On Windows, type <code>npm run touchdown --</code> instead of <code>./touchdown</code>.{" "}
        <a href={`${SOURCE_REPOSITORY}#set-up`} target="_blank" rel="noreferrer">
          Setting up, in the README
        </a>
        .
      </p>
      <ol className="agent-steps">
        <li>
          <span className="agent-steps__text">Save the request.</span>
          <button
            type="button"
            className="btn btn--quiet btn--small"
            onClick={() => {
              download(`${name}.json`, JSON.stringify(request(), null, 2), "application/json");
              setSaved(true);
            }}
          >
            <Icon name="download" />
            {saved ? "Save it again" : "Save the request"}
          </button>
        </li>
        <li>
          <span className="agent-steps__text">In a terminal, in the Touchdown directory, run:</span>
          <span className="agent-command">
            <code>{command}</code>
            <button
              type="button"
              className="icon-btn agent-command__copy"
              aria-label="Copy the command"
              title="Copy the command"
              onClick={() => void navigator.clipboard?.writeText(command).then(() => toast("Command copied."), () => toast("Could not copy. Select the command instead."))}
            >
              <Icon name="copy" />
            </button>
          </span>
        </li>
        <li>
          <span className="agent-steps__text">Load the result it writes next to the request ({name}.result.json).</span>
          <button type="button" className="btn btn--quiet btn--small" onClick={() => fileInput.current?.click()}>
            <Icon name="upload" />
            Load the result
          </button>
        </li>
      </ol>
      <p className="agent-panel__note">
        Sent to the agent: dates, airports, flight numbers, registrations, types, models, operators, liveries and phases. Notes are sent only after <code>./touchdown agent notes on</code>. Never ticket numbers, booking references, seats or photo links. The agent and its rules are set with <code>./touchdown agent</code>.
      </p>
      {loader}
      {error && <p className="agent-panel__error" role="alert">{error}</p>}
    </section>
  );
}

/** The agent's suggestions for one row, each with Use and Dismiss, and its note when it doubts the row without one. */
export function AgentSuggestions({ record, choices, onChoose }: { record: AgentRecordResult; choices: Map<string, Choice>; onChoose: (field: AgentField, c: Choice | null) => void }) {
  return (
    <ul className="suggestions" aria-label="Agent suggestions">
      {record.suggestions.map((s) => {
        const c = choices.get(choiceKey(record.recordId, s.field)) ?? null;
        return (
          <li key={s.field} className={`suggestion${c ? ` is-${c}` : ""}`}>
            <div className="suggestion__main">
              <p className="suggestion__change">
                <span className="suggestion__field">{AGENT_FIELD_LABEL[s.field]}</span> <span className="suggestion__old">{s.current || "empty"}</span> <Icon name="arrow-right" className="icon suggestion__arrow" /> <b>{s.suggested || "clear it"}</b>
              </p>
              <p className="suggestion__reason">
                {s.reason} <span className="suggestion__meta">{s.confidence[0]!.toUpperCase() + s.confidence.slice(1)} confidence, {BASIS[s.basis]}.</span>
              </p>
            </div>
            <div className="suggestion__actions">
              {c === "used" ? (
                <>
                  <span className="suggestion__state">
                    <Icon name="check" />
                    Used
                  </span>
                  <button type="button" className="btn btn--ghost btn--small" onClick={() => onChoose(s.field, null)}>
                    Undo
                  </button>
                </>
              ) : c === "dismissed" ? (
                <>
                  <span className="suggestion__state">Dismissed</span>
                  <button type="button" className="btn btn--ghost btn--small" onClick={() => onChoose(s.field, null)}>
                    Undo
                  </button>
                </>
              ) : (
                <>
                  <button type="button" className="btn btn--quiet btn--small" onClick={() => onChoose(s.field, "used")}>
                    Use
                  </button>
                  <button type="button" className="btn btn--ghost btn--small" onClick={() => onChoose(s.field, "dismissed")}>
                    Dismiss
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
              <span className="suggestion__field">Agent</span> {record.note}
            </p>
          </div>
        </li>
      )}
    </ul>
  );
}
