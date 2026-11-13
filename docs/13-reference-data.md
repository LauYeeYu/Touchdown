# 13 Reference Data and External Sources

Where facts about airports, airlines, aircraft types, airframes, flights, and tracks come from (requirements D3, D5, D6, F2). Prices and terms change; recheck them before relying on a paid source.

## Summary

| Need | Default source (free) | Paid option | Gap |
|------|-----------------------|-------------|-----|
| Airports + time zones | OurAirports + airportsdata | none needed | none |
| Airlines (IATA + ICAO + validity) | Wikidata, VRS airlines, Mictronics operators | none needed | small airlines, renames |
| Aircraft types | VRS standing-data model-type | none needed | family table is ours to maintain |
| Registration → type, hex, operator | Mictronics / tar1090-db, adsbdb, hexdb | — | registration history outside the US |
| Registration → MSN, first flight | OpenSky aircraft DB (2025-08 snapshot); Flightradar24 through the user's own browser (opt-in); text pasted from an airframe page | — | aircraft registered after 2025-08; exact first flight dates (see "Airframe facts") |
| Flight number + date → aircraft, times | none for past flights without an account; OpenSky's flights endpoints with the user's own OpenSky API client (see "Flight lookups") | FlightAware AeroAPI Personal (last 10 days) | flights older than 10 days where OpenSky has no receivers (China, the Gulf in part) |
| Recorded track | A track file the user adds: a Flightradar24 download (manual, the most complete, oceans and China included), or a KML or GPX file | adsb.lol trace history, only when the user asks (`touchdown tracks`, to fill gaps; from 2023-02-16, thin until March 2023); AeroAPI (last 10 days) | flights nobody has a file for; for adsb.lol, areas with poor receiver coverage |

## Static reference datasets

Built by `packages/refdata` and shipped with the web app as versioned JSON. Rebuilt on a schedule (weekly is enough).

