import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { createRootRoute, createRoute, createRouter, RouterProvider } from "@tanstack/react-router";
import "./styles/app.css";
import { AppData } from "./data/app.ts";
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
import { MapPage } from "./pages/MapPage.tsx";
import { GlobePage } from "./pages/GlobePage.tsx";
import { AirportPage } from "./pages/AirportPage.tsx";
import { ImportPage } from "./pages/ImportPage.tsx";
import { Issues } from "./pages/Issues.tsx";
import { SettingsPage } from "./pages/SettingsPage.tsx";
import { NotFound } from "./pages/NotFound.tsx";
import { airportParams, slugParams, setSlugData } from "./lib/slugs.ts";

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
const map = createRoute({ getParentRoute: () => root, path: "/map", component: MapPage });
const airport = createRoute({ getParentRoute: () => root, path: "/airports/$id", component: AirportPage, params: airportParams });
const globeR = createRoute({ getParentRoute: () => root, path: "/globe", component: GlobePage });
const importR = createRoute({ getParentRoute: () => root, path: "/import", component: ImportPage });
const issues = createRoute({ getParentRoute: () => root, path: "/issues", component: Issues });
const settings = createRoute({ getParentRoute: () => root, path: "/settings", component: SettingsPage });

const routeTree = root.addChildren([home, flights, flightNew, flight, flightEdit, spotting, sightingNew, session, sightingEdit, aircraft, aircraftOne, airport, stats, map, globeR, importR, issues, settings]);

const router = createRouter({ routeTree, defaultPreload: false, scrollRestoration: false });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

function App() {
  const [app, setApp] = useState<AppData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  useEffect(() => {
    (async () => {
      const opened = await AppData.open();
      if (import.meta.env.DEV) {
        const m = await import("./data/localBackup.ts");
        if (await m.loadLocalBackupOnce(opened, () => setNote("Loading your local data…"))) return;
        if (await m.loadLocalBackupOnHardReload(opened, () => setNote("Hard refresh: loading your local data again…"))) return;
      }
      setSlugData(opened);
      setApp(opened);
    })().catch((e: Error) => setError(e.message));
  }, []);
  if (error) {
    return (
      <div className="page boot">
        <h1 className="lead">Touchdown could not open its local data.</h1>
        <p className="recent__line">{error}</p>
      </div>
    );
  }
  if (!app) {
    return (
      <div className="page boot" aria-busy="true">
        <p className="recent__line">{note ?? "Opening your log…"}</p>
      </div>
    );
  }
  return (
    <AppContext.Provider value={app}>
      <RouterProvider router={router} />
    </AppContext.Provider>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
