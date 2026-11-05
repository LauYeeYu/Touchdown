// Which column of a spreadsheet holds which field (docs/31-ui.md, Import): each column with a few of its values
// and the field it was read as, which the user can change. Unclear columns are marked.

import { COLUMN_FIELDS, FIELD_DEFS, mappingProblem, type ColumnField, type RowKind, type SheetMapping } from "@touchdown/core";
import { t } from "@touchdown/i18n";
import { Segmented } from "./form.tsx";
import { Select } from "./Select.tsx";
import { Icon } from "../lib/icons.tsx";

export interface ColumnChoice {
  kind: RowKind;
  fields: ColumnField[];
}

const kindOptions = (): { value: RowKind; label: string }[] => [
  { value: "sightings", label: t("import.columns.kind.sightings") },
  { value: "flights", label: t("import.columns.kind.flights") },
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
    <section className="column-mapping" aria-label={t("import.columns.label")}>
      <div className="column-mapping__kind">
        <span>{t("import.columns.kind.label")}</span>
        <Segmented value={value.kind} options={kindOptions()} onChange={setKind} label={t("import.columns.kind.label")} />
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
                  <b>{c.header || t("import.columns.unnamed", { n: c.index + 1 })}</b>
                  <small>{FIELD_DEFS[field].private ? t("import.columns.hidden") : c.samples.slice(0, 3).join(" · ") || t("import.empty")}</small>
                  {unclear && <small className="column-mapping__why">{t("import.columns.unclear", { why: c.why })}</small>}
                </span>
                <Select<ColumnField>
                  value={field}
                  label={t("import.columns.fieldFor", { named: c.header ? "yes" : "no", header: c.header, n: c.index + 1 })}
                  onChange={(v) => onChange({ ...value, fields: value.fields.map((f, i) => (i === c.index ? v : f)) })}
                  options={[{ value: "ignore", label: t("import.columns.notUsed") }, ...options.map((f) => ({ value: f, label: FIELD_DEFS[f].label }))]}
                />
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
          {t("import.columns.read")}
        </button>
        <button type="button" className="btn btn--ghost" onClick={onCancel}>
          {t("import.chooseAnother")}
        </button>
      </div>
      <p className="form-sub">{t("import.columns.note")}</p>
    </section>
  );
}
