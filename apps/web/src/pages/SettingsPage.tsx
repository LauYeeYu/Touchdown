// Settings (docs/31-ui.md): account and, for the owner, people (docs/33), display, sync mode (docs/32), data
// (backup, restore, CSV, delete), family overrides, sources. The agent check's settings belong to the CLI on each computer (docs/22).

import { Fragment, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { backupZip, readBackup, tableCsv, tableRows, todayIn, toUtcIso, writeXlsx, type Settings, type XlsxCell } from "@touchdown/core";
import { dateOnly, dayMonthYear, myFr24Flights } from "@touchdown/core/view";
import { dateStyles, LOCALES, sentenceGap, t, type DateStyle, type MessageKey } from "@touchdown/i18n";
import type { AppData } from "../data/app.ts";
import { useApp } from "../data/context.tsx";
import { chooseStorage, placeName, type StorageKind } from "../data/connection.ts";
import { account } from "../data/account.ts";
import { canUseFolders } from "../data/folder.ts";
import { loadGoogle, SignInCancelled } from "../data/google.ts";
import { familyName, momentLabel } from "../lib/format.ts";
import { tx } from "../lib/i18n.tsx";
import { Icon } from "../lib/icons.tsx";
import { Field, Segmented, TextInput } from "../components/form.tsx";
import { LocalWarning, ModeChoice, STORAGE_BUTTON, STORAGE_NOTE, StorageChoice, useSyncInfo, type Mode } from "../components/ModeChoice.tsx";
import { toast } from "../components/overlay.tsx";
import { Select } from "../components/Select.tsx";
import { MyFr24Dialog } from "../components/MyFr24Dialog.tsx";
import { CopiesDialog } from "../components/CopiesDialog.tsx";
import type { StorageCopies } from "../data/sync.ts";
import { AccountSection } from "../components/AccountSettings.tsx";
import { clause, tracksToComeText } from "../components/Shell.tsx";
import { download } from "../lib/download.ts";
import { connectStandard, foldersOnlyHere, standardUnavailable, takeStandardError } from "./FirstRun.tsx";
import { standard, type StandardStatus } from "../data/standard.ts";
import { StandardTerms } from "../components/StandardTerms.tsx";
import { useShares } from "../data/shares.ts";
import { saveAsGoogleSheet, type MadeSheet } from "../data/sheets.ts";

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
  const place = c && c.mode !== "local" ? placeName(c) : null;
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
    if (!window.confirm(t("settings.leaveStandard.confirm"))) return false;
    try {
      await standard.disconnect();
      return true;
    } catch (e) {
      toast(t("settings.leaveStandard.failed", { problem: (e as Error).message }));
      return false;
    }
  };

  const toPrivate = async () => {
    if (!(await leaveStandard())) return;
    let picked;
    try {
      picked = await chooseStorage(storage);
    } catch (e) {
      toast(t("settings.connect.failed", { storage, problem: (e as Error).message }));
      return;
    }
    if (!picked) return;
    const { connection } = picked;
    const hasLog = app.store.count("flights") + app.store.count("sightings") > 0;
    if (hasLog && picked.holdsLog && !window.confirm(t("settings.connect.merge", { place: placeName(connection) }))) return;
    setBusy(true);
    await app.connect(connection);
    setBusy(false);
    setMoving(false);
    const info = app.getSyncInfo();
    toast(info?.state === "failed" ? t("settings.connect.syncFailed", { place: placeName(connection) }) : t("settings.connect.done", { left: place && place !== placeName(connection) ? "yes" : "no", place: placeName(connection), old: place ?? "" }));
  };

  const toLocal = async () => {
    if (!(await leaveStandard())) return;
    const was = place;
    await app.connect({ mode: "local", since: toUtcIso(Date.now()) });
    setUnderstood(false);
    toast(t("settings.local.done", { left: was ? "yes" : "no", place: was ?? "" }));
  };

  const cancel = () => {
    setChosen(current);
    setMoving(false);
  };

  return (
    <>
      <h2 className="form-section">{t("settings.syncMode")}</h2>
      <ModeChoice
        value={chosen}
        onChange={(m) => {
          setChosen(m);
          // Choosing Standard opens its terms; nothing changes until they are accepted.
          if (m === "standard" && current !== "standard") setTermsOpen(true);
        }}
        unavailable={std?.available || current === "standard" ? {} : { standard: standardUnavailable() }}
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
      {chosen === current && current === "standard" && <SharedLinksLine />}
      {choosing && (
        <>
          <h3 className="form-subsection">{t("settings.storage.title")}</h3>
          <StorageChoice value={storage} onChange={setStorage} unavailable={canUseFolders() ? {} : { localfs: foldersOnlyHere() }} />
          <p className="form-sub">{STORAGE_NOTE[storage]}</p>
          <div className="button-row">
            <button type="button" className="btn btn--primary" disabled={busy} onClick={() => void toPrivate()}>
              {busy ? t("settings.syncing") : STORAGE_BUTTON[storage]}
            </button>
            <button type="button" className="btn btn--ghost" onClick={cancel}>
              {t("common.cancel")}
            </button>
          </div>
        </>
      )}
      {chosen !== current && chosen === "local" && (
        <>
          <LocalWarning understood={understood} onChange={setUnderstood} />
          <div className="button-row">
            <button type="button" className="btn btn--primary" disabled={!understood} onClick={() => void toLocal().then(() => setChosen("local"))}>
              {t("settings.local.keep")}
            </button>
            <button type="button" className="btn btn--ghost" onClick={cancel}>
              {t("common.cancel")}
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
                {tx(
                  "settings.sync.permission",
                  { how: sync.mode === "standard" ? "standard" : sync.adapter === "gdrive" ? "gdrive" : "folder", place: sync.place },
                  {
                    allow: (text) => (
                      <button type="button" className="link-btn" onClick={() => void app.sync?.allow()}>
                        {text}
                      </button>
                    ),
                  },
                )}
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
                {t("settings.sync.syncing", { reading: sync.tables ? "no" : "yes", place: sync.place })}
                {sync.tracks && `${sentenceGap()}${t("settings.sync.tracks", { done: sync.tracks.done, total: sync.tracks.total })}`}
              </span>
            </p>
          )}
          {sync.state === "synced" && (
            <p className="status-line status-line--good">
              <Icon name="circle-check" />
              <span>
                {t("settings.sync.synced", { dated: sync.lastAt ? "yes" : "no", place: sync.place, at: sync.lastAt ? momentLabel(sync.lastAt) : "" })}
                {sync.waiting > 0 && `${sentenceGap()}${t("settings.sync.waiting", { count: sync.waiting })}`}
              </span>
            </p>
          )}
          {sync.state === "failed" && (
            <p className="status-line status-line--error">
              <Icon name="circle-x" />
              <span>{t("settings.sync.failed", { place: sync.place, problem: clause(sync.error) })}</span>
            </p>
          )}
          {sync.state === "offline" && (
            <p className="status-line">
              <Icon name="wifi-off" />
              <span>{t("settings.sync.offline", { place: sync.place, count: sync.waiting })}</span>
            </p>
          )}
          {sync.state === "update" && (
            <p className="status-line status-line--error">
              <Icon name="rotate-cw" />
              <span>{t("settings.sync.update", { place: sync.place })}</span>
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
                {t("settings.sync.problems.title")}
                {sync.problems.slice(0, 3).map((p) => (
                  <Fragment key={p}>
                    <br />
                    {p}
                  </Fragment>
                ))}
                {sync.problems.length > 3 && (
                  <>
                    <br />
                    {t("settings.sync.problems.more", { count: sync.problems.length - 3 })}
                  </>
                )}
                <br />
                {t("settings.sync.problems.restore", { place: sync.place })}
              </span>
            </p>
          )}
          {conflicts > 0 && (
            <p className="status-line">
              <Icon name="merge" />
              <span>{tx("settings.sync.conflicts", { count: conflicts }, { link: (text) => <Link to="/issues">{text}</Link> })}</span>
            </p>
          )}
          <div className="button-row">
            {sync.state !== "permission" && (
              <button type="button" className="btn btn--quiet btn--small" disabled={sync.state === "syncing"} onClick={() => void app.sync?.run()}>
                <Icon name="refresh-cw" />
                {t("settings.sync.now")}
              </button>
            )}
            {sync.mode === "private" && (
              <button type="button" className="btn btn--quiet btn--small" onClick={() => setMoving(true)}>
                {t("settings.storage.change")}
              </button>
            )}
          </div>
        </>
      )}
    </>
  );
}

