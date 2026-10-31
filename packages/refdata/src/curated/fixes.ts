// Small manual fixes applied on top of the downloaded sources by scripts/build.ts.

import type { Operator, WakeCategory } from "../../../core/src/ref/types.ts";

/**
 * Time zone for an airport in a country that has a single IANA zone. Used when airportsdata has no
 * entry for the airport. Countries with several zones are not listed; their airports need an entry
 * in airportTzFixes.
 */
export const singleZoneCountryTz: Record<string, string> = {
  AE: "Asia/Dubai", AF: "Asia/Kabul", AG: "America/Antigua", AI: "America/Anguilla", AL: "Europe/Tirane",
  AM: "Asia/Yerevan", AO: "Africa/Luanda", AS: "Pacific/Pago_Pago", AT: "Europe/Vienna", AW: "America/Aruba",
  AZ: "Asia/Baku", BA: "Europe/Sarajevo", BB: "America/Barbados", BD: "Asia/Dhaka", BE: "Europe/Brussels",
  BF: "Africa/Ouagadougou", BG: "Europe/Sofia", BH: "Asia/Bahrain", BI: "Africa/Bujumbura", BJ: "Africa/Porto-Novo",
  BL: "America/St_Barthelemy", BM: "Atlantic/Bermuda", BN: "Asia/Brunei", BO: "America/La_Paz", BQ: "America/Kralendijk",
  BS: "America/Nassau", BT: "Asia/Thimphu", BW: "Africa/Gaborone", BY: "Europe/Minsk", BZ: "America/Belize",
  CC: "Indian/Cocos", CF: "Africa/Bangui", CG: "Africa/Brazzaville", CH: "Europe/Zurich", CI: "Africa/Abidjan",
  CK: "Pacific/Rarotonga", CM: "Africa/Douala", CN: "Asia/Shanghai", CO: "America/Bogota", CR: "America/Costa_Rica",
  CU: "America/Havana", CV: "Atlantic/Cape_Verde", CW: "America/Curacao", CX: "Indian/Christmas", CY: "Asia/Nicosia",
  CZ: "Europe/Prague", DE: "Europe/Berlin", DJ: "Africa/Djibouti", DK: "Europe/Copenhagen", DM: "America/Dominica",
  DO: "America/Santo_Domingo", DZ: "Africa/Algiers", EE: "Europe/Tallinn", EG: "Africa/Cairo", EH: "Africa/El_Aaiun",
  ER: "Africa/Asmara", ET: "Africa/Addis_Ababa", FI: "Europe/Helsinki", FJ: "Pacific/Fiji", FK: "Atlantic/Stanley",
  FO: "Atlantic/Faroe", FR: "Europe/Paris", GA: "Africa/Libreville", GB: "Europe/London", GD: "America/Grenada",
  GE: "Asia/Tbilisi", GF: "America/Cayenne", GG: "Europe/Guernsey", GH: "Africa/Accra", GI: "Europe/Gibraltar",
  GM: "Africa/Banjul", GN: "Africa/Conakry", GP: "America/Guadeloupe", GQ: "Africa/Malabo", GR: "Europe/Athens",
  GT: "America/Guatemala", GU: "Pacific/Guam", GW: "Africa/Bissau", GY: "America/Guyana", HK: "Asia/Hong_Kong",
  HN: "America/Tegucigalpa", HR: "Europe/Zagreb", HT: "America/Port-au-Prince", HU: "Europe/Budapest", IE: "Europe/Dublin",
  IL: "Asia/Jerusalem", IM: "Europe/Isle_of_Man", IN: "Asia/Kolkata", IO: "Indian/Chagos", IQ: "Asia/Baghdad",
  IR: "Asia/Tehran", IS: "Atlantic/Reykjavik", IT: "Europe/Rome", JE: "Europe/Jersey", JM: "America/Jamaica",
  JO: "Asia/Amman", JP: "Asia/Tokyo", KE: "Africa/Nairobi", KG: "Asia/Bishkek", KH: "Asia/Phnom_Penh",
  KM: "Indian/Comoro", KN: "America/St_Kitts", KP: "Asia/Pyongyang", KR: "Asia/Seoul", KW: "Asia/Kuwait",
  KY: "America/Cayman", LA: "Asia/Vientiane", LB: "Asia/Beirut", LC: "America/St_Lucia", LK: "Asia/Colombo",
  LR: "Africa/Monrovia", LS: "Africa/Maseru", LT: "Europe/Vilnius", LU: "Europe/Luxembourg", LV: "Europe/Riga",
  LY: "Africa/Tripoli", MA: "Africa/Casablanca", MD: "Europe/Chisinau", ME: "Europe/Podgorica", MF: "America/Marigot",
  MG: "Indian/Antananarivo", MK: "Europe/Skopje", ML: "Africa/Bamako", MM: "Asia/Yangon", MO: "Asia/Macau",
  MP: "Pacific/Saipan", MQ: "America/Martinique", MR: "Africa/Nouakchott", MS: "America/Montserrat", MT: "Europe/Malta",
  MU: "Indian/Mauritius", MV: "Indian/Maldives", MW: "Africa/Blantyre", MZ: "Africa/Maputo", NA: "Africa/Windhoek",
  NC: "Pacific/Noumea", NE: "Africa/Niamey", NF: "Pacific/Norfolk", NG: "Africa/Lagos", NI: "America/Managua",
  NL: "Europe/Amsterdam", NP: "Asia/Kathmandu", NR: "Pacific/Nauru", NU: "Pacific/Niue", OM: "Asia/Muscat",
  PA: "America/Panama", PE: "America/Lima", PH: "Asia/Manila", PK: "Asia/Karachi", PL: "Europe/Warsaw",
  PM: "America/Miquelon", PW: "Pacific/Palau", PY: "America/Asuncion", QA: "Asia/Qatar", RE: "Indian/Reunion",
  RO: "Europe/Bucharest", RS: "Europe/Belgrade", RW: "Africa/Kigali", SA: "Asia/Riyadh", SB: "Pacific/Guadalcanal",
  SC: "Indian/Mahe", SD: "Africa/Khartoum", SE: "Europe/Stockholm", SG: "Asia/Singapore", SH: "Atlantic/St_Helena",
  SI: "Europe/Ljubljana", SK: "Europe/Bratislava", SL: "Africa/Freetown", SN: "Africa/Dakar", SO: "Africa/Mogadishu",
  SR: "America/Paramaribo", SS: "Africa/Juba", ST: "Africa/Sao_Tome", SV: "America/El_Salvador", SX: "America/Lower_Princes",
  SY: "Asia/Damascus", SZ: "Africa/Mbabane", TD: "Africa/Ndjamena", TG: "Africa/Lome", TH: "Asia/Bangkok",
  TJ: "Asia/Dushanbe", TL: "Asia/Dili", TM: "Asia/Ashgabat", TN: "Africa/Tunis", TO: "Pacific/Tongatapu",
  TR: "Europe/Istanbul", TT: "America/Port_of_Spain", TV: "Pacific/Funafuti", TW: "Asia/Taipei", TZ: "Africa/Dar_es_Salaam",
  UG: "Africa/Kampala", UY: "America/Montevideo", UZ: "Asia/Tashkent", VC: "America/St_Vincent", VE: "America/Caracas",
  VG: "America/Tortola", VN: "Asia/Ho_Chi_Minh", VU: "Pacific/Efate", WF: "Pacific/Wallis", WS: "Pacific/Apia",
  XK: "Europe/Belgrade", YE: "Asia/Aden", YT: "Indian/Mayotte", ZA: "Africa/Johannesburg", ZM: "Africa/Lusaka",
  ZW: "Africa/Harare",
};