| Dataset | Source | Licence | Fields used | Notes |
|---------|--------|---------|-------------|-------|
| Airports | [OurAirports](https://ourairports.com/data/) `airports.csv` | Public domain | ident, type, name, lat/lon, elevation, iso_country, municipality, icao_code, iata_code | Two tables (below, "Airports"): `airports` (`large_airport`, `medium_airport`, and any airport with an IATA code) and `airfields` (the other open airfields, seaplane bases, heliports and balloon ports with an ICAO code). |
| Airport time zones | [airportsdata](https://github.com/mborsetti/airportsdata) | MIT | icao, iata, lid, tz | Joined to OurAirports by ICAO, then IATA, then the FAA identifier, within 100 km; else the country's zone where it has one. An airfield with neither takes the zone of the nearest airport in its country that has one, within 100 km, and is left out beyond. |
| Airlines | [Wikidata](https://www.wikidata.org/) (P230 ICAO, P229 IATA, P576 dissolved) | CC0 | codes, name, country, dissolved date | Best open source for validity dates. |
| Airlines (fill gaps) | [VRS standing-data](https://github.com/vradarserver/standing-data) airlines; [Mictronics](https://github.com/Mictronics/aircraft-database) operators.json | CC0; ODC-By | name, ICAO, IATA, callsign, country | |
| Aircraft types | VRS standing-data `model-type` | CC0 | ICAO designator, manufacturer, model, engines, wake category | ICAO's own Doc 8643 data is copyrighted and paid; not used. |
| Families | Our own table (~150 rows) in `packages/refdata` | Ours | designator → family | No open dataset exists. Starts from the families listed in [01](01-existing-data.md). |
| Model patterns | Our own table | Ours | designator → regex for manufacturer model designations | For V-MODEL-TYPE. |
| Registration prefixes | Our own table, from ICAO nationality marks | Ours | prefix, country, pattern | |

Attribution for ODC-By and ODbL sources is shown on an About page and in exports that contain derived data.

### Airports

Built. Private flights, lessons and pleasure flights use small airfields, which most airport lists leave out. The airports are two tables, built from the same sources by `scripts/airports.ts`:

| Table | Rows | In the app |
|---|---|---|
| `airports` | Large and medium airports, and any airport with an IATA code (about 9,000). | Shipped with the app and loaded with it. |
| `airfields` | The other open airfields, seaplane bases, heliports and balloon ports that have an ICAO code (OurAirports' `icao_code`, or a `gps_code` of four letters) and no IATA code, and whose id and code no airport has (about 13,000, 1.4 MB). Their id is `ap_<icao>`, as an airport's. | Loaded only when needed (`@touchdown/refdata/airfields`): when the log has a record whose airport code or id the airports do not have, when a code or a name typed in an airport field matches none of them, and before a file is read on the Import page or from the inbox. Then kept for the session. The share page loads them when a link's records need them. The CLI always reads both. |

An airfield's zone, where no source gives one, is the nearest airport's in its country (`MAX_NEAREST_ZONE_KM`): checked against airfields whose zone is known, it gives the right UTC offsets for 98% of them (99% within 25 km). A wrong one can be put right with an airport of the user's own under the same code, which comes first. Airfields have no names in other languages.

An airport in neither table is added by the user (`airport_overrides`, [10](10-domain-model.md); [31](31-ui.md), "Airports of your own"): a code, a name, a place, a country, a position and a time zone. It comes before the reference data, with the same code too. Records saved before their airport was known (an import from before the airfields, or a code added later) are linked by a fix ([20](20-validation.md), V-AIRPORT-KNOWN).

### Names in other languages

Built (G12, [31](31-ui.md), "Language"): airports, the places they serve and airlines are shown in the interface's language where Wikidata has a name in it. `npm run build-names -w @touchdown/refdata` (`scripts/names.ts`, after `build-data`) asks Wikidata (CC0) for the labels of every airport with an ICAO or IATA code (P239, P238), of the place it serves (P931), and of every airline with an ICAO code (P230), and writes `data/names/<tag>.json`.

| Part | Rule |
|---|---|
| Matching | An airport by ICAO, else IATA, an ICAO match first (an IATA code can pass from a closed airport to another). An airline by ICAO, and only when Wikidata's English name is the same company's (`sameAirline`), since ICAO codes pass between airlines over the years. The English name is the `en` label, else the `mul` one (the label for every language, where many items keep it). |
| Several items with one code | An airport and the air base beside it, an airport and the one it replaced, an airline and the one that had its code before: the item whose English name is most like the table's (`best`), the same whatever order Wikidata answers in. Of those named at least half as alike as the closest, one with a name in the language comes first and, where the table names an airport, a civil one. |
| Places | Of the places the item serves, the one whose English name is the table's place as the app shows it ("Manchester, Greater Manchester" is Manchester), else that place where another item with the code serves it, else the item's place that has a name in the language. In Chinese a trailing 市 is dropped (上海, not 上海市), as a city is written in a line. |
| Airport names | A Chinese label that is only the place's name ("查尔斯顿" for Charleston International Airport) or has no word for an airfield (机场, 基地, 站 and the like: "布里斯托尔（BRS）") is passed over for another of the item's labels, else the airport keeps its English name. Where the table names an airport, a label with 机场 or 空港 comes first. |
| zh-CN | The `zh-cn`, `zh-hans`, `zh-sg` or `zh` label, in Simplified characters. |
| zh-TW | The `zh-tw` or `zh-hant` label, else `zh-hk`, else the Simplified one converted with Taiwan's wording (OpenCC, used only when the data is built, never shipped). Some converted names may differ from Taiwan's official ones. |
| de-DE | The `de` label, kept only where it differs from the English name. |
| Chinese names | Kept only when written in Chinese characters. |
| Corrections | A name Wikidata has wrong (Andes Líneas Aéreas labelled with Austral's Chinese name) is put right, or dropped so the English name shows, from `src/curated/name-fixes.ts`, by the row's id. The build applies them, and `npm run build-names -w @touchdown/refdata -- --fixes-only` applies them to the files as they are, without asking Wikidata again. |
| Makers of aircraft types | Not from Wikidata: the makers with a name of their own in the language are messages (`labels.maker.*`: Boeing is 波音, Airbus 空客 and 空中巴士). The model stays as written. |
| In the app | Loaded only when the language is chosen (`@touchdown/refdata/names`), before the first page is drawn. Shown only: matching, imports and search by code keep the data's English names, the log stores ids, and search finds a place by either name. A name not in the file is shown in English. The CLI and the myFR24 export stay in English. |

### Type figures

Decided, built (`packages/refdata/scripts/type-specs.ts`, `src/curated/type-specs.ts`, `data/type_specs.json`, `data/family_facts.json`): each type code in a family ([10](10-domain-model.md), "Reference tables") has the figures its English Wikipedia article gives in its specifications: length, wingspan (a helicopter's main rotor diameter), height, fuselage width, wing area and sweep, maximum take-off weight, range, cruise speed, seats (typical and maximum) and engines. Each family has its first flight, entry into service, number built and status from its article's infobox.

| Rule | |
|---|---|
| Figures, not prose | Only the figures are kept, with the article's title and revision, and each type's page links to that revision. No text is copied, so no share-alike text is in the app. |
| Where | The article for each family's codes and which of its table's columns is which code are curated (`type-specs.ts`): one family can need several articles (the 737's four generations). A figure the table does not give but the article states elsewhere is an override there, with where it is in the article. |
| Never guessed | A figure the article does not give stays empty. |
| Units | Metric, as the article gives it where it gives both; shown in the log's distance unit for range and speed. |
| When | Built when the reference data is, not read while the app runs: `npm run build-type-specs -w @touchdown/refdata` (`--refresh` asks for each article's latest revision), which keeps what it reads in `data/private/cache/wikipedia/`. |
| Order | A family's codes are listed by generation, then model: the first generation first, and within a generation its models in order (A318, A319, A320, A321, then the A320neo's). The order is a curated list (`src/curated/type-order.ts`), as nothing in the tables says which generation a type code belongs to. A test checks each list has exactly its family's codes. |
| In the app | Its own module (`@touchdown/refdata/typeinfo`), loaded the first time a page needs it: the type pages and the aircraft list's silhouettes ([31](31-ui.md), "Aircraft types"). |

Decided, built (`packages/refdata/scripts/type-wikidata.ts`, `src/curated/type-wikidata.ts`, `data/type_wikidata.json`): every type code in `aircraft_types.json`, in a family or not, can have the figures its Wikidata item states: length, wingspan (a helicopter's main rotor diameter), height, maximum take-off weight, range, cruise speed, maximum passengers, engines, first flight, entry into service, number built, and a role (airliner, business, light, helicopter, military, other). They are for the codes without the figures above, and fill what those figures lack. A code that matches no item has no row.

| Rule | |
|---|---|
| Source | Wikidata's query service, CC0. Each row keeps the item's id and revision. |
| Matching | Wikidata has no property for ICAO type designators, so a code is matched by name: its manufacturer and model (`aircraft_types.json`) against the English labels and aliases of Wikidata's aircraft items, without case, accents or punctuation. A label match comes before the item of the code's curated Wikipedia article, which comes before an alias match (aliases also name derivatives), then the item with the most figures. Wrong or missing matches are curated (`itemOverrides`). |
| Shared items | An item that several codes match is their family's, and its figures may be any one model's: those codes keep its role and engines only. |
| Units | Wikidata's normalised values, so Wikidata converts feet, pounds and knots: metres, kilograms, km and km/h. Dates as precise as stated (`YYYY-MM-DD`, `YYYY-MM` or `YYYY`). |
| Several values | Preferred rank first, and a value qualified for another variant or a prototype is left out. Then the largest maximum take-off weight, range, seats and number built, and the earliest date. A length, span, height or cruise speed is kept only when its values agree. |
| Checks | A value outside a plausible range, a length and span no aircraft has together, or a maximum take-off weight that does not fit the code's wake turbulence category is dropped, so a unit mix-up does not reach the app. The build prints each one. |
| Role | From the item's classes (instance of, subclass of, has use, and the classes above them) through a curated map. Of several, one: helicopter, then military, business, airliner, light, other. |
| Overrides | A value Wikidata states wrongly is corrected in `valueOverrides`, with why. |
| Never guessed | A figure the item does not state stays empty. |
| When | `npm run build-type-wikidata -w @touchdown/refdata` (`--refresh` asks again), which keeps the answers in `data/private/cache/wikidata/`, so a rerun asks only for items it has not seen. |

Decided, built (`packages/refdata/scripts/type-wikipedia.ts`, `src/curated/type-wikipedia.ts`, `data/type_wikipedia.json`): a type code that neither of the tables above gives a length and a span can have the length, wingspan (a helicopter's main rotor diameter), height and maximum take-off weight that the specifications template (`{{Aircraft specs}}`) of its English Wikipedia article states. These are mostly light, homebuilt, older and military types. A code with neither a length nor a span from its article has no row.

| Rule | |
|---|---|
| Source | English Wikipedia's API, CC BY-SA. Figures only, no text. Each row keeps the article's title and the revision read. |
| Which codes | Those with a manufacturer (not ICAO's group codes such as ZZZZ) that `type_specs.json` and `type_wikidata.json` together leave without a length or a span. |
| Matching | The English article of the code's Wikidata item (`type_wikidata.json`), redirects followed. A code without an item, or whose item has no English article, is searched for by its manufacturer and model. A result is taken only when its page has a specifications template and names the manufacturer, in its infobox or in its title outside the model's name, and its title holds the model's designation as whole words ("An-2" is not in "An-26", "PA-28" not in "PA-28R"), with no other model's name after it ("MQ-1 Predator" is not the MQ-1 Warrior). Without the designation, the rest of the model's name will do when no other code of that manufacturer has it and the title holds no other designation or number and no other words after the name ("Short Belfast" for the SC-5 Belfast; "Beechcraft Bonanza" for none of the 33, 35 and 36; "Beechcraft T-34 Mentor" not for the T-34A, "Eurofly Flash Light" not for the Flash). Two results of the same standing are ambiguous, and neither is taken. A replica takes only an article about the replica. |
| Shared articles | An article that several codes reach (several models' items lead to their family's article), that the curated figures read for other codes, or that a code reaches through a redirect to one of its sections states one model's figures without saying which code's: no code takes them. Nor does a code whose article's specifications are headed with another model of its series ("Specifications (KR-2)" in the article found for the KR-1). |
| Reading | The article's first specifications template, by its parameters (`length m`, `span m`, `height m`, `max takeoff weight kg` and their imperial forms). A biplane's span is the largest of its wings' spans. A rotorcraft's span is its main rotor's diameter, where the template gives no span or the rotor is wider than the stub wings. A rotorcraft's length that the template says includes the rotors is not taken: the other tables give the fuselage's. |
| Units | Metric where the template gives it, else converted exactly (1 ft = 0.3048 m, 1 in = 0.0254 m, 1 lb = 0.45359237 kg). |
| Never guessed | A value is read only when it is a plain number, or inches with a fraction as the template takes them ("9+1/2"), once its references, notes, thousands separators and unit are removed. A range, an approximation or a value with text stays empty, and the build prints it. |
| Checks | As for Wikidata: a value outside its plausible range, a length and span no aircraft has together, or a maximum take-off weight that does not fit the code's wake turbulence category is dropped and printed. |
| Overrides | Where the item's article or the search gives the wrong article, or none, the article is curated (`articleOverrides`), with why: mostly where ICAO names a licence builder or a later owner (PZL-Mielec for the An-2), and one aircraft under two codes. An override's article is read as it is. Null: no article fits. |
| When | `npm run build-type-wikipedia -w @touchdown/refdata` (`--refresh` asks again, `--check` also reads the articles of codes that have figures already and prints how far they agree with the other two tables). Every answer is kept in `data/private/cache/wikipedia/type-wikipedia/`, so a rerun makes no requests. |

### Silhouettes

Decided, built (G11, Q-SILHOUETTE; `apps/web/src/lib/silhouette.ts`, `packages/refdata/src/curated/silhouettes.ts`): every family's types are drawn from above by one generator, so they share one style and can be drawn to one scale. The figures give the length, span, fuselage width and sweep; the family's shape gives what they do not: where the wing's root sits along the fuselage, its root chord and taper, wingtips (winglets, sharklets, raked), where the engines are (on the wing, above it, beside the tail), the tailplane, propellers, or a helicopter's boom, rotor blades, stabiliser and tail rotor or fenestron, and what some types alone have: the E-3's and E-767's radar dome, the older Learjets' tip tanks, Concorde's ogee delta, the Cessna 337's twin booms and pod, the Cirrus SF50's engine on its back. A type whose wingtips or engines differ from its family's has its own (the 777-300ER's raked tips, the 747-8's). A type without length and span is not drawn.

- **A type without a family's shape** (`genericShape`): drawn with the usual shape of its kind, from its engines (jet, turboprop, piston), their number, its wake category and its role (Wikidata's, else its family's, else what its engines and size most often are): an airliner twin, a widebody, a four-engined jet, a business jet with its engines by the tail, a fighter's short swept wing with no engines showing (a military jet up to 25 m across; a larger one is drawn as the transport it is), a turboprop or piston twin, a four-engined propeller aircraft, a single, a helicopter. A glider, a balloon or an airship is not drawn. Its page says the drawing is the usual shape of its kind, not the aircraft's own.
- **Sweep** (`familySweep`, `typeSweep`): the wing's quarter-chord sweep, for drawing a type whose figures give none, as its family's English Wikipedia articles state it, quoted beside each value: the A330's 30°, the 747's 37.5°, the Citation X's 37°, the CitationJets' 0°. Where the articles state none, the figure the manufacturer publishes, marked as such (the DC-10's, MD-11's and TriStar's 35°, the BAe 146's 15°), or a straight wing where the type plainly has one (the older Citations). A jet with none is drawn at 25°.

- **A sibling's span or length.** Where a type's article gives no span or no length, the drawing may take another code's on the same wing (`sameWing`: the 737-800 and 737-900) or of the same length (`sameBody`: the 747-200 and 747-400). The figures still show none, and the measured drawing marks only the dimensions the type's own figures give.

- **Checked, and shown before.** Each family's drawings are compared with the real aircraft's planform, by eye against its wing, engines and tail, and the family is listed in `checkedFamilies`. Every drawing shows on the site and to visitors from the start. Until its family is checked, a type's page says the drawing is not checked against the real aircraft yet. (Changed: first, only checked families' drawings showed.) Not checked yet, and why: the helicopters (rotors drawn as crossed lines, no tail rotor or fenestron), the 707 and 767 families (the E-3's, E-6's and E-767's radar dome), the Cessna 337 (drawn as a single), Concorde (a straight-edged delta), the Cirrus SF50 (its V-tail and dorsal engine) and the Learjets (the older ones' wingtip tanks).
- **No set taken.** No CC BY set of top views covers these families in one style. Single drawings under CC0 exist, each in its own style.

## Airframe index

Facts about individual airframes. Too large to ship whole with the app (hundreds of thousands of rows), so it is built into a sharded static index and fetched on demand.

**Inputs (merged by the refdata build):**

| Source | Gives | Licence / terms |
|--------|-------|-----------------|
| [Mictronics aircraft DB](https://github.com/Mictronics/aircraft-database) | hex ↔ registration ↔ type | ODC-By (attribution) |
| [tar1090-db](https://github.com/wiedehopf/tar1090-db) | hex ↔ registration ↔ type, description | No licence file. The user accepts using it for this hobby app (Q-LICENSES). |
| [FAA registry](https://registry.faa.gov/database/ReleasableAircraft.zip) | US: serial number, year, hex; DEREG file gives registration history | US government data |
| [OpenSky aircraft DB](https://opensky-network.org/) complete snapshot 2025-08 | serial number, line number, first flight, operator, prevReg/nextReg | OpenSky terms (non-profit research and education). The user accepts using it for this hobby app (Q-LICENSES). Not updated since 2025-08. |

**Output:** `airframes/<shard>.json`, sharded by the first two characters of the registration's match form. Each entry: registration, hex, type designator, model, manufacturer, MSN (if known), first flight (if known), operator (if known), registration periods (if known), sources. Served as static files next to the app.

**Coverage expectation.** MSN and first flight will be known for most US aircraft and for most aircraft in the OpenSky snapshot. Aircraft registered outside the US after 2025-08 will often have no MSN, so their airframes stay provisional ([11](11-aircraft-identity.md)) until the user or a later source supplies it.

## Live lookups (through the lookup service)

Used when the static index has no entry or is stale. Results are cached by the lookup service.

| Source | Endpoint | Gives | Terms |
|--------|----------|-------|-------|
| [adsbdb](https://www.adsbdb.com/) | `GET /v0/aircraft/{reg or hex}` | type, manufacturer, hex, registration, owner, country | Free, no key. Aircraft data credited to PlaneBase. Route data may not be copied into other databases. Light, cached use only. |
| [hexdb.io](https://hexdb.io/) | `/api/v1/aircraft/{hex}`, `/reg-hex?reg=` | registration, type, owner | "Please do not scrape." Light, cached use only. |

Built so far (`touchdown spot`, [21](21-import-export.md)):
- adsbdb is asked directly from the user's computer, one request a second. Answers, including "unknown aircraft", are cached for 90 days in `data/private/cache/airframes/adsbdb/`.
- The airline also comes from the OpenSky snapshot (only from rows whose free-text columns split cleanly) and, with `--fr24`, from Flightradar24 pages: the "AIRLINE" row and its "Code" row. When the operator holding the certificate is a different company, it goes to the agent as a note.
- Models as these sources write them ("A320 232", "Boeing 787-9 Dreamliner") are turned into the standard form and kept only when they fit the type.
- The web app credits the OpenSky Network and adsbdb (PlaneBase) in its footer.

## Airframe facts

How an aircraft in the log gets its serial number (MSN), line number, first flight and delivery dates. The airframe index above is the long-term plan; this section is what the CLI and the web app do now.

### Sources

| Source | Gives | How | Status |
|--------|-------|-----|--------|
| OpenSky aircraft database, complete snapshot 2025-08 | MSN for most airliners; line number and first flight for a few (first flight is filled in about 1% of rows); build year | One CSV download (about 110 MB, from OpenSky's S3 bucket) into `data/private/reference/` (git-ignored), read locally. Licence accepted for this app (Q-LICENSES). | Decided |
| Flightradar24 aircraft page (`/data/aircraft/<registration>`) | MSN, model, type code, Mode S code, and a month beside the age (for example "AGE (Oct 2009)") | Opt-in (`--fr24`). Read through a Chrome the user started with `--remote-debugging-port` and is signed in to: one tab, one page at a time, 10 seconds apart by default, answers cached. FR24's terms (clause 2.3) allow access only "via a human-operated web browser or mobile application"; the user decides whether to use this (Q-FR24-BROWSER). If FR24 shows a bot check, the run stops using FR24; nothing tries to get past it. | Decided |
| Text pasted from an airframe page | Whatever the page shows: MSN, line number, first flight, delivery | The user opens a page in their browser (the aircraft page links to airfleets.net, aviation.flights, planespotters.net and Flightradar24), selects all, copies and pastes into "Paste from a web page" on the aircraft page. The values are previewed before saving. | Decided |

**Limitation of FR24.** FR24 never gives the day of the first flight, only a month beside the age, so it can fill serial numbers but not first flight dates. A first flight date is stored only when the exact day is known (Q-FR24-MONTH). The month is not always the first flight either: for an older aircraft it matched the first flight, but brand-new aircraft were seen up to three months before it (it is probably the delivery or registration month). So it is used only as a loose check: an answer is rejected when one of the user's records is more than a year before that month, which still catches a registration that belonged to another aircraft years earlier.

### Sites that are not read automatically

| Site | Why |
|------|-----|
| airfleets.net | Every request from a program gets a bot check (HTTP 403), which says Airfleets "protects its aviation data against automated access and abusive scraping". robots.txt itself allows `/ficheapp/` and `/recherche/`. |
| aviation.flights | Every request from a program gets a bot check, robots.txt included. Its terms reserve the right to block users "creating automated scripts that will interact with any of the pages of the service". It sells an API. |
| planespotters.net | robots.txt ends with `User-agent: *` / `Disallow: /` (only named search engines are allowed). The terms (section 13) say the aircraft database "may not be copied or altered, neither in whole nor in part, without prior permission". Every request from a program also gets a bot check. |
| FAA registry download | The ReleasableAircraft.zip download refuses requests from a program (HTTP 503). A user can download it in a browser; reading that file is not built yet (Proposed). |
| adsbdb, hexdb.io | Allow light use but give neither MSN nor first flight. |
| Wikidata | Allows queries, but has serial numbers or first flights for only a few hundred airframes. |

An exact first flight date for most aircraft therefore comes from the user at a browser, through the paste flow (Q-FIRST-FLIGHT).

### airfleets.net pages

The addresses below are for giving the user the right page to open in their own browser. The user reads it and pastes it into the paste flow. No program fetches them.

| Page | Address | Shows |
|------|---------|-------|
| Aircraft | `https://www.airfleets.net/ficheapp/plane-<family>-<msn>.htm`, for example `plane-b737ng-12345.htm` | One aircraft's facts, its first flight date and age among them |
| Search | `https://www.airfleets.net/recherche/?key=<registration>` | The aircraft that have carried a registration. The aircraft page's "Look it up" link opens this. |
| Production list | `https://www.airfleets.net/listing/<family>-<page>.htm`, for example `b737-1.htm` | 50 aircraft a page in serial order from the first one built, with MSN, LN, Type, Airline, First flight, Registration and Status |
| Airline fleet | `https://www.airfleets.net/flottecie/<Airline name>-active-<family>.htm`, spaces written `%20` | MSN, LN, Type, Registration, Delivery date and Remark. The delivery date is the airline's, not the factory's, so it is not a first flight. |

**Family names.** The aircraft page and the production list name families differently: the 737NG's aircraft pages use `b737ng`, while the Boeing 737 production list, covering every generation from the 737-100, uses `b737`. The names for other families are not recorded yet (Open). Add each here when a page shows it, and do not guess one.

**Dates.** airfleets writes dates day first, `dd/mm/yyyy`: `09/04/2012` is 9 April 2012, not 4 September. A month alone is `mm/yyyy` ("Parked since 03/2021"). The paste flow reads slashed dates day first unless the second number is over 12 (`parsePageDate` in `packages/core/src/identity/paste.ts`). When the day and the month are both 12 or under, the age shown on the aircraft page confirms the reading: the two readings give different ages.

### Checks before anything is stored

A source answers for a registration, and registrations are reused. An answer is used only if it fits every record of the airframe; otherwise it is reported and nothing is stored.

| Check | Rejects when |
|-------|--------------|
| Type | The source's type code is in another family than the airframe's (same family, e.g. A321 and A21N, is fine). |
| Maker | The first word of the maker differs ("Airbus SAS" and "Airbus" agree). |
| First flight | A record of the airframe is dated before the source's first flight. |
| Build year, age month | A record is dated before the start of the build year (OpenSky), or more than a year before the age month (FR24). |
| Registration dates | The source gives when the aircraft carried the registration and a record falls outside it, with a month's slack either side. |

When a source knows several airframes for a registration, the first that passes is used.

### What is stored

- The facts go on the airframe (`msn`, `lineNumber`, `firstFlightDate`, `deliveryDate`, `status`, and `manufacturer` when missing), with a `field_provenance` row per field: source `lookup`, detail the provider (`opensky`, `fr24`). `factsProvider` and `factsFetchedAt` record the latest lookup; the page address goes in `external_ids` (system = provider). The transponder address the source gives (OpenSky's `icao24`, also from a row without a serial number when the registration has no row with one; Flightradar24's Mode S code) goes on the registration (`registration_periods.icaoHex`) when it has none, with its own `field_provenance` row; a different address already there is kept and reported. `touchdown tracks` uses it before any other source.
- A serial number makes the airframe confirmed (`identityKey = msn:<maker>:<msn>`, with the series for Airbus, [11](11-aircraft-identity.md)). If another airframe already has that key, the two are merged.
- Serial numbers are compared and stored without leading zeros when they are all digits (FR24 writes "038" where the maker writes "38").
- A value the user typed in the app always wins; a different lookup value is reported, not stored. A value imported from the user's own sheet also wins unless the CLI runs with `--overwrite-imported`.
- Pasted values are saved as values the user entered (`field_provenance` source `user`): on the aircraft page, or with `touchdown aircraft edit REF --paste FILE` through the inbox ([34](34-command-line.md)).
- The aircraft page shows where each fact came from ("from OpenSky", "from your sheet", "entered by you"), linking to the page when there is one.

### Running it

`./touchdown airframes` looks up every aircraft in the user's log that lacks a serial number or first flight, on a copy of the log: what fits goes to the inbox as one file of changes ([34](34-command-line.md)), each answer with its source, checked against the records again when the user imports it and applied with the same code (`applyAirframeFacts`), merges included; undoing the import takes them back. `airframes <backup.zip> --out <backup.zip>` fills a backup file instead, and `import … --airframes` does the same while building a backup. Options:

| Option | Does |
|--------|------|
| `--fr24` | Also use Flightradar24 through the user's Chrome (`--chrome-port`, default 9222; `--fr24-delay`, default 10 seconds). Only aircraft still without a serial number are visited. |
| `--all` | Look up every aircraft, not only those with gaps. |
| `--only REG,REG` / `--limit N` | Restrict the run. |
| `--refresh` / `--offline` | Ask the sources again / use only cached answers. Answers are cached for 90 days in `data/private/cache/airframes/`, but a Flightradar24 page only with its serial number: a page without one (the signed-in plan may not show it) is read again next time, and one cached before is dropped. `--offline` still uses it. |
| `--overwrite-imported` | Let lookups replace values imported from the user's sheet. |

## Flight lookups (flight number + date)

No free source covers past flights without an account. With one, OpenSky does.

| Option | Coverage | Cost | Terms | Use |
|--------|----------|------|-------|-----|
| [OpenSky REST API](https://openskynetwork.github.io/opensky-api/rest.html), `flights/departure` and `flights/arrival` | Past days back to at least 2023 (tested), wherever OpenSky has receivers: good in Europe and the US, nothing inside China, partial in the Gulf; the other end of a flight is often "not seen" (`estArrivalAirport` null) | Free with an OpenSky account: an API client (OAuth2 client credentials, tokens of 30 minutes) and 4,000 credits a day, 30 credits for each query of one airport and one day; anonymous requests answer "You cannot access historical flights" | OpenSky terms (non-profit research and education; Q-LICENSES) | Finding the aircraft of a past flight: the departures of the origin (or the arrivals at the destination) on the flight's UTC day give hex code, callsign and the estimated other airport; the airline's ICAO code and the flight number name the flight when the callsign is the flight number (`DLH400` for LH400, `RPA4321` for a Delta flight flown by Republic), else the airline's flight nearest the logged time on the route; the hex becomes a registration through the OpenSky aircraft database or adsbdb. Lufthansa and Ryanair mostly fly alphanumeric callsigns (`DLH9XY`, `RYR12AB`), so the route and time decide, and the aircraft is confirmed by its adsb.lol trace of that day ([23](23-tracks-and-maps.md)). Done by hand so far (Q-OPENSKY-FLIGHTS); the user's client would be kept in `data/private/`, never committed. |
| FlightAware AeroAPI, Personal tier | 10 days back, 2 days ahead | $5/month free usage, then about $0.005 per flight and $0.012 per track | Single account, personal use. Raw data kept ≤ 30 days; derived data may be kept. | Optional. Each user enters their own key (Q-BUDGET). |
| adsb.lol live API | Aircraft in the air now | Free | ODbL; contact them for production use | Optional "capture during flight": while the user's flight is airborne, look up its callsign to get the hex and registration. |
| FR24 API | From 2022-06 | From $9/month | Data may not be stored more than 30 days | Not used: a logbook stores data permanently. |
| FlightAware AeroAPI, Standard | Back to 2011 | From $100/month | Not reviewed | Only for a one-time backfill, if ever. |

In practice: for past flights the registration comes from the user, the FR24 import, or the existing sheet, and otherwise from OpenSky's flights data where it has coverage. The other lookups help only for new flights.

## Recorded tracks

See [23](23-tracks-and-maps.md) for how tracks are matched and drawn.

| Source | Coverage | Cost | Terms | How |
|--------|----------|------|-------|-----|
| [adsb.lol](https://adsb.lol/) globe history | From 2023-02-16: test releases until early March 2023, with far fewer receivers (under 0.1 GB on the first day, about 1 GB a day by late February), then the regular history; good over the US and Europe, gaps over oceans, almost nothing over China | Free | ODbL (attribution) | Per-aircraft, per-day trace: `globe_history/YYYY/MM/DD/traces/<last 2 hex>/trace_full_<hex>.json`. Needs the airframe's hex for that date. Not a documented API: cache and throttle. Observed in testing: 404 = no trace for that aircraft that day; 403 = the whole day is not on the server; no traces found for dates after mid-November 2025 (recheck before relying on it). The whole history is also published on GitHub, one release per UTC day with every aircraft's trace that day (repositories `adsblol/globe_history_<year>`, a new day each morning): about 1.5 GB a day at the end of 2023, 1.9 GB at the end of 2024, 3 GB at the end of 2025 and 3.3 GB in October 2026, with a second copy (staging) of about the same size; roughly 3 TB in all. One trace there would mean downloading its whole day, but each day is a plain tar of files gzipped one by one, so `touchdown tracks` reads only the aircraft's folder by byte ranges ([23](23-tracks-and-maps.md), "Backfill"): about 10 to 60 MB a flight. Observed later: the per-file server now answers scripts with a "Verification" page (HTTP 403), for every date; nothing tries to get past it. GitHub's release files allow no reads from a web page (no CORS headers), so a web version would need the site to relay them. |
| FR24 consumer subscription | Silver 90 days, Gold 365 days, Business 3 years | FR24 subscription (a user may have one) | Automated access is against FR24's terms | User downloads the CSV or KML for a flight and uploads it. Best coverage over China and oceans. Observed in testing: the aircraft history list stops at the plan's history limit (the list API returns 400 beyond it), and downloads are limited per day (the site calls `/download/check-quota` before each download). |
| AeroAPI Personal | 10 days | As above | As above | Optional, user's own key. |
| Great circle | Always | Free | — | Default when no recorded track exists. |

## Lookup service API (proposed)

Stateless; no user data stored; responses cached.

| Endpoint | Does |
|----------|------|
| `GET /airframe/{registration}` | Static index entry, else adsbdb/hexdb, normalised to one shape. |
| `GET /trace/{hex}/{date}` | Fetches and caches the adsb.lol trace. |
| `GET /flight/{flightNumber}/{date}` | Forwards to AeroAPI with the user's key passed in a header (never stored or logged). Only if the user configured a key. |
| `GET /live/{callsign}` | adsb.lol live lookup for "capture during flight". |

Every response says which provider answered and when the data was fetched, so `field_provenance` can record it.
