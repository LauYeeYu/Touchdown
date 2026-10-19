// The airframe lookup sources (docs/13-reference-data.md, "Airframe facts").

import type { RefIndex } from "@touchdown/core";
import type { Provider } from "../airframes.ts";
import { openSkyProvider } from "./opensky.ts";
import { fr24Provider, type Fr24Options } from "./fr24.ts";

export const PROVIDER_IDS = ["opensky", "fr24"] as const;

/** The sources in the order they are tried. Flightradar24 only when the user asks for it (--fr24). */
export function providers(ref: RefIndex, log: (l: string) => void, fr24: Fr24Options | null): Provider[] {
  return [openSkyProvider(ref, log), ...(fr24 ? [fr24Provider(ref, fr24)] : [])];
}
