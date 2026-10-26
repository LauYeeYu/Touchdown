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
| Flight number + date → aircraft, times | none for past flights | FlightAware AeroAPI Personal (last 10 days) | flights older than 10 days |
| Recorded track | adsb.lol trace history (from 2023-02-16, thin until March 2023) | AeroAPI (last 10 days); FR24 consumer plan (manual download) | flights before 2023-02-16, and many before March 2023; areas with poor receiver coverage |

## Static reference datasets

Built by `packages/refdata` and shipped with the web app as versioned JSON. Rebuilt on a schedule (weekly is enough).

| Dataset | Source | Licence | Fields used | Notes |
|---------|--------|---------|-------------|-------|
| Airports | [OurAirports](https://ourairports.com/data/) `airports.csv` | Public domain | ident, type, name, lat/lon, elevation, iso_country, municipality, icao_code, iata_code | Keep `large_airport`, `medium_airport`, and any airport with an IATA code or used in the user's data. |
| Airport time zones | [airportsdata](https://github.com/mborsetti/airportsdata) | MIT | icao, iata, tz | Joined to OurAirports by ICAO, then IATA. Fallback: compute from lat/lon with timezone-boundary-builder (ODbL). |
| Airlines | [Wikidata](https://www.wikidata.org/) (P230 ICAO, P229 IATA, P576 dissolved) | CC0 | codes, name, country, dissolved date | Best open source for validity dates. |
| Airlines (fill gaps) | [VRS standing-data](https://github.com/vradarserver/standing-data) airlines; [Mictronics](https://github.com/Mictronics/aircraft-database) operators.json | CC0; ODC-By | name, ICAO, IATA, callsign, country | |
| Aircraft types | VRS standing-data `model-type` | CC0 | ICAO designator, manufacturer, model, engines, wake category | ICAO's own Doc 8643 data is copyrighted and paid; not used. |
| Families | Our own table (~150 rows) in `packages/refdata` | Ours | designator → family | No open dataset exists. Starts from the families listed in [01](01-existing-data.md). |
| Model patterns | Our own table | Ours | designator → regex for manufacturer model designations | For V-MODEL-TYPE. |
| Registration prefixes | Our own table, from ICAO nationality marks | Ours | prefix, country, pattern | |

Attribution for ODC-By and ODbL sources is shown on an About page and in exports that contain derived data.

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

- The facts go on the airframe (`msn`, `lineNumber`, `firstFlightDate`, `deliveryDate`, `status`, and `manufacturer` when missing), with a `field_provenance` row per field: source `lookup`, detail the provider (`opensky`, `fr24`). `factsProvider` and `factsFetchedAt` record the latest lookup; the page address goes in `external_ids` (system = provider).
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
| `--refresh` / `--offline` | Ask the sources again / use only cached answers. Answers are cached for 90 days in `data/private/cache/airframes/`. |
| `--overwrite-imported` | Let lookups replace values imported from the user's sheet. |

## Flight lookups (flight number + date)

No free source covers past flights.

| Option | Coverage | Cost | Terms | Use |
|--------|----------|------|-------|-----|
| FlightAware AeroAPI, Personal tier | 10 days back, 2 days ahead | $5/month free usage, then about $0.005 per flight and $0.012 per track | Single account, personal use. Raw data kept ≤ 30 days; derived data may be kept. | Optional. Each user enters their own key (Q-BUDGET). |
| adsb.lol live API | Aircraft in the air now | Free | ODbL; contact them for production use | Optional "capture during flight": while the user's flight is airborne, look up its callsign to get the hex and registration. |
| FR24 API | From 2022-06 | From $9/month | Data may not be stored more than 30 days | Not used: a logbook stores data permanently. |
| FlightAware AeroAPI, Standard | Back to 2011 | From $100/month | Not reviewed | Only for a one-time backfill, if ever. |

In practice: for past flights the registration comes from the user, the FR24 import, or the existing sheet. Flight lookups help only for new flights.

## Recorded tracks

See [23](23-tracks-and-maps.md) for how tracks are matched and drawn.

| Source | Coverage | Cost | Terms | How |
|--------|----------|------|-------|-----|
| [adsb.lol](https://adsb.lol/) globe history | From 2023-02-16: test releases until early March 2023, with far fewer receivers (under 0.1 GB on the first day, about 1 GB a day by late February), then the regular history; good over the US and Europe, gaps over oceans, almost nothing over China | Free | ODbL (attribution) | Per-aircraft, per-day trace: `globe_history/YYYY/MM/DD/traces/<last 2 hex>/trace_full_<hex>.json`. Needs the airframe's hex for that date. Not a documented API: cache and throttle. Observed in testing: 404 = no trace for that aircraft that day; 403 = the whole day is not on the server; no traces found for dates after mid-November 2025 (recheck before relying on it). The whole history is also published on GitHub, one release per UTC day with every aircraft's trace that day (repositories `adsblol/globe_history_<year>`, a new day each morning): about 1.5 GB a day at the end of 2023, 1.9 GB at the end of 2024, 3 GB at the end of 2025 and 3.3 GB in October 2026, with a second copy (staging) of about the same size; roughly 3 TB in all. One trace there means downloading its whole day. |
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
