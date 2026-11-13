// Where the figures on aircraft type pages come from: for each family in families.ts, the English Wikipedia
// articles that describe its ICAO type designators, and which of each article's specification columns gives
// which designator. scripts/type-specs.ts reads the "Specifications" section of each article and writes
// data/type_specs.json and data/family_facts.json. Figures only, no prose, and each row links to its article.
//
// A column maps to a designator only when the article has a column (or a list) for that variant. Military and
// special versions take the figures of their own article, or none. Overrides at the end hold values the parser
// cannot read but the article states; each names where in the article it is.

/**
 * A designator, or a designator and the part of each cell that gives its value, when a column covers several
 * variants: `{ type: "MD82", part: "82" }` takes "-82: 149,500 lb" from a cell that lists "-81: …" and "-82: …"
 * (a cell without such parts is taken whole).
 */
export type Target = string | { type: string; part: string };

/** One article and how its figures map to type designators. */
export interface SpecSource {
  /** English Wikipedia title, as the API resolves it. */
  article: string;
  /** Heading of the section with the figures (a regular expression, case-insensitive), when it is not "Specifications…". */
  section?: string;
  /**
   * Variant heading in the article's table → designator(s). A table with one variant a row is read the same way, by
   * its first column. "*" takes an article whose figures are one list or one column.
   */
  columns: Record<string, Target | Target[]>;
  /** Designators the article describes without figures of their own: a row with the link only. */
  linkOnly?: string[];
  /**
   * A helicopter: spanM is the main rotor diameter (its width seen from above), lengthM the fuselage length when the
   * article gives it, else the length it gives (with rotors turning). The comment on each says which.
   */
  rotorcraft?: true;
  /**
   * "max": a count of seats without a class or "typical" in the source's table is its most ("Passenger capacity" in
   * Boeing's comparison tables, which the article's own list shows above its one-class figure).
   */
  capacity?: "max";
}

export interface FamilySpecSources {
  familyId: string;
  /**
   * The family's main article, read for its infobox (first flight, introduction, number built, status). None for a
   * family of separate models without an article of its own (Learjet, Cessna Citation).
   */
  main?: string;
  sources: SpecSource[];
}

/** The figures of one type designator, metric. */
export interface TypeSpecValues {
  lengthM: number | null;
  spanM: number | null;
  heightM: number | null;
  fuselageWidthM: number | null;
  wingAreaM2: number | null;
  sweepDeg: number | null;
  mtowKg: number | null;
  rangeKm: number | null;
  cruiseKmh: number | null;
  cruiseMach: number | null;
  seatsTypical: number | null;
  seatsMax: number | null;
  engines: string | null;
}

export interface FamilyFactValues {
  firstFlight: string | null;
  introduced: string | null;
  built: number | null;
  builtAsOf: string | null;
  status: string | null;
}

/** An article whose figures are one list (or one column) for one designator. */
const one = (article: string, type: string, more: Partial<SpecSource> = {}): SpecSource => ({ article, columns: { "*": type }, ...more });

/** A helicopter's article with one list; the comment on each says which length the article gives. */
const heli = (article: string, type: string): SpecSource => ({ article, columns: { "*": type }, rotorcraft: true });