/** myFR24's import page, where the file goes (Settings › Import there). */
const MYFR24_IMPORT = "https://my.flightradar24.com/settings/import";

/**
 * Where the language choice was on the screen when a new language reloaded the page: it opens with the choice in the
 * same place, so it can be changed back at once. The page above it may be taller or shorter in the new language.
 */
const RELOADED_AT = "touchdown.languageChoiceAt";

/** Read once a page load (React runs an effect twice in development), and dropped once the page is in place. */
let reloadedAt: { top: number; until: number } | null | undefined;
function takeReloadedAt() {
  if (reloadedAt === undefined) {
    let at: string | null = null;
    try {
      at = sessionStorage.getItem(RELOADED_AT);
      sessionStorage.removeItem(RELOADED_AT);
    } catch {
      // Storage blocked: the page opens at the top.
    }
    reloadedAt = at === null ? null : { top: Number(at), until: performance.now() + 3000 };
  }
  return reloadedAt;
}

/** A reference data source, named in the interface's language. The data keeps the English attribution. */
const SOURCES: [string, MessageKey][] = [
  ["OurAirports", "settings.reference.source.ourAirports"],
  ["airportsdata", "settings.reference.source.airportsData"],
  ["Mictronics", "settings.reference.source.mictronics"],
  ["Virtual Radar Server", "settings.reference.source.vrs"],
  ["Wikidata", "settings.reference.source.wikidata"],
  ["Touchdown", "settings.reference.source.touchdown"],
];
const sourceLabel = (source: string) => {
  const key = SOURCES.find(([name]) => source.startsWith(name))?.[1];
  return key ? t(key) : source;
};