/**
 * Time zones for airports in countries with several zones that airportsdata does not cover.
 * Keyed by airport id. Military bases without an IATA code are left out on purpose.
 */
export const airportTzFixes: Record<string, string> = {
  "ap_ar-0767": "America/Argentina/Cordoba", // Misiones
  "ap_br-2182": "America/Fortaleza", // Ceará
  "ap_es-0109": "Europe/Madrid", // Catalonia
  "ap_id-0339": "Asia/Jayapura", // Papua
  "ap_id-0340": "Asia/Jakarta", // West Sumatra
  "ap_id-0341": "Asia/Pontianak", // West Kalimantan
  "ap_mx-2118": "America/Mexico_City", // State of Mexico
  ap_kxta: "America/Los_Angeles", // Nevada
  ap_mmga: "America/Chihuahua", // Chihuahua
  ap_phik: "Pacific/Honolulu",
  "ap_ru-0089": "Europe/Moscow", // Krymsk, Krasnodar Krai
  ap_saov: "America/Argentina/Cordoba", // Córdoba
  ap_sbac: "America/Fortaleza", // Ceará
  ap_sejd: "America/Guayaquil", // mainland Ecuador
  ap_sn6l: "America/Fortaleza", // Ceará
  ap_sncp: "America/Sao_Paulo", // Santa Catarina
  ap_uesk: "Asia/Srednekolymsk",
  ap_ukoh: "Europe/Kyiv",
  ap_ushq: "Asia/Yekaterinburg", // Khanty-Mansi
  ap_ustj: "Asia/Yekaterinburg", // Tyumen
  ap_uwkj: "Europe/Moscow", // Mari El
  ap_wafb: "Asia/Makassar", // South Sulawesi
  ap_walk: "Asia/Makassar", // East Kalimantan
  ap_ward: "Asia/Jakarta", // East Java
  ap_wawd: "Asia/Makassar", // Southeast Sulawesi
  ap_wayb: "Asia/Jayapura", // Papua
  ap_wimu: "Asia/Jakarta", // Aceh
  ap_witk: "Asia/Jakarta", // Aceh
  ap_yewa: "Australia/Perth",
  ap_ynkr: "Australia/Darwin",
};

