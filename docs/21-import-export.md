# 21 Import and Export

Getting data in and out: the user's existing sheets, my.flightradar24.com, generic CSV, and full backups (requirements G5, F1, D8, S5).

## Import pipeline

Every import, from any source, goes through the same stages. Nothing is written to the user's data until the commit at the end.

```
1. Read        file or sheet → raw rows (kept in the ImportBatch)
2. Detect      recognise the format by its header → column mapping (editable)
3. Parse       each row → candidate record: raw values + normalised values
4. Match       compare with existing records → new | identical | update | conflict
5. Resolve     link to airframes (11)
6. Check       deterministic rules (20)
7. Fill        auto-fill suggestions (20)
8. Agent       optional: hand off to the companion CLI, load the result (22)
9. Review      user accepts, edits, or skips rows and suggestions (31)
10. Commit     write records + ImportBatch; batch can be undone
```

Matching keys (stage 4):

| Collection | Key | Notes |
|------------|-----|-------|
| Flights | date + flight number + from | Falls back to date + from + to when the flight number is missing. |
| Sightings | date + registration + location | Several sightings of one aircraft on one day at one place are treated as one unless the user keeps both. |

"Update" rows show a field-by-field diff. Empty incoming fields never overwrite existing values.

Two cases are settled by the importer rather than left as conflicts (the user can still turn each one down in the review):
- A sighting repeated within one file (same registration, place and day) is merged into the first row: empty fields are filled, photo notes are combined, and a different phase goes into the notes ("Also taking off"). This follows the rule that one aircraft at one place on one day is one sighting.
- When an existing flight has its takeoff on the scheduled date and the incoming row's boarding time shows the flight left after midnight, the row's takeoff and landing (a day later) are taken, with the reason shown.

Lookups during an import are batched, cached, and rate-limited. If the app is offline, external checks are marked "not checked" and can be re-run later.

## Source: my.flightradar24.com CSV

Format (19 columns):

```
Date,Flight number,From,To,Dep time,Arr time,Duration,Airline,Aircraft,Registration,
Seat number,Seat type,Flight class,Flight reason,Note,Dep_id,Arr_id,Airline_id,Aircraft_id
```

| Column | Example | Parse |
|--------|---------|-------|
| Date | `2024-10-12` | `scheduledDate`. This is the **scheduled** local departure date, not the takeoff date. |
| Flight number | `DL49` | `flightNumber` |
| From, To | `Amsterdam / Schiphol (AMS/EHAM)` | Codes from the last parentheses: IATA before the slash, ICAO after. |
| Dep time, Arr time | `12:10:00` | Clock times only (takeoff and landing, local airport time; verified against FR24 track files, Q-FR24-TIMES). Combined with the date into full date-times `takeoffAt` and `landingAt`; see "Building date-times from clock times" below. |
| Duration | `08:20:00` | Compared with the computed duration. |
| Airline | `Delta Air Lines (DL/DAL)` | Codes from the parentheses. Empty is ` (/)`. |
| Aircraft | `Airbus A330-900neo (A339)` | Type code from the parentheses. The name is a marketing name, not a model designation, so it is kept only in the raw row. Empty is ` ()`. |
| Registration | `N123AB` | `registration` |
| Seat number | `1A` | `seat` |
| Seat type | `1` | 0 none, 1 window, 2 middle, 3 aisle → `seatPosition` |
| Flight class | `1` | 0 none, 1 economy, 2 business, 3 first, 4 economy plus, 5 private → `cabinClass` |
| Flight reason | `1` | 0 none, 1 leisure, 2 business, 3 crew, 4 other → `reason` |
| Note | text | `notes` |
| Dep_id … Aircraft_id | `122` | FR24 internal ids, `0` = not set. Kept in `external_ids` (system `fr24`) for round-trip export. |

Confirmed against a real export. The file starts with an empty line before the header; the parser must skip leading blank lines.

## Source: the flight log and spotting spreadsheets

- The user picks each sheet with the Google Picker; this grants access to that file only (`drive.file`).
- Read with the Sheets API as unformatted values, so dates arrive as serial numbers and are converted exactly.
- Only the data tab is read (the `Data` tab of the spotting spreadsheet, the first tab of the flight log). Summary and pivot tabs are ignored; the app recomputes them.
- Column mapping is preset from [01](01-existing-data.md).
- If the spreadsheets are no longer available in Google, export them as CSV (or `.xlsx`) first; the file goes through the same preset mapping.

Special parsing:

