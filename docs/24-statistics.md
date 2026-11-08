# 24 Statistics

Metric definitions for flights, sightings, and both together (requirements G3, P1, P2). Each metric is defined precisely so the numbers are reproducible and testable.

## General rules

- Statistics are computed in the browser from the local store. Data volume (thousands of records) does not need a database engine; plain TypeScript aggregation is enough.
- "Aircraft" always means distinct airframes (requirement I4). Provisional airframes are counted, and the count of provisional ones is shown next to the total.
- Every metric lists the fields it needs. Records missing them are left out, and the UI shows "N records left out (missing X)".
- Deleted records (tombstones) are never counted. Only flown flights exist in the log.
- Ties in "most frequent" are all shown (the sheet joins them; the app lists them).
- Codes are shown in the user's chosen style (IATA, ICAO, or both).

## Building blocks

### Dimensions

| Dimension | Flights | Sightings | Source |
|-----------|---------|-----------|--------|
| Airline / operator | marketing `airline` (option: operating) | `operator` | record |
| Operator country | ✓ | ✓ | Operator reference |
| Manufacturer | ✓ | ✓ | derived from type |
| Family | ✓ | ✓ | derived from type (with user overrides) |
| Type code | ✓ | ✓ | record / airframe |
| Model | ✓ | ✓ | record / airframe |
| Registration country | ✓ | ✓ | registration prefix |
| Airframe | ✓ | ✓ | `airframeId` |
| Airport | `fromAirportId`, `toAirportId`, or either | `airportId` | record |
| Airport country | ✓ | ✓ | Airport reference |
| Route (undirected) | ✓ | | `from`+`to`, codes sorted alphabetically |
| Route (directed) | ✓ | | `from`→`to` |
| Year, month, weekday, hour | ✓ | ✓ | flight day and local takeoff time / `seenOn` and `seenAt` |
| Cabin class, seat position, reason | ✓ | | record |
| Phase | | ✓ | record; a sighting seen in several phases counts under each |
| Special livery | ✓ | ✓ | record |
| Aircraft age at the time | ✓ | ✓ | record date − airframe first flight |

### Measures

| Measure | Definition |
|---------|-----------|
| Records | Count of flights or sightings. |
| Aircraft | Count of distinct `airframeId` (records without one are left out). |
| Distance | Sum of each flight's distance (flights): the one the user entered, else the distance flown along its recorded track, else the great circle ([23](23-tracks-and-maps.md), "Distance"). |
| Time | Sum of `durationMin` (flights). |
| Airports | Count of distinct airports. |
| First seen / last seen | Min / max date. |

### Custom view (pivot)

Shown in the app as the "Custom view" tab (`components/CustomView.tsx`). Built. Any one or two dimensions × one measure, over the period chosen at the top of Statistics, narrowed by filters:

| Part | Behaviour |
|------|-----------|
| The question | One sentence of choices, no explaining text: "[Number of flights] by [airline] split by [family]". The first choice is what to count, the dataset and the measure together: number of flights, aircraft flown, distance flown, time in the air; number of sightings, aircraft seen. "Split by" is added with a button and removed with ×; a second button swaps rows and columns. |
| Filters | "Filter" opens a panel: a dimension, then its values to tick, each with how many records have it among those the other filters keep (a value ticked before stays listed). A filter keeps the records with any of its values; several filters all hold. Each shows as a chip ("Airline: British Airways, Lufthansa +2") that reopens its panel, with × to remove it. Ticking applies at once. The row ends with how many records are counted ("4 of 12 flights"). Filters on a dimension the other dataset lacks go when the count switches dataset. |
| The table | Rows by their figure, largest first, except year, month and hour, which go in time order; at most 25 rows, then "Show all". At most 14 columns, the rest added up as "Others". A Total column (when split) and a Total row: totals count each aircraft once. Each figure is shaded by its size in the dataset's ink. Values are named as elsewhere ("British Airways", "March", "09:00"). |
| The records | Every figure, total included, is a button: it lists the flights or sightings behind it under the table, newest first, 20 a page, as the Flights and Spotting lists show them (`pivotRecords` in core). |
| Left out | Records without a value for the chosen dimensions are left out and counted under the table ("3 flights left out: no family recorded"). |

The logic is in core (`pivot`, `filterRecords`, `dimensionValues`, `pivotRecords`; value names in `pivotValueLabel`), shared with the CLI (`stats --by … --where DIM=V[,V]`, [34](34-command-line.md)). Examples the user already has:

| Sheet tab | Pivot |
|-----------|-------|
| Airlines by Family | rows = family, columns = airline, measure = aircraft |
| Family by Airlines | rows = airline, columns = family, measure = aircraft |
| Manufacturer by Airlines | rows = airline, columns = manufacturer, measure = aircraft |
| Family by Location | rows = airport, columns = family, measure = aircraft |

