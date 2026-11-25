# 24 Statistics

Metric definitions for flights, sightings, and both together (requirements G3, P1, P2). Each metric is defined precisely so the numbers are reproducible and testable.

## General rules

- Statistics are computed in the browser from the local store. Data volume (thousands of records) does not need a database engine; plain TypeScript aggregation is enough.
- "Aircraft" always means distinct airframes (requirement I4). Provisional airframes are counted, and the count of provisional ones is shown next to the total.
- Every metric lists the fields it needs. Records missing them are left out, and the UI shows "N records left out (missing X)".
- Deleted records (tombstones) are never counted.
- A planned flight still to come is never counted: not in a figure, a list's totals, a ranking, a record, an aircraft's or an airport's count, the Statistics page or the custom view. Once its time has passed it counts like a flown flight, before the user confirms it ([10](10-domain-model.md), "A flight's status"; [31](31-ui.md), "Planned flights"). The figures change on their own at that moment, without a reload.
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

## Stamps

Decided (G13). Stamps mark things done in the log: a 747 flown, an aircraft photographed at its factory, the Equator crossed. Where they are shown is in [31](31-ui.md), "Stamps".

### Rules

- Worked out from the log each time, like every figure here, and never stored, so an edit or a deletion changes them at once. The code is in the core package (`stamps` in `@touchdown/core/view`), shared by the web app, share links and the command line.
- Counted flights and sightings only: a planned flight counts from the moment its time has passed, as everywhere ([General rules](#general-rules)).
- A stamp is earned by a record: the first, in date order, that meets its rule, or for a rule over several records the one that completes it. The stamp's date is that record's day (the flight day, or the day seen), and it links to it. Records without a day come after the dated ones. Importing an old log earns its stamps on their own dates.
- A stamp's ink is that of what earns it: flown gold for flights, spotted blue for sightings, half and half for the two together (DESIGN.md, "The Two Inks Rule").
- A stamp not yet earned is shown greyed with its rule. A hidden one is not shown until it is earned.
- Some stamps have parts: each part is ticked with the record that earned it. A stamp earned by any part (a maker's factories, Tricky approaches) is earned at its first. A stamp that needs every part (Full family, Six continents) is earned at its last.
- Some have levels (Registers, Special liveries): earned at the first, then showing the highest reached and the next.
- A record's type is its own type code, else its aircraft's. A flight's airports are its departure and its arrival, the diversion airport when it diverted. Its local times are read from its stored times, which carry their airport's UTC offset: takeoff, else gate departure, else the scheduled departure; landing, else gate arrival, else the scheduled arrival.
- Lines on the globe are great circles between the airports. A recorded track is not used, so a stamp does not depend on which flights have one.
- Distance is the flight's distance as in the flights summary (entered, else along its track, else the great circle).

### Factories

| Stamp | Earned by | Ink |
|---|---|---|
| One per maker ("Boeing factories") | A sighting at one of the maker's factory airfields ([Factory airfields](#factory-airfields)) of an aircraft the maker built (its type's manufacturer), on a day the site was building them. Parts: the maker's sites. | spotted |
| Parts on the way | A sighting of a Beluga, BelugaXL or Dreamlifter (`A3ST`, `A337`, `BLCF`), the freighters that carry parts between factories. | spotted |
| Test registration | A sighting of an aircraft on a registration it wears only on test flights before delivery ([Factory airfields](#factory-airfields)). | spotted |
| Saw it built (hidden) | A flight on an aircraft photographed earlier at one of its maker's factory airfields. | both |

### Aircraft

| Stamp | Earned by | Ink |
|---|---|---|
| Queen of the Skies | A flight on a 747 (the `B747` family). | flown |
| Superjumbo | A flight on an A380 (`A388`). | flown |
| Four engines | A flight on a four-engined type. | flown |
| Full family | Flights on an A318, an A319, an A320 and an A321, the A319, A320 and A321 counting as ceo or neo. Parts: the four. | flown |
| Fresh off the line | A flight on an aircraft delivered 30 days before or less, or, without a delivery date, first flown 60 days before or less. | flown |
| Veteran | A flight on an aircraft first flown 30 years before or more. | flown |
| Old friend | The fifth flight on the same aircraft. | flown |
| Both sides of the fence | A flight on an aircraft also photographed, in either order: earned by the later of the two. | both |
| Supersonic (hidden) | A flight on Concorde or the Tu-144. | flown |

### The globe

| Stamp | Earned by | Ink |
|---|---|---|
| Across the Equator | A flight between the two hemispheres. | flown |
| Across the date line | A flight whose great circle crosses the 180° meridian. The date line itself bends around islands, so the meridian is what counts. | flown |
| Arctic Circle | A flight whose great circle reaches 66°34′ N or further north. | flown |
| Back to yesterday | A flight that lands on an earlier date, at the arrival airport, than it took off at the departure airport. | flown |
| Ultra long haul | A flight of 14,000 km or more. | flown |
| Short hop | A flight under 50 km. | flown |
| Thin air | A flight to or from an airport 3,000 m (9,843 ft) above sea level or higher. | flown |
| Below sea level (hidden) | A flight to or from an airport below sea level. | flown |
| Six continents | Flights to or from Africa, Asia, Europe, North America, South America and Oceania. Parts: the six. An airport's continent is its country's ([Continents](#continents)). | flown |
| Antarctica (hidden) | A flight to or from an airport in Antarctica. | flown |
| Around the world | 40,075 km flown in all, the Earth's circumference at the Equator. | flown |
| To the Moon | 384,400 km flown in all, the Moon's mean distance. | flown |
| And back | 768,800 km flown in all. | flown |

### Places

| Stamp | Earned by | Ink |
|---|---|---|
| Maho Beach | A sighting at Princess Juliana, St Maarten (SXM). | spotted |
| Tricky approaches | A flight to or from Paro (PBH), Lukla (LUA), St Barthélemy (SBH), Gibraltar (GIB) or Madeira (FNC). Parts: the five. | flown |
| Beach landing (hidden) | A flight to or from Barra (BRR), whose runway is the beach. | flown |
| Kai Tak (hidden) | A flight to or from Hong Kong on a day before 6 July 1998, when Kai Tak closed. | flown |

### Flights and spotting

| Stamp | Earned by | Ink |
|---|---|---|
| Red-eye | A flight that takes off between 21:00 and 01:59 and lands between 05:00 and 09:59, local times, at least 3 hours later. | flown |
| New Year in the air | A flight in the air at midnight on 1 January at its departure or its arrival airport's time. | flown |
| Plan B | A flight that diverted. | flown |
| Up front | A flight in business or first. | flown |
| Registers | Aircraft photographed from 10, 25 and 50 countries' registers, by their registrations' prefixes. Levels: 10, 25, 50. | spotted |
| Special liveries | 10 and 50 special liveries photographed, each aircraft and livery once. Levels: 10, 50. | spotted |
| Big day | 100 aircraft photographed in one day. | spotted |

### Stamps the owner gives

Decided, built (Q-STAMP-GRANTED). A few stamps are not worked out from the log: the site's owner gives them to people from People in Settings, and can take one back ([33](33-accounts-and-sign-in.md), "Stamps the owner gives"). The server keeps them with the account (`granted_stamps`), not in the person's log, which the owner cannot write. The account's pages receive them with the account, the command line when it is signed in, and a whole log's share link with its content. They are listed last, in their own group, From Touchdown, only once given, each dated the day it was given (in UTC) with no record to open, in the page's own ink rather than gold or blue, as they say nothing of flights or sightings. The list is curated in the core package (`packages/core/src/stamps/granted.ts`); the server stores a stamp's id, so an id is never renamed.

| Stamp | Given for | Inside |
|---|---|---|
| Alpha user | Among the first people invited to Touchdown | α |
| Bug finder | A problem in Touchdown found and reported | a bug |
| Translator | Help with Touchdown's translations | 文A |

### Factory airfields

Curated in the core package (`packages/core/src/stamps/factories.ts`), each site with its source. A sighting counts on a day between the site's first and last year of building. One stamp per maker, and only for the makers the aircraft types pages show as popular for every role (`POPULAR_MAKERS.all` in core, [31](31-ui.md), "Aircraft types"), so that the stamps stay few and well known; a test keeps the two lists together. Of those, Aérospatiale-BAC, Ilyushin and Tupolev have no factory airfield here yet. A maker's aircraft are the types whose manufacturer the reference tables give as that maker (for McDonnell Douglas also Douglas). Saw it built counts the same sites.

| Maker | Sites (years) |
|---|---|
| Boeing | PAE Everett (1967–), RNT Renton (1957–), BFI Boeing Field, flight test and delivery (1967–), CHS Charleston (2011–), LGB Long Beach (1997–2015) |
| McDonnell Douglas | LGB Long Beach (1941–2001) |
| Airbus | TLS Toulouse (1972–), XFW Hamburg Finkenwerder (1993–), TSN Tianjin (2008–), BFM Mobile (2015–), YMX Mirabel, the A220 (2013–) |
| Embraer | SJK São José dos Campos (1969–), MLB Melbourne, Florida (2011–) |
| COMAC | PVG Shanghai Pudong (2017–) |
| Bombardier | YUL Montréal-Trudeau (1980–), YMX Mirabel, the CRJ (1999–2020), YYZ Toronto Pearson, the Global (2023–), ICT Wichita, the Learjet (1990–2021) |
| Lockheed | PMD Palmdale, the TriStar (1968–1984) |

Left out because the reference tables do not hold the airfield: Downsview (Bombardier's Global until 2024), Gavião Peixoto (Embraer). A few start years are the first year confirmed rather than the first year of building, as the file says.

Test registrations: the French test and delivery class (`F-W…`, Airbus and ATR at Toulouse among others) and Airbus Hamburg's `D-AV…`. Boeing's temporary registrations follow no pattern, and those of Tianjin, Mobile and Mirabel are not documented, so they are not recognised.

### Continents

Curated in the core package (`packages/core/src/stamps/continents.ts`): each country's continent as the United Nations' geographic regions (M49) place it, so Central America and the Caribbean are North America, Australia and the Pacific islands Oceania, and Cyprus and the Caucasus Asia. Three countries on two continents go by the airport's longitude: Russia (Europe west of 60° E, the Urals), Turkey (Europe west of 29° E, the Bosphorus) and Egypt (Asia east of 32.35° E, the Suez Canal). Kazakhstan counts as Asia.

## Maps

- Flights map: every flight as a recorded track if one exists, otherwise a great-circle line. Line weight or colour by count. Airports sized by visits.
- Sightings map: airports/spots with aircraft counts.
- Map exports (figure, video) are in [23](23-tracks-and-maps.md).

## Testing

A fixture dataset built from the owner's data (private fields removed, kept in `data/private/`) is checked against the summary numbers in the private snapshot (`data/private/`, not committed). Differences must be explained: for example, airframes vs registrations, or the sheet's row-4 formula bug.
