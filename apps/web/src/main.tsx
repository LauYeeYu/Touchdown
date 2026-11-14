import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { createRootRoute, createRoute, createRouter, redirect, RouterProvider } from "@tanstack/react-router";
import "./styles/app.css";
import { AppData, type OpenStep } from "./data/app.ts";
import { account, lastAccount, whoAmI } from "./data/account.ts";
import { db, openAccountDb } from "./data/db.ts";
import { tabsFor } from "./data/tabs.ts";
import { standardConnection } from "./data/connection.ts";
import { standard } from "./data/standard.ts";
import { forgetOffline, keepOffline } from "./data/offline.ts";
import { Boot, BootError, OfflineWithoutAccount, waitingProgress } from "./components/Boot.tsx";
import { AppContext } from "./data/context.tsx";
import { Shell } from "./components/Shell.tsx";
import { Home } from "./pages/Home.tsx";
import { Flights } from "./pages/Flights.tsx";
import { FlightDetail } from "./pages/FlightDetail.tsx";
import { FlightForm } from "./pages/FlightForm.tsx";
import { Spotting } from "./pages/Spotting.tsx";
import { SightingForm } from "./pages/SightingForm.tsx";
import { SessionAdd } from "./pages/SessionAdd.tsx";
import { AircraftList } from "./pages/AircraftList.tsx";
import { AircraftDetail } from "./pages/AircraftDetail.tsx";
import { Stats } from "./pages/Stats.tsx";
import { AirportPage } from "./pages/AirportPage.tsx";
import { ImportPage } from "./pages/ImportPage.tsx";
import { Issues } from "./pages/Issues.tsx";
import { SettingsPage } from "./pages/SettingsPage.tsx";
import { SharedLinks } from "./pages/SharedLinks.tsx";
import { Types } from "./pages/Types.tsx";
import { TypePage } from "./pages/TypePage.tsx";
import { TypeCompare } from "./pages/TypeCompare.tsx";
import { TypeManufacturer } from "./pages/TypeManufacturer.tsx";
import { TypeFamily } from "./pages/TypeFamily.tsx";
import { FirstRun } from "./pages/FirstRun.tsx";
import { CliPage } from "./pages/CliPage.tsx";
import { Guide } from "./pages/Guide.tsx";
import { NotFound } from "./pages/NotFound.tsx";
import { airportParams, slugParams, setSlugData } from "./lib/slugs.ts";
import { setCodeStyle } from "./lib/codes.ts";
import { showRefNames, toUtcIso, validateWithoutEval } from "@touchdown/core";
import { locale, t } from "@touchdown/i18n";
import { loadRefNames } from "@touchdown/refdata/names";
import { followLog, startLanguage } from "./lib/i18n.tsx";

// The hosted site's security policy forbids eval (docs/30).
validateWithoutEval();

const root = createRootRoute({ component: Shell, notFoundComponent: () => <NotFound /> });