Saved views: the user can save a custom view (dimensions, measure, filters) under a name ("Save this view", shown only while what shows is not saved already). They are kept in the log's `saved_views` table and their filters in `saved_view_filters`, one row a value ([10](10-domain-model.md)), so every device has them. A saved view is a chip; the one matching what shows is marked; choosing one brings back its choices and filters. The CLI shows one with `touchdown stats --view NAME`, its filters applied, and saves or removes one through the inbox (`stats views save … --where …` and `remove`, [34](34-command-line.md)).

## Sightings summary (requirement P1)

| Metric | Definition | Needs |
|--------|-----------|-------|
| Aircraft | distinct airframes | registration |
| Sightings | records | — |
| Airlines | distinct operators | operator |
| Plane families | distinct families | type |
| Type codes | distinct type codes | type |
| Special-livery aircraft | distinct airframes with at least one sighting where `specialLivery` is set (this is what the sheet counts) | registration, specialLivery |
| Special liveries | distinct `(operator, specialLivery)` pairs | specialLivery |
| Most frequent airline | operator with the most distinct airframes (ties listed) | operator, registration |
| Most frequent family | family with the most distinct airframes | type, registration |
| Most frequent type code | type code with the most distinct airframes | type, registration |
| New aircraft per day | per date: airframes first seen that date | date, registration |
| Repeat sightings | airframes with more than one sighting, with dates and places | registration |
| By location | airports with sightings, aircraft per airport | location |
| By phase | count per phase | phase |

## Flights summary (FR24 / Flighty style)

| Metric | Definition | Needs |
|--------|-----------|-------|
| Flights | records | — |
| Distance | sum of each flight's distance (entered, else flown along its track, else the great circle); also shown as times around the Earth (÷ 40,075) | from, to |
| Flight time | sum of `durationMin` (takeoff to landing, as in the user's sheet and Flightradar24) | times or duration |
| Airports | distinct airports in `from` ∪ `to` | from, to |
| Countries | distinct airport countries | from, to |
| Airlines | distinct marketing airlines | airline |
| Aircraft | distinct airframes | registration |
| Types | distinct type codes | type |
| Routes | distinct undirected routes | from, to |
| Most flown airline / route / manufacturer / family / type | as in the current sheet; route is undirected | |
| Top airports | visits = departures + arrivals | from, to |
| Longest / shortest flight | by distance and by duration | |
| Aircraft age | the time from each aircraft's first flight to the flight's day (one row per flight) and to today (one row per aircraft), oldest or youngest first, with the average and range when flown in a sentence (`aircraftAges` in `@touchdown/core/view`). The log records no day an aircraft stopped flying, only its status: for one marked retired or written off, the "Age now" figure is the time since its first flight, not active service: the column says "Since first flight", the help tip and `touchdown stats` say so, and the row carries the status (Decided). Flights without a date or an aircraft, on an aircraft without a first flight date, or dated before it are left out and counted ("Excluded: …"). Built, on Statistics and in `touchdown stats`. | registration, first flight |
| Most flown airframe | airframe with most flights | registration |
| Seat position split | window / middle / aisle share | seat |
| Cabin class split | | cabinClass |
| Per year | flights, distance, time, new airports, new airlines, new types | date |
| Calendar heatmap | flights per flight day (local date of takeoff, else `scheduledDate`) | takeoff or scheduledDate |
| Time of day | departures by local hour | departure time |
| Delays | actual − scheduled departure and arrival, when both exist | times |
| Route extension | the distance flown beyond the great circle, along the recorded track ([23](23-tracks-and-maps.md), "Route extension"): the most indirect flights, and by route for routes with two or more such flights, sorted by the extra distance (the default) or by the percentage (a percentage puts short flights first, since climbing out and coming in add the same few miles to any flight). Built. | a recorded track |

## Combined

| Metric | Definition |
|--------|-----------|
| Flown and photographed | airframes with at least one flight and one sighting |
| Types flown vs spotted | per type: flights, aircraft flown, aircraft spotted |
| Spotted but never flown | families/types with sightings and no flights |
| Airframe timeline | for one airframe: flights, sightings, registrations, operators by date |

## Maps

- Flights map: every flight as a recorded track if one exists, otherwise a great-circle line. Line weight or colour by count. Airports sized by visits.
- Sightings map: airports/spots with aircraft counts.
- Map exports (figure, video) are in [23](23-tracks-and-maps.md).

## Testing

A fixture dataset built from the owner's data (private fields removed, kept in `data/private/`) is checked against the summary numbers in the private snapshot (`data/private/`, not committed). Differences must be explained: for example, airframes vs registrations, or the sheet's row-4 formula bug.
