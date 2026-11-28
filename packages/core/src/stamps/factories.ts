// Factory airfields, for the factory stamps (docs/24-statistics.md, "Factory airfields"): where each maker's aircraft
// are finally assembled, flown off the line or delivered, and the years the site did it. Each site names the source it
// was checked against. Curated by hand: a site that opens or closes is a line here. Only the makers the aircraft types
// pages show as popular for every role (`POPULAR_MAKERS.all`), so that the stamps stay few and well known.

export interface FactorySite {
  /** The airfield's ICAO code, as the reference tables hold it. */
  icao: string;
  /** What the site builds, for the reader of this file. */
  builds: string;
  /** The first and the last year of building there; `to` null while it still builds. */
  from: number;
  to: number | null;
  source: string;
}

export interface Factory {
  /** Stable, in the stamp's id: `factory.<id>`. */
  id: string;
  /** The maker as the stamp names it, in the reference tables' spelling. */
  maker: string;
  /** The values of the reference types' `manufacturer` that count as built by it. */
  manufacturers: readonly string[];
  sites: readonly FactorySite[];
}

export const FACTORIES: readonly Factory[] = [
  {
    id: "boeing",
    maker: "Boeing",
    manufacturers: ["Boeing"],
    sites: [
      { icao: "KPAE", builds: "747 (to 2022), 767, 777, 787 (to 2021)", from: 1967, to: null, source: "https://en.wikipedia.org/wiki/Boeing_Everett_Factory" },
      { icao: "KRNT", builds: "707, 727, 737, 757 (to 2004)", from: 1957, to: null, source: "https://en.wikipedia.org/wiki/Boeing_Renton_Factory" },
      { icao: "KBFI", builds: "the first 737s, then Renton's 737s finished, flight-tested and delivered", from: 1967, to: null, source: "https://en.wikipedia.org/wiki/King_County_International_Airport" },
      { icao: "KCHS", builds: "787, the only line since 2021", from: 2011, to: null, source: "https://en.wikipedia.org/wiki/Boeing_South_Carolina" },
      { icao: "KLGB", builds: "717 and C-17, after the merger with McDonnell Douglas", from: 1997, to: 2015, source: "https://boeing.mediaroom.com/2006-05-23-Boeing-Delivers-Final-717s-Concludes-Commercial-Production-in-California" },
    ],
  },
  {
    id: "mcdonnellDouglas",
    maker: "McDonnell Douglas",
    manufacturers: ["McDonnell Douglas", "Douglas"],
    sites: [
      // The MD-11, the last of the line, was delivered in 2001, under Boeing.
      { icao: "KLGB", builds: "DC-8, DC-9, DC-10, MD-80, MD-90, MD-11", from: 1941, to: 2001, source: "https://boeing.mediaroom.com/2006-05-23-Boeing-Delivers-Final-717s-Concludes-Commercial-Production-in-California" },
    ],
  },
  {
    id: "airbus",
    maker: "Airbus",
    manufacturers: ["Airbus"],
    sites: [
      { icao: "LFBO", builds: "A300 and A310 (to 2007), A320, A330, A340, A350, A380 (to 2021), the Belugas", from: 1972, to: null, source: "https://en.wikipedia.org/wiki/Airbus" },
      { icao: "EDHI", builds: "A320 family, the A321 first", from: 1993, to: null, source: "https://en.wikipedia.org/wiki/Airbus_A321" },
      { icao: "ZBTJ", builds: "A320 family, and A330 completion", from: 2008, to: null, source: "https://www.airbus.com/en/newsroom/press-releases/2017-09-airbus-inaugurates-its-a330-completion-delivery-centre-in-china" },
      { icao: "KBFM", builds: "A320 family, and the A220 from 2019", from: 2015, to: null, source: "https://en.wikipedia.org/wiki/Airbus_Mobile" },
      { icao: "CYMX", builds: "A220, the CSeries until Airbus took it over in 2018", from: 2013, to: null, source: "https://en.wikipedia.org/wiki/Airbus_A220" },
    ],
  },
  {
    id: "embraer",
    maker: "Embraer",
    manufacturers: ["Embraer"],
    sites: [
      { icao: "SBSJ", builds: "E-Jets, E1 and E2", from: 1969, to: null, source: "https://www.aero-mag.com/embraer-e190-e2-passenger-jets-pratt-whitney-pw1000g-engines" },
      { icao: "KMLB", builds: "Phenom, Praetor and Legacy 450 and 500", from: 2011, to: null, source: "https://www.ainonline.com/aviation-news/business-aviation/2017-04-24/embraer-assemble-bulk-legacy-450/500s-florida" },
    ],
  },
  {
    id: "comac",
    maker: "COMAC",
    manufacturers: ["COMAC"],
    sites: [
      { icao: "ZSPD", builds: "C919, and a second ARJ21 line from 2020", from: 2017, to: null, source: "https://en.wikipedia.org/wiki/Comac_ARJ21" },
    ],
  },
  {
    id: "bombardier",
    maker: "Bombardier",
    manufacturers: ["Bombardier"],
    sites: [
      { icao: "CYUL", builds: "Challenger, and CRJ100 and 200 (1991 to 2006)", from: 1980, to: null, source: "https://en.wikipedia.org/wiki/Bombardier_Aviation" },
      // The year CRJ700 assembly moved here from Dorval is not confirmed: 1999 is the CRJ700's first flight.
      { icao: "CYMX", builds: "CRJ700, 900 and 1000", from: 1999, to: 2020, source: "https://en.wikipedia.org/wiki/Bombardier_Aviation" },
      { icao: "CYYZ", builds: "Global, after Downsview", from: 2023, to: null, source: "https://www.flightglobal.com/business-aviation/bombardier-brings-new-global-production-site-in-toronto-fully-online/158104.article" },
      { icao: "KICT", builds: "Learjet, while Bombardier owned it", from: 1990, to: 2021, source: "https://en.wikipedia.org/wiki/Learjet" },
    ],
  },
  {
    id: "lockheed",
    maker: "Lockheed",
    manufacturers: ["Lockheed"],
    sites: [
      { icao: "KPMD", builds: "L-1011 TriStar", from: 1968, to: 1984, source: "https://en.wikipedia.org/wiki/Palmdale_Regional_Airport" },
    ],
  },
];

/** The freighters that carry aircraft parts between factories: the Beluga, the BelugaXL and the Dreamlifter. */
export const PARTS_FREIGHTERS: readonly string[] = ["A3ST", "A337", "BLCF"];
