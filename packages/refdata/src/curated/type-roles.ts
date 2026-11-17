// A type's role where Wikidata gives none or another (docs/13-reference-data.md, "Type figures"): a type code that
// matches no Wikidata item, or whose item reaches no role class, would otherwise take the role its engines and size
// make most likely, which calls a fighter with an airliner's wake category an airliner. The role sorts the types pages
// and chooses how a type without a family's shape is drawn (silhouettes.ts, `genericShape`). Helicopters, gyroplanes
// and tiltrotors need none here: their kind in the types table makes them helicopters.

import type { TypeRole } from "../../../core/src/ref/types.ts";

export const typeRoles: Record<string, TypeRole> = {
  // Fighters, attack aircraft, bombers and reconnaissance aircraft.
  AJET: "military", // Alpha Jet
  AMX: "military",
  CNBR: "military", // Canberra
  E530: "military", // Textron Scorpion
  EUFI: "military", // Eurofighter Typhoon
  F111: "military",
  F18: "military",
  F18H: "military",
  F5SA: "military", // Saeqeh
  FC1: "military", // JF-17
  HAR: "military", // Harrier
  I22: "military", // Iryda
  J8A: "military",
  J8B: "military",
  JAGR: "military", // Jaguar
  LCA: "military", // Tejas
  MG23: "military",
  MG31: "military",
  MYA4: "military", // Myasishchev M-4, a bomber
  M17: "military", // Myasishchev M-17, a reconnaissance aircraft
  MYS4: "military", // Mystère IV
  SB29: "military", // Saab 29 Tunnan
  SB39: "military", // Gripen
  SHAW: "military", // Sea Hawk
  SMB2: "military", // Super Mystère
  SU27: "military",
  TOR: "military", // Tornado
  VAUT: "military", // Vautour
  YURO: "military", // Orao
  // Jet trainers.
  BTX1: "military",
  FOUG: "military", // Fouga Magister
  G2GL: "military", // Galeb
  GNAT: "military",
  HT16: "military", // Kiran
  HT36: "military", // Sitara
  IR99: "military",
  JAST: "military", // Jastreb
  JL9: "military",
  JPRO: "military", // Jet Provost
  K50: "military", // T-50 Golden Eagle
  L15: "military",
  L159: "military",
  L29: "military",
  L59: "military",
  M345: "military",
  M346: "military",
  MG15: "military", // LiM-1, a MiG-15
  MG17: "military", // FT-5, a MiG-17 trainer
  MGAT: "military",
  S211: "military",
  T33: "military",
  TZRV: "military", // Tazarve
  // Military transports, patrol aircraft and amphibians, and airborne warning and command aircraft on an airliner's
  // airframe, which its family would make an airliner.
  ATLA: "military", // Atlantic
  BELF: "military", // Belfast
  BER4: "military", // Beriev A-40
  E3CF: "military", // E-3 Sentry
  E3TF: "military",
  E6: "military", // E-6 Mercury
  E737: "military", // E-7 Wedgetail
  KC39: "military", // C-390
  S2T: "military", // Turbo Tracker
  US1: "military",
  WW24: "military", // Westwind Sea Scan
  Y20: "military",
  // Airliners whose items reach military aircraft through the air forces that flew them.
  DH8A: "airliner",
  DH8B: "airliner",
  DH8C: "airliner",
  DH8D: "airliner",
  E110: "airliner", // Bandeirante
  // Business jets and a business turboprop.
  ASTR: "business",
  BE40: "business",
  BE45: "business",
  BE4W: "business",
  EA40: "business", // Eclipse 400
  EVIC: "business", // Epic Victory
  FA5X: "business",
  // Falcon 20: its item reaches military aircraft through the air forces that flew it. It was built as a business jet.
  FA20: "business",
  G159: "business", // Gulfstream I
  G250: "business",
  GLF2: "business",
  GLF3: "business",
  H25A: "business", // HS 125
  HA4T: "business",
  HF20: "business", // HFB 320 Hansa Jet
  JCOM: "business", // Jet Commander
  L29A: "business", // JetStar
  L29B: "business",
  LJ85: "business",
  MU30: "business", // Diamond
  PA47: "business", // PiperJet
  SBR2: "business", // Sabreliner 75
  // Record, research and launch aircraft, and demonstrators.
  ARES: "other",
  BSCA: "other", // NASA's Shuttle Carrier Aircraft, a 747
  GFLY: "other", // GlobalFlyer
  M55: "other", // Geophysica
  MG44: "other",
  PRTS: "other", // Proteus
  S37: "other", // Berkut
  S401: "other", // Sierra
  SLCH: "other", // Stratolaunch
  SWFT: "other",
  VMT: "other", // VM-T Atlant, a carrier of rockets and Buran
  WB57: "other",
  WHK2: "other", // WhiteKnightTwo
  WHKN: "other", // White Knight
  X55: "other",
};