| Field | Rule |
|-------|------|
| Class (flights) | Single letter → `bookingClass`. Text → `fareBrand`. A letter in parentheses inside text (`Main Classic (T)`) → both. |
| Misc (flights) | Copied to `notes` as is. |
| Misc (sightings) | Text ending in "Livery" while Special Livery is empty → suggest `livery` (regular variant, e.g. an airline's alternate standard colour scheme). "Partial body", "Too far" → tags. "Taken this aircraft..." → dropped after import, because the app derives it; kept in notes until the user confirms. Other text → `notes`. |
| Status (sightings) | Touching-down → `landing`, Taking-off → `taking_off`, others lowercased. |
| Boarding Time, Departure Time, Landing Time (flights) | Clock times only. Combined with the Date into full date-times `boardingAt`, `takeoffAt`, `landingAt`; see "Building date-times from clock times". Departure/Landing mean takeoff/touchdown, as in Flightradar24. |
| Aircraft (both) | Parsed from the compact or standard style into the standard form (D4). |
| Country (sightings) | Not stored; it is the registration country. Compared with the country derived from the registration prefix; differences are flagged. |
| First Flight Date (flights) | Goes to the airframe as a user-supplied fact, not to the flight. |
| ETKT (flights) | `ticketNumber` (private). |

## Building date-times from clock times

The sheets and the myFR24 export store a date and separate clock times. Touchdown stores only full date-times ([10](10-domain-model.md)), so the importer combines them:

1. Start from the row's date, which is the **scheduled** departure date (`scheduledDate`).
2. Takeoff: date + takeoff clock time in the origin airport's time zone.
   - If a boarding or scheduled departure time is known and the takeoff clock time is earlier than it, the takeoff was after midnight: add one day. Example: boarding 23:20, takeoff 00:12 → takeoff `<date + 1>T00:12`.
   - If a recorded track or a flight lookup gives the exact takeoff instant, use that instead.
   - If none of these is available and the takeoff clock time is between 00:00 and 03:59, keep the same day and raise V-DAY-ROLLOVER as a question for the user.
3. Landing: takeoff instant + Duration, expressed in the destination's time zone. Its clock time must match the row's landing time within 2 minutes; otherwise the row is a conflict.
4. Boarding and other times: date + clock time in the relevant airport's zone, moved by a day if needed to keep V-TIMES-ORDER true.

When matching rows against other sources (tracks, FR24 lists, the other spreadsheet), compare instants, and allow the scheduled date to differ from the takeoff date by one day.

## Reconciling FR24 and the flight log spreadsheet

The same flights are in both the FR24 export and the flight log spreadsheet. The first import of the second source matches every row against the first (stage 4) and merges:
- The sheet has gate, boarding time, ticket number, first flight date, special livery, notes.
- FR24 has seat type, flight class, flight reason, notes, and FR24 ids.
- Where both have a value and they differ (times, registration, type), the row is a conflict and the user picks.

Comparing the times of matched flights also answers Q-FR24-TIMES (local or UTC).

## Source: generic CSV

- Upload, pick a delimiter and encoding (auto-detected), map columns to fields.
- Mappings can be saved as presets (in settings).
- Known presets: Touchdown CSV export, myFR24, Flighty export (header known), the two sheets.

## Source: Touchdown backup

A `.zip` of the user's Touchdown folder from [12](12-storage-and-sync.md) (JSON tables or SQLite file, plus tracks and attachments). Restores everything exactly. Used for moving between storage backends and for the manual-file adapter.

The companion CLI writes the same file (`touchdown import FILES --out backup.zip`), so data imported or added with a local command can be loaded into the web app with Restore in Settings, until sync arrives in phase 3.

## Exports

| Export | Content | Notes |
|--------|---------|-------|
| Backup (`.zip`) | All tables, tracks, attachments, in the user's current backend format (JSON tables or SQLite file) | Full fidelity. Private fields included. Restores into either backend. |
| CSV per table | Flights, sightings, airframes | Flattened; lists joined with ` \| `. Private fields only with "include private fields". Cells starting with `= + - @`, tab, or CR are prefixed with `'`. |
| Google Sheets | Same as CSV, uploaded to Drive and converted to a Sheet | Works with `drive.file` (the app creates the file). |
| myFR24 import CSV | The 19-column format | Date = `scheduledDate` (or the local takeoff date if unknown); Dep/Arr time = local clock time of takeoff/landing. Airports written as `IATA/ICAO`, which myFR24 accepts. Original FR24 ids kept where known. Option: only flights not exported before (`external.fr24.exportedAt`). Whether myFR24 accepts a subset of columns and whether airline names must match its names exactly are unverified; test with a small file first. |
| Stats | Any table as CSV; any chart as PNG/SVG | |
| Map figure / video | See [23](23-tracks-and-maps.md) | |

myFR24 has no API. Both directions are manual file transfers.

## Undo

Each ImportBatch stores the ids of records it created and the previous version of records it updated. Undo restores those versions and deletes created records (as tombstones). Undo is refused for records edited after the import, unless the user confirms.