export const typeSpecSources: FamilySpecSources[] = [
  // Airbus
  { familyId: "A220", main: "Airbus A220", sources: [{ article: "Airbus A220", columns: { "A220-100": "BCS1", "A220-300": "BCS3" } }] },
  {
    familyId: "A300",
    main: "Airbus A300",
    sources: [
      { article: "Airbus A300", columns: { "A300B4-200": "A30B", "A300-600R": "A306" } },
      one("Airbus Beluga", "A3ST"), // A300-600ST
    ],
  },
  {
    familyId: "A310",
    main: "Airbus A310",
    sources: [
      { article: "Airbus A310", section: "^Differences between variants", columns: { "A310-300": "A310" } },
      one("Airbus A310", "A310"), // A310-325
    ],
  },
  {
    familyId: "A320",
    main: "Airbus A320 family",
    sources: [
      { article: "Airbus A320 family", columns: { A318: "A318", A319: "A319", A320: "A320", A321: "A321" } },
      { article: "Airbus A320neo family", columns: { A319neo: "A19N", A320neo: "A20N", A321neo: "A21N" } },
    ],
  },
  {
    familyId: "A330",
    main: "Airbus A330",
    sources: [
      { article: "Airbus A330", columns: { "A330-200": "A332", "A330-300": "A333" } },
      { article: "Airbus A330neo", section: "^Comparison of variants", columns: { "A330-841": "A338", "A330-941": "A339" } },
      one("Airbus A330neo", "A339"), // A330-941
      one("Airbus BelugaXL", "A337"),
    ],
  },
  {
    familyId: "A340",
    main: "Airbus A340",
    sources: [{ article: "Airbus A340", columns: { "A340-200": "A342", "A340-300": "A343", "A340-500": "A345", "A340-600": "A346" } }],
  },
  {
    familyId: "A350",
    main: "Airbus A350",
    sources: [
      {
        article: "Airbus A350",
        section: "^Comparison of variants",
        columns: { "A350-900/-900ULR": { type: "A359", part: "900" }, "A350-1000/-1000ULR": { type: "A35K", part: "1000" } },
        capacity: "max",
      },
      one("Airbus A350", "A359"), // A350-941
    ],
  },
  { familyId: "A380", main: "Airbus A380", sources: [{ article: "Airbus A380", columns: { "A380-841": "A388" } }] },
  { familyId: "A400M", main: "Airbus A400M Atlas", sources: [one("Airbus A400M Atlas", "A400")] },
  { familyId: "C295", main: "Airbus C295", sources: [one("Airbus C295", "C295"), one("CASA/IPTN CN-235", "CN35")] },

  // Boeing
  {
    familyId: "B707",
    main: "Boeing 707",
    sources: [
      {
        article: "Boeing 707",
        section: "^Comparison of variants",
        columns: { "707-120": "B701", "707-320B": "B703" },
        capacity: "max",
      },
      one("Boeing 720", "B720"),
      one("Boeing E-3 Sentry", "E3TF", { linkOnly: ["E3CF"] }), // E-3 with TF33 engines
      one("Boeing E-6 Mercury", "E6"),
    ],
  },
  { familyId: "B717", main: "Boeing 717", sources: [one("Boeing 717", "B712")] },
  {
    familyId: "B727",
    main: "Boeing 727",
    sources: [
      { article: "Boeing 727", section: "^Comparison of variants", columns: { "727-100": "B721", "727-200 Advanced": "B722" }, capacity: "max" },
      one("Boeing 727", "B721"), // 727-100
    ],
  },
  {
    familyId: "B737",
    main: "Boeing 737",
    sources: [
      { article: "Boeing 737", section: "^Comparison of variants", columns: { "737-100": "B731", "737-200": "B732" }, capacity: "max" },
      one("Boeing 737", "B732"), // 737-200
      {
        article: "Boeing 737 Classic",
        section: "^Comparison of variants",
        columns: { "737-300": "B733", "737-400": "B734", "737-500": "B735" },
        capacity: "max",
      },
      one("Boeing 737 Classic", "B733"), // 737-300
      {
        article: "Boeing 737 Next Generation",
        section: "^Comparison of variants",
        columns: { "737-600": "B736", "737-700": "B737", "737-800": "B738", "737-900ER": "B739" },
        capacity: "max",
      },
      one("Boeing 737 Next Generation", "B738"), // 737-800
      {
        article: "Boeing 737 MAX",
        section: "^Comparison$",
        columns: { "737 MAX 7": "B37M", "737 MAX 8": "B38M", "737 MAX 9": "B39M", "737 MAX 10": "B3XM" },
      },
      { article: "Boeing 737 MAX", columns: { "MAX 8 with LEAP-1B28": "B38M", "MAX 9": "B39M", "MAX 10": "B3XM" } },
      one("Boeing P-8 Poseidon", "P8"),
      one("Boeing E-7 Wedgetail", "E737"),
    ],
  },
  {
    familyId: "B747",
    main: "Boeing 747",
    sources: [
      one("Boeing 747", "B742", { linkOnly: ["B741", "B743", "B74R"] }), // 747-200B
      { article: "Boeing 747-400", section: "^Comparison$", columns: { "747-400": "B744" } },
      one("Boeing 747-400", "B744"),
      one("Boeing 747-8", "B748"), // 747-8 Intercontinental
      one("Boeing 747SP", "B74S"),
      { article: "Boeing Dreamlifter", columns: { "747 Dreamlifter": "BLCF" } },
    ],
  },
  {
    familyId: "B757",
    main: "Boeing 757",
    sources: [
      { article: "Boeing 757", section: "^Comparison$", columns: { "757-200": "B752", "757-300": "B753" } },
      one("Boeing 757", "B752"), // 757-200
    ],
  },
  {
    familyId: "B767",
    main: "Boeing 767",
    sources: [
      {
        article: "Boeing 767",
        section: "^Comparison$",
        columns: { "767-200ER": "B762", "767-300ER/F": "B763", "767-400ER": "B764" },
        capacity: "max",
      },
      one("Boeing 767", "B763"), // 767-300ER
      one("Boeing E-767", "E767"),
    ],
  },
  {
    familyId: "B777",
    main: "Boeing 777",
    sources: [
      {
        article: "Boeing 777",
        section: "^Comparison$",
        columns: {
          "777-200/200ER": { type: "B772", part: "200ER" },
          "777-300": "B773",
          "777-300ER": { type: "B77W", part: "300ER" },
          "777-200LR/777F": { type: "B77L", part: "200LR" },
        },
      },
      one("Boeing 777", "B77W"), // 777-300ER
      { article: "Boeing 777X", section: "^Comparison$", columns: { "777-8": "B778", "777-9": "B779" } },
      one("Boeing 777X", "B779"), // 777-9
    ],
  },
  {
    familyId: "B787",
    main: "Boeing 787 Dreamliner",
    sources: [
      { article: "Boeing 787 Dreamliner", section: "^Comparison$", columns: { "787-8": "B788", "787-9": "B789", "787-10": "B78X" } },
      one("Boeing 787 Dreamliner", "B789"), // 787-9 iMTOW
    ],
  },
  { familyId: "C17", main: "Boeing C-17 Globemaster III", sources: [one("Boeing C-17 Globemaster III", "C17")] },

  // McDonnell Douglas, Douglas, Lockheed
  { familyId: "DC3", main: "Douglas DC-3", sources: [one("Douglas DC-3", "DC3")] },
  {
    familyId: "DC8",
    main: "Douglas DC-8",
    sources: [
      {
        article: "Douglas DC-8",
        columns: {
          "-40/43/50/55": { type: "DC85", part: "50|-50/55|-40/50" },
          "-63/73": [
            { type: "DC86", part: "63|Super 62H/63" },
            { type: "DC87", part: "73|Super 70" },
          ],
        },
      },
    ],
  },
  {
    familyId: "DC9",
    main: "McDonnell Douglas DC-9",
    sources: [{ article: "McDonnell Douglas DC-9", columns: { "-15": "DC91", "-21": "DC92", "-32": "DC93", "-41": "DC94", "-51": "DC95" } }],
  },
  { familyId: "DC10", main: "McDonnell Douglas DC-10", sources: [{ article: "McDonnell Douglas DC-10", columns: { "-30": "DC10" } }] },
  { familyId: "MD11", main: "McDonnell Douglas MD-11", sources: [{ article: "McDonnell Douglas MD-11", columns: { "MD-11": "MD11" } }] },
  {
    familyId: "MD80",
    main: "McDonnell Douglas MD-80",
    sources: [
      {
        article: "McDonnell Douglas MD-80",
        columns: {
          "MD-81/82/83/88": [
            { type: "MD81", part: "81" },
            { type: "MD82", part: "82" },
            { type: "MD83", part: "83" },
            { type: "MD88", part: "88" },
          ],
          "MD-87": "MD87",
        },
      },
    ],
  },
  { familyId: "MD90", main: "McDonnell Douglas MD-90", sources: [one("McDonnell Douglas MD-90", "MD90")] }, // MD-90-30
  { familyId: "L1011", main: "Lockheed L-1011 TriStar", sources: [{ article: "Lockheed L-1011 TriStar", columns: { "L-1011-1": "L101" } }] },
  {
    familyId: "C130",
    main: "Lockheed C-130 Hercules",
    sources: [one("Lockheed C-130 Hercules", "C130"), one("Lockheed Martin C-130J Super Hercules", "C30J")], // C-130H
  },
  { familyId: "C5", main: "Lockheed C-5 Galaxy", sources: [one("Lockheed C-5 Galaxy", "C5M", { linkOnly: ["C5"] })] },

  // Embraer
  { familyId: "E170", main: "Embraer E-Jet family", sources: [{ article: "Embraer E-Jet family", columns: { E170: "E170" } }] },
  {
    familyId: "E175",
    main: "Embraer E-Jet family",
    sources: [
      // The wingspan cell gives "STD" (26.01 m) and "LR" (28.65 m): the short and the long wing.
      { article: "Embraer E-Jet family", columns: { E175: [{ type: "E75S", part: "STD" }, { type: "E75L", part: "LR" }] } },
      { article: "Embraer E-Jet E2 family", columns: { "E175-E2": "E275" } },
    ],
  },
  {
    familyId: "E190",
    main: "Embraer E-Jet family",
    sources: [
      { article: "Embraer E-Jet family", columns: { E190: "E190" } },
      { article: "Embraer E-Jet E2 family", columns: { "E190-E2": "E290" } },
    ],
  },
  {
    familyId: "E195",
    main: "Embraer E-Jet family",
    sources: [
      { article: "Embraer E-Jet family", columns: { E195: "E195" } },
      { article: "Embraer E-Jet E2 family", columns: { "E195-E2": "E295" } },
    ],
  },
  {
    familyId: "E145",
    main: "Embraer ERJ family",
    sources: [{ article: "Embraer ERJ family", columns: { "ERJ 135LR": "E135", "ERJ 145XR": "E45X" }, linkOnly: ["E145"] }],
  },
  { familyId: "E120", main: "Embraer EMB 120 Brasilia", sources: [one("Embraer EMB 120 Brasilia", "E120")] },
  { familyId: "E110", main: "Embraer EMB 110 Bandeirante", sources: [one("Embraer EMB 110 Bandeirante", "E110")] },
  { familyId: "C390", main: "Embraer C-390 Millennium", sources: [one("Embraer C-390 Millennium", "E390")] },
  { familyId: "Phenom100", main: "Embraer Phenom 100", sources: [one("Embraer Phenom 100", "E50P")] },
  { familyId: "Phenom300", main: "Embraer Phenom 300", sources: [one("Embraer Phenom 300", "E55P")] },
  {
    familyId: "Embraer Legacy/Praetor",
    main: "Embraer Legacy 600",
    sources: [
      { article: "Embraer Legacy 600", columns: { "Legacy 600": "E35L" } },
      { article: "Embraer Legacy 450/500 and Praetor 500/600", columns: { "Legacy 450": "E545", "Legacy 500": "E550" } },
    ],
  },

  // Bombardier, Canadair, Learjet
  {
    familyId: "CRJ",
    main: "Bombardier CRJ100/200",
    sources: [
      { article: "Bombardier CRJ100/200", columns: { CRJ100: "CRJ1", CRJ200: "CRJ2" } },
      {
        article: "Bombardier CRJ700 series",
        section: "^Comparison of variants",
        columns: { CRJ700: "CRJ7", CRJ900: "CRJ9", CRJ1000: "CRJX" },
      },
      one("Bombardier CRJ700 series", "CRJ9"), // CRJ900
    ],
  },
  { familyId: "CL30", main: "Bombardier Challenger 300", sources: [{ article: "Bombardier Challenger 300", columns: { "Challenger 300": "CL30" } }] },
  { familyId: "CL35", main: "Bombardier Challenger 300", sources: [{ article: "Bombardier Challenger 300", columns: { "Challenger 350": "CL35" } }] },
  { familyId: "CL60", main: "Bombardier Challenger 600 series", sources: [one("Bombardier Challenger 600 series", "CL60")] }, // Challenger 650
  {
    familyId: "Global",
    main: "Bombardier Global Express",
    sources: [
      { article: "Bombardier Global Express", columns: { "Global 5000": "GL5T", "Global 6000": "GLEX" } },
      { article: "Bombardier Global 7500", columns: { "Global 7500": "GL7T" } },
    ],
  },
  {
    familyId: "Learjet",
    sources: [
      one("Learjet 23", "LJ23"),
      one("Learjet 24", "LJ24"), // 24F
      one("Learjet 25", "LJ25"), // 25D
      one("Learjet 28", "LJ28"),
      one("Learjet 31", "LJ31"),
      one("Learjet 35", "LJ35"), // the article's list is for the 36A, a model of the same designator
      one("Learjet 40", "LJ40"),
      one("Learjet 45", "LJ45"),
      one("Learjet 70/75", "LJ75", { linkOnly: ["LJ70"] }), // Learjet 75
      one("Learjet 55", "LJ55"),
      one("Learjet 60", "LJ60"),
    ],
  },

  // De Havilland Canada
  {
    familyId: "Dash8",
    main: "De Havilland Canada Dash 8",
    sources: [
      {
        article: "De Havilland Canada Dash 8",
        columns: {
          "Q200(-100)": [
            { type: "DH8A", part: "100" },
            { type: "DH8B", part: "200" },
          ],
          Q300: "DH8C",
          Q400: "DH8D",
        },
      },
    ],
  },
  { familyId: "DHC7", main: "De Havilland Canada Dash 7", sources: [one("De Havilland Canada Dash 7", "DHC7")] },
  { familyId: "DHC6", main: "De Havilland Canada DHC-6 Twin Otter", sources: [{ article: "De Havilland Canada DHC-6 Twin Otter", columns: { "300": "DHC6" } }] },
  { familyId: "DHC2", main: "De Havilland Canada DHC-2 Beaver", sources: [one("De Havilland Canada DHC-2 Beaver", "DHC2")] },
  { familyId: "DHC3", main: "De Havilland Canada DHC-3 Otter", sources: [one("De Havilland Canada DHC-3 Otter", "DHC3")] },

  // Other regional and transport aircraft
  {
    familyId: "ATR42",
    main: "ATR 42",
    sources: [{ article: "ATR 42", columns: { "ATR 42-300": "AT43", "ATR 42-400": "AT44", "ATR 42-500": "AT45", "ATR 42-600": "AT46" } }],
  },
  {
    familyId: "ATR72",
    main: "ATR 72",
    sources: [{ article: "ATR 72", columns: { "ATR 72-200": "AT72", "ATR-72-210": "AT73", "ATR 72-500": "AT75", "ATR 72-600": "AT76" } }],
  },
  { familyId: "SF34", main: "Saab 340", sources: [one("Saab 340", "SF34")] }, // 340B
  { familyId: "SB20", main: "Saab 2000", sources: [one("Saab 2000", "SB20")] },
  { familyId: "F27", main: "Fokker F27 Friendship", sources: [one("Fokker F27 Friendship", "F27")] },
  { familyId: "F28", main: "Fokker F28 Fellowship", sources: [{ article: "Fokker F28 Fellowship", columns: { "-4000": "F28" } }] },
  { familyId: "F50", main: "Fokker 50", sources: [one("Fokker 50", "F50")] },
  { familyId: "F100", main: "Fokker 100", sources: [one("Fokker 70", "F70"), one("Fokker 100", "F100")] },
  {
    familyId: "BAe146",
    main: "British Aerospace 146",
    sources: [
      {
        article: "British Aerospace 146",
        columns: {
          "-100/RJ70": [
            { type: "B461", part: "BAe 146" },
            { type: "RJ70", part: "Avro RJ" },
          ],
          "-200/RJ85": [
            { type: "B462", part: "BAe 146" },
            { type: "RJ85", part: "Avro RJ" },
          ],
          "-300/RJ100": [
            { type: "B463", part: "BAe 146" },
            { type: "RJ1H", part: "Avro RJ" },
          ],
        },
      },
    ],
  },
  {
    familyId: "Jetstream",
    main: "British Aerospace Jetstream",
    sources: [one("British Aerospace Jetstream", "JS31", { linkOnly: ["JS32"] }), one("British Aerospace Jetstream 41", "JS41")],
  },
  { familyId: "D328", main: "Dornier 328", sources: [one("Dornier 328", "D328"), one("Fairchild Dornier 328JET", "J328")] },
  { familyId: "B190", main: "Beechcraft 1900", sources: [one("Beechcraft 1900", "B190")] }, // 1900D
  { familyId: "L410", main: "Let L-410 Turbolet", sources: [one("Let L-410 Turbolet", "L410")] },
  { familyId: "SSJ100", main: "Yakovlev SJ-100", sources: [{ article: "Yakovlev SJ-100", columns: { "95B": "SU95" } }] },
  { familyId: "MC21", main: "Yakovlev MC-21", sources: [{ article: "Yakovlev MC-21", columns: { "MC-21-300": "MC23" } }] },
  { familyId: "ARJ21", main: "Comac C909", sources: [{ article: "Comac C909", columns: { "ARJ21-700 STD": "AJ27" } }] },
  { familyId: "C919", main: "Comac C919", sources: [{ article: "Comac C919", columns: { "C919-100 STD": "C919" } }] },
  { familyId: "An148", main: "Antonov An-148", sources: [{ article: "Antonov An-148", columns: { "148-100E": "A148", "158 *": "A158" } }] },
  { familyId: "An124", main: "Antonov An-124 Ruslan", sources: [one("Antonov An-124 Ruslan", "A124")] },
  { familyId: "An225", main: "Antonov An-225 Mriya", sources: [one("Antonov An-225 Mriya", "A225")] },
  { familyId: "Il76", main: "Ilyushin Il-76", sources: [one("Ilyushin Il-76", "IL76")] }, // Il-76MD-90AE
  { familyId: "Il96", main: "Ilyushin Il-96", sources: [{ article: "Ilyushin Il-96", columns: { "Il-96-300": "IL96" } }] },
  { familyId: "Tu154", main: "Tupolev Tu-154", sources: [{ article: "Tupolev Tu-154", columns: { "Tu-154M": "T154" } }] },
  { familyId: "Tu204", main: "Tupolev Tu-204", sources: [{ article: "Tupolev Tu-204", columns: { "204-100 / 204-120": { type: "T204", part: "100" } } }] },
  { familyId: "Concorde", main: "Concorde", sources: [one("Concorde", "CONC")] },

  // Business jets
  {
    familyId: "Cessna Citation",
    main: "Cessna Citation family",
    sources: [
      one("Cessna Citation I", "C500", { linkOnly: ["C501"] }),
      one("Cessna Citation Mustang", "C510"),
      { article: "Cessna CitationJet/M2", columns: { "M2 (CJ1)": ["C525", "C25M"], "CJ2+": "C25A", "CJ3+": "C25B", CJ4: "C25C" } },
      one("Cessna Citation II", "C550", { linkOnly: ["C551", "C55B"] }), // S550 Citation S/II
      one("Cessna Citation V", "C560"), // Citation Ultra
      one("Cessna Citation Excel", "C56X"), // Citation XLS+
      one("Cessna Citation III", "C650"), // III/VI
      one("Cessna Citation Sovereign", "C680"), // Sovereign+
      one("Cessna Citation Latitude", "C68A"),
      one("Cessna Citation Longitude", "C700"),
      { article: "Cessna Citation X", columns: { "Citation X": "C750" } },
    ],
  },
  // The article's figures are the G100's, a model of its own designator.
  { familyId: "G150", main: "Gulfstream G100", sources: [{ article: "Gulfstream G100", columns: {}, linkOnly: ["G150"] }] },
  { familyId: "G200", main: "Gulfstream G200", sources: [one("Gulfstream G200", "GALX")] },
  { familyId: "G280", main: "Gulfstream G280", sources: [one("Gulfstream G280", "G280")] },
  { familyId: "G450", main: "Gulfstream IV", sources: [{ article: "Gulfstream IV", columns: { G450: "GLF4" } }] },
  { familyId: "G550", main: "Gulfstream V", sources: [one("Gulfstream V", "GLF5")] },
  {
    familyId: "G500",
    main: "Gulfstream G400/G500/G600",
    sources: [{ article: "Gulfstream G400/G500/G600", columns: { G400: "GA4C", G500: "GA5C", G600: "GA6C" } }],
  },
  { familyId: "G650", main: "Gulfstream G650/G700/G800", sources: [{ article: "Gulfstream G650/G700/G800", columns: { G650: "GLF6" } }] },
  { familyId: "G700", main: "Gulfstream G650/G700/G800", sources: [{ article: "Gulfstream G650/G700/G800", columns: { G700: "GA7C", G800: "GA8C" } }] },
  { familyId: "FA50", main: "Dassault Falcon 50", sources: [one("Dassault Falcon 50", "FA50")] }, // 50EX
  { familyId: "F900", main: "Dassault Falcon 900", sources: [one("Dassault Falcon 900", "F900")] }, // 900B
  { familyId: "F2TH", main: "Dassault Falcon 2000", sources: [one("Dassault Falcon 2000", "F2TH")] }, // 2000LXS
  { familyId: "FA7X", main: "Dassault Falcon 7X", sources: [{ article: "Dassault Falcon 7X", columns: { "7X": "FA7X" } }] },
  { familyId: "FA8X", main: "Dassault Falcon 7X", sources: [{ article: "Dassault Falcon 7X", columns: { "8X": "FA8X" } }] },
  { familyId: "FA6X", main: "Dassault Falcon 6X", sources: [{ article: "Dassault Falcon 6X", columns: { "Falcon 6X": "FA6X" } }] },
  {
    familyId: "Hawker",
    main: "British Aerospace 125",
    sources: [one("Hawker 800", "H25B"), { article: "British Aerospace 125", columns: {}, linkOnly: ["H25C"] }],
  },
  { familyId: "HondaJet", main: "Honda HA-420 HondaJet", sources: [{ article: "Honda HA-420 HondaJet", columns: { HondaJet: "HDJT" } }] },
  { familyId: "PC24", main: "Pilatus PC-24", sources: [one("Pilatus PC-24", "PC24")] },
  { familyId: "SF50", main: "Cirrus Vision SF50", sources: [one("Cirrus Vision SF50", "SF50")] }, // G2

  // Turboprops and piston aircraft
  { familyId: "PC12", main: "Pilatus PC-12", sources: [one("Pilatus PC-12", "PC12")] }, // PC-12NG
  { familyId: "PC6", main: "Pilatus PC-6 Porter", sources: [one("Pilatus PC-6 Porter", "PC6T")] }, // B2 Turbo-Porter
  {
    familyId: "King Air",
    main: "Beechcraft King Air",
    sources: [
      { article: "Beechcraft King Air", columns: { C90GTi: "BE9L", B100: "BE10" }, linkOnly: ["BE9T"] },
      { article: "Beechcraft Super King Air", columns: { "250": "BE20", "350i": "B350" }, linkOnly: ["BE30"] },
    ],
  },
  { familyId: "TBM", main: "SOCATA TBM", sources: [one("SOCATA TBM", "TBM9", { linkOnly: ["TBM7", "TBM8"] })] }, // TBM 900
  { familyId: "Kodiak", main: "Daher Kodiak", sources: [one("Daher Kodiak", "K100")] },
  { familyId: "P2012", main: "Tecnam P2012 Traveller", sources: [one("Tecnam P2012 Traveller", "P212")] },
  { familyId: "C150", main: "Cessna 150", sources: [one("Cessna 150", "C150")] }, // 150M
  { familyId: "C152", main: "Cessna 152", sources: [one("Cessna 152", "C152")] },
  { familyId: "C172", main: "Cessna 172", sources: [one("Cessna 172", "C172")] }, // 172R
  { familyId: "C177", main: "Cessna 177 Cardinal", sources: [one("Cessna 177 Cardinal", "C177")] }, // 177B
  { familyId: "C180", main: "Cessna 180 Skywagon", sources: [one("Cessna 180 Skywagon", "C180")] },
  { familyId: "C182", main: "Cessna 182 Skylane", sources: [one("Cessna 182 Skylane", "C182")] }, // 182T
  { familyId: "C185", main: "Cessna 185 Skywagon", sources: [one("Cessna 185 Skywagon", "C185")] },
  { familyId: "C206", main: "Cessna 206", sources: [one("Cessna 206", "C206")] }, // 206H
  { familyId: "C208", main: "Cessna 208 Caravan", sources: [one("Cessna 208 Caravan", "C208")] },
  { familyId: "C210", main: "Cessna 210 Centurion", sources: [one("Cessna 210 Centurion", "C210")] }, // T210N
  { familyId: "C310", main: "Cessna 310", sources: [one("Cessna 310", "C310")] },
  { familyId: "C337", main: "Cessna Skymaster", sources: [one("Cessna Skymaster", "C337")] }, // 337D
  { familyId: "C340", main: "Cessna 340", sources: [one("Cessna 340", "C340")] }, // 340A
  { familyId: "C402", main: "Cessna 402", sources: [one("Cessna 402", "C402")] }, // 402C
  { familyId: "C404", main: "Cessna 404 Titan", sources: [one("Cessna 404 Titan", "C404")] },
  { familyId: "C414", main: "Cessna 414", sources: [one("Cessna 414", "C414")] }, // 414A
  { familyId: "C421", main: "Cessna 421 Golden Eagle", sources: [one("Cessna 421 Golden Eagle", "C421")] }, // 421C
  { familyId: "C441", main: "Cessna 441 Conquest II", sources: [one("Cessna 441 Conquest II", "C441")] },
  { familyId: "PA28", main: "Piper PA-28 Cherokee", sources: [one("Piper PA-28 Cherokee", "P28A", { linkOnly: ["P28B", "P28R", "P28T"] })] }, // PA-28-140
  {
    familyId: "PA32",
    main: "Piper PA-32 Cherokee Six",
    sources: [
      one("Piper PA-32 Cherokee Six", "PA32"), // PA-32-300
      one("Piper PA-32R", "P32R", { linkOnly: ["P32T"] }), // Cherokee Lance PA-32R-300
    ],
  },
  { familyId: "PA34", main: "Piper PA-34 Seneca", sources: [one("Piper PA-34 Seneca", "PA34")] }, // Seneca V
  { familyId: "PA44", main: "Piper PA-44 Seminole", sources: [one("Piper PA-44 Seminole", "PA44")] },
  { familyId: "PA31", main: "Piper PA-31 Navajo", sources: [one("Piper PA-31 Navajo", "PA31")] },
  { familyId: "PA46", main: "Piper PA-46", sources: [{ article: "Piper PA-46", columns: { M350: "PA46", M500: "P46T" } }] },
  { familyId: "PA18", main: "Piper PA-18 Super Cub", sources: [one("Piper PA-18 Super Cub", "PA18")] }, // PA-18-150
  { familyId: "J3", main: "Piper J-3 Cub", sources: [one("Piper J-3 Cub", "J3")] }, // J3C-65
  { familyId: "Bonanza", main: "Beechcraft Bonanza", sources: [one("Beechcraft Bonanza", "BE36", { linkOnly: ["BE33", "BE35"] })] }, // G36
  { familyId: "Baron", main: "Beechcraft Baron", sources: [one("Beechcraft Baron", "BE55", { linkOnly: ["BE58"] })] }, // B55
  { familyId: "SR20", main: "Cirrus SR20", sources: [one("Cirrus SR20", "SR20")] }, // SR20-G3
  { familyId: "SR22", main: "Cirrus SR22", sources: [one("Cirrus SR22", "SR22", { linkOnly: ["S22T"] })] }, // SR22-G5
  { familyId: "DA20", main: "Diamond DA20 Katana", sources: [one("Diamond DA20 Katana", "DV20")] }, // DA20-C1
  { familyId: "DA40", main: "Diamond DA40 Diamond Star", sources: [one("Diamond DA40 Diamond Star", "DA40")] }, // DA40 XL
  { familyId: "DA42", main: "Diamond DA42 Twin Star", sources: [one("Diamond DA42 Twin Star", "DA42")] },
  { familyId: "DA62", main: "Diamond DA62", sources: [one("Diamond DA62", "DA62")] },
  { familyId: "M20", main: "Mooney M20", sources: [one("Mooney M20", "M20P", { linkOnly: ["M20T"] })] },

  // Helicopters: spanM is the main rotor diameter; the length each takes is noted.
  { familyId: "R22", main: "Robinson R22", sources: [heli("Robinson R22", "R22")] }, // "Length", not said whether with rotors
  { familyId: "R44", main: "Robinson R44", sources: [heli("Robinson R44", "R44")] }, // "Length", not said whether with rotors
  { familyId: "R66", main: "Robinson R66", sources: [heli("Robinson R66", "R66")] }, // "Length", not said whether with rotors
  { familyId: "Bell 206", main: "Bell 206", sources: [heli("Bell 206", "B06")] }, // "Fuselage length" (206B JetRanger II)
  { familyId: "Bell 407", main: "Bell 407", sources: [heli("Bell 407", "B407")] }, // "Length", not said whether with rotors
  { familyId: "Bell 412", main: "Bell 412", sources: [heli("Bell 412", "B412")] }, // "Fuselage length" (412EP)
  { familyId: "Bell 429", main: "Bell 429 GlobalRanger", sources: [heli("Bell 429 GlobalRanger", "B429")] }, // "Length", not said whether with rotors
  { familyId: "H125", main: "Eurocopter AS350 Écureuil", sources: [heli("Eurocopter AS350 Écureuil", "AS50")] }, // "Length … (fuselage)" (AS350 B3)
  {
    familyId: "H130",
    main: "Eurocopter EC130",
    sources: [{ article: "Eurocopter EC130", columns: { "EC130 T2 (H130)": "EC30" }, rotorcraft: true }], // "Length", not said whether with rotors
  },
  { familyId: "H135", main: "Eurocopter EC135", sources: [heli("Eurocopter EC135", "EC35")] }, // "Length", not said whether with rotors (P2+/T2+)
  { familyId: "H145", main: "Eurocopter EC145", sources: [heli("Eurocopter EC145", "EC45")] }, // "Length", not said whether with rotors (H145)
  { familyId: "AS365", main: "Eurocopter AS365 Dauphin", sources: [heli("Eurocopter AS365 Dauphin", "AS65")] }, // "Length", not said whether with rotors (N3)
  { familyId: "AW109", main: "AgustaWestland AW109", sources: [heli("AgustaWestland AW109", "A109")] }, // "Length … fuselage" (AW109 Power)
  { familyId: "AW139", main: "AgustaWestland AW139", sources: [heli("AgustaWestland AW139", "A139")] }, // "Length", not said whether with rotors
  { familyId: "S76", main: "Sikorsky S-76", sources: [heli("Sikorsky S-76", "S76")] }, // "Length … from tip of main rotor to tip of tail rotor" (S-76C++)
  { familyId: "S92", main: "Sikorsky S-92", sources: [heli("Sikorsky S-92", "S92")] }, // "Length", not said whether with rotors
  { familyId: "H60", main: "Sikorsky UH-60 Black Hawk", sources: [heli("Sikorsky UH-60 Black Hawk", "H60")] }, // "Fuselage length" (UH-60M)
];

