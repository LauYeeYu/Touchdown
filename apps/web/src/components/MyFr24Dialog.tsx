// Settings › Data › myFR24: the flights for the file, chosen in a dialog tall enough for a long list (docs/21,
// "Exports"). Each time it opens, the flights not in myFR24 yet are chosen. Downloading the file marks its flights as
// sent and closes the dialog.

import { useEffect, useRef, useState } from "react";
import { arrivalAirportId, flightDay, flightName, todayIn, type Flight, type Settings } from "@touchdown/core";
import { airportLabel, dayMonthYear, momentDay, myFr24Csv, myFr24Flights, myFr24States, type MyFr24State } from "@touchdown/core/view";
import { t } from "@touchdown/i18n";
import { useApp } from "../data/context.tsx";
import { download } from "../lib/download.ts";
import { Icon } from "../lib/icons.tsx";
import { toast } from "./overlay.tsx";
import { PickAll, PickList, pickHint } from "./PickList.tsx";
import { useBackdropClose } from "../lib/dialog.ts";

/** A flight in the list: its day, number and route, and whether myFR24 has it already. */
function MyFr24Row({ flight: f, state, codes }: { flight: Flight; state: MyFr24State | undefined; codes: Settings["codeDisplay"] }) {
  const { app } = useApp();
  const day = f.scheduledDate ?? flightDay(f);
  const from = airportLabel(f.fromAirportId, app.ref, codes) || f.fromRaw || "?";
  const to = airportLabel(arrivalAirportId(f), app.ref, codes) || f.toRaw || "?";
  return (
    <>
      <span className="pick__date">{day ? dayMonthYear(day) : t("settings.myfr24.noDate")}</span>
      <span className="pick__flight">{flightName(f) ?? "—"}</span>
      <span className="pick__route">
        {from} → {to}
      </span>
      {state && <span className="pick__tag">{state.kind === "sent" ? t("settings.myfr24.sent", { date: momentDay(Date.parse(state.at)) }) : t("settings.myfr24.imported")}</span>}
    </>
  );
}

export function MyFr24Dialog({ onClose }: { onClose: () => void }) {
  const { app } = useApp();
  const { store, ref } = app;
  const dialog = useRef<HTMLDialogElement>(null);
  const backdrop = useBackdropClose(() => dialog.current?.close());
  const all = myFr24Flights(store);
  const states = myFr24States(store);
  const [chosen, setChosen] = useState<Set<string>>(() => new Set(myFr24Flights(store, true).map((f) => f.id)));
  const picked = all.filter((f) => chosen.has(f.id));
  useEffect(() => {
    dialog.current?.showModal();
  }, []);

  const save = () => {
    download(`flightdiary-touchdown-${todayIn()}.csv`, myFr24Csv(store, ref, picked), "text/csv");
    app.markMyFr24Export(picked.map((f) => f.id));
    toast(t("settings.myfr24.done", { count: picked.length }));
    onClose();
  };

  return (
    <dialog ref={dialog} className="share-dialog pick-dialog" {...backdrop} aria-labelledby="myfr24-title" onClose={onClose} onCancel={onClose}>
      <h2 id="myfr24-title" className="share-dialog__title">
        {t("settings.myfr24.dialog.title")}
      </h2>
      <p className="pick__hint">
        <Icon name="info" />
        <span>{t("settings.myfr24.hint", pickHint())}</span>
      </p>
      {/* The list's head (all of it, what is chosen) stays above the rows as they scroll. Newest first, as the
          Flights page lists them. The file keeps the oldest first. */}
      <div className="pick__panel">
        <div className="pick__head">
          <PickAll total={all.length} chosen={picked.length} onAll={() => setChosen(new Set(all.map((f) => f.id)))} onNone={() => setChosen(new Set())} label={t("settings.myfr24.pick.all")} />
          <span className="pick__count" aria-live="polite">
            {t("settings.myfr24.chosen", { chosen: picked.length, total: all.length })}
          </span>
        </div>
        <PickList items={[...all].reverse()} keyOf={(f) => f.id} chosen={chosen} onChange={setChosen} label={t("settings.myfr24.listLabel")} render={(f) => <MyFr24Row flight={f} state={states.get(f.id)} codes={app.settings().codeDisplay} />} />
      </div>
      <div className="share-dialog__foot">
        <button type="button" className="btn btn--primary btn--small" disabled={!picked.length} onClick={save}>
          <Icon name="download" />
          {t("settings.myfr24.button", { count: picked.length })}
        </button>
        <button type="button" className="btn btn--ghost btn--small" onClick={onClose}>
          {t("common.cancel")}
        </button>
      </div>
    </dialog>
  );
}
