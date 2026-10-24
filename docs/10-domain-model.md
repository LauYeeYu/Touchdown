# 10 Domain Model and Schema

The data schema: every table, column, and type. This is the lowest layer; every other doc builds on it.

The schema is defined once, in code (`packages/core/schema`), and is the single source of truth. From it the build generates TypeScript types, runtime validators, JSON Schemas (for JSON table files and the agent check), SQL table definitions for SQLite, Postgres, and Cloudflare D1, and CSV column lists. No backend stores anything the schema does not define. How backends store and sync these tables is in [12](12-storage-and-sync.md).

## Rules

- **Flat tables.** Every column holds one scalar value. Lists and nested data are child tables. The only exception is `record_history.row`, a full row snapshot kept for undo, which is validated against the schema version it was written with.
- **Everything optional.** Every column is optional except system columns and the parent reference of child tables. A record can be saved with any subset of fields (requirement G4). A missing field creates an "incomplete" notice, never a save error. Each statistic reports how many records it left out (see [24](24-statistics.md)).
- **Raw and normalised.** Where the typed input matters (registration, codes, model), a `…Raw` column keeps the value as entered and the plain column holds the normalised value. Automatic fixes change only the normalised value and record where it came from in `field_provenance`.
- **Date-times.** Every precise time is a full ISO 8601 date-time with the UTC offset in effect at that place and moment, e.g. `2025-03-15T00:12+01:00`. There are no time-only columns, so a takeoff after midnight can never be filed under the previous day (requirement G8). The wall-clock part is the local time at the airport; the offset makes it an exact instant. The offset is computed from the airport's IANA time zone when the value is entered.
- **Dates.** Values that are calendar dates by nature, or where only the day is known, are `YYYY-MM-DD` (`scheduledDate`, `firstFlightDate`, `seenOn`).
- **IDs.** ULIDs, generated on the device.
- **Units.** Distances in kilometres, altitudes in feet, speeds in knots. Display units are a setting.
- **Names.** Logical names are camelCase (TypeScript, JSON keys). SQL column names are the snake_case form, generated (`takeoffAt` → `takeoff_at`).

## Logical types

| Type | Meaning | JSON tables | SQLite / D1 | Postgres |
|------|---------|-------------|-------------|----------|
| `id` | ULID | string | `TEXT PRIMARY KEY` | `text primary key` |
| `text` | string | string | `TEXT` | `text` |
| `integer` | whole number | number | `INTEGER` | `bigint` |
| `real` | decimal number | number | `REAL` | `double precision` |
| `boolean` | true/false | `true`/`false` | `INTEGER` 0/1 with `CHECK` | `boolean` |
| `date` | `YYYY-MM-DD` | string | `TEXT` with format `CHECK` | `date` |
| `datetime` | ISO 8601 with offset | string | `TEXT` + generated `<col>_utc INTEGER` (epoch seconds, indexed) | `text` + generated `<col>_utc timestamptz` (indexed). Never `timestamptz` alone: it drops the local offset. |
| `enum` | one of a fixed list | string | `TEXT` with `CHECK (… IN …)` | `text` with `CHECK` (no native enum types, so migrations stay simple) |
| `ref` | id of a row in another table | string | `TEXT` + foreign key | `text` + foreign key |
| `json` | row snapshot (only `record_history.row`) | object | `TEXT` | `jsonb` |

## System columns

Every user table has these, in addition to its own columns:

| Column | Type | Notes |
|--------|------|-------|
| `id` | id | |
| `rev` | integer | +1 on every change. |
| `updatedAt` | datetime | UTC (`Z`). |
| `updatedBy` | text | Device id. |
| `basedOn` | text | The version (its `updatedAt`, `updatedBy` and `rev`) of another device's row this one was edited from, kept through later edits on the same device; null for a row only this device has edited. Sync uses it to tell an edit made on top of a version from one made beside it ([12](12-storage-and-sync.md), "Sync algorithm"). |
| `deleted` | boolean | Tombstone. Kept so deletes sync. |

