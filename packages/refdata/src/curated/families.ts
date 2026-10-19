// Aircraft families: our own grouping of ICAO type designators (docs/13-reference-data.md).
// Ids follow the "Plane Family" values of the spreadsheets the app replaces. E170 and E175 are separate
// families by default; users can regroup types with family_overrides.

import type { Family } from "../../../core/src/ref/types.ts";

interface CuratedFamily extends Family {
  types: string[];
}

export const curatedFamilies: CuratedFamily[] = [
  // Airbus
  { id: "A220", name: "Airbus A220", manufacturer: "Airbus", types: ["BCS1", "BCS3"] },
  { id: "A300", name: "Airbus A300", manufacturer: "Airbus", types: ["A30B", "A306", "A3ST"] },
  { id: "A310", name: "Airbus A310", manufacturer: "Airbus", types: ["A310"] },
  { id: "A320", name: "Airbus A320 family", manufacturer: "Airbus", types: ["A318", "A319", "A320", "A321", "A19N", "A20N", "A21N"] },
  { id: "A330", name: "Airbus A330", manufacturer: "Airbus", types: ["A332", "A333", "A337", "A338", "A339"] },
  { id: "A340", name: "Airbus A340", manufacturer: "Airbus", types: ["A342", "A343", "A345", "A346"] },
  { id: "A350", name: "Airbus A350", manufacturer: "Airbus", types: ["A359", "A35K"] },
  { id: "A380", name: "Airbus A380", manufacturer: "Airbus", types: ["A388"] },
  { id: "A400M", name: "Airbus A400M Atlas", manufacturer: "Airbus", types: ["A400"] },
  { id: "C295", name: "Airbus C295 / CN-235", manufacturer: "Airbus", types: ["C295", "CN35"] },

  // Boeing
  { id: "B707", name: "Boeing 707 / 720", manufacturer: "Boeing", types: ["B701", "B703", "B720", "E3TF", "E3CF", "E6"] },
  { id: "B717", name: "Boeing 717", manufacturer: "Boeing", types: ["B712"] },
  { id: "B727", name: "Boeing 727", manufacturer: "Boeing", types: ["B721", "B722"] },
  {
    id: "B737",
    name: "Boeing 737",
    manufacturer: "Boeing",
    types: ["B731", "B732", "B733", "B734", "B735", "B736", "B737", "B738", "B739", "B37M", "B38M", "B39M", "B3XM", "P8", "E737"],
  },
  { id: "B747", name: "Boeing 747", manufacturer: "Boeing", types: ["B741", "B742", "B743", "B744", "B748", "B74S", "B74R", "BLCF"] },
  { id: "B757", name: "Boeing 757", manufacturer: "Boeing", types: ["B752", "B753"] },
  { id: "B767", name: "Boeing 767", manufacturer: "Boeing", types: ["B762", "B763", "B764", "E767"] },
  { id: "B777", name: "Boeing 777", manufacturer: "Boeing", types: ["B772", "B773", "B77L", "B77W", "B778", "B779"] },
  { id: "B787", name: "Boeing 787", manufacturer: "Boeing", types: ["B788", "B789", "B78X"] },
  { id: "C17", name: "Boeing C-17 Globemaster III", manufacturer: "Boeing", types: ["C17"] },

  // McDonnell Douglas, Douglas, Lockheed
  { id: "DC3", name: "Douglas DC-3", manufacturer: "Douglas", types: ["DC3"] },
  { id: "DC8", name: "Douglas DC-8", manufacturer: "Douglas", types: ["DC85", "DC86", "DC87"] },
  { id: "DC9", name: "McDonnell Douglas DC-9", manufacturer: "McDonnell Douglas", types: ["DC91", "DC92", "DC93", "DC94", "DC95"] },
  { id: "DC10", name: "McDonnell Douglas DC-10", manufacturer: "McDonnell Douglas", types: ["DC10"] },
  { id: "MD11", name: "McDonnell Douglas MD-11", manufacturer: "McDonnell Douglas", types: ["MD11"] },
  { id: "MD80", name: "McDonnell Douglas MD-80", manufacturer: "McDonnell Douglas", types: ["MD81", "MD82", "MD83", "MD87", "MD88"] },
  { id: "MD90", name: "McDonnell Douglas MD-90", manufacturer: "McDonnell Douglas", types: ["MD90"] },
  { id: "L1011", name: "Lockheed L-1011 TriStar", manufacturer: "Lockheed", types: ["L101"] },
  { id: "C130", name: "Lockheed C-130 Hercules", manufacturer: "Lockheed", types: ["C130", "C30J"] },
  { id: "C5", name: "Lockheed C-5 Galaxy", manufacturer: "Lockheed", types: ["C5", "C5M"] },

  // Embraer
  { id: "E170", name: "Embraer E170", manufacturer: "Embraer", types: ["E170"] },
  { id: "E175", name: "Embraer E175", manufacturer: "Embraer", types: ["E75L", "E75S", "E275"] },
  { id: "E190", name: "Embraer E190", manufacturer: "Embraer", types: ["E190", "E290"] },
  { id: "E195", name: "Embraer E195", manufacturer: "Embraer", types: ["E195", "E295"] },
  { id: "E145", name: "Embraer ERJ 135 / 140 / 145", manufacturer: "Embraer", types: ["E135", "E145", "E45X"] },
  { id: "E120", name: "Embraer EMB 120 Brasilia", manufacturer: "Embraer", types: ["E120"] },
  { id: "E110", name: "Embraer EMB 110 Bandeirante", manufacturer: "Embraer", types: ["E110"] },
  { id: "C390", name: "Embraer C-390 Millennium", manufacturer: "Embraer", types: ["E390"] },
  { id: "Phenom100", name: "Embraer Phenom 100", manufacturer: "Embraer", types: ["E50P"] },
  { id: "Phenom300", name: "Embraer Phenom 300", manufacturer: "Embraer", types: ["E55P"] },
  { id: "Embraer Legacy/Praetor", name: "Embraer Legacy / Praetor", manufacturer: "Embraer", types: ["E35L", "E545", "E550"] },

  // Bombardier, Canadair, Learjet
  { id: "CRJ", name: "Bombardier CRJ", manufacturer: "Bombardier", types: ["CRJ1", "CRJ2", "CRJ7", "CRJ9", "CRJX"] },
  { id: "CL30", name: "Bombardier Challenger 300", manufacturer: "Bombardier", types: ["CL30"] },
  { id: "CL35", name: "Bombardier Challenger 350", manufacturer: "Bombardier", types: ["CL35"] },
  { id: "CL60", name: "Bombardier Challenger 600 series", manufacturer: "Bombardier", types: ["CL60"] },
  { id: "Global", name: "Bombardier Global", manufacturer: "Bombardier", types: ["GLEX", "GL5T", "GL7T"] },
  {
    id: "Learjet",
    name: "Learjet",
    manufacturer: "Bombardier",
    types: ["LJ23", "LJ24", "LJ25", "LJ28", "LJ31", "LJ35", "LJ40", "LJ45", "LJ55", "LJ60", "LJ70", "LJ75"],
  },

  // De Havilland Canada
  { id: "Dash8", name: "De Havilland Canada Dash 8", manufacturer: "De Havilland Canada", types: ["DH8A", "DH8B", "DH8C", "DH8D"] },
  { id: "DHC7", name: "De Havilland Canada Dash 7", manufacturer: "De Havilland Canada", types: ["DHC7"] },
  { id: "DHC6", name: "De Havilland Canada Twin Otter", manufacturer: "De Havilland Canada", types: ["DHC6"] },
  { id: "DHC2", name: "De Havilland Canada Beaver", manufacturer: "De Havilland Canada", types: ["DHC2"] },
  { id: "DHC3", name: "De Havilland Canada Otter", manufacturer: "De Havilland Canada", types: ["DHC3"] },

  // Other regional and transport aircraft
  { id: "ATR42", name: "ATR 42", manufacturer: "ATR", types: ["AT43", "AT44", "AT45", "AT46"] },
  { id: "ATR72", name: "ATR 72", manufacturer: "ATR", types: ["AT72", "AT73", "AT75", "AT76"] },
  { id: "SF34", name: "Saab 340", manufacturer: "Saab", types: ["SF34"] },
  { id: "SB20", name: "Saab 2000", manufacturer: "Saab", types: ["SB20"] },
  { id: "F27", name: "Fokker F27 Friendship", manufacturer: "Fokker", types: ["F27"] },
  { id: "F28", name: "Fokker F28 Fellowship", manufacturer: "Fokker", types: ["F28"] },
  { id: "F50", name: "Fokker 50", manufacturer: "Fokker", types: ["F50"] },
  { id: "F100", name: "Fokker 70 / 100", manufacturer: "Fokker", types: ["F70", "F100"] },
  { id: "BAe146", name: "BAe 146 / Avro RJ", manufacturer: "British Aerospace", types: ["B461", "B462", "B463", "RJ70", "RJ85", "RJ1H"] },
  { id: "Jetstream", name: "BAe Jetstream", manufacturer: "British Aerospace", types: ["JS31", "JS32", "JS41"] },
  { id: "D328", name: "Dornier 328", manufacturer: "Dornier", types: ["D328", "J328"] },
  { id: "B190", name: "Beechcraft 1900", manufacturer: "Beechcraft", types: ["B190"] },
  { id: "L410", name: "Let L-410 Turbolet", manufacturer: "Let", types: ["L410"] },
  { id: "SSJ100", name: "Sukhoi Superjet 100", manufacturer: "Sukhoi", types: ["SU95"] },
  { id: "MC21", name: "Irkut MC-21", manufacturer: "Irkut", types: ["MC23"] },
  { id: "ARJ21", name: "COMAC ARJ21", manufacturer: "COMAC", types: ["AJ27"] },
  { id: "C919", name: "COMAC C919", manufacturer: "COMAC", types: ["C919"] },
  { id: "An148", name: "Antonov An-148 / An-158", manufacturer: "Antonov", types: ["A148", "A158"] },
  { id: "An124", name: "Antonov An-124 Ruslan", manufacturer: "Antonov", types: ["A124"] },
  { id: "An225", name: "Antonov An-225 Mriya", manufacturer: "Antonov", types: ["A225"] },
  { id: "Il76", name: "Ilyushin Il-76", manufacturer: "Ilyushin", types: ["IL76"] },
  { id: "Il96", name: "Ilyushin Il-96", manufacturer: "Ilyushin", types: ["IL96"] },
  { id: "Tu154", name: "Tupolev Tu-154", manufacturer: "Tupolev", types: ["T154"] },
  { id: "Tu204", name: "Tupolev Tu-204 / Tu-214", manufacturer: "Tupolev", types: ["T204"] },
  { id: "Concorde", name: "Concorde", manufacturer: "Aérospatiale-BAC", types: ["CONC"] },

  // Business jets
  {
    id: "Cessna Citation",
    name: "Cessna Citation",
    manufacturer: "Cessna",
    types: ["C500", "C501", "C510", "C525", "C25A", "C25B", "C25C", "C25M", "C550", "C551", "C55B", "C560", "C56X", "C650", "C680", "C68A", "C700", "C750"],
  },
  { id: "G150", name: "Gulfstream G150", manufacturer: "Gulfstream", types: ["G150"] },
  { id: "G200", name: "Gulfstream G200", manufacturer: "Gulfstream", types: ["GALX"] },
  { id: "G280", name: "Gulfstream G280", manufacturer: "Gulfstream", types: ["G280"] },
  { id: "G450", name: "Gulfstream G-IV / G450", manufacturer: "Gulfstream", types: ["GLF4"] },
  { id: "G550", name: "Gulfstream G-V / G550", manufacturer: "Gulfstream", types: ["GLF5"] },
  { id: "G500", name: "Gulfstream G400 / G500 / G600", manufacturer: "Gulfstream", types: ["GA4C", "GA5C", "GA6C"] },
  { id: "G650", name: "Gulfstream G650", manufacturer: "Gulfstream", types: ["GLF6"] },
  { id: "G700", name: "Gulfstream G700 / G800", manufacturer: "Gulfstream", types: ["GA7C", "GA8C"] },
  { id: "FA50", name: "Dassault Falcon 50", manufacturer: "Dassault", types: ["FA50"] },
  { id: "F900", name: "Dassault Falcon 900", manufacturer: "Dassault", types: ["F900"] },
  { id: "F2TH", name: "Dassault Falcon 2000", manufacturer: "Dassault", types: ["F2TH"] },
  { id: "FA7X", name: "Dassault Falcon 7X", manufacturer: "Dassault", types: ["FA7X"] },
  { id: "FA8X", name: "Dassault Falcon 8X", manufacturer: "Dassault", types: ["FA8X"] },
  { id: "FA6X", name: "Dassault Falcon 6X", manufacturer: "Dassault", types: ["FA6X"] },
  { id: "Hawker", name: "Hawker 800 / 1000", manufacturer: "Hawker Beechcraft", types: ["H25B", "H25C"] },
  { id: "HondaJet", name: "HondaJet", manufacturer: "Honda", types: ["HDJT"] },
  { id: "PC24", name: "Pilatus PC-24", manufacturer: "Pilatus", types: ["PC24"] },
  { id: "SF50", name: "Cirrus Vision Jet", manufacturer: "Cirrus", types: ["SF50"] },

  // Turboprops and piston aircraft
  { id: "PC12", name: "Pilatus PC-12", manufacturer: "Pilatus", types: ["PC12"] },
  { id: "PC6", name: "Pilatus PC-6 Porter", manufacturer: "Pilatus", types: ["PC6T"] },
  { id: "King Air", name: "Beechcraft King Air", manufacturer: "Beechcraft", types: ["BE9L", "BE9T", "BE10", "BE20", "BE30", "B350"] },
  { id: "TBM", name: "Daher TBM", manufacturer: "Daher", types: ["TBM7", "TBM8", "TBM9"] },
  { id: "Kodiak", name: "Kodiak 100", manufacturer: "Quest", types: ["K100"] },
  { id: "P2012", name: "Tecnam P2012 Traveller", manufacturer: "Tecnam", types: ["P212"] },
  { id: "C150", name: "Cessna 150", manufacturer: "Cessna", types: ["C150"] },
  { id: "C152", name: "Cessna 152", manufacturer: "Cessna", types: ["C152"] },
  { id: "C172", name: "Cessna 172 Skyhawk", manufacturer: "Cessna", types: ["C172"] },
  { id: "C177", name: "Cessna 177 Cardinal", manufacturer: "Cessna", types: ["C177"] },
  { id: "C180", name: "Cessna 180", manufacturer: "Cessna", types: ["C180"] },
  { id: "C182", name: "Cessna 182 Skylane", manufacturer: "Cessna", types: ["C182"] },
  { id: "C185", name: "Cessna 185 Skywagon", manufacturer: "Cessna", types: ["C185"] },
  { id: "C206", name: "Cessna 206 Stationair", manufacturer: "Cessna", types: ["C206"] },
  { id: "C208", name: "Cessna 208 Caravan", manufacturer: "Cessna", types: ["C208"] },
  { id: "C210", name: "Cessna 210 Centurion", manufacturer: "Cessna", types: ["C210"] },
  { id: "C310", name: "Cessna 310", manufacturer: "Cessna", types: ["C310"] },
  { id: "C337", name: "Cessna 337 Skymaster", manufacturer: "Cessna", types: ["C337"] },
  { id: "C340", name: "Cessna 340", manufacturer: "Cessna", types: ["C340"] },
  { id: "C402", name: "Cessna 402", manufacturer: "Cessna", types: ["C402"] },
  { id: "C404", name: "Cessna 404 Titan", manufacturer: "Cessna", types: ["C404"] },
  { id: "C414", name: "Cessna 414 Chancellor", manufacturer: "Cessna", types: ["C414"] },
  { id: "C421", name: "Cessna 421 Golden Eagle", manufacturer: "Cessna", types: ["C421"] },
  { id: "C441", name: "Cessna 441 Conquest II", manufacturer: "Cessna", types: ["C441"] },
  { id: "PA28", name: "Piper PA-28 Cherokee", manufacturer: "Piper", types: ["P28A", "P28B", "P28R", "P28T"] },
  { id: "PA32", name: "Piper PA-32 Cherokee Six / Saratoga", manufacturer: "Piper", types: ["PA32", "P32R", "P32T"] },
  { id: "PA34", name: "Piper PA-34 Seneca", manufacturer: "Piper", types: ["PA34"] },
  { id: "PA44", name: "Piper PA-44 Seminole", manufacturer: "Piper", types: ["PA44"] },
  { id: "PA31", name: "Piper PA-31 Navajo", manufacturer: "Piper", types: ["PA31"] },
  { id: "PA46", name: "Piper PA-46 Malibu / M-Class", manufacturer: "Piper", types: ["PA46", "P46T"] },
  { id: "PA18", name: "Piper PA-18 Super Cub", manufacturer: "Piper", types: ["PA18"] },
  { id: "J3", name: "Piper J-3 Cub", manufacturer: "Piper", types: ["J3"] },
  { id: "Bonanza", name: "Beechcraft Bonanza", manufacturer: "Beechcraft", types: ["BE33", "BE35", "BE36"] },
  { id: "Baron", name: "Beechcraft Baron", manufacturer: "Beechcraft", types: ["BE55", "BE58"] },
  { id: "SR20", name: "Cirrus SR20", manufacturer: "Cirrus", types: ["SR20"] },
  { id: "SR22", name: "Cirrus SR22", manufacturer: "Cirrus", types: ["SR22", "S22T"] },
  { id: "DA20", name: "Diamond DA20", manufacturer: "Diamond", types: ["DV20"] },
  { id: "DA40", name: "Diamond DA40", manufacturer: "Diamond", types: ["DA40"] },
  { id: "DA42", name: "Diamond DA42", manufacturer: "Diamond", types: ["DA42"] },
  { id: "DA62", name: "Diamond DA62", manufacturer: "Diamond", types: ["DA62"] },
  { id: "M20", name: "Mooney M20", manufacturer: "Mooney", types: ["M20P", "M20T"] },

  // Helicopters
  { id: "R22", name: "Robinson R22", manufacturer: "Robinson", types: ["R22"] },
  { id: "R44", name: "Robinson R44", manufacturer: "Robinson", types: ["R44"] },
  { id: "R66", name: "Robinson R66", manufacturer: "Robinson", types: ["R66"] },
  { id: "Bell 206", name: "Bell 206", manufacturer: "Bell", types: ["B06"] },
  { id: "Bell 407", name: "Bell 407", manufacturer: "Bell", types: ["B407"] },
  { id: "Bell 412", name: "Bell 412", manufacturer: "Bell", types: ["B412"] },
  { id: "Bell 429", name: "Bell 429", manufacturer: "Bell", types: ["B429"] },
  { id: "H125", name: "Airbus H125 / AS350", manufacturer: "Airbus Helicopters", types: ["AS50"] },
  { id: "H130", name: "Airbus H130 / EC130", manufacturer: "Airbus Helicopters", types: ["EC30"] },
  { id: "H135", name: "Airbus H135 / EC135", manufacturer: "Airbus Helicopters", types: ["EC35"] },
  { id: "H145", name: "Airbus H145 / EC145", manufacturer: "Airbus Helicopters", types: ["EC45"] },
  { id: "AS365", name: "Airbus AS365 Dauphin", manufacturer: "Airbus Helicopters", types: ["AS65"] },
  { id: "AW109", name: "Leonardo AW109", manufacturer: "Leonardo", types: ["A109"] },
  { id: "AW139", name: "Leonardo AW139", manufacturer: "Leonardo", types: ["A139"] },
  { id: "S76", name: "Sikorsky S-76", manufacturer: "Sikorsky", types: ["S76"] },
  { id: "S92", name: "Sikorsky S-92", manufacturer: "Sikorsky", types: ["S92"] },
  { id: "H60", name: "Sikorsky H-60 Black Hawk", manufacturer: "Sikorsky", types: ["H60"] },
];

export const families: Family[] = curatedFamilies.map(({ id, name, manufacturer }) => ({ id, name, manufacturer }));

export const familyById = new Map<string, Family>(families.map((f) => [f.id, f]));

/** Type designator → family id. */
export const familyOfType = new Map<string, string>(curatedFamilies.flatMap((f) => f.types.map((t) => [t, f.id] as [string, string])));
