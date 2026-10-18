# 13 Reference Data and External Sources

Where facts about airports, airlines, aircraft types, airframes, flights, and tracks come from (requirements D3, D5, D6, F2). Prices and terms change; recheck them before relying on a paid source.

## Summary

| Need | Default source (free) | Paid option | Gap |
|------|-----------------------|-------------|-----|
| Airports + time zones | OurAirports + airportsdata | none needed | none |
| Airlines (IATA + ICAO + validity) | Wikidata, VRS airlines, Mictronics operators | none needed | small airlines, renames |
| Aircraft types | VRS standing-data model-type | none needed | family table is ours to maintain |
| Registration → type, hex, operator | Mictronics / tar1090-db, adsbdb, hexdb | — | registration history outside the US |
| Registration → MSN, first flight | FAA registry (US), OpenSky aircraft DB (2025-08 snapshot) | — | non-US aircraft built after 2025-08; history |
| Flight number + date → aircraft, times | none for past flights | FlightAware AeroAPI Personal (last 10 days) | flights older than 10 days |
| Recorded track | adsb.lol trace history (from 2023-03) | AeroAPI (last 10 days); FR24 consumer plan (manual download) | flights before 2023-03; areas with poor receiver coverage |

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

## Sites the user checks by hand

The user currently looks up aircraft on airfleets.net (Airbus), aviation.flights (Boeing), and planespotters.net. These sites do not allow automated access (airframes.org explicitly forbids it; the others have no API). The app does not scrape them. Instead, each airframe page shows links that open these sites with the registration filled in, so the manual check is one click away. A value the user copies from them is stored with `fieldSources = user`.

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
| [adsb.lol](https://adsb.lol/) globe history | 2023-03 onward; good over the US and Europe, gaps over oceans, almost nothing over China | Free | ODbL (attribution) | Per-aircraft, per-day trace: `globe_history/YYYY/MM/DD/traces/<last 2 hex>/trace_full_<hex>.json`. Needs the airframe's hex for that date. Not a documented API: cache and throttle. Observed in testing: 404 = no trace for that aircraft that day; 403 = the whole day is not on the server; no traces found for dates after mid-November 2025 (recheck before relying on it). |
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