/** Values the parser cannot read (or reads wrongly) but the mapped article states, at the revision written to the table. */
export const typeSpecOverrides: Record<string, Partial<TypeSpecValues>> = {
  // Airbus A300, "Specifications" table, row "Main deck": "281/309Y @ 34/31 in) max 345" (A300B4-200) and
  // "247 (46F + 201Y)/285Y @ 34 in max 345" (A300-600R); the row's label does not say seats.
  A30B: { seatsTypical: 281, seatsMax: 345 },
  A306: { seatsTypical: 247, seatsMax: 345 },
  // Airbus A380, "Specifications" table, row "Engines (4×)": Trent 970/972 on the -841/-842, GP7270 on the -861.
  A388: { engines: "4 × Rolls-Royce Trent 970/972 or Engine Alliance GP7270" },
  // Ilyushin Il-96, "Specifications" table, row "Seats (3/2/1-class)": 237/263/300 for the Il-96-300.
  IL96: { seatsTypical: 263, seatsMax: 300 },
  // Airbus A350, "Wing": "a wingspan that is common to the proposed variants. Its 64.75 m (212.4 ft) wingspan …",
  // "The A350's wing has a 31.9° sweep angle".
  A359: { sweepDeg: 31.9 },
  A35K: { spanM: 64.75, sweepDeg: 31.9 },
  // Boeing 787, "787-9": "Keeping the same wingspan as the 787-8"; "Specifications (787-9 …)": 197 ft 3 in (60.12 m).
  B788: { spanM: 60.12 },
  // Boeing 727, "The wing span and height remain the same on both the -100 and -200 (108 … feet (33 … m))";
  // "Specifications (Boeing 727-100 …)": 108 ft 0 in (32.92 m).
  B722: { spanM: 32.92 },
  // Boeing 777X, "Comparison" table, row "Engine (×2)": one cell for both models, a list of the GE9X's versions;
  // "Specifications (777-9)", "Powerplant: 2 × General Electric GE9X-105B1A and subvariants".
  B778: { engines: "2 × General Electric GE9X" },
  B779: { engines: "2 × General Electric GE9X" },
  // Antonov An-124, "Specifications": the 88 passengers sit in the upper deck behind the cockpit of a freighter.
  A124: { seatsTypical: null, seatsMax: null },
  // Bombardier Challenger 300, "Specifications" table, row "Capacity": "Max 19 occupants (including the crew and no
  // more than 16 passengers). Typically 8 or 9 max passenger seating capacity".
  CL30: { seatsTypical: 8, seatsMax: 16 },
  CL35: { seatsTypical: 8, seatsMax: 16 },
  // Cessna Citation III, "Specifications (III/VI)", "Cruise speed": 472 kn is the maximum and 476 kn the VII's.
  C650: { cruiseKmh: null },
  // McDonnell Douglas DC-9, "Specifications" table, row "Engine (2×)": the row's first cell names the JT8D, the
  // variants' cells only its models ("-9/11").
  DC92: { engines: "2 × Pratt & Whitney JT8D-9/11" },
  DC93: { engines: "2 × Pratt & Whitney JT8D-1/5/7/9/11/15/17" },
  DC94: { engines: "2 × Pratt & Whitney JT8D-9/11/15/17" },
  DC95: { engines: "2 × Pratt & Whitney JT8D-15/17" },
  DC91: { engines: "2 × Pratt & Whitney JT8D-1/5/7/9/11/15/17" },
  // McDonnell Douglas MD-11, "Specifications" table, row "Main deck": "298: 16F + 56J + 226Y or 323: 34J + 289Y or
  // 410Y, 10-abreast" (three classes, two classes, one class).
  MD11: { seatsTypical: 323, seatsMax: 410 },
  // McDonnell Douglas MD-90, "Specifications (MD-90-30)" table, row "Fuselage": "131.6×142 in (334.3×360.7 cm)
  // width × height".
  MD90: { fuselageWidthM: 3.343 },
};

/** Infobox values the parser cannot read, from the family's main article. */
export const familyFactOverrides: Record<string, Partial<FamilyFactValues>> = {
  // Gulfstream G400/G500/G600, infobox "Number built": one count for each model ("G400: 4 G500: 125+ G600: 200+").
  G500: { built: null },
};
