# 01 Existing Data

The formats of the data the owner kept before Touchdown, and how each maps to the new model. This doc is self-contained: the original spreadsheets will not stay available, so their structure and rules are recorded here.

Touchdown has no reader fixed to these spreadsheets: they are read like any other through a column mapping ([21](21-import-export.md), "Source: any spreadsheet"), whose header names cover the columns below. The column tables here record what each column means.

This doc contains no personal data. Examples are made up. The actual values, summary numbers, and issues found in the owner's data are kept in `data/private/` (git-ignored) and are used as test expectations in phase 1.

## Sources

| Source | Content |
|--------|---------|
| Flight log spreadsheet | Flights flown (tens of rows) |
| Spotting spreadsheet | Aircraft photographed (hundreds of rows) |
| my.flightradar24.com CSV export | Flights flown (the same set as the flight log spreadsheet) |
| FR24 track CSVs | Recorded tracks downloaded from FR24 flight playback, one file per flight |

## Flight log spreadsheet

### Columns

| Column | Example | Maps to | Notes |
|--------|---------|---------|-------|
| Date | 05-Mar-2025 | `flights.scheduledDate` | Scheduled local departure date. |
| Airlines | XY | `flights.airlineRaw` → `airlineId` | IATA airline code. |
| Flight Number | XY123 | `flights.flightNumber` | |
| Seat | 12A | `flights.seat` | Sometimes empty. |
| Class | K, Basic Economy, Economy (K) | `flights.bookingClass`, `flights.fareBrand` | Mixes booking class letters and fare brand names. See below. |
| Departure | AAA | `flights.fromRaw` → `fromAirportId` | IATA airport code. |
| Gate | 30, B12 | `flights.departureGate` | |
| Boarding Time | 09:55 | `flights.boardingAt` | Clock time only; combined with Date into a date-time on import ([21](21-import-export.md)). Sometimes empty. |
| Departure Time | 10:40 | `flights.takeoffAt` | Takeoff (wheels-off) clock time at the departure airport, same meaning as Flightradar24 (verified, Q-FR24-TIMES). The sheet has no date for it: a takeoff after midnight still sits on the scheduled date's row. Combined into a date-time on import ([21](21-import-export.md)). |
| Destination | BBB | `flights.toRaw` → `toAirportId` | IATA airport code. |
| Landing Time | 12:50 | `flights.landingAt` | Touchdown clock time at the destination, no date. The landing date-time is derived from takeoff + duration and checked against this clock time. |
| Duration | 02:10 | (used, not stored) | Takeoff to landing. Used to build the landing date-time and to check it against Landing Time. |
| Distance (km) | 1300 | (checked, not stored) | The same route can have different values in the sheet. Distance is derived from airport coordinates; the sheet value is only compared (V-DISTANCE-DIFF). |
| Route | AAA-BBB | derived | Not stored. Built from `from` and `to`. |
| ETKT | 13-digit number + `/coupon` | `flights.ticketNumber` | Private. Both legs of a ticket share the number; the coupon (`/1`, `/2`, ...) differs. |
| Manufacturer | Airbus | derived from type | |
| Plane Family | A330 | derived from type | |
| Type Code | A333 | `flights.typeCodeRaw` → `typeCode` | ICAO type designator. |
| Aircraft | A330-343 | `flights.modelRaw` → `model` | Manufacturer model designation; parsed into the standard form (D4). |
| Registration Number | B-1234 | `flights.registrationRaw` → `registration` | |
| First Flight Date | 17-Sep-2011 | `airframes.firstFlightDate` | Fact about the airframe, not the flight. Recorded with `field_provenance` source `user`. |
| Special Livery | Anniversary Livery | `flights.specialLivery` | |
| Misc | free text, URLs | `flights.notes` | A note to the user, copied as is. Not parsed or tracked. |

### "Class" values

Three shapes occur:
- a single booking class letter (`K`);
- a fare brand name (`Basic Economy`, `Saver`);
- a fare brand with the booking class in parentheses (`Economy (K)`).

Import rule: a single letter → `bookingClass`; text → `fareBrand`; a letter in parentheses inside text → `bookingClass` too. `cabinClass` is set to `economy` unless the user says otherwise.

### Notes column (text next to the table)

Copied word for word:

> Note: The aircraft field should be modified according the following rules
> 1. The manufacture is abbreviated with only one letter.
> 2. All space are removed
> 3. Parathesis are removed
>
> Websites
> Boeing: https://aviation.flights/
> Airbus: https://www.airfleets.net/ficheapp/
> https://www.planespotters.net/

The naming rule became the "compact" display style (requirement D4). The data did not follow it consistently (e.g. `B777-322(ER)` keeps parentheses). The websites are where the owner looks up airframe facts by hand; the app links to them ([13](13-reference-data.md)).

### Summary sheet (what the app must reproduce)

| Item | Definition |
|------|-----------|
| Total distance | Sum of Distance. |
| Total time | Sum of Duration. |
| Most flown airline / route / manufacturer / family / type code | Group with the most flights. |
| Counts per airline, route, manufacturer, family, type code, model | Number of flights per group. |

