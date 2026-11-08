// An airport field: a picker over the airports with the airport it names under it. A code or a name the tables loaded
// so far lack loads the small airfields (docs/13, "Airports"). Still unknown, it offers to add the airport
// (AirportDialog) and takes the code it was saved under.

import { useEffect, useMemo, useState } from "react";
import type { Airport } from "@touchdown/core";
import { t } from "@touchdown/i18n";
import { useApp } from "../data/context.tsx";
import { AirportDialog } from "./AirportDialog.tsx";
import { airportOptions, Picker, searchAirports } from "./form.tsx";

export function AirportField({ label, value, onChange, airport, shown, unknown, placeholder }: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  /** The airport the value names, if any. */
  airport: Airport | null;
  /** How that airport is named under the field. */
  shown: string;
  /** What is said under a value that names no airport. */
  unknown: string;
  placeholder?: string;
}) {
  const { app } = useApp();
  const [adding, setAdding] = useState(false);
  const raw = value.trim();
  const lacking = useMemo(() => raw.length >= 3 && !airport && searchAirports(app.ref, raw, 1).length === 0, [raw, airport, app.ref, app.airfieldsLoaded]);
  useEffect(() => {
    if (lacking && !app.airfieldsLoaded) void app.loadAirfields();
  }, [lacking, app]);
  const bad = !!raw && !airport;
  return (
    <div className="field">
      <span className="field__label">{label}</span>
      <Picker label={label} value={value} onChange={onChange} options={airportOptions(app.ref)} placeholder={placeholder} invalid={bad} />
      <span className={`field__hint${bad ? " field__hint--bad" : ""}`}>
        {airport ? shown : bad ? unknown : ""}
        {bad && app.airfieldsLoaded && (
          <button type="button" className="link-btn field__action" onClick={() => setAdding(true)}>
            {t("airport.own.add")}
          </button>
        )}
      </span>
      {adding && <AirportDialog raw={raw} onClose={() => setAdding(false)} onSaved={onChange} />}
    </div>
  );
}
