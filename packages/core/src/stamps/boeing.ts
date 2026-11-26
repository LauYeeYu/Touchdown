// The Boeing stamps' lists (docs/24-statistics.md, "Aircraft"): which types each counts, by ICAO code.

/**
 * Pride of Seattle: the Boeings designed in Seattle that first flew before the head office moved to Chicago in 2001,
 * each code by its first variant's first flight. The 717 is left out, as McDonnell Douglas designed it in Long Beach,
 * and so are the 777-300ER and -200LR (2003, 2005), the 787 (2009), the 747-8 (2010), the 737 MAX (2016) and the 777X
 * (2020). https://en.wikipedia.org/wiki/Boeing
 */
export const SEATTLE_BOEINGS: readonly string[] = [
  // 707 (1957) and 720 (1959)
  "B701", "B703", "B720",
  // 727 (1963)
  "B721", "B722",
  // 737 Original, Classic and Next Generation, the -900 first flying in 2000
  "B731", "B732", "B733", "B734", "B735", "B736", "B737", "B738", "B739",
  // 747 up to the -400 (1988)
  "B741", "B742", "B743", "B744", "B74D", "B74R", "B74S",
  // 757 (1982, the -300 in 1998)
  "B752", "B753",
  // 767 (1981, the -400ER in 1999)
  "B762", "B763", "B764",
  // 777-200 and -300 (1994, 1997)
  "B772", "B773",
];

/** Worth the wait: the 777X, the 777-8 and the 777-9, launched in 2013 to enter service in 2020. */
export const TRIPLE_SEVEN_X: readonly string[] = ["B778", "B779"];