Routes are counted without direction: AAA-BBB and BBB-AAA are the same route, written with the two codes in alphabetical order.

## Spotting spreadsheet

### Columns

| Column | Example | Maps to | Notes |
|--------|---------|---------|-------|
| Registration | N123AB | `sightings.registrationRaw` → `registration` | |
| Date | (spreadsheet serial date) | `sightings.seenOn` | No time recorded. Can be empty. |
| Location | KAAA | `sightings.airportRaw` → `airportId` | ICAO airport code. |
| Airlines | XYZ | `sightings.operatorRaw` → `operatorId` | ICAO airline code; also "Private Owner". |
| Country | US | derived | Registration country (from the registration prefix). Not stored; the import compares it with the prefix-derived country and flags differences. |
| Manufacturer | Boeing | derived from type | |
| Plane Family | B777 | derived from type | |
| Type Code | B77W | `sightings.typeCodeRaw` → `typeCode` | |
| Aircraft | B777-322(ER) | `sightings.modelRaw` → `model` | Parsed into the standard form (D4). |
| Status | Approaching | `sightings.phase` | See below. |
| Special Livery | Sports Team Livery | `sightings.specialLivery` | Stickers count as special livery. |
| Misc | free text | `sightings.livery`, `sighting_tags`, `sightings.notes` | See below. |

### Status values

Approaching → `approaching`, Touching-down → `landing`, Taking-off → `taking_off`, Taxiing → `taxiing`, Parked → `parked`, Towing → `towing`.

### Special liveries

Alliance liveries, anniversary and event liveries, and stickers all count as special. The livery names seen in the owner's data seed the livery autocomplete; the list is kept in `data/private/`.

### What "Misc" holds

| Kind | Examples | Goes to |
|------|----------|---------|
| Regular livery variants (not special) | an airline's alternate standard colour schemes | `sightings.livery` |
| Named tail or sticker artwork | a named tail animal, a sports title sticker | `sightings.notes` (user may move to `specialLivery`) |
| Cross-reference to flights | "Taken this aircraft", "Taken this aircraft on the same day" | Dropped after import; the app derives it from the flight log. Kept in notes until the user confirms. |
| Photo quality | "Partial body", "Too far" | `tags`: `partial_body`, `too_far` |
| Scene | a mountain in the background, another aircraft in the same photo | `notes` |
| Repeat | "Second time", "Photoed the aircraft in different places" | Derived (repeat sightings); kept in notes. |

### Derived sheets (what the app must reproduce)

| Sheet | What it shows | Measure |
|-------|---------------|---------|
| Summary | Aircraft, Airlines, Plane Families, Type Codes, Special Livery, Most Frequent Airline / Family / Type | unique registrations |
| Airlines by Family | rows: family, then airline | unique registrations |
| Family by Airlines | rows: airline, then family | unique registrations |
| Manufacturer by Airlines | rows: airline, then manufacturer | unique registrations |
| Family by Location | rows: airport, then family | unique registrations |
| Airlines / Family / Type Code / Aircraft | one dimension each, sorted | unique registrations |

Formula logic, for reproduction: filter rows where the group column is not empty, take unique values of the group column, and for each value count unique registrations in the matching rows. "Most frequent" picks the group with the highest count; ties are joined into one cell. "Special Livery" counts unique registrations with a non-empty Special Livery.

Under the new model, "unique aircraft" means unique airframes, not unique registrations (requirement I4), so the numbers can change slightly.

## Kinds of issues found in the data

The specific cases are in the private snapshot. The kinds are:

- A registration recorded with two different type codes. Either a typo or two airframes; the checker must flag it.
- The same airline code with different letter case (`AAl` and `AAL`), counted as two airlines.
- Sightings without a date.
- Two flights sharing the same ticket coupon number (`/1` used twice for an outbound and a return).
- The same airport pair with different distances.
- Summary formulas that start at the wrong row and skip records.
- The myFR24 export and the sheet disagreeing on the aircraft type of a flight (e.g. a 787-8 registration listed as A21N in FR24). The airframe lookup decides; the import shows these as conflicts.

## myFR24 export

The same flights as the flight log spreadsheet. Format in [21](21-import-export.md). Date is the scheduled departure date; Dep/Arr times are takeoff and touchdown clock times in local time, matching the sheet. The file starts with an empty line before the header.

## FR24 track files

CSV files downloaded from Flightradar24 flight playback, named `<flight>_<from>_<to>_<YYYYMMDD>_<fr24 flight id>.csv`. Columns: `Timestamp` (Unix seconds), `UTC`, `Callsign`, `Position` (`"lat,lon"`), `Altitude` (ft), `Speed` (kt), `Direction` (degrees). Each file covers taxi-out to taxi-in, with one point every few seconds to a minute.

## Code systems

Flights used IATA codes; sightings used ICAO codes. Decision: store both codes for every airline and airport, accept either on input, and let the user choose which one to display (requirement G7).
