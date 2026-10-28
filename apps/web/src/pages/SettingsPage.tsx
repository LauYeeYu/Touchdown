// Settings (docs/31-ui.md): account and, for the owner, people (docs/33), display, sync mode (docs/32), data
// (backup, restore, CSV, delete), family overrides, sources. The agent check's settings belong to the CLI on each computer (docs/22).

import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { backupZip, readBackup, tableCsv, todayIn, toUtcIso, type Settings } from "@touchdown/core";
import type { AppData } from "../data/app.ts";
import { useApp } from "../data/context.tsx";
import { chooseStorage, type StorageKind } from "../data/connection.ts";
import { canUseFolders } from "../data/folder.ts";
import { loadGoogle } from "../data/google.ts";
import { momentLabel, nf, plural } from "../lib/format.ts";
import { Icon } from "../lib/icons.tsx";
import { Field, Segmented, TextInput } from "../components/form.tsx";
import { LocalWarning, ModeChoice, STORAGE_BUTTON, STORAGE_NOTE, StorageChoice, useSyncInfo, type Mode } from "../components/ModeChoice.tsx";
import { toast } from "../components/overlay.tsx";
import { AccountSection } from "../components/AccountSettings.tsx";
import { clause, tracksToComeText } from "../components/Shell.tsx";
import { download } from "../lib/download.ts";
import { connectStandard, FOLDERS_ONLY_HERE, STANDARD_NOTE, STANDARD_UNAVAILABLE, takeStandardError } from "./FirstRun.tsx";
import { standard, type StandardStatus } from "../data/standard.ts";
import { StandardTerms } from "../components/StandardTerms.tsx";

const LEAVE_STANDARD = "Leaving Standard revokes Touchdown's key to your Google Drive and deletes it from the server. Your log in Google Drive is left as it is. Continue?";

