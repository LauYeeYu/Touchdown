# 20 Validation

Sanity checks on every entry (requirement D2) and consistency checks across records (requirement D1). The agent check ([22](22-agent-verification.md)) runs after these and never replaces them.

## Principles

- Checks never block saving (requirement G4). They produce findings.
- Every finding has a rule id, a severity, the records involved, a message, and an optional suggested fix.
- A suggested fix is applied only when the user accepts it. Exception: pure formatting fixes (case, dashes, whitespace) are applied to the normalised value automatically; the raw value is kept.
- The user can accept a warning (IssueAck). It stays hidden until the values that caused it change.
- The same rule code runs in the browser and in the companion CLI (shared TypeScript package).

Severity:
- **error**: almost certainly wrong (type code does not exist, arrival before departure).
- **warning**: probably wrong or worth a look (operator differs from lookup).
- **info**: incomplete or a suggestion (no seat recorded, could fill first-flight date).

## When checks run

| Trigger | Rules run |
|---------|-----------|
| Field edited | Field rules for that field (instant feedback). |
| Record saved | All field rules + identity resolution + cross-record rules touching that record. |
| Import | All rules on every row before anything is committed. |
| Reference data or airframe facts refreshed | All rules on affected records. |
| Manual "check everything" | All rules. |

## Field rules (V-)

| Id | Applies to | Check | Severity | Auto-fix |
|----|-----------|-------|----------|----------|
| V-REG-FORMAT | registration | Matches a known national prefix pattern. | warning | Add/remove dash, uppercase. |
| V-DATE-SANE | date | Not before 1903; not in the future (only flown flights are logged). | error | |
| V-AIRPORT-KNOWN | from, to, location | Code resolves to one airport (IATA or ICAO). | error | Case fix. Suggest closest match. |
| V-AIRPORT-SAME | flight | `from` ≠ `to` (unless the user marks it as a return-to-gate or local flight). | warning | |
| V-OPERATOR-KNOWN | airline, operator | Code resolves (IATA or ICAO, case-insensitive), or the name of an airline or of an operator of the user's own. `AAl` → `AAL`. | error | Case fix. A company's name that is no airline ("Example Motors"): "Add … as an operator", which links every record with that name. Imports and saving in the app add such a name by themselves (built). |
| V-TYPE-KNOWN | typeCode | Exists in the ICAO type list. | error | Suggest from model string. |
| V-MODEL-TYPE | model, typeCode | Model matches one of the type's `modelPatterns` (e.g. `A321-271NX` → A21N). | warning | Suggest typeCode from model, or model naming fix. |
| V-MODEL-PARSE | model | Can be parsed into the standard form from any accepted style (`B777-322ER`, `777-322(ER)`, `Boeing 777-322ER`). | warning | Store the parsed standard form. |
| V-FLIGHTNO-FORMAT | flightNumber | 2–3 character airline designator + 1–4 digits + optional letter. | warning | Uppercase, remove spaces. |
| V-FLIGHTNO-AIRLINE | flightNumber, airline | Designator prefix matches the airline's IATA or ICAO code. | warning | Fill airline from flight number. |
| V-SEAT-FORMAT | seat | 1–3 digits + one letter. | warning | Uppercase. |
| V-TIMES-ORDER | flight times | boarding ≤ departure ≤ takeoff < landing ≤ arrival, compared as instants. | error | |
| V-TIME-OFFSET | any date-time | The UTC offset matches the airport's time zone on that date (catches a wrong zone or a missed daylight-saving change). A diverted flight's landing and arrival are checked against the airport it landed at. | error | Recompute the offset from the airport. |
| V-DAY-ROLLOVER | flight | The local date of takeoff is `scheduledDate` or the day after. The day after is fine (late departure) and is shown as info; anything else is an error. | error / info | |
| V-DURATION-SPEED | flight | Distance / duration between about 150 and 1,100 km/h. Catches wrong airports, wrong dates, wrong times. | warning | |
| V-DISTANCE-DIFF | flight | Entered distance within 3% of great-circle distance. | info | Use computed value. |
| V-BEFORE-FIRST-FLIGHT | flight, sighting | Record date ≥ airframe first flight date. | error | |
| V-REG-COUNTRY | registration, operator | Registration country vs operator country. Leasing makes this common, so only info. | info | |
| V-INCOMPLETE | any | Lists empty fields that stats or maps need (airports, date, registration). | info | Offer auto-fill. |
| V-PRIVATE-IN-NOTES | notes | Notes look like a ticket number or booking reference. | info | Move to private field. |

## Cross-record rules (C-)

| Id | Check | Severity |
|----|-------|----------|
| C-TYPE-MISMATCH | Records linked to the same airframe have a type code different from the airframe's. (Example in [11](11-aircraft-identity.md).) | error |
| C-REG-OVERLAP | One registration has overlapping periods on two airframes. | error |
| C-OPERATOR-MISMATCH | Record's operator differs from the airframe's operator for that date. | warning |
| C-DUP-FLIGHT | Same date + flight number + `from` twice. | warning |
| C-DUP-SIGHTING | Same date + registration + location twice. | info (may be intentional) |
| C-DUP-TICKET | Two flights share the same ticket number and coupon (e.g. `/1` twice). | warning |
| C-FLIGHT-OVERLAP | Two of the user's flights overlap in time. | error |
| C-CODE-VARIANTS | Codes that differ only by case or whitespace across records. | warning (auto-fix) |
| C-LIVERY-NAME | Same special livery spelled differently on the same airframe (`Oneworld Livery` vs `oneworld livery`). | info |
| C-LIVERY-MISSING | A flight or sighting with no special livery on a day the aircraft's other records show it wore one: the same livery is recorded before and after it, or the last record before it has one and is less than a year old. Fix: set that livery. | warning |
| C-SAME-DAY | Sighting of an airframe at airport X on a day the user flew that airframe through X. Not a problem; shown as a link. | info |

## External rules (X-)

These need the lookup service ([13](13-reference-data.md)). They are skipped offline and shown as "not checked".

| Id | Check | Severity |
|----|-------|----------|
| X-REG-LOOKUP | Lookup for the registration disagrees with entered type, model, or operator. | warning |
| X-REG-REUSE-POSSIBLE | Lookup knows only the current holder of the registration, and that airframe's first flight is after the record date or its type differs. | warning |
| X-FLIGHT-LOOKUP | Flight lookup (if the provider supports history) disagrees on aircraft type, registration, or times. | warning |

## Auto-fill (requirement D5)

Auto-fill runs after checks and fills only empty fields. Each filled value records its source in `field_provenance`.

| Empty field | Filled from |
|-------------|-------------|
| typeCode | Linked airframe; else model string via `modelPatterns`. |
| model | Linked airframe. |
| manufacturer, family | Type code (always derived, never typed). |
| operator (sighting) | Airframe operator period for that date (suggestion only). |
| airline | Flight number designator. |
| distanceKm | Airport coordinates. |
| durationMin | Takeoff and landing instants. |
| seatPosition | Seat letter + aircraft type's usual layout (marked as a guess). |
| firstFlightDate, MSN | Airframe lookup. |
| registration, type, times (flight) | Flight lookup by flight number + date, if a provider supports history (see 13). Suggestion only. |

## Testing the rules

Each rule ships with fixtures: at least one row that passes and one that fails. The kinds of issues listed in [01](01-existing-data.md) (type conflicts, code case variants, duplicate coupons, missing dates) are fixtures, built from made-up rows.
