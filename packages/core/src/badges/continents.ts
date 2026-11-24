// Each country's continent, for the Six continents and Antarctica badges (docs/24-statistics.md, "Continents"): as
// the United Nations' geographic regions (M49) place it, so Central America and the Caribbean are North America,
// Australia and the Pacific islands Oceania, and Cyprus and the Caucasus Asia. Three countries on two continents go by
// the airport's longitude.

export type Continent = "AF" | "AN" | "AS" | "EU" | "NA" | "OC" | "SA";

/** The six continents the Six continents badge needs, in the order its parts are listed. */
export const SIX_CONTINENTS: readonly Continent[] = ["AF", "AS", "EU", "NA", "SA", "OC"];

const LISTS: Record<Continent, string> = {
  AF: "AO BF BI BJ BW CD CF CG CI CM CV DJ DZ EG EH ER ET GA GH GM GN GQ GW IO KE KM LR LS LY MA MG ML MR MU MW MZ NA NE NG RE RW SC SD SH SL SN SO SS ST SZ TD TG TN TZ UG YT ZA ZM ZW",
  AN: "AQ BV HM TF",
  AS: "AE AF AM AZ BD BH BN BT CN CY GE HK ID IL IN IQ IR JO JP KG KH KP KR KW KZ LA LB LK MM MN MO MV MY NP OM PH PK PS QA SA SG SY TH TJ TL TM TR TW UZ VN YE",
  EU: "AD AL AT AX BA BE BG BY CH CZ DE DK EE ES FI FO FR GB GG GI GR HR HU IE IM IS IT JE LI LT LU LV MC MD ME MK MT NL NO PL PT RO RS RU SE SI SJ SK SM UA VA XK",
  NA: "AG AI AW BB BL BM BQ BS BZ CA CR CU CW DM DO GD GL GP GT HN HT JM KN KY LC MF MQ MS MX NI PA PM PR SV SX TC TT US VC VG VI",
  OC: "AS AU CC CK CX FJ FM GU KI MH MP NC NF NR NU NZ PF PG PN PW SB TK TO TV UM VU WF WS",
  SA: "AR BO BR CL CO EC FK GF GS GY PE PY SR UY VE",
};

const BY_COUNTRY = new Map<string, Continent>();
for (const [continent, codes] of Object.entries(LISTS) as [Continent, string][]) for (const code of codes.split(" ")) BY_COUNTRY.set(code, continent);

/** An airport's continent: its country's, or for Russia, Turkey and Egypt the side of the line it lies on. */
export function continentOf(a: { country: string; lon: number }): Continent | null {
  // The Urals, the Bosphorus and the Suez Canal, roughly: no airport lies close enough to them for more to matter.
  if (a.country === "RU") return a.lon < 60 ? "EU" : "AS";
  if (a.country === "TR") return a.lon < 29 ? "EU" : "AS";
  if (a.country === "EG") return a.lon > 32.35 ? "AS" : "AF";
  return BY_COUNTRY.get(a.country) ?? null;
}