Reference tables and `track_points` do not have them (reference data is replaced as a whole; track points are replaced with their track).

## Tables

```
Reference (shipped with the app, read-only)
  families ─< aircraft_types ─< model_patterns
  operators   airports   registration_prefixes

User data
  flights ─────────┐                 ┌─< registration_periods
                   ├──> airframes ───┤
  sightings ───────┘                 └─< operator_periods
  sightings ─< sighting_tags
  flights / sightings ─< photo_links
  flights ─< tracks ─< track_points
  any user row ─< field_provenance, external_ids, record_history
  import_batches        issue_acks ─< issue_ack_records
  settings, family_overrides, saved_views ─< saved_view_filters
  airport_overrides, operator_overrides, aircraft_type_overrides
```

`flights` and `sightings` never point at a registration directly. They store the registration as entered, and the identity resolver ([11](11-aircraft-identity.md)) sets `airframeId`.

### Reference tables

Built by `packages/refdata` from the sources in [13](13-reference-data.md), versioned, and shipped with the app. A user's additions and corrections live in the `*_overrides` user tables, which have the same columns plus the system columns. The app reads the reference table with the overrides applied on top.

**families**

| Column | Type | Example | Notes |
|--------|------|---------|-------|
| `id` | text | `A320` | Primary key. |
| `name` | text | `Airbus A320 family` | |
| `manufacturer` | text | `Airbus` | |

**aircraft_types**

| Column | Type | Example | Notes |
|--------|------|---------|-------|
| `designator` | text | `A21N` | ICAO type designator. Primary key. |
| `manufacturer` | text | `Airbus` | |
| `name` | text | `A321neo` | |
| `familyId` | ref families | `A320` | Default grouping keeps E170 and E175 as separate families. Users can override it (`family_overrides`). |
| `engineType` | enum | `jet` | `jet`, `turboprop`, `piston`, `electric`, `other` |
| `engineCount` | integer | `2` | |
| `wtc` | enum | `M` | Wake turbulence category: `L`, `M`, `H`, `J` |

**model_patterns**

| Column | Type | Example | Notes |
|--------|------|---------|-------|
| `designator` | ref aircraft_types | `A21N` | |
| `pattern` | text | `^A321-2\d\dNX?$` | Regex matching manufacturer model designations (standard form) of this type. Used by V-MODEL-TYPE. |
| `example` | text | `A321-271NX` | |

**operators**

| Column | Type | Example | Notes |
|--------|------|---------|-------|
| `id` | text | `op_dal` | Primary key. |
| `icao` | text | `DAL` | |
| `iata` | text | `DL` | IATA codes are reused over time; `validFrom`/`validTo` disambiguate. |
| `name` | text | `Delta Air Lines` | |
| `callsign` | text | `DELTA` | |
| `country` | text | `US` | ISO 3166-1 alpha-2. |
| `kind` | enum | `airline` | `airline`, `cargo`, `charter`, `business`, `private`, `government`, `military`, `manufacturer`, `lessor`, `other`. "Private Owner" maps to a generic `private` operator. |
| `validFrom`, `validTo` | date | | |

**airports**

| Column | Type | Example | Notes |
|--------|------|---------|-------|
| `id` | text | `ap_egll` | Primary key. |
| `icao` | text | `EGLL` | Some small fields have none. |
| `iata` | text | `LHR` | |
| `name` | text | `London Heathrow` | |
| `city` | text | `London` | |
| `country` | text | `GB` | |
| `lat`, `lon` | real | `51.4706`, `-0.4619` | Needed for distance and maps. |
| `elevationFt` | integer | `83` | |
| `tz` | text | `Europe/London` | IANA time zone. Needed for every date-time at this airport. |

**registration_prefixes**

| Column | Type | Example | Notes |
|--------|------|---------|-------|
| `prefix` | text | `N`, `B-`, `JA`, `D-` | Primary key. |
| `country` | text | `US` | Some prefixes split by sub-range (`B-` mainland China / Taiwan, `B-H` Hong Kong, `B-M` Macau). |
| `pattern` | text | `^N[1-9][0-9A-Z]{0,4}$` | For format checks and for adding/removing the dash. |