/** Where the log lives (docs/32): the mode, changing it, and how sync is going in Private and Standard mode. */
function WhereTheLogLives({ app }: { app: AppData }) {
  const c = app.connection;
  const current: Mode = c?.mode ?? "local";
  const [chosen, setChosen] = useState<Mode>(current);
  const [storage, setStorage] = useState<StorageKind>(c?.mode === "private" && c.adapter === "gdrive" && canUseFolders() ? "localfs" : "gdrive");
  // In Private: choosing other storage.
  const [moving, setMoving] = useState(false);
  const [understood, setUnderstood] = useState(false);
  const [busy, setBusy] = useState(false);
  const [std, setStd] = useState<StandardStatus | null>(null);
  const [termsProblem, setTermsProblem] = useState<string | null>(null);
  const [termsOpen, setTermsOpen] = useState(false);
  const sync = useSyncInfo(app);
  const notHere = sync ? app.tracksNotHere() : 0;
  const conflicts = app.conflicts().length;
  const place = c && c.mode !== "local" ? c.name : null;
  const choosing = chosen === "private" && (current !== "private" || moving);

  useEffect(() => {
    const back = takeStandardError();
    if (back) toast(back);
    void standard.status().then(setStd, () => setStd(null));
  }, []);

  useEffect(() => {
    if (choosing && storage === "gdrive") void loadGoogle().catch(() => undefined);
  }, [choosing, storage]);

  /** Leaving Standard: the key is revoked and deleted first (docs/32, "Changing mode"). */
  const leaveStandard = async (): Promise<boolean> => {
    if (current !== "standard") return true;
    if (!window.confirm(LEAVE_STANDARD)) return false;
    try {
      await standard.disconnect();
      return true;
    } catch (e) {
      toast(`Could not leave Standard: ${(e as Error).message}`);
      return false;
    }
  };

  const toPrivate = async () => {
    if (!(await leaveStandard())) return;
    let picked;
    try {
      picked = await chooseStorage(storage);
    } catch (e) {
      toast(`${storage === "gdrive" ? "Google Drive could not be connected" : "The folder could not be opened"}: ${(e as Error).message}`);
      return;
    }
    if (!picked) return;
    const { connection } = picked;
    const hasLog = app.store.count("flights") + app.store.count("sightings") > 0;
    if (hasLog && picked.holdsLog && !window.confirm(`${connection.name} already holds a Touchdown log. Your log in this browser and that one will be merged; where both changed the same entry, the later change is kept and the other is kept in the log's history. Continue?`)) return;
    setBusy(true);
    await app.connect(connection);
    setBusy(false);
    setMoving(false);
    const info = app.getSyncInfo();
    toast(info?.state === "failed" ? `Could not sync with ${connection.name}.` : `Your log now syncs through ${connection.name}.${place && place !== connection.name ? ` The copy in ${place} is left as it is.` : ""}`);
  };

  const toLocal = async () => {
    if (!(await leaveStandard())) return;
    const was = place;
    await app.connect({ mode: "local", since: toUtcIso(Date.now()) });
    setUnderstood(false);
    toast(was ? `Your log is now kept in this browser only. The copy in ${was} is left as it is.` : "Your log is kept in this browser only.");
  };

  const cancel = () => {
    setChosen(current);
    setMoving(false);
  };

  return (
    <>
      <h2 className="form-section">Sync mode</h2>
      <ModeChoice
        value={chosen}
        onChange={(m) => {
          setChosen(m);
          // Choosing Standard opens its terms; nothing changes until they are accepted.
          if (m === "standard" && current !== "standard") setTermsOpen(true);
        }}
        unavailable={std?.available || current === "standard" ? {} : { standard: STANDARD_UNAVAILABLE }}
        notes={{ standard: STANDARD_NOTE }}
      />
      {std && (
        <StandardTerms
          open={termsOpen && chosen === "standard" && current !== "standard"}
          busy={busy}
          problem={termsProblem}
          onAccept={() => {
            setBusy(true);
            void connectStandard(std, "/settings").then((p) => {
              if (p) {
                setTermsProblem(p);
                setBusy(false);
              }
            });
          }}
          onDecline={() => {
            setTermsOpen(false);
            setTermsProblem(null);
            cancel();
          }}
        />
      )}
      {choosing && (
        <>
          <h3 className="form-subsection">Storage</h3>
          <StorageChoice value={storage} onChange={setStorage} unavailable={canUseFolders() ? {} : { localfs: FOLDERS_ONLY_HERE }} />
          <p className="form-sub">{STORAGE_NOTE[storage]}</p>
          <div className="button-row">
            <button type="button" className="btn btn--primary" disabled={busy} onClick={() => void toPrivate()}>
              {busy ? "Syncing…" : STORAGE_BUTTON[storage]}
            </button>
            <button type="button" className="btn btn--ghost" onClick={cancel}>
              Cancel
            </button>
          </div>
        </>
      )}
      {chosen !== current && chosen === "local" && (
        <>
          <LocalWarning understood={understood} onChange={setUnderstood} />
          <div className="button-row">
            <button type="button" className="btn btn--primary" disabled={!understood} onClick={() => void toLocal().then(() => setChosen("local"))}>
              Keep the log in this browser only
            </button>
            <button type="button" className="btn btn--ghost" onClick={cancel}>
              Cancel
            </button>
          </div>
        </>
      )}
      {chosen === current && current === "local" && <LocalWarning />}
      {chosen === current && !moving && sync && (
        <>
          {sync.state === "permission" && (
            <p className="status-line">
              <Icon name={sync.adapter === "gdrive" ? "cloud" : "folder"} />
              <span>
                {sync.mode === "standard" ? `Touchdown cannot reach ${sync.place} for you.` : sync.adapter === "gdrive" ? `Sign in to Google again to sync with ${sync.place}.` : `Touchdown needs your permission to use ${sync.place} again.`}{" "}
                <button type="button" className="link-btn" onClick={() => void app.sync?.allow()}>
                  {sync.mode === "standard" ? "Connect Google Drive again" : sync.adapter === "gdrive" ? "Sign in" : "Allow"}
                </button>
              </span>
            </p>
          )}
          {sync.state === "permission" && sync.error && (
            <p className="status-line status-line--error">
              <Icon name="circle-x" />
              <span>{sync.error}</span>
            </p>
          )}
          {sync.state === "syncing" && (
            <p className="status-line">
              <Icon name="refresh-cw" />
              <span>
                {sync.tables ? `Syncing with ${sync.place}…` : `Reading your log from ${sync.place}…`}
                {sync.tracks && ` Reading recorded tracks: ${nf.format(sync.tracks.done)} of ${nf.format(sync.tracks.total)}.`}
              </span>
            </p>
          )}
          {sync.state === "synced" && (
            <p className="status-line status-line--good">
              <Icon name="circle-check" />
              <span>
                Synced with {sync.place}
                {sync.lastAt ? `, ${momentLabel(sync.lastAt)}` : ""}.{sync.waiting > 0 && ` ${plural(sync.waiting, "change")} not synced yet.`}
              </span>
            </p>
          )}
          {sync.state === "failed" && (
            <p className="status-line status-line--error">
              <Icon name="circle-x" />
              <span>
                Could not sync with {sync.place}: {clause(sync.error)}. Your changes are kept in this browser and sent once it works.
              </span>
            </p>
          )}
          {sync.state === "update" && (
            <p className="status-line status-line--error">
              <Icon name="rotate-cw" />
              <span>A newer version of Touchdown has changed your log in {sync.place}. Reload the page to update the app; your changes are kept in this browser and sent after the reload.</span>
            </p>
          )}
          {sync.tables && !sync.tracks && notHere > 0 && (
            <p className="status-line">
              <Icon name="route" />
              <span>{tracksToComeText(notHere, sync.place)}</span>
            </p>
          )}
          {sync.problems.length > 0 && (
            <p className="status-line status-line--error">
              <Icon name="circle-alert" />
              <span>
                Left alone because they could not be read: {sync.problems.slice(0, 3).join("; ")}
                {sync.problems.length > 3 ? `; and ${sync.problems.length - 3} more` : ""}. Restore them from a backup in {sync.place}, or fix them there.
              </span>
            </p>
          )}
          {conflicts > 0 && (
            <p className="status-line">
              <Icon name="merge" />
              <span>
                {plural(conflicts, "field was", "fields were")} changed on two devices before either saw the other's change. <Link to="/issues">Choose which to keep</Link>.
              </span>
            </p>
          )}
          <div className="button-row">
            {sync.state !== "permission" && (
              <button type="button" className="btn btn--quiet btn--small" disabled={sync.state === "syncing"} onClick={() => void app.sync?.run()}>
                <Icon name="refresh-cw" />
                Sync now
              </button>
            )}
            {sync.mode === "private" && (
              <button type="button" className="btn btn--quiet btn--small" onClick={() => setMoving(true)}>
                Change storage
              </button>
            )}
          </div>
        </>
      )}
    </>
  );
}

