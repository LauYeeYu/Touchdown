// The manufacturers the aircraft types pages show as cards (docs/31, "Aircraft types"), by their addresses (`slugOf`),
// in alphabetical order: the best known of each role, of those with types drawn with their family's shape or their own,
// and the airliners' for every role. Other aircraft have too few such types for cards. The factory stamps go by the
// list for every role (docs/24-statistics.md, "Factory airfields").

import type { TypeRole } from "./types.ts";

const AIRLINER_MAKERS = ["aerospatiale-bac", "airbus", "boeing", "bombardier", "comac", "embraer", "ilyushin", "lockheed", "mcdonnell-douglas", "tupolev"];

export const POPULAR_MAKERS: Record<TypeRole | "all", readonly string[]> = {
  all: AIRLINER_MAKERS,
  airliner: AIRLINER_MAKERS,
  business: ["beechcraft", "bombardier", "cessna", "daher", "dassault", "embraer", "gulfstream", "hawker-beechcraft", "honda", "pilatus"],
  light: ["beechcraft", "cessna", "cirrus", "de-havilland-canada", "diamond", "mooney", "pilatus", "piper", "quest", "tecnam"],
  helicopter: ["agustawestland", "airbus-helicopters", "bell", "bell-boeing", "boeing-vertol", "kamov", "leonardo", "mil", "robinson", "sikorsky"],
  military: ["airbus", "boeing", "dassault", "embraer", "fairchild", "lockheed", "northrop", "northrop-grumman", "saab", "tupolev"],
  other: [],
};