### flights

| Column | Type | Example | Notes |
|--------|------|---------|-------|
| `scheduledDate` | date | `2025-03-14` | Scheduled local departure date, as on the ticket. With the flight number it identifies the flight. A label, not a precise time: the actual takeoff can be on the next day. |
| `flightNumber` | text | `XY123` | Marketing flight number. |
| `airlineId` | ref operators | | Marketing carrier. |
| `airlineRaw` | text | `XY` | IATA or ICAO code as entered. |
| `operatingAirlineId` | ref operators | | For codeshares and regional flights. |
| `fromAirportId`, `toAirportId` | ref airports | | |
| `fromRaw`, `toRaw` | text | `LHR`, `KJFK` | Codes as entered (IATA or ICAO). |
| `divertedToAirportId` | ref airports | | Distance and maps use it when set. |
| `boardingAt` | datetime | `2025-03-14T23:20+01:00` | |
| `departureScheduledAt` | datetime | `2025-03-14T23:45+01:00` | Gate departure, scheduled. |
| `departureAt` | datetime | `2025-03-14T23:58+01:00` | Gate departure, actual. |
| `takeoffAt` | datetime | `2025-03-15T00:12+01:00` | Wheels off. What Flightradar24 calls departure time. |
| `landingAt` | datetime | `2025-03-15T03:05+00:00` | Wheels on, local time at the landing airport. |
| `arrivalScheduledAt` | datetime | | Gate arrival, scheduled. |
| `arrivalAt` | datetime | | Gate arrival, actual. |
| `departureTerminal`, `departureGate` | text | `1`, `A12` | |
| `arrivalTerminal`, `arrivalGate` | text | | |
| `seat` | text | `14A` | |
| `seatPosition` | enum | `window` | `window`, `middle`, `aisle`. When empty, a guess from the seat letter is shown as derived. |
| `cabinClass` | enum | `economy` | `economy`, `premium_economy`, `business`, `first`, `private` |
| `bookingClass` | text | `T` | Single letter. |
| `fareBrand` | text | `Basic` | |
| `reason` | enum | `leisure` | `leisure`, `business`, `crew`, `other` (same set as FR24). |
| `ticketNumber` | text | | **Private.** |
| `bookingRef` | text | | **Private.** PNR. |
| `registration`, `registrationRaw` | text | `D-ABCD`, `dabcd` | Normalised and as entered. |
| `typeCode`, `typeCodeRaw` | text | `A359` | |
| `model`, `modelRaw` | text | `A350-941`, `A350941` | Standard form (manufacturer designation) and as entered (any style; requirement D4). |
| `airframeId` | ref airframes | | Set by the identity resolver. |
| `livery` | text | | Regular livery variant (not special). |
| `specialLivery` | text | `Anniversary Livery` | Special livery or sticker. |
| `distanceKmOverride` | real | | Empty = use the derived great-circle distance. |
| `durationMinOverride` | integer | | Empty = use landing − takeoff. |
| `notes` | text | | Free text for the user, including URLs. |
| `sourceKind` | enum | `fr24_csv` | `manual`, `fr24_csv`, `sheet`, `csv`, `api` |
| `sourceBatchId` | ref import_batches | | |
| `sourceRow` | integer | | Row number in the source file. |

Derived, not stored: manufacturer and family (from type), route, distance (unless overridden), duration (unless overridden), and the **flight day** (local date of `takeoffAt`, else `departureAt`, else `scheduledDate`; used for stats, calendars, and ordering).

### sightings

One sighting = one aircraft seen at one place on one day. Several photos of it in that session are one sighting.

