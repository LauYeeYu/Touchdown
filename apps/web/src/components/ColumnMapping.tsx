// Which column of a spreadsheet holds which field (docs/31-ui.md, Import): each column with a few of its values
// and the field it was read as, which the user can change. Unclear columns are marked.

import { COLUMN_FIELDS, FIELD_DEFS, mappingProblem, type ColumnField, type RowKind, type SheetMapping } from "@touchdown/core";
import { Segmented } from "./form.tsx";
import { Icon } from "../lib/icons.tsx";

export interface ColumnChoice {
  kind: RowKind;
  fields: ColumnField[];
}

const KIND_OPTIONS: { value: RowKind; label: string }[] = [
  { value: "sightings", label: "Aircraft you saw" },
  { value: "flights", label: "Flights you took" },
];

export function ColumnMapping({ guess, value, onChange, onUse, onCancel }: { guess: SheetMapping; value: ColumnChoice; onChange: (v: ColumnChoice) => void; onUse: () => void; onCancel: () => void }) {
  const problem = mappingProblem(value);
  const options = COLUMN_FIELDS.filter((f) => f !== "ignore" && FIELD_DEFS[f].kinds.includes(value.kind));
  const setKind = (kind: RowKind | null) => {
    if (!kind) return;
    // A field of the other kind is not used.
    onChange({ kind, fields: value.fields.map((f) => (f !== "ignore" && !FIELD_DEFS[f].kinds.includes(kind) ? "ignore" : f)) });
  };
  return (
    <section className="column-mapping" aria-label="Columns">
      <div className="column-mapping__kind">
        <span>The rows are</span>
        <Segmented value={value.kind} options={KIND_OPTIONS} onChange={setKind} label="The rows are" />
      </div>
      <ul className="column-mapping__list">
        {guess.columns
          .filter((c) => c.header || c.samples.length)
          .map((c) => {
            const field = value.fields[c.index]!;
            // Unclear: the header and values did not settle it (whatever the field chosen for it now).
            const unclear = c.confidence === "unsure";
            return (
              <li key={c.index} className={`column-mapping__row${unclear ? " is-unclear" : ""}`}>
                <span className="column-mapping__name">
                  <b>{c.header || `Column ${c.index + 1}`}</b>
                  <small>{FIELD_DEFS[field].private ? "values hidden (private)" : c.samples.slice(0, 3).join(" · ") || "empty"}</small>
                  {unclear && <small className="column-mapping__why">Unclear: {c.why}</small>}
                </span>
                <select
                  className="select"
                  value={field}
                  aria-label={`What ${c.header || `column ${c.index + 1}`} holds`}
                  onChange={(e) => onChange({ ...value, fields: value.fields.map((f, i) => (i === c.index ? (e.target.value as ColumnField) : f)) })}
                >
                  <option value="ignore">Not used</option>
                  {options.map((f) => (
                    <option key={f} value={f}>
                      {FIELD_DEFS[f].label}
                    </option>
                  ))}
                </select>
              </li>
            );
          })}
      </ul>
      {problem && (
        <p className="status-line status-line--check" role="alert">
          <Icon name="triangle-alert" />
          <span>{problem}</span>
        </p>
      )}
      <div className="column-mapping__actions">
        <button type="button" className="btn btn--primary" disabled={!!problem} onClick={onUse}>
          Read the rows
        </button>
        <button type="button" className="btn btn--ghost" onClick={onCancel}>
          Choose another file
        </button>
      </div>
      <p className="form-sub">"Other text" goes to the notes; the agent check can sort it into fields. These columns are remembered in this browser for files laid out the same way.</p>
    </section>
  );
}