const home = createRoute({ getParentRoute: () => root, path: "/", component: Home });
const flights = createRoute({ getParentRoute: () => root, path: "/flights", component: Flights });
const flightNew = createRoute({ getParentRoute: () => root, path: "/flights/new", component: () => <FlightForm /> });
const flight = createRoute({ getParentRoute: () => root, path: "/flights/$id", component: FlightDetail, params: slugParams("flights") });
const flightEdit = createRoute({ getParentRoute: () => root, path: "/flights/$id/edit", component: () => <FlightForm edit />, params: slugParams("flights") });
const spotting = createRoute({ getParentRoute: () => root, path: "/spotting", component: Spotting });
const sightingNew = createRoute({ getParentRoute: () => root, path: "/spotting/new", component: () => <SightingForm /> });
const session = createRoute({ getParentRoute: () => root, path: "/spotting/session", component: SessionAdd });
const sightingEdit = createRoute({ getParentRoute: () => root, path: "/spotting/$id/edit", component: () => <SightingForm edit />, params: slugParams("sightings") });
const aircraft = createRoute({ getParentRoute: () => root, path: "/aircraft", component: AircraftList });
const aircraftOne = createRoute({ getParentRoute: () => root, path: "/aircraft/$id", component: AircraftDetail, params: slugParams("aircraft") });
const stats = createRoute({ getParentRoute: () => root, path: "/stats", component: Stats });
// The map and the globe once had pages of their own; the globe now heads Statistics.
const map = createRoute({ getParentRoute: () => root, path: "/map", beforeLoad: () => { throw redirect({ to: "/stats", replace: true }); } });
const airport = createRoute({ getParentRoute: () => root, path: "/airports/$id", component: AirportPage, params: airportParams });
const globeR = createRoute({ getParentRoute: () => root, path: "/globe", beforeLoad: () => { throw redirect({ to: "/stats", replace: true }); } });
// ?inbox= opens a spotting session waiting in the inbox (src/data/inbox.ts).
const importR = createRoute({ getParentRoute: () => root, path: "/import", component: ImportPage, validateSearch: (s: Record<string, unknown>): { inbox?: string } => (typeof s.inbox === "string" ? { inbox: s.inbox } : {}) });
const issues = createRoute({ getParentRoute: () => root, path: "/issues", component: Issues });
const settings = createRoute({ getParentRoute: () => root, path: "/settings", component: SettingsPage });
const sharedLinks = createRoute({ getParentRoute: () => root, path: "/shares", component: SharedLinks });
// Aircraft types, from the More menu (docs/31, "Aircraft types"): the list, a type's page by its code, a manufacturer's
// and a family's pages, and Compare.
const types = createRoute({ getParentRoute: () => root, path: "/types", component: Types });
const typeOne = createRoute({ getParentRoute: () => root, path: "/types/$code", component: TypePage });
const typeMaker = createRoute({ getParentRoute: () => root, path: "/types/manufacturers/$manufacturer", component: TypeManufacturer });
const typeFamily = createRoute({ getParentRoute: () => root, path: "/types/families/$family", component: TypeFamily });
const typeCompare = createRoute({
  getParentRoute: () => root,
  path: "/types/compare",
  component: TypeCompare,
  validateSearch: (s: Record<string, unknown>): { a?: string; b?: string } => ({ ...(typeof s.a === "string" ? { a: s.a } : {}), ...(typeof s.b === "string" ? { b: s.b } : {}) }),
});
const guide = createRoute({ getParentRoute: () => root, path: "/guide", component: Guide });

const routeTree = root.addChildren([home, flights, flightNew, flight, flightEdit, spotting, sightingNew, session, sightingEdit, aircraft, aircraftOne, airport, stats, map, globeR, importR, issues, settings, sharedLinks, types, typeCompare, typeMaker, typeFamily, typeOne, guide]);

// Back returns to where the page was scrolled; a new page starts at the top.
const router = createRouter({ routeTree, defaultPreload: false, scrollRestoration: true });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

// Opens the data once per page load. React's development mode runs effects twice; without this the data was
// read twice and the local backup could be loaded twice.
let booting: Promise<AppData> | null = null;

/**
 * Follows the account's Standard connection; `connecting` is called before the first sync, which can take a while. A
 * tab that does not write the copy follows only when it comes back from connecting; the writing tab does the rest.
 */
async function followStandard(app: AppData, writer: boolean, connecting: () => void) {
  const params = new URLSearchParams(location.search);
  const back = params.get("storage") === "connected";
  if (back) {
    params.delete("storage");
    history.replaceState(history.state, "", location.pathname + (params.size ? `?${params}` : "") + location.hash);
  }
  const c = app.connection;
  if (c?.mode === "standard" || (!writer && !back)) return;
  if (!back && c && !(c.mode === "private" && c.adapter === "gdrive")) return;
  const st = await standard.status().catch(() => null);
  if (!st?.connected || !st.account || st.status !== "ok") return;
  if (!back && c?.mode === "private" && c.adapter === "gdrive" && c.account !== st.account) return;
  connecting();
  await app.connect(standardConnection(st.account, toUtcIso(Date.now())));
}

/** Where the loading bar is (0 to 1) and what is being done. */
interface Progress {
  at: number;
  text: string;
}