| Column | Type | Example | Notes |
|--------|------|---------|-------|
| `seenOn` | date | `2025-06-21` | Local date. Always set when the day is known. |
| `seenAt` | datetime | `2025-06-21T14:05-04:00` | Set when the time is known. Its local date must equal `seenOn`. |
| `airportId` | ref airports | | |
| `airportRaw` | text | `KAAA` | |
| `spotName` | text | | Spotting location name. |
| `lat`, `lon` | real | | Spotting position, if recorded. |
| `registration`, `registrationRaw` | text | `N123AB` | |
| `operatorId` | ref operators | | Operator as seen. |
| `operatorRaw` | text | `XYZ` | |
| `typeCode`, `typeCodeRaw` | text | `B77W` | |
| `model`, `modelRaw` | text | `777-322(ER)` | |
| `airframeId` | ref airframes | | Set by the identity resolver. |
| `phase` | enum | `approaching` | `approaching`, `landing`, `taking_off`, `taxiing`, `parked`, `towing`, `overflight`, `other` |
| `livery` | text | `Blue Tail` | Regular livery variant (not special). |
| `specialLivery` | text | `Sports Team Livery` | Special livery or sticker. |
| `photoCount` | integer | | |
| `notes` | text | | |
| `sourceKind`, `sourceBatchId`, `sourceRow` | | | As in flights. |

**sighting_tags**: `sightingId` (ref sightings), `tag` (text; suggested values `partial_body`, `too_far`, `night`, `backlit`, `blurry`).

**photo_links**: `ownerTable` (enum `flights`, `sightings`), `ownerId` (id), `url` (text; e.g. a Google Photos share link), `label` (text).

### airframes

The physical aircraft. Facts come from shared lookups and can be refreshed; user corrections are recorded in `field_provenance` with source `user` and win over lookups.

| Column | Type | Example | Notes |
|--------|------|---------|-------|
| `identityKey` | text | `msn:airbus:10741` or `prov:N123AB:2025-03-14` | Unique. See [11](11-aircraft-identity.md). |
| `provisional` | boolean | | `true` until the MSN is known. |
| `manufacturer` | text | `Airbus` | |
| `msn` | text | `10741` | Manufacturer serial number. |
| `lineNumber` | text | | |
| `typeCode` | text | `A21N` | |
| `model` | text | `A321-271NX` | |
| `firstFlightDate` | date | | |
| `deliveryDate` | date | | |
| `status` | enum | `active` | `active`, `stored`, `retired`, `written_off`, `unknown` |
| `factsProvider` | text | `opensky-2025-08` | |
| `factsFetchedAt` | datetime | | |
| `notes` | text | | |

**registration_periods**: `airframeId` (ref), `registration` (text, normalised), `validFrom` (date), `validTo` (date; empty = current), `icaoHex` (text; changes with the registration, so it lives here), `source` (text).

**operator_periods**: `airframeId` (ref), `operatorId` (ref operators), `validFrom`, `validTo` (date), `source` (text).

### tracks

| Column | Type | Notes |
|--------|------|-------|
| `flightId` | ref flights | One recorded track per flight; great circles are computed, not stored. |
| `provider` | enum | `fr24_csv`, `fr24_kml`, `adsblol`, `aeroapi`, `gpx`, `other` |
| `coverage` | enum | `complete`, `partial` |
| `pointCount` | integer | |
| `firstPointAt`, `lastPointAt` | datetime | UTC. |
| `distanceKm` | real | Along the track. |
| `attribution` | text | E.g. `Track data: adsb.lol (ODbL)`. |
| `importedAt` | datetime | |

**track_points** (no system columns; replaced together with the track): `trackId` (ref), `seq` (integer), `t` (integer, Unix seconds UTC), `lat`, `lon` (real), `altitudeFt` (integer), `groundSpeedKt` (integer), `headingDeg` (integer). Simplified to at most 2,000 points per track ([23](23-tracks-and-maps.md)).

### Provenance and external ids

**field_provenance**: where a value came from. `ownerTable` (text), `ownerId` (id), `field` (text), `source` (enum `user`, `import`, `lookup`, `agent`, `derived`), `detail` (text; provider or agent name, e.g. `adsbdb`, `claude`), `recordedAt` (datetime). A `user` row on an airframe field is a user override.

