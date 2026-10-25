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
| Distance | Sum of `distanceKm` (flights). |
| Time | Sum of `durationMin` (flights). |
| Airports | Count of distinct airports. |
| First seen / last seen | Min / max date. |

### Custom view (pivot)

Shown in the app as the "Custom view" tab, with plain controls: From (flights or sightings), Count (number of records, aircraft each once, distance, time in the air), Group by (rows) and Split by (columns, optional). Any one or two dimensions × one measure, with filters (date range, dataset, any dimension value). Shown as a table and, where it reads well, a chart. Examples the user already has:

| Sheet tab | Pivot |
|-----------|-------|
| Airlines by Family | rows = family, columns = airline, measure = aircraft |
| Family by Airlines | rows = airline, columns = family, measure = aircraft |
| Manufacturer by Airlines | rows = airline, columns = manufacturer, measure = aircraft |
| Family by Location | rows = airport, columns = family, measure = aircraft |

Saved views: the user can save a custom view (dimensions, measure, filters) under a name ("Save this view"). They are kept in the log's `saved_views` table ([10](10-domain-model.md)), so every device has them. The CLI shows one with `touchdown stats --view NAME`, and saves or removes one through the inbox (`stats views save` and `remove`, [34](34-command-line.md)).

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
| Distance | sum of `distanceKm`; also shown as times around the Earth (÷ 40,075) | from, to |
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
| Oldest / youngest aircraft flown | age at flight date | registration, first flight |
| Most flown airframe | airframe with most flights | registration |
| Seat position split | window / middle / aisle share | seat |
| Cabin class split | | cabinClass |
| Per year | flights, distance, time, new airports, new airlines, new types | date |
| Calendar heatmap | flights per flight day (local date of takeoff, else `scheduledDate`) | takeoff or scheduledDate |
| Time of day | departures by local hour | departure time |
| Delays | actual − scheduled departure and arrival, when both exist | times |

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