export function SettingsPage() {
  const { app } = useApp();
  const { store, ref } = app;
  const s = app.settings();
  const [includePrivate, setIncludePrivate] = useState(false);
  const [designator, setDesignator] = useState("");
  const [family, setFamily] = useState("");
  const [sources, setSources] = useState<string[]>([]);
  const [refVersion, setRefVersion] = useState("");
  // Whether the browser keeps the log when the disk runs low (main.tsx asks for that).
  const [kept, setKept] = useState<boolean | null>(null);
  useEffect(() => {
    navigator.storage
      ?.persisted?.()
      .then(setKept)
      .catch(() => setKept(null));
  }, []);

  useEffect(() => {
    void import("@touchdown/refdata").then((m) => {
      setSources(m.refSources());
      setRefVersion(m.refVersion);
    });
  }, []);

  const set = (patch: Partial<Settings>) => app.updateSettings(patch);
  const families = [...ref.families.values()].sort((a, b) => a.name.localeCompare(b.name));
  const overrides = store.all("family_overrides");

  const restore = async (file: File) => {
    const back = readBackup(new Uint8Array(await file.arrayBuffer()));
    if (back.problems.length) {
      window.alert(`This backup cannot be restored:\n\n${back.problems.slice(0, 8).join("\n")}`);
      return;
    }
    const n = (back.tables.get("flights")?.length ?? 0) + (back.tables.get("sightings")?.length ?? 0);
    const merged = app.connection && app.connection.mode !== "local" ? " Your folder's log is then merged in at the next sync; where both changed the same entry, the later change is kept." : "";
    if (!window.confirm(`Replace everything in this browser with the backup (${plural(n, "flight or sighting", "flights and sightings")})?${merged} Export a backup of the current data first if you might need it.`)) return;
    await app.replaceAll(back.tables);
    location.reload();
  };

  return (
    <div className="page page--form">
      <div className="view-top" />
      <h1 className="form-title">Settings</h1>

      <AccountSection app={app} />

      <h2 className="form-section">Display</h2>
      <div className="form-grid form-grid--choices">
        <Field label="Theme">
          <Segmented label="Theme" value={s.theme ?? "system"} onChange={(v) => set({ theme: v ?? "system" })} options={[{ value: "system", label: "Follow the device" }, { value: "light", label: "Light" }, { value: "dark", label: "Dark" }]} />
        </Field>
        <Field label="Distance">
          <Segmented label="Distance" value={s.distanceUnit ?? "km"} onChange={(v) => set({ distanceUnit: v ?? "km" })} options={[{ value: "km", label: "Kilometres" }, { value: "mi", label: "Miles" }, { value: "nm", label: "Nautical miles" }]} />
        </Field>
        <Field label="Airport and airline codes">
          <Segmented label="Codes" value={s.codeDisplay ?? "iata"} onChange={(v) => set({ codeDisplay: v ?? "iata" })} options={[{ value: "iata", label: "IATA (LHR)" }, { value: "icao", label: "ICAO (EGLL)" }, { value: "both", label: "Both" }]} />
        </Field>
        <Field label="Model names">
          <Segmented label="Model names" value={s.modelNaming ?? "standard"} onChange={(v) => set({ modelNaming: v ?? "standard" })} options={[{ value: "standard", label: "Boeing 777-322(ER)" }, { value: "compact", label: "B777-322ER" }]} />
        </Field>
      </div>

      <WhereTheLogLives app={app} />

      <h2 className="form-section">Data</h2>
      <p className="status-line">
        <Icon name="hard-drive" />
        <span>
          This browser holds {app.connection && app.connection.mode !== "local" ? "a copy of " : ""}your log ({plural(store.count("flights"), "flight")}, {plural(store.count("sightings"), "sighting")}, {plural(store.count("airframes"), "aircraft", "aircraft")}).
          {kept === true && " The browser keeps it until you delete it."}
          {kept === false && " The browser may clear it if the disk runs low."}
        </span>
      </p>
      <div className="button-row">
        <button
          type="button"
          className="btn btn--quiet"
          onClick={() => {
            download(`touchdown-backup-${todayIn()}.zip`, backupZip(store) as BlobPart, "application/zip");
            app.markBackup();
          }}
        >
          <Icon name="download" />
          Export a backup (.zip)
        </button>
        <label className="btn btn--quiet">
          <Icon name="upload" />
          Restore from a backup
          <input
            type="file"
            accept=".zip,application/zip"
            className="visually-hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void restore(f);
              e.target.value = "";
            }}
          />
        </label>
      </div>
      {import.meta.env.DEV && (
        <div className="button-row">
          <button
            type="button"
            className="btn btn--quiet btn--small"
            onClick={async () => {
              if (!window.confirm("Replace everything in this browser with the local backup from data/private?")) return;
              if (import.meta.env.DEV && !(await (await import("../data/localBackup.ts")).loadLocalBackup(app))) toast("No local backup at data/private/touchdown-backup.zip.");
            }}
          >
            <Icon name="hard-drive" />
            Load the local backup (development)
          </button>
        </div>
      )}
      <p className="form-sub">A backup contains every table, including private fields.</p>
      <div className="button-row">
        {(["flights", "sightings", "airframes"] as const).map((t) => (
          <button key={t} type="button" className="btn btn--quiet btn--small" onClick={() => download(`touchdown-${t}-${todayIn()}.csv`, tableCsv(store, t, includePrivate), "text/csv")}>
            <Icon name="file" />
            {t === "airframes" ? "Aircraft" : t[0]!.toUpperCase() + t.slice(1)} as CSV
          </button>
        ))}
        <label className="check">
          <input type="checkbox" checked={includePrivate} onChange={(e) => setIncludePrivate(e.target.checked)} />
          Include private fields (ticket number, booking reference)
        </label>
      </div>
      <div className="button-row">
        <button
          type="button"
          className="btn btn--danger btn--small"
          onClick={async () => {
            const place = app.connection && app.connection.mode !== "local" ? ` The log in ${app.connection.name} is left as it is.` : " This cannot be undone here.";
            if (!window.confirm(`Delete every flight, sighting and setting in this browser, and forget where the log lives?${place}`)) return;
            if (window.prompt('Type "delete" to confirm.') !== "delete") return;
            await app.deleteEverything();
            location.reload();
          }}
        >
          <Icon name="trash" />
          Delete all data in this browser
        </button>
      </div>

      <h2 className="form-section">Aircraft families</h2>
      <p className="form-sub">Families group type codes in the statistics. Change a type's family here, for example to count the E170 and E175 together.</p>
      {overrides.length > 0 && (
        <ul className="rows overrides">
          {overrides.map((o) => (
            <li key={o.id} className="history-row">
              <span>
                <b>{o.designator}</b>
                <small>in {ref.family(o.familyId)?.name ?? o.familyId}</small>
              </span>
              <button
                type="button"
                className="btn btn--quiet btn--small"
                onClick={() => app.setFamily(o.designator!, null)}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
      <form
        className="inline-form"
        onSubmit={(e) => {
          e.preventDefault();
          const d = designator.trim().toUpperCase();
          if (!ref.type(d) || !family) {
            toast(ref.type(d) ? "Choose a family." : `${d} is not a type code.`);
            return;
          }
          app.setFamily(d, family);
          setDesignator("");
        }}
      >
        <Field label="Type code">
          <TextInput value={designator} onChange={(e) => setDesignator(e.target.value)} placeholder="E170" />
        </Field>
        <Field label="Family">
          <select className="select" value={family} onChange={(e) => setFamily(e.target.value)}>
            <option value="">Choose</option>
            {families.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </select>
        </Field>
        <button type="submit" className="btn btn--quiet btn--small">
          Add
        </button>
      </form>


      <h2 className="form-section">Reference data</h2>
      <p className="form-sub">Airports, airlines and aircraft types{refVersion ? `, built ${refVersion}` : ""}. Sources:</p>
      <ul className="sources">
        {sources.map((x) => (
          <li key={x}>{x}</li>
        ))}
        <li>Map: Natural Earth (public domain) via world-atlas. Icons: Lucide (ISC). Typeface: Source Sans 3 (SIL Open Font License). Reference photos: planespotters.net, credited on each photo.</li>
      </ul>
    </div>
  );
}