**external_ids**: ids and markers from other systems. `ownerTable`, `ownerId`, `system` (text, e.g. `fr24`), `key` (text, e.g. `flightId`, `depId`, `exportedAt`), `value` (text).

### History, imports, accepted warnings

**record_history**: previous versions of rows, for undo and conflict review. `tableName` (text), `recordId` (id), `recordRev` (integer; the version of the row that was replaced, named so it does not clash with the system column `rev`), `row` (json), `changedAt` (datetime), `batchId` (ref import_batches, optional), `reason` (enum `edit`, `import`, `sync_conflict`, `migration`). A user's own edits write a row with reason `edit`; undoing an import uses this to leave records edited since alone.

**import_batches**: `createdAt` (datetime), `sourceKind` (enum), `fileName` (text), `fileHash` (text), `mappingPreset` (text), `rowsRead`, `rowsAccepted`, `rowsEdited`, `rowsRejected` (integer), `agentChecker` (enum `claude`, `codex`, `none`), `status` (enum `committed`, `undone`). The original source file is kept next to the data as an attachment ([12](12-storage-and-sync.md)).

**issue_acks**: a warning the user accepted ([20](20-validation.md)). `ruleId` (text), `fingerprint` (text; hash of the values that triggered it; if they change, the warning returns), `note` (text).
**issue_ack_records**: `ackId` (ref issue_acks), `tableName` (text), `recordId` (id).

### Settings

**settings** (one row, `id = "settings"`):

| Column | Type | Notes |
|--------|------|-------|
| `distanceUnit` | enum | `km`, `mi`, `nm` |
| `theme` | enum | `system` (follow the device), `light`, `dark` |
| `codeDisplay` | enum | `iata`, `icao`, `both` |
| `modelNaming` | enum | `standard` (`Boeing 777-322(ER)`) or `compact` (`B777-322ER`). Display only (D4). |
| `homeAirportId` | ref airports | Used for defaults. |
| `dataMode` | enum | `standard`, `private`, `local` ([32](32-modes-and-sharing.md)). |
| `storageBackend` | enum | `json_tables`, `sqlite_file` (later: `sqlite_local`, `postgres`, `d1`) |
| `storageAdapter` | enum | `gdrive`, `localfs`, `manual` (file backends only; later `dropbox`, `onedrive`). `manual` is Local mode. |
| `storageLocation` | text | Folder id or path. Never a token or key. |
| `storageAccount` | text | The storage account the log is in (for Google Drive, the account's email), so signing in to another account is noticed. Never a token or key. |

The values of `storageBackend` and `storageAdapter` come from one registry in core; a new value is a schema change ([32](32-modes-and-sharing.md), "Recording the backend").

**family_overrides**: `designator` (ref aircraft_types), `familyId` (ref families).
**saved_views**: `name` (text), `dataset` (enum `flights`, `sightings`, `both`), `rowDimension`, `columnDimension`, `measure` (text, from the lists in [24](24-statistics.md)).
**saved_view_filters**: `viewId` (ref saved_views), `dimension` (text), `operator` (enum `eq`, `in`, `between`), `value` (text).

**airport_overrides**, **operator_overrides**, **aircraft_type_overrides**: the same columns as the reference tables, plus system columns.

## Schema versions

The schema has a single version number. Every change (new column, rename, new table, type change) bumps it and comes with a migration step defined once in core. Each backend applies the step in its own way ([12](12-storage-and-sync.md)).

| Version | Change |
|---------|--------|
| 1 | First version. |
| 2 | `basedOn` system column. |
| 3 | `settings.dataMode` and `settings.storageAccount`. |
| 4 | `settings.agentChecker`, `settings.sendNotesToAgent` and the `agent_rules` table removed: the agent check's settings belong to the CLI on each computer ([22](22-agent-verification.md)). Older files have the columns dropped when read; an `agent_rules` file is not read. |
