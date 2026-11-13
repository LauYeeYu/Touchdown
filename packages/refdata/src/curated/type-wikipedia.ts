// Curated part of the type figures from English Wikipedia's specifications templates (scripts/type-wikipedia.ts,
// data/type_wikipedia.json): the article chosen by hand where the Wikidata item's article or the search finds the
// wrong one or none. Each override says why. An override's article is read as it is: it is not checked for the
// manufacturer, a shared article or another model's specifications.

/**
 * Designator → English Wikipedia article title. Null: no article fits (the one found is about another aircraft, or its
 * figures are another model's).
 */
export const articleOverrides: Record<string, string | null> = {
  // The search finds the article, but ICAO names another maker: a licence builder, a later owner of the design or the
  // company's later name.
  A223: "MAI-223", // Kityonok, designed at the Moscow Aviation Institute (MAI)
  ACAM: "Lockwood Aircam", // Leza-Lockwood builds the Air Cam
  AJET: "Dassault/Dornier Alpha Jet", // AOI assembled Egypt's Alpha Jets
  AM3: "Aermacchi AM.3", // Atlas built the AM.3 as the Bosbok for South Africa
  AN2: "Antonov An-2", // PZL-Mielec built most An-2s
  BEVR: "Spectrum Beaver", // ASAP took over the Beaver
  BREZ: "Breezer Breezer", // Aerostyle built the Breezer first
  BU20: "Stout Bushmaster 2000", // Aircraft Hydro-Forming built the Bushmaster 2000
  C309: "CEA-309 Mehari", // designed at CEA-UFMG
  C365: "F+W C-3605", // EKW is F+W Emmen's earlier name
  CAD2: "Bushcaddy R-120", // Class Bush Caddy is Bushcaddy
  CAD4: "Bushcaddy L-164",
  CH62: "Zenith Gemini CH-620", // Zenair's CH-620, marketed by Zenith
  CHIN: "Birdman Chinook", // ASAP took over the Chinook
  CNBR: "English Electric Canberra", // BAC took over English Electric
  CRES: "PAC Cresco", // New Zealand Aerospace Industries became PAC
  CRUZ: "CZAW SportCruiser", // CSA is CZAW's later name
  DAL4: "UL-Jih Fascination", // Dallach's D-4, built by UL-Jih
  DAL5: "UL-Jih Evolution", // Dallach's D-5, built by UL-Jih
  E530: "Textron AirLand Scorpion", // Cessna's model 530
  EP9: "Edgar Percival E.P.9", // Lancashire Aircraft took over the E.P.9
  ETA: "Eta (glider)", // built by Binder
  FA04: "Flaeming Air FA 04 Peregrine",
  FANT: "RFB Fantrainer", // the Royal Thai Air Force assembled its Fantrainers
  FLCO: "Selex ES Falco", // Selex ES was a Finmeccanica company
  FU24: "Fletcher FU-24", // Air Parts built the FU-24 in New Zealand
  FW44: "Focke-Wulf Fw 44 Stieglitz", // FMA built the Fw 44 under licence
  GENI: "IFB-Stuttgart E-Genius",
  GLSP: "Glasair Sportsman 2+2", // New GlaStar is Glasair
  GP1: "Skyleader GP One", // Jihlavan built the Skyleader
  GX: "Remos GX", // Stemme built the Remos
  IA50: "FMA IA 50 Guaraní II", // DINFIA is FMA's name of the time
  IR21: "IAR-821", // ICA is IAR's name of the time
  IR22: "IAR-822",
  IR24: "IAR 824",
  IR31: "IAR-831",
  JAGR: "SEPECAT Jaguar", // Hindustan built the Jaguar under licence
  JSQA: "Promavia Jet Squalus", // designed at General Avia
  LOVE: "Loving WR-1 Love", // Loving-Wayne is Loving's company
  LYNX: "AgustaWestland AW159 Wildcat", // Westland is part of AgustaWestland
  LYSA: "Westland Lysander", // National Steel Car built Lysanders under licence
  M110: "Monocoupe 110 Special", // Aviat built the 110 Special
  M200: "Meyers 200", // Aero Commander bought the Meyers 200
  M21: "PZL M-21 Dromader Mini",
  M24: "PZL M-24 Dromader Super",
  M308: "Macchi M.B.308", // German Bianco built the M.B.308 under licence
  MGAT: "Mikoyan MiG-AT", // MAPO is the Mikoyan bureau's name of the time
  MH02: "Honda MH02", // built with Mississippi State University
  MIMU: "Mustang Aeronautics Midget Mustang", // Bushby's design
  MP20: "Lefebvre Busard", // the MP.205 Busard, sold by Plan
  MRMD: "CZAW Mermaid", // CSA is CZAW's later name
  N219: "Indonesian Aerospace N219", // Dirgantara Indonesia is Indonesian Aerospace
  N250: "IPTN N250", // Nusantara is IPTN
  NIPR: "Tipsy Nipper", // Avions Fairey built the Nipper
  PEMB: "Percival Pembroke", // Hunting is Percival's later name
  PK15: "PIK-15",
  PREX: "Wilson Private Explorer",
  PROT: "CZAW Parrot", // CSA is CZAW's later name
  PZ26: "PZL-126 Mrówka", // Agrolot is a PZL company
  RF9: "Fournier RF-9", // ABS built the RF-9
  S108: "Stinson 108", // Piper bought Stinson and built the 108
  SB91: "Saab 91 Safir", // De Schelde built Safirs under licence
  SC01: "Gyroflug Speed Canard", // FFT built the Speed Canard
  SLG4: "Sling Aircraft Sling 4", // The Airplane Factory is Sling Aircraft
  SS2: "SpaceShipTwo", // Scaled Composites, Rutan's company
  SSTM: "Storm Aviation Sea Storm", // SG Aviation is Storm Aviation
  T101: "ROS-Aeroprogress T-101 Grach",
  T250: "Bellanca Aries", // Anderson Greenwood's design, built by Bellanca
  TFK2: "AMS-Flight Carat", // Technoflug's design, built by AMS-Flight
  TIPB: "Tipsy B", // Avions Fairey built the Tipsy B
  TOR: "Panavia Tornado", // Aeritalia is a Panavia partner
  VC10: "Vickers VC10", // BAC took over Vickers
  WHK2: "Scaled Composites White Knight Two", // Scaled Composites, Rutan's company
  WHKN: "Scaled Composites White Knight",
  YS11: "NAMC YS-11", // Mitsubishi led NAMC
  YURO: "Soko J-22 Orao", // SOKO and CNIAR built the Orao
  Z50: "Zlín Z-50", // Moravan built the Zlín aircraft

  // The article is the model's, but its title names the model otherwise than ICAO does, so the search does not take it.
  A900: "Aviatika-900 Acrobat", // the MAI-900
  ARV1: "ARV Super2", // the ARV-1 Super 2
  AURA: "Sunward SA 60L Aurora", // the SA60
  BN2P: "Britten-Norman BN-2 Islander", // its specifications are the BN-2B's
  C125: "Northrop YC-125 Raider",
  CE22: "Gidroplan Che-22 Korvet", // Korvet, transliterated Corvette by ICAO
  E314: "Embraer EMB 314 Super Tucano", // ALX was the Super Tucano's programme name
  F106: "Convair F-106 Delta Dart", // the QF-106 is a converted F-106
  F111: "General Dynamics–Grumman EF-111A Raven",
  G2T1: "Great Lakes Sport Trainer", // the 2T-1 Sport Trainer
  G21: "Grumman G-21 Goose",
  H43B: "Kaman HH-43 Huskie",
  HF20: "HFB 320 Hansa Jet",
  HT36: "HAL HJT-36 Yashas", // the Sitara, renamed Yashas
  PILL: "ENAER T-35 Pillán", // its specifications are the T-35A's
  SA11: "Stits SA-11A Playmate",
  T6: "North American T-6 Texan", // the Harvard is the T-6 in Commonwealth service
  TF19: "Taylorcraft F-19 Sportsman",

  // One aircraft under two codes: its article is both codes'.
  LEGD: "Performance Turbine Legend",
  TLEG: "Performance Turbine Legend",
  SU57: "Sukhoi Su-57", // the T-50 is the Su-57's prototype designation
  T50S: "Sukhoi Su-57",
  VISI: "Pro-Composites Vision",
  VSON: "Pro-Composites Vision",

  // Two aircraft have the name Yakovlev Yak-30 (the 1948 fighter and the 1960 trainer). Which one the code is is not
  // known.
  YK30: null,
};