// One bar from 0 to 100%: the page's own bar creeps towards 30% while the code loads (public/boot.css), each
// step of opening the log moves it on, and it fills when the first page is ready.
const SHARE: Record<OpenStep, number> = { reference: 0.15, log: 0.3 };
const PREPARED = 0.9;
// Read before React replaces the page's own bar, so the bar never steps back.
const START = Math.max(0.3, waitingProgress());

function boot(report: (p: Progress) => void): Promise<AppData> {
  booting ??= (async () => {
    let at = START;
    const pending = new Set<OpenStep>(["reference", "log"]);
    let records = 0;
    const text = () =>
      pending.size === 2
        ? t("shell.opening.both")
        : pending.has("log")
          ? t("shell.opening.log")
          : pending.has("reference")
            ? t("shell.opening.reference")
            : t("shell.opening.preparing", { count: records });
    report({ at, text: text() });
    // A step with no measure of its own (asking the server, the first sync of a log from Google Drive) moves the bar
    // slowly towards `to`, so it never stands still. Returns the function that stops it.
    const creep = (to: number, text: string) => {
      report({ at, text });
      const timer = setInterval(() => report({ at: (at += (to - at) * 0.06), text }), 300);
      return () => clearInterval(timer);
    };
    // Whose log to open (docs/33): each account has its own copy in the browser.
    const checked = creep(START + 0.04, t("shell.opening.account"));
    const me = await whoAmI();
    checked();
    if (me === "signed-out" && !import.meta.env.DEV) {
      // The session ended (signed out elsewhere, or expired): the offline copy goes too, so the log does not open
      // without signing in again.
      await forgetOffline();
      location.assign(`/signin?next=${encodeURIComponent(location.pathname + location.search)}`);
      return new Promise<AppData>(() => {});
    }
    // Offline, the app opens the log of the account last signed in here (docs/30, "Offline"), and none without one.
    const offlineAccount = me === "offline" ? lastAccount() : null;
    if (me === "offline" && !offlineAccount && !import.meta.env.DEV) throw new OfflineWithoutAccount();
    openAccountDb(typeof me === "object" ? me.id : offlineAccount);
    // Signed in online: keep the app's files for the next time it opens offline.
    if (typeof me === "object") keepOffline();
    // Tabs share the browser's copy (docs/12, "Tabs"): one writes it and syncs, the others follow it.
    const tabs = tabsFor(db.name);
    const writer = (await tabs.open()) === "writer";
    let opened = await AppData.open(tabs, (step, n) => {
      pending.delete(step);
      if (n !== undefined) records = n;
      at += SHARE[step];
      report({ at, text: text() });
    });
    if (import.meta.env.DEV && writer) {
      const m = await import("./data/localBackup.ts");
      const step = (text: string) => report({ at: (at = Math.min(PREPARED, at + 0.04)), text });
      const hard = (text: string) => step(t("shell.opening.hardRefresh", { step: text }));
      if ((await m.loadLocalBackupOnce(opened, step)) || (await m.loadLocalBackupOnHardReload(opened, hard))) {
        // The browser now holds the backup: read it in, carrying the same bar on rather than reloading.
        opened = await AppData.open(tabs, (s, n) => s === "log" && n !== undefined && step(t("shell.opening.preparing", { count: n })));
      }
    }
    const where = () => (opened.connection?.mode !== "local" && opened.connection?.adapter === "localfs" ? opened.connection.name : t("data.googleDrive"));
    // Standard (docs/32): back from connecting Google Drive, or a browser that has not chosen yet, or one syncing the
    // same Google Drive in Private, follows the account's Standard connection by itself.
    let stopCreep = () => {};
    if (typeof me === "object") await followStandard(opened, writer, () => (stopCreep = creep(PREPARED - 0.02, t("shell.opening.from", { place: t("data.googleDrive") }))));
    stopCreep();
    // A browser that held a log before the data modes existed keeps it here: Local (docs/32).
    if (writer && !opened.connection && (opened.store.count("flights") || opened.store.count("sightings"))) await opened.connect({ mode: "local", since: toUtcIso(Date.now()) });
    // Sync runs in the background and the page shows the copy in this browser, once the copy has the storage's tables:
    // until then (a new browser, or a first download cut short by a reload) the loading screen waits for them. Tracks
    // come after, in the background.
    const syncing = opened.startSync();
    if (await opened.tablesMissing()) {
      const stop = creep(PREPARED - 0.02, t("shell.opening.from", { place: where() }));
      await syncing;
      stop();
    }
    if (writer) void opened.takeOutbox();
    // Development only: the open log, for trying things in the console.
    if (import.meta.env.DEV) Object.assign(window, { touchdown: opened });
    // The log's language and date format, before the first page is drawn, and as they change (lib/i18n.tsx).
    const choice = () => ({ language: opened.settings().language, dateFormat: opened.settings().dateFormat });
    let followed = JSON.stringify(choice());
    await followLog(choice(), true);
    // The account keeps the log's language too, so a share link opens in it in any browser the user is signed in on
    // (docs/33). It is told when it differs: at opening, and when a choice made on another device arrives.
    let told = typeof me === "object" ? (me.language ?? null) : undefined;
    const tellAccount = () => {
      const language = opened.settings().language ?? null;
      if (told === undefined || language === told) return;
      told = language;
      void account.setLanguage(language).catch(() => (told = null));
    };
    tellAccount();
    // Airports', places' and airlines' names in that language too (docs/13, "Names in other languages").
    // Names that cannot be loaded (an old cached app, a network error) leave the data's own: the app still opens.
    showRefNames(await loadRefNames(locale()).catch(() => null));
    opened.subscribe(() => {
      const now = JSON.stringify(choice());
      if (now !== followed) {
        void followLog(choice());
        tellAccount();
      }
      followed = now;
    });
    report({ at: PREPARED, text: t("shell.opening.showing") });
    setSlugData(opened);
    // Airport codes follow the setting on every page (lib/codes.ts).
    setCodeStyle(opened.settings().codeDisplay);
    opened.subscribe(() => setCodeStyle(opened.settings().codeDisplay));
    // Ask the browser to keep the log when the disk runs low (docs/12, "Local store"). Chrome decides without
    // asking the user; Firefox asks once.
    if (opened.store.count("flights") || opened.store.count("sightings")) {
      void navigator.storage
        ?.persisted?.()
        .then((kept) => kept || navigator.storage.persist())
        .catch(() => false);
    }
    return opened;
  })();
  return booting;
}

