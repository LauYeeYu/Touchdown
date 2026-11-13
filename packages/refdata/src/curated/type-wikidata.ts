// Curated parts of the type figures from Wikidata (scripts/type-wikidata.ts, data/type_wikidata.json): the classes
// that give a type its role, the items chosen by hand where the names match the wrong item or none, and values
// corrected where the chosen item states a wrong one. Each override says why.

import type { TypeRole, TypeWikidata } from "../../../core/src/ref/types.ts";

/**
 * Wikidata classes → role. A type takes the roles of every class it reaches through "instance of" (P31), "subclass
 * of" (P279) or "has use" (P366) and then "subclass of" upwards, so a class here covers its subclasses ("military
 * aircraft" covers fighters, bombers and military transports).
 */
export const roleClasses: Record<string, TypeRole> = {
  // Helicopters, gyroplanes and tiltrotors.
  Q949801: "helicopter", // rotorcraft
  Q34486: "helicopter", // helicopter
  Q208708: "helicopter", // autogyro
  Q1258304: "helicopter", // gyrodyne
  Q1088655: "helicopter", // tiltrotor
  Q3467724: "helicopter", // convertiplane

  // Fighters, bombers, attack, military transports, tankers, early warning, patrol, reconnaissance, military
  // trainers and drones.
  Q216916: "military", // military aircraft
  Q1184840: "military", // military vehicle
  Q19287541: "military", // combat aircraft
  Q104531786: "military", // military trainer
  Q6188960: "military", // jet trainer
  Q18536148: "military", // advanced trainer airplane
  Q4479333: "military", // combat training aircraft
  Q1445518: "military", // military cargo transport aircraft
  Q3261888: "military", // tanker aircraft
  Q161341: "military", // airborne early warning and command system
  Q658414: "military", // maritime patrol aircraft
  Q3041792: "military", // reconnaissance aircraft
  Q60346377: "military", // observation aircraft
  Q484000: "military", // unmanned aerial vehicle
  Q140329650: "military", // drone
  Q627716: "military", // military aviation (a use)
  Q68482296: "military", // military activity (a use)

  // Business jets and business turboprops.
  Q1062135: "business", // business jet
  Q18552353: "business", // executive aircraft
  Q24895863: "business", // business aircraft
  Q1142631: "business", // very light jet
  Q15449497: "business", // executive transport (a use)
  Q15449252: "business", // business aviation (a use)

  // Passenger and cargo transports.
  Q210932: "airliner", // airliner
  Q473625: "airliner", // regional airliner
  Q4993068: "airliner", // regional jet
  Q19799: "airliner", // cargo aircraft
  Q126003589: "airliner", // commercial transport aircraft
  Q9640723: "airliner", // commercial aviation (a use)
  Q59710393: "airliner", // scheduled air transport (a use)

  // General aviation: light, utility, aerobatic, agricultural, homebuilt, gliders, ultralights.
  Q22695586: "light", // general aviation aircraft
  Q1571929: "light", // general aviation (a use)
  Q112127984: "light", // light aircraft
  Q1372231: "light", // light aircraft
  Q1130697: "light", // utility aircraft
  Q2312440: "light", // sportplane
  Q50435271: "light", // recreational aircraft
  Q104708087: "light", // touring aircraft
  Q3244201: "light", // bush plane
  Q2995267: "light", // homebuilt aircraft
  Q2165278: "light", // glider
  Q180173: "light", // sailplane
  Q1930290: "light", // motor glider
  Q19768182: "light", // ultralight aircraft
  Q777459: "light", // light-sport aircraft
  Q678305: "light", // ultralight aviation (a use)
  Q396067: "light", // agricultural aircraft
  Q9333222: "light", // aerobatic airplane
  Q373557: "light", // aerobatics (a use)
  Q644628: "light", // aerial sport (a use)
  Q7246183: "light", // private aviation (a use)

  // Airships, balloons, experimental aircraft.
  Q133585: "other", // airship
  Q183951: "other", // balloon
  Q1384417: "other", // experimental aircraft
  Q47147162: "other", // testbed aircraft
};

