import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { createRootRoute, createRoute, createRouter, redirect, RouterProvider } from "@tanstack/react-router";
import "./styles/app.css";
import { AppData, type OpenStep } from "./data/app.ts";
import { lastAccount, whoAmI } from "./data/account.ts";
import { openAccountDb } from "./data/db.ts";
import { standardConnection } from "./data/connection.ts";
import { standard } from "./data/standard.ts";
import { Boot, BootError, waitingProgress } from "./components/Boot.tsx";
import { nf } from "./lib/format.ts";
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
import { FirstRun } from "./pages/FirstRun.tsx";
import { CliPage } from "./pages/CliPage.tsx";
import { NotFound } from "./pages/NotFound.tsx";
import { airportParams, slugParams, setSlugData } from "./lib/slugs.ts";
import { setCodeStyle } from "./lib/codes.ts";
import { toUtcIso, validateWithoutEval } from "@touchdown/core";

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

const routeTree = root.addChildren([home, flights, flightNew, flight, flightEdit, spotting, sightingNew, session, sightingEdit, aircraft, aircraftOne, airport, stats, map, globeR, importR, issues, settings]);

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

/** Follows the account's Standard connection; `connecting` is called before the first sync, which can take a while. */
async function followStandard(app: AppData, connecting: () => void) {
  const params = new URLSearchParams(location.search);
  const back = params.get("storage") === "connected";
  if (back) {
    params.delete("storage");
    history.replaceState(history.state, "", location.pathname + (params.size ? `?${params}` : "") + location.hash);
  }
  const c = app.connection;
  if (c?.mode === "standard") return;
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
        ? "Reading your log and the reference data…"
        : pending.has("log")
          ? "Reading your log…"
          : pending.has("reference")
            ? "Loading airports, airlines and aircraft types…"
            : `Preparing ${nf.format(records)} records…`;
    report({ at, text: text() });
    // A step with no measure of its own (asking the server, the first sync of a log from Google Drive) moves the bar
    // slowly towards `to`, so it never stands still. Returns the function that stops it.
    const creep = (to: number, t: string) => {
      report({ at, text: t });
      const timer = setInterval(() => report({ at: (at += (to - at) * 0.06), text: t }), 300);
      return () => clearInterval(timer);
    };
    // Whose log to open (docs/33): each account has its own copy in the browser.
    const checked = creep(START + 0.04, "Checking your account…");
    const me = await whoAmI();
    checked();
    if (me === "signed-out" && !import.meta.env.DEV) {
      location.assign(`/signin?next=${encodeURIComponent(location.pathname + location.search)}`);
      return new Promise<AppData>(() => {});
    }
    openAccountDb(typeof me === "object" ? me.id : me === "offline" ? lastAccount() : null);
    let opened = await AppData.open((step, n) => {
      pending.delete(step);
      if (n !== undefined) records = n;
      at += SHARE[step];
      report({ at, text: text() });
    });
    if (import.meta.env.DEV) {
      const m = await import("./data/localBackup.ts");
      const step = (t: string) => report({ at: (at = Math.min(PREPARED, at + 0.04)), text: t });
      const hard = (t: string) => step(`Hard refresh. ${t}`);
      if ((await m.loadLocalBackupOnce(opened, step)) || (await m.loadLocalBackupOnHardReload(opened, hard))) {
        // The browser now holds the backup: read it in, carrying the same bar on rather than reloading.
        opened = await AppData.open((s, n) => s === "log" && n !== undefined && step(`Preparing ${nf.format(n)} records…`));
      }
    }
    // Standard (docs/32): back from connecting Google Drive, or a browser that has not chosen yet, or one syncing the
    // same Google Drive in Private, follows the account's Standard connection by itself.
    let stopCreep = () => {};
    if (typeof me === "object") await followStandard(opened, () => (stopCreep = creep(PREPARED - 0.02, "Reading your log from Google Drive…")));
    stopCreep();
    // A browser that held a log before the data modes existed keeps it here: Local (docs/32).
    if (!opened.connection && (opened.store.count("flights") || opened.store.count("sightings"))) await opened.connect({ mode: "local", since: toUtcIso(Date.now()) });
    // Private mode syncs in the background; the page shows the copy in this browser meanwhile.
    void opened.startSync();
    report({ at: PREPARED, text: "Showing your log…" });
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

// How long the finished bar stays before the loading screen goes: the fill, then the fade (boot.css).
const FINISH_MS = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 300;

function App() {
  const [app, setApp] = useState<AppData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<Progress>({ at: START, text: "Loading the app…" });
  const [finished, setFinished] = useState(false);
  // Asked once per browser, before the app opens: where the log lives.
  const [firstRun, setFirstRun] = useState(false);
  useEffect(() => {
    boot(setProgress)
      .then((a) => {
        setFirstRun(!a.connection);
        setApp(a);
      })
      .catch((e: Error) => setError(e.message));
  }, []);
  useEffect(() => {
    if (!app) return;
    const t = setTimeout(() => setFinished(true), FINISH_MS);
    return () => clearTimeout(t);
  }, [app]);
  if (error) return <BootError message={error} />;
  // The first page renders under the loading screen while the bar fills and the screen fades.
  return (
    <>
      {app && (
        <AppContext.Provider value={app}>
          {firstRun ? <FirstRun app={app} onDone={() => setFirstRun(false)} /> : <RouterProvider router={router} />}
        </AppContext.Provider>
      )}
      {!finished && <Boot progress={app ? 1 : progress.at} text={app ? "Ready" : progress.text} done={!!app} />}
    </>
  );
}

// The command line's pages stand on their own: they do not open the log (pages/CliPage.tsx).
createRoot(document.getElementById("root")!).render(<StrictMode>{location.pathname.startsWith("/cli/") ? <CliPage /> : <App />}</StrictMode>);