export function SettingsPage() {
  const { app } = useApp();
  const languageChoice = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const at = takeReloadedAt();
    if (!at) return;
    // The page settles over its first seconds (the router's own scroll restoration, notes and parts that load after and
    // change the height above the choice): each frame until then the choice is put back in place, unless the reader
    // scrolls first.
    let frame = 0;
    const events = ["wheel", "touchstart", "keydown", "pointerdown"] as const;
    const stop = () => {
      cancelAnimationFrame(frame);
      events.forEach((e) => window.removeEventListener(e, done));
    };
    const done = () => {
      reloadedAt = null;
      stop();
    };
    const hold = () => {
      const choice = languageChoice.current;
      const off = choice ? choice.getBoundingClientRect().top - at.top : 0;
      if (Math.abs(off) > 1) window.scrollTo({ top: window.scrollY + off, behavior: "instant" });
      if (performance.now() < at.until) frame = requestAnimationFrame(hold);
      else done();
    };
    for (const e of events) window.addEventListener(e, done, { passive: true });
    frame = requestAnimationFrame(hold);
    return stop;
  }, []);
  const { store, ref } = app;
  const s = app.settings();
  const [includePrivate, setIncludePrivate] = useState(false);
  const [choosingFr24, setChoosingFr24] = useState(false);
  // The daily copies in the storage (docs/12, "Daily copies"): how many, the newest, and the dialog listing them.
  const syncState = useSyncInfo(app)?.state;
  const [copies, setCopies] = useState<{ count: number; latest: string | null } | null>(null);
  const [showCopies, setShowCopies] = useState<StorageCopies | null>(null);
  useEffect(() => {
    const c = app.sync?.copies();
    if (!c || syncState !== "synced") return;
    let live = true;
    c.list().then(
      (list) => live && setCopies({ count: list.length, latest: list[0]?.day ?? null }),
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [app, syncState]);
  const [sheet, setSheet] = useState<{ busy: boolean; made: MadeSheet | null }>({ busy: false, made: null });
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
  // The language and date format are kept in the log, for every device (docs/31-ui.md, "Language"). Pages drawn after
  // a new date format use it. A new language reloads the page, once the choice is saved in this browser's copy.
  const dateStyle: DateStyle = dateStyles().includes(s.dateFormat ?? "language") ? (s.dateFormat ?? "language") : "language";
  const language = s.language && s.language in LOCALES ? s.language : "browser";
  const chooseLanguage = async (v: string | null) => {
    const language = v && v !== "browser" ? v : null;
    set({ language });
    await app.flushNow();
    // Kept with the account too, for share links (docs/33); signed out or offline, the log has it.
    await account.setLanguage(language).catch(() => undefined);
    try {
      const choice = languageChoice.current;
      if (choice) sessionStorage.setItem(RELOADED_AT, String(Math.round(choice.getBoundingClientRect().top)));
    } catch {
      // Storage blocked: the page opens at the top after the reload.
    }
    location.reload();
  };
  const today = todayIn();
  const families = [...ref.families.values()].sort((a, b) => a.name.localeCompare(b.name));
  const overrides = store.all("family_overrides");

  const restore = async (data: Uint8Array) => {
    const back = readBackup(data);
    if (back.problems.length) {
      window.alert(t("settings.restore.problems", { problems: back.problems.slice(0, 8).join("\n") }));
      return;
    }
    const n = (back.tables.get("flights")?.length ?? 0) + (back.tables.get("sightings")?.length ?? 0);
    const synced = app.connection && app.connection.mode !== "local" ? "yes" : "no";
    if (!window.confirm(t("settings.restore.confirm", { count: n, synced }))) return;
    await app.replaceAll(back.tables);
    location.reload();
  };

  const fr24New = myFr24Flights(store, true).length;

  /** The tables as one Google Sheet in the user's Google Drive (docs/21, "Exports"). */
  const toGoogleSheets = async () => {
    setSheet({ busy: true, made: null });
    try {
      const tabs: [string, "flights" | "sightings" | "airframes"][] = [
        ["Flights", "flights"],
        ["Sightings", "sightings"],
        ["Aircraft", "airframes"],
      ];
      const workbook = writeXlsx(tabs.map(([name, t]) => ({ name, rows: tableRows(store, t, includePrivate) as XlsxCell[][] })));
      const made = await saveAsGoogleSheet(app.connection, `Touchdown ${todayIn()}`, workbook);
      setSheet({ busy: false, made });
      toast(t("settings.sheets.made", { name: made.name }));
    } catch (e) {
      setSheet({ busy: false, made: null });
      if (!(e instanceof SignInCancelled)) toast(t("settings.sheets.failed", { problem: (e as Error).message }));
    }
  };

  return (
    <div className="page">
      <div className="view-top" />
      <h1 className="form-title">{t("settings.title")}</h1>

      <AccountSection app={app} />

      <h2 className="form-section">{t("settings.display.title")}</h2>
      <div className="form-grid form-grid--choices">
        <Field label={t("settings.display.theme")}>
          <Segmented label={t("settings.display.theme")} value={s.theme ?? "system"} onChange={(v) => set({ theme: v ?? "system" })} options={[{ value: "system", label: t("settings.display.theme.system") }, { value: "light", label: t("settings.display.theme.light") }, { value: "dark", label: t("settings.display.theme.dark") }]} />
        </Field>
        {Object.keys(LOCALES).length > 1 && (
          <Field label={t("settings.display.language")}>
            <div ref={languageChoice}>
              <Select
                label={t("settings.display.language")}
                value={language}
                onChange={(v) => void chooseLanguage(v)}
                options={[{ value: "browser", label: t("settings.display.language.browser") }, ...Object.entries(LOCALES).map(([tag, l]) => ({ value: tag, label: l.name }))]}
              />
            </div>
          </Field>
        )}
        <Field label={t("settings.display.dates")}>
          <Segmented
            label={t("settings.display.dates")}
            value={dateStyle}
            onChange={(v) => set({ dateFormat: v && v !== "language" ? v : null })}
            options={dateStyles().map((style) => ({ value: style, label: dateOnly(today, { day: "numeric", month: "short", year: "numeric" }, style) }))}
          />
        </Field>
        <Field label={t("settings.display.distance")}>
          <Segmented label={t("settings.display.distance")} value={s.distanceUnit ?? "km"} onChange={(v) => set({ distanceUnit: v ?? "km" })} options={[{ value: "km", label: t("settings.display.distance.km") }, { value: "mi", label: t("settings.display.distance.mi") }, { value: "nm", label: t("settings.display.distance.nm") }]} />
        </Field>
        <Field label={t("settings.display.codes")}>
          <Segmented label={t("settings.display.codes.label")} value={s.codeDisplay ?? "iata"} onChange={(v) => set({ codeDisplay: v ?? "iata" })} options={[{ value: "iata", label: "IATA (LHR)" }, { value: "icao", label: "ICAO (EGLL)" }, { value: "both", label: t("settings.display.codes.both") }]} />
        </Field>
        <Field label={t("settings.display.models")}>
          <Segmented label={t("settings.display.models")} value={s.modelNaming ?? "standard"} onChange={(v) => set({ modelNaming: v ?? "standard" })} options={[{ value: "standard", label: "Boeing 777-322(ER)" }, { value: "compact", label: "B777-322ER" }]} />
        </Field>
      </div>

      <WhereTheLogLives app={app} />

      <h2 className="form-section">{t("settings.data.title")}</h2>
      <p className="status-line">
        <Icon name="hard-drive" />
        <span>
          {t("settings.data.holds", { copy: app.connection && app.connection.mode !== "local" ? "yes" : "no", flights: t("common.count.flights", { count: store.count("flights") }), sightings: t("common.count.sightings", { count: store.count("sightings") }), aircraft: t("common.count.aircraft", { count: store.count("airframes") }) })}
          {kept === true && `${sentenceGap()}${t("settings.data.kept")}`}
          {kept === false && `${sentenceGap()}${t("settings.data.mayClear")}`}
        </span>
      </p>
      {/* Each way to take the log out, or bring a backup in, is one item: its name, the options its buttons follow, then
          the buttons. The account card's look (DESIGN.md, "Settings → Account"). */}
      <ul className="account-card data-card">
        <li className="data-item">
          <span className="account-item__text">{t("settings.data.backup.title")}</span>
          <div className="data-item__actions">
            <button
              type="button"
              className="btn btn--quiet btn--small"
              onClick={() => {
                download(`touchdown-backup-${todayIn()}.zip`, backupZip(store) as BlobPart, "application/zip");
                app.markBackup();
              }}
            >
              <Icon name="download" />
              {t("settings.data.export")}
            </button>
            <label className="btn btn--quiet btn--small">
              <Icon name="upload" />
              {t("settings.data.restore")}
              <input
                type="file"
                accept=".zip,application/zip"
                className="visually-hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void f.arrayBuffer().then((b) => restore(new Uint8Array(b)));
                  e.target.value = "";
                }}
              />
            </label>
            {app.sync?.copies() && (
              <>
                <button type="button" className="btn btn--quiet btn--small" onClick={() => setShowCopies(app.sync?.copies() ?? null)}>
                  <Icon name="clock" />
                  {t("settings.copies.button")}
                </button>
                {copies && <span className="data-item__state">{t("settings.copies.state", { count: copies.count, place: app.sync.info.place, latest: copies.latest ? dayMonthYear(copies.latest) : "" })}</span>}
              </>
            )}
            {showCopies && (
              <CopiesDialog
                copies={showCopies}
                place={app.sync?.info.place ?? ""}
                onRestore={(data) => {
                  setShowCopies(null);
                  void restore(data);
                }}
                onClose={() => setShowCopies(null)}
              />
            )}
            {import.meta.env.DEV && (
              <button
                type="button"
                className="btn btn--quiet btn--small"
                onClick={async () => {
                  if (!window.confirm(t("settings.dev.loadConfirm"))) return;
                  if (import.meta.env.DEV && !(await (await import("../data/localBackup.ts")).loadLocalBackup(app))) toast(t("settings.dev.noBackup"));
                }}
              >
                <Icon name="hard-drive" />
                {t("settings.dev.load")}
              </button>
            )}
          </div>
        </li>
        <li className="data-item">
          <span className="account-item__text">{t("settings.data.tables.title")}</span>
          <label className="check">
            <input type="checkbox" checked={includePrivate} onChange={(e) => setIncludePrivate(e.target.checked)} />
            {t("settings.data.includePrivate")}
          </label>
          <div className="data-item__actions">
            {(["flights", "sightings", "airframes"] as const).map((table) => (
              <button key={table} type="button" className="btn btn--quiet btn--small" onClick={() => download(`touchdown-${table}-${todayIn()}.csv`, tableCsv(store, table, includePrivate), "text/csv")}>
                <Icon name="file" />
                {t("settings.data.csv", { table })}
              </button>
            ))}
            <button type="button" className="btn btn--quiet btn--small" disabled={sheet.busy} onClick={() => void toGoogleSheets()}>
              <Icon name={sheet.busy ? "loader-circle" : "table"} />
              {sheet.busy ? t("settings.sheets.making") : t("settings.sheets.button")}
            </button>
            {sheet.made && (
              <a className="link-btn" href={sheet.made.url} target="_blank" rel="noopener">
                {t("settings.sheets.open", { name: sheet.made.name })}
                <Icon name="external-link" />
              </a>
            )}
          </div>
        </li>
        <li className="data-item">
          <span className="account-item__text">
            <span>
              {tx("settings.myfr24.title", {}, {
                link: (text) => (
                  <a href={MYFR24_IMPORT} target="_blank" rel="noopener">
                    {text}
                    <Icon name="external-link" />
                  </a>
                ),
              })}
            </span>
          </span>
          <div className="data-item__actions">
            <button type="button" className="btn btn--quiet btn--small" disabled={!store.count("flights")} onClick={() => setChoosingFr24(true)}>
              <Icon name="list-checks" />
              {t("settings.myfr24.choose")}
            </button>
            <span className="data-item__state">{t("settings.myfr24.notYet", { count: fr24New })}</span>
          </div>
          {choosingFr24 && <MyFr24Dialog onClose={() => setChoosingFr24(false)} />}
        </li>
      </ul>
      <div className="button-row">
        <button
          type="button"
          className="btn btn--danger btn--small"
          onClick={async () => {
            const place = app.connection && app.connection.mode !== "local" ? placeName(app.connection) : null;
            if (!window.confirm(t("settings.delete.confirm", { synced: place !== null ? "yes" : "no", place: place ?? "" }))) return;
            const word = t("settings.delete.word");
            if (window.prompt(t("settings.delete.type", { word })) !== word) return;
            await app.deleteEverything();
            location.reload();
          }}
        >
          <Icon name="trash" />
          {t("settings.delete.button")}
        </button>
      </div>

      <h2 className="form-section">{t("settings.families.title")}</h2>
      <p className="form-sub">{t("settings.families.intro")}</p>
      {overrides.length > 0 && (
        <ul className="rows overrides">
          {overrides.map((o) => (
            <li key={o.id} className="history-row">
              <span>
                <b>{o.designator}</b>
                <small>{t("settings.families.in", { family: familyName(o.familyId, ref) })}</small>
              </span>
              <button
                type="button"
                className="btn btn--quiet btn--small"
                onClick={() => app.setFamily(o.designator!, null)}
              >
                {t("common.remove")}
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
            toast(ref.type(d) ? t("settings.families.choose") : t("settings.families.notType", { code: d }));
            return;
          }
          app.setFamily(d, family);
          setDesignator("");
        }}
      >
        <Field label={t("settings.families.typeCode")}>
          <TextInput value={designator} onChange={(e) => setDesignator(e.target.value)} placeholder="E170" />
        </Field>
        <Field label={t("settings.families.family")}>
          <Select label={t("settings.families.family")} value={family} onChange={setFamily} options={[{ value: "", label: t("settings.families.none") }, ...families.map((f) => ({ value: f.id, label: f.name }))]} />
        </Field>
        <button type="submit" className="btn btn--quiet btn--small">
          {t("common.add")}
        </button>
      </form>


      <h2 className="form-section">{t("settings.reference.title")}</h2>
      <p className="form-sub">{t("settings.reference.intro", { built: refVersion ? "yes" : "no", version: refVersion })}</p>
      <ul className="sources">
        {sources.map((x) => (
          <li key={x}>{sourceLabel(x)}</li>
        ))}
        <li>{t("settings.reference.credits")}</li>
      </ul>
    </div>
  );
}

/** In Standard mode: how many links are shared, and the way to them (docs/32, "Settings in Standard mode"). */
function SharedLinksLine() {
  const list = useShares(true);
  return (
    <p className="status-line">
      <Icon name="link" />
      <span>{list ? tx("settings.shares.line", { count: list.links.length }, { link: (text) => <Link to="/shares">{text}</Link> }) : tx("settings.shares.lineLoading", {}, { link: (text) => <Link to="/shares">{text}</Link> })}</span>
    </p>
  );
}