/**
 * Corrections to operators, keyed by ICAO code. Fields given here replace the merged values.
 * Used for the common airlines that must resolve by both codes, and for codes the open sources get
 * wrong or leave out.
 */
export const operatorFixes: Record<string, Partial<Omit<Operator, "id" | "icao">>> = {
  // US mainline and regional carriers
  AAL: { name: "American Airlines", iata: "AA", country: "US", kind: "airline", validTo: null },
  ASA: { name: "Alaska Airlines", iata: "AS", country: "US", kind: "airline", validTo: null },
  DAL: { name: "Delta Air Lines", iata: "DL", country: "US", kind: "airline", validTo: null },
  HAL: { name: "Hawaiian Airlines", iata: "HA", country: "US", kind: "airline", validTo: null },
  JBU: { name: "JetBlue", iata: "B6", country: "US", kind: "airline", validTo: null },
  SWA: { name: "Southwest Airlines", iata: "WN", country: "US", kind: "airline", validTo: null },
  UAL: { name: "United Airlines", iata: "UA", country: "US", kind: "airline", validTo: null },
  // Endeavor Air, formerly Pinnacle Airlines, began in 1985 (Wikidata, under its former ICAO code FLG). Without a
  // start date, XL Airways Germany, listed with 9E in 2006-2012, would take the code on those days.
  EDV: { name: "Endeavor Air", iata: "9E", country: "US", kind: "airline", validFrom: "1985-01-01", validTo: null },
  ENY: { name: "Envoy Air", iata: "MQ", country: "US", kind: "airline", validTo: null },
  RPA: { name: "Republic Airways", iata: "YX", country: "US", kind: "airline", validTo: null },
  SKW: { name: "SkyWest Airlines", iata: "OO", country: "US", kind: "airline", validTo: null },
  // Wikidata only has the Piedmont Airlines that merged into USAir in 1989; PDT is now the
  // American Eagle carrier, formerly Henson Airlines.
  PDT: { name: "Piedmont Airlines", iata: "PT", country: "US", kind: "airline", validFrom: null, validTo: null },
  // NetJets fractional ownership
  EJA: { name: "NetJets", iata: null, country: "US", kind: "business", validTo: null },
  // Porter Airlines uses POE/PD and PTR/P3. Wikidata lists PTR only for two defunct Jordanian airlines.
  PTR: { name: "Porter Airlines", iata: "P3", country: "CA", kind: "airline", validFrom: null, validTo: null },
  POE: { name: "Porter Airlines", iata: "PD", country: "CA", kind: "airline", validTo: null },
  // Canada, Europe, Middle East
  ACA: { name: "Air Canada", iata: "AC", country: "CA", kind: "airline", validTo: null },
  AFR: { name: "Air France", iata: "AF", country: "FR", kind: "airline", validTo: null },
  BAW: { name: "British Airways", iata: "BA", country: "GB", kind: "airline", validTo: null },
  DLH: { name: "Lufthansa", iata: "LH", country: "DE", kind: "airline", validTo: null },
  EIN: { name: "Aer Lingus", iata: "EI", country: "IE", kind: "airline", validTo: null },
  KLM: { name: "KLM", iata: "KL", country: "NL", kind: "airline", validTo: null },
  QTR: { name: "Qatar Airways", iata: "QR", country: "QA", kind: "airline", validTo: null },
  UAE: { name: "Emirates", iata: "EK", country: "AE", kind: "airline", validTo: null },
  // East Asia
  ANA: { name: "All Nippon Airways", iata: "NH", country: "JP", kind: "airline", validTo: null },
  CCA: { name: "Air China", iata: "CA", country: "CN", kind: "airline", validTo: null },
  CES: { name: "China Eastern Airlines", iata: "MU", country: "CN", kind: "airline", validTo: null },
  CHH: { name: "Hainan Airlines", iata: "HU", country: "CN", kind: "airline", validTo: null },
  CPA: { name: "Cathay Pacific", iata: "CX", country: "HK", kind: "airline", validTo: null },
  CSN: { name: "China Southern Airlines", iata: "CZ", country: "CN", kind: "airline", validTo: null },
  DKH: { name: "Juneyao Air", iata: "HO", country: "CN", kind: "airline", validTo: null },
  HBH: { name: "Hebei Airlines", iata: "NS", country: "CN", kind: "airline", validTo: null },
  SIA: { name: "Singapore Airlines", iata: "SQ", country: "SG", kind: "airline", validTo: null },
  // Scoot has flown as TGW since it absorbed Tigerair Singapore; Wikidata still gives TR to SCO.
  TGW: { name: "Scoot", iata: "TR", country: "SG", kind: "airline", validTo: null },
  // Codes shared over time. PrivatAir's IATA code was PV (Wikipedia, CAPA), and PT is Piedmont's. Jambojet began
  // flying on 1 April 2014: without that date, Jetstar Hong Kong, listed with JM in 2012-2015 though it never flew,
  // would take the code in 2014.
  PTI: { iata: "PV" },
  JMA: { validFrom: "2014-04-01" },
  // Cargo airlines whose names do not say so
  FDX: { name: "FedEx Express", iata: "FX", country: "US", kind: "cargo", validTo: null },
  UPS: { name: "UPS Airlines", iata: "5X", country: "US", kind: "cargo", validTo: null },
  GTI: { name: "Atlas Air", iata: "5Y", country: "US", kind: "cargo", validTo: null },
  ABX: { name: "ABX Air", iata: "GB", country: "US", kind: "cargo" },
  ATN: { name: "Air Transport International", iata: "8C", country: "US", kind: "cargo" },
  // Manufacturers' own flight operations
  BOE: { name: "Boeing", country: "US", kind: "manufacturer" },
  AIB: { name: "Airbus", country: "FR", kind: "manufacturer" },
};

/** Wake turbulence category J (super) is not in the open sources. */
export const wakeCategoryFixes: Record<string, WakeCategory> = {
  A388: "J",
  A225: "J",
};