/**
 * Which role a type takes when its classes give several: a military helicopter is a helicopter, a military transport
 * built from an airliner is military, a business jet built from an airliner is a business jet.
 */
export const rolePriority: TypeRole[] = ["helicopter", "military", "business", "airliner", "light", "other"];

/** Kinds of engine, not engine models: a "powered by" (P516) value of one of these is left out of `engines`. */
export const engineKinds = new Set([
  "Q309027", // turboprop
  "Q654051", // turbofan
  "Q943162", // turboshaft
  "Q1779063", // piston engine
  "Q214098", // radial engine
  "Q1043622", // rotary engine
  "Q72313", // electric motor
]);

/** The figures of one type designator, as the table has them. */
export type TypeWikidataValues = Omit<TypeWikidata, "designator" | "item" | "revision" | "label">;

/**
 * Designator → item, where matching by name gives the wrong item or none. Null: no item fits (the name matches
 * another aircraft).
 */
export const itemOverrides: Record<string, string | null> = {
  // BAe 146-100, -200, -300: the names match aliases of the Avro RJ70, RJ85 and RJ100 items, later aircraft with other
  // engines and weights. No item for each 146 model was found, and the family's item (Q589498) gives one length for
  // all three.
  B461: null,
  B462: null,
  B463: null,
  // Gulfstream G400 (GA4C) is the G400 of the G500/G600 generation. The item of that name (Q1554296) is the earlier
  // G400, a Gulfstream IV model (GLF4).
  GA4C: null,
  // Gulfstream G500 (GA5C) is the G500 of 2018, in the G500/G600 family (Q24256468). The other item of that name
  // (Q1554301) is the earlier G500, a Gulfstream V model (GLF5).
  GA5C: "Q54365880",
  // Hawker 1000: its curated article is the British Aerospace 125's, whose item (Q1591686) is the whole family's (first
  // flight in 1962, every model built). No item for the Hawker 1000 was found.
  H25C: null,
  // Aero Commander 1121 Jet Commander: the name is an alias of the IAI 1124 Westwind item (Q1653016), its successor.
  JCOM: null,
  // Wassmer WA-421 Prestige: the name matches an alias of the WA-40 item (Q7972781), an earlier model. The WA 4/21
  // Prestige has its own item.
  WA42: "Q20798119",
};

/** Values the chosen item states wrongly, or a figure it gives for another variant. */
export const valueOverrides: Record<string, Partial<TypeWikidataValues>> = {
  // AgustaWestland AW109 (Q398965), height (P2048) 6.62 m: the AW109 stands 3.5 m tall (its Wikipedia article,
  // "Specifications").
  A109: { heightM: null },
  // Airbus A320 (Q18784360), length (P2043) 35.75 m: no A320 model is that long. The A320 is 37.57 m (its Wikipedia
  // article, "Specifications").
  A320: { lengthM: null },
  // Airbus A380 (Q5830), powered by (P516): the Trent 700 (Q9070485), the A330's engine. The A380 has the Trent 900
  // (Q129249) or the GP7000.
  A388: { engines: null },
  // Beechcraft 1900 (Q661819), total produced (P1092) 3: 695 were built (its Wikipedia article's infobox).
  B190: { built: null },
  // Ilyushin Il-96 (Q272571), the family's item: length 64.7 m and height 15.7 m are not the Il-96-300's (55.35 m and
  // 17.55 m in its Wikipedia article, "Specifications"), so they are another model's.
  IL96: { lengthM: null, heightM: null },
  // Irkut MC-21 (Q929769), the family's item, for the MC-21-300: length 46.7 m and height 12.7 m are not the -300's
  // (42.2 m and 11.45 m in its Wikipedia article, "Specifications").
  MC23: { lengthM: null, heightM: null },
  // Yakovlev SJ-100 (Q486066), wingspan (P2050) 54 m: the Superjet's is 27.8 m (its Wikipedia article,
  // "Specifications"), about half that.
  SU95: { spanM: null },
};