function App() {
  const [app, setApp] = useState<AppData | null>(null);
  const [error, setError] = useState<{ title?: string; message: string } | null>(null);
  const [progress, setProgress] = useState<Progress>(() => ({ at: START, text: t("shell.opening.app") }));
  const [finished, setFinished] = useState(false);
  // Asked once per browser, before the app opens: where the log lives.
  const [firstRun, setFirstRun] = useState(false);
  useEffect(() => {
    boot(setProgress)
      .then((a) => {
        setFirstRun(!a.connection);
        setApp(a);
      })
      .catch((e: Error) => setError(e instanceof OfflineWithoutAccount ? { title: t("shell.opening.offline"), message: e.message } : { message: e.message }));
  }, []);
  if (error) return <BootError message={error.message} title={error.title} />;
  // The first page renders under the loading screen while the bar fills and the screen fades.
  return (
    <>
      {app && (
        <AppContext.Provider value={app}>
          {firstRun ? <FirstRun app={app} onDone={() => setFirstRun(false)} /> : <RouterProvider router={router} />}
        </AppContext.Provider>
      )}
      {!finished && <Boot progress={app ? 1 : progress.at} text={app ? t("shell.opening.ready") : progress.text} done={!!app} onGone={() => setFinished(true)} />}
    </>
  );
}

// The command line's pages stand on their own: they do not open the log (pages/CliPage.tsx).
void startLanguage().then(() => createRoot(document.getElementById("root")!).render(<StrictMode>{location.pathname.startsWith("/cli/") ? <CliPage /> : <App />}</StrictMode>));
