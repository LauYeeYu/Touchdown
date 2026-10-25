// Data shaped for the pages, derived from the stored rows. The functions are in the core package
// (@touchdown/core/view), shared with the CLI; here flights carry their codes as the user chose them.

import type { Flight, RefIndex, Store } from "@touchdown/core";
import { sortedFlights as sorted, viewFlight as view, type FlightView } from "@touchdown/core/view";
import { codeStyle } from "./codes.ts";

export { aircraftViews, flownAndPhotographed, sessionsOf, type AircraftView, type BothEntry, type FlightView, type Session } from "@touchdown/core/view";

export const viewFlight = (f: Flight, ref: RefIndex): FlightView => view(f, ref, codeStyle());

/** Flights in time order (by takeoff instant where known, else flight day). */
export const sortedFlights = (store: Store, ref: RefIndex): FlightView[] => sorted(store, ref, codeStyle());
