// The share page's routes (docs/32-modes-and-sharing.md, "The public page"): the app's own pages at the app's own
// addresses, after a # so the server sees only /p/<id> (/p/<id>#/flights/2025-03-14T0830-LHR-CDG). A whole-log link
// has every page that reads the log; a flight, sighting or aircraft link only its record's, and its first page is the
// record's. Links to a page the link does not show are plain text (lib/link.tsx).

import { createHashHistory, createRootRoute, createRoute, createRouter, redirect } from "@tanstack/react-router";
import type { TableName } from "@touchdown/core";
import type { LinkScope } from "../lib/link.tsx";
import { airportParams, slugParams } from "../lib/slugs.ts";
import { Home } from "../pages/Home.tsx";
import { Flights } from "../pages/Flights.tsx";
import { FlightDetail } from "../pages/FlightDetail.tsx";
import { Spotting } from "../pages/Spotting.tsx";
import { AircraftList } from "../pages/AircraftList.tsx";
import { AircraftDetail } from "../pages/AircraftDetail.tsx";
import { AirportPage } from "../pages/AirportPage.tsx";
import { Stats } from "../pages/Stats.tsx";
import { NotFound } from "../pages/NotFound.tsx";
import type { ShareData } from "./data.ts";
import { ShareShell } from "./Shell.tsx";
import { SightingView } from "./SightingView.tsx";

const SIGHTING = ["/spotting/$id", "/spotting/$id/edit"];

/** The pages a link shows, for its links: null for a whole log, which shows them all. */
export function scopeOf(data: ShareData): LinkScope | null {
  const { kind, subject } = data.content;
  if (kind === "log") return null;
  const has = (t: TableName, id: string | undefined) => !!id && !!data.store.get(t, id);
  return (to, params) => {
    const id = params?.id;
    if (to === "/") return true;
    if (kind === "flight") return to === "/flights/$id" && id === subject;
    if (kind === "sighting") return SIGHTING.includes(to) && id === subject;
    return (to === "/aircraft/$id" && id === subject) || (to === "/flights/$id" && has("flights", id)) || (SIGHTING.includes(to) && has("sightings", id));
  };
}

export function shareRouter(data: ShareData) {
  const { kind, subject } = data.content;
  const log = kind === "log";
  const root = createRootRoute({ component: ShareShell, notFoundComponent: () => <NotFound what="This page is not part of the link." /> });
  // The routes are not the app's registered ones, so their targets are given as plain values.
  const go = (to: string, id?: string | null) => redirect({ to, params: id ? { id } : undefined, replace: true } as never);
  const page = kind === "flight" ? "/flights/$id" : kind === "sighting" ? "/spotting/$id" : kind === "aircraft" ? "/aircraft/$id" : null;

  const home = createRoute({ getParentRoute: () => root, path: "/", component: Home, beforeLoad: page ? () => { throw go(page, subject); } : undefined });
  const flight = createRoute({ getParentRoute: () => root, path: "/flights/$id", component: FlightDetail, params: slugParams("flights") });
  const sighting = createRoute({ getParentRoute: () => root, path: "/spotting/$id", component: SightingView, params: slugParams("sightings") });
  // The app's pages link a sighting to its form; on a link it opens the sighting's page.
  const sightingForm = createRoute({ getParentRoute: () => root, path: "/spotting/$id/edit", params: slugParams("sightings"), beforeLoad: ({ params }) => { throw go("/spotting/$id", (params as { id: string }).id); } });
  const aircraftOne = createRoute({ getParentRoute: () => root, path: "/aircraft/$id", component: AircraftDetail, params: slugParams("aircraft") });
  const whole = log
    ? [
        createRoute({ getParentRoute: () => root, path: "/flights", component: Flights }),
        createRoute({ getParentRoute: () => root, path: "/spotting", component: Spotting }),
        createRoute({ getParentRoute: () => root, path: "/aircraft", component: AircraftList }),
        createRoute({ getParentRoute: () => root, path: "/airports/$id", component: AirportPage, params: airportParams }),
        createRoute({ getParentRoute: () => root, path: "/stats", component: Stats }),
      ]
    : [];
  const own = kind === "flight" ? [flight] : kind === "sighting" ? [sighting, sightingForm] : [flight, sighting, sightingForm, aircraftOne];
  const routeTree = root.addChildren(log ? [home, flight, sighting, sightingForm, aircraftOne, ...whole] : [home, ...own]);
  return createRouter({ routeTree, history: createHashHistory(), defaultPreload: false, scrollRestoration: true });
}
