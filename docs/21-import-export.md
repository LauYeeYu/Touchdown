# 21 Import and Export

Getting data in and out: the user's existing sheets, my.flightradar24.com, generic CSV, and full backups (requirements G5, F1, D8, S5).

## Import pipeline

Every import, from any source, goes through the same stages. Nothing is written to the user's data until the commit at the end.

```
1. Read        file or sheet → raw rows (kept in the ImportBatch)
2. Detect      the myFR24 export by its header; any other sheet → column mapping (worked out, editable, remembered)
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

## Source: any spreadsheet

Decided, built. Every spreadsheet other than the myFR24 export is read through a column mapping: which column holds which field. Nothing is fixed to one person's layout. The owner's two sheets were read by fixed readers until this reader gave the same result on both, field for field; they are now ordinary layouts like anyone's.

**Working out the columns** (`guessMapping`, core `import/mapping.ts`):
- A header the reader knows decides, when the values agree. Header names are compared lower case with punctuation removed, and each field has several ("Registration", "Reg", "Tail number"; "Location", "Airport", "Place"; "Misc", "Other", "Remarks" for notes or free text, …).
- A column without a known header is placed by its values when most of them fit one field: registrations, type designators, flight numbers, models, phases, seats, dates, durations, clock times, airport codes, airline codes. Type designators are tried before flight numbers ("A21N" would pass for both).
- A header the values contradict ("Aircraft type" holding type designators), a second column for a field that only one column can hold, a field of the other kind (a gate in a file of sightings), and a column nothing explains are marked **unclear** and not used until someone says what they are.
- Whether the rows are flights or sightings follows from the columns placed with some confidence: a flight number, airports from and to, times, a seat or a class make flights.
- Rows can be read when sightings have a registration column, and flights a date and a flight number (or both airports).

**Settling unclear columns:**

| Where | How |
|-------|-----|
| Import page | A column step lists every column with three of its values and what it was read as; unclear ones are marked with the reason. The user changes any of them, says whether the rows are sightings or flights, and reads the rows. Shown only when something is unclear or rows cannot be read; otherwise the review says how the columns were read, with "Change the columns". |
| Terminal (`spot`, `check`, `import`) | The columns are printed. `--map "Header=field"` (or a column number) sets one. At a terminal, each unclear column is asked about. If the user has chosen an agent, it is asked first about the unclear columns only ([22](22-agent-verification.md), "Column help"); its readings are proposals the user confirms. `import` asks nothing: unclear columns are not used. |
| Remembered | A layout the user confirms is kept by its headers: in the browser for the Import page, in `data/private/touchdown-cli.json` for the terminal. The same layout is then read without asking. |

**Reading rows**, per field, whatever the column is called:

| Field | Rule |
|-------|------|
| Date | A date, a spreadsheet serial number, `15/03/2025` (day first) or `15-Mar-2025`. For flights, the scheduled date. |
| Class or fare (flights) | Single letter → `bookingClass`. Text → `fareBrand`. A letter in parentheses inside text (`Main Classic (T)`) → both. |
| Boarding, takeoff, landing times (flights) | Clock times only (or Excel day fractions). Combined with the date into full date-times `boardingAt`, `takeoffAt`, `landingAt`; see "Building date-times from clock times". Takeoff and landing mean wheels off and touchdown, as in Flightradar24. |
| Model (both) | Parsed from the compact or standard style into the standard form (D4). |
| Phase (sightings) | Touching-down → `landing`, Taking-off → `taking_off`, other known words; anything else is stored as `other` with a note. |
| Notes and other text | Flights: copied to `notes`. Sightings: split into photo tags ("Partial body", "Too far", "Night", "Backlit", "Blurry"), a livery (a part ending in "Livery" while there is no special livery: a regular variant, such as an airline's alternate standard scheme) and notes. In `spot`, the agent also sorts it into fields. |
| Registration country (sightings) | Not stored; it is the registration country. Compared with the country of the registration prefix; differences are flagged. |
| Distance (flights) | Not stored; compared with the great-circle distance. |
| Aircraft's first flight (flights) | Goes to the airframe as a fact the user supplied, not to the flight. |
| Ticket number, booking reference (flights) | Private fields: stored, never shown in samples, never sent to an agent. |
| Not used | Manufacturer and family (derived from the type), route (derived from the airports), photo links. |

From Google Sheets (with sync, phase 3): the user picks each sheet with the Google Picker, which grants access to that file only (`drive.file`); it is read with the Sheets API as unformatted values, so dates arrive as serial numbers and are converted exactly. Until then, export the sheet as CSV or `.xlsx`.

## Building date-times from clock times

Spreadsheets and the myFR24 export store a date and separate clock times. Touchdown stores only full date-times ([10](10-domain-model.md)), so the importer combines them:

1. Start from the row's date, which is the **scheduled** departure date (`scheduledDate`).
2. Takeoff: date + takeoff clock time in the origin airport's time zone.
   - If a boarding or scheduled departure time is known and the takeoff clock time is earlier than it, the takeoff was after midnight: add one day. Example: boarding 23:20, takeoff 00:12 → takeoff `<date + 1>T00:12`.
   - If a recorded track or a flight lookup gives the exact takeoff instant, use that instead.
   - If none of these is available and the takeoff clock time is between 00:00 and 03:59, keep the same day and raise V-DAY-ROLLOVER as a question for the user.
3. Landing: takeoff instant + Duration, expressed in the destination's time zone. Its clock time must match the row's landing time within 2 minutes; otherwise the row is a conflict.
4. Boarding and other times: date + clock time in the relevant airport's zone, moved by a day if needed to keep V-TIMES-ORDER true.

When matching rows against other sources (tracks, FR24 lists, the other spreadsheet), compare instants, and allow the scheduled date to differ from the takeoff date by one day.

### Time zones and daylight saving

Decided:

| Case | Rule |
|---|---|
| Offset | Each airport has an IANA time zone (`Europe/London`, not `+01:00`). A clock time gets the offset in force there on that date, so summer time and past changes to a zone's rules (Moscow in 2014, Brazil in 2019, Mexico in 2022) come out right. Zone rules come from the runtime's time-zone data (`Intl`); none is shipped. |
| Duration | Always the difference between instants. A flight that crosses a clock change has a duration that differs from the clock difference by the change. |
| Repeated hour (clocks go back) | A clock time in that hour happens twice. Takeoff: the one that makes takeoff plus duration land at the row's landing time; otherwise the earlier. Landing without a duration: the first one after takeoff. Boarding: the latest one not after takeoff. |
| Skipped hour (clocks go forward) | The time does not exist; it is moved forward by the change (02:30 → 03:30), as Temporal's "compatible" rule does. |
| A day later | Moving a time to the next day (after-midnight corrections, the V-TIMES-ORDER fix) keeps the clock time and takes the offset in force on the new day. |
| Diversions | Landing and actual arrival use the zone of the airport the flight landed at; scheduled arrival uses the planned destination's zone. |

## Reconciling FR24 and the flight log spreadsheet

The same flights are in both the FR24 export and the flight log spreadsheet. The first import of the second source matches every row against the first (stage 4) and merges:
- The sheet has gate, boarding time, ticket number, first flight date, special livery, notes.
- FR24 has seat type, flight class, flight reason, notes, and FR24 ids.
- Where both have a value and they differ (times, registration, type), the row is a conflict and the user picks.

Comparing the times of matched flights also answers Q-FR24-TIMES (local or UTC).

## Source: spotting session (`touchdown spot`)

Decided, built (CLI). Instead of typing a row into the spotting spreadsheet and looking each registration up by hand, the user types what they saw and the CLI fills in the rest. The agent is the one the user chose ([22](22-agent-verification.md), "Choosing the agent").

```
./touchdown spot [--at EGLL] [--on 2025-03-15] [--fr24] [--agent codex|none]
```

| Step | What happens |
|------|--------------|
| Type | One aircraft per line: the registration and anything else known, in any order (`G-ABCD landing`, `D-ABCD at EDDF DLH A20N "Retro livery"`). A line with only a place, date or phase sets it for the lines after it; `no phase` clears the phase. Lines can also be given as arguments or piped in. |
| Read | Recognised: registrations (with or without the dash; without it only in capitals, so words are not read as registrations), airports (ICAO, or IATA after "at"), dates (`today`, `yesterday`, `2025-03-15`, `15/03/2025`), phases, airline codes (ICAO, or IATA in capitals), type designators and models. The rest is kept as text. |
| Look up | Per registration: the user's log (a backup; `data/private/touchdown-backup.zip` by default, `--log FILE` for another), the OpenSky snapshot (downloaded once), adsbdb (answers cached for 90 days) and, with `--fr24`, Flightradar24 through the user's Chrome (Q-FR24-BROWSER). |
| Fill | What the user typed is kept. An empty type code or model takes the value from the source kept most up to date (Flightradar24, adsbdb, OpenSky, then the user's log). An empty airline takes the value from the source whose date is nearest the sighting's, since aircraft change hands. A model is kept only when it fits the type (the model patterns in [13](13-reference-data.md)). The user's log never vouches for the sighting itself (the same aircraft, day and place). |
| Compare | A source that says something else is listed, except where it is no real difference: a model given only as its series (`777-300(ER)` for a `777-31H(ER)`), under its type certificate's name (`BD-500-1A11` for an `A220-300`) or without a suffix (`(ER)`, `(BDSF)`, `SF`, `E`); and an airline from OpenSky or adsbdb against one the user typed, since those give the company that operates the aircraft, not the airline whose colours it wears (Q-SPOT-AIRLINE). A source whose type is of another family is flagged as probably another aircraft with the same registration (or a mistyped type); its model, airline and serial number are not used. |
| Check | The agent ([22](22-agent-verification.md)) gets the batch with each source's answer and the words Touchdown could not place. It sorts those words into fields (special livery, livery, phase, …) and the rest into notes. It picks between sources that disagree, and notes anything doubtful, such as an aircraft retired before the date. |
| Use or ask | Used straight away: values a source gave, words sorted into fields, and fixes from the reference data the agent is sure of. Asked about: a change to anything the user typed, anything from the agent's own knowledge, and wanted fields that are still empty (date, place, type code, airline, phase). The user can type a doubted line again to correct it. Without a terminal, these are listed instead of asked. |
| Special livery | When the user's log has the aircraft in a special livery and none was typed, the user is asked whether it still wore the one recorded nearest the date (Q-SPOT-LIVERY). It is never filled in unasked: special liveries are painted over. The web app's quick add and session add ask the same. |
| Correct | ↑ and ↓ bring back earlier lines, also from earlier sessions (kept in `data/private/cache/spot-history.txt`). A line brought back and changed replaces the aircraft it came from; when the registration changed, the user is asked first. `edit N` brings back line N, `drop N` removes it, `list` shows the session's aircraft. The same aircraft typed again for the same place and day replaces the earlier line (one sighting, Q-SIGHTING-UNIT). Tab completes commands, phases, registrations from the log and airport codes after "at". |
| Save | An empty line checks the lines typed so far and saves them to the session's inbox file, `data/private/inbox/spot-<date>-<time>.json` (or `--out`). |
| A spreadsheet | `spot FILE.xlsx` (or `.csv`) reads a sheet of sightings in any layout ("Source: any spreadsheet") and treats each row as a typed line: lookups (adsbdb only for aircraft OpenSky does not know), the agent's check, no questions per row. Before an agent check of more than 50 rows it says how many calls that is and lets the user go on without the agent. Everything still open goes to the review in the web app. The inbox file is `sheet-<date>-<time>-<file name>.json`. |

The inbox file (`touchdown-inbox`, version 1) has, per sighting:
- the values, named as in the agent check;
- where each value came from: `you`, `your_log`, `opensky`, `adsbdb`, `fr24`, `derived` (the type from a typed model), `claude` or `codex`;
- what is still open, in words, and which fields the user left empty;
- the airframe facts a lookup gave: serial number, maker, line number, first flight.

### Getting a session to the web app

A session's sightings are not in the log until the user reviews and imports them in the web app (Decided: review first, Q-SPOT-ARRIVAL). The CLI says so after every save and when the session ends.

**The inbox is a queue.** Each session is one file, rewritten on every save and written only by its session; a session that saves nothing writes no file. A file leaves the inbox once it is imported (into `imported/`, kept 30 days), when the user discards it, or when all its sightings are in the log already (imported some other way). So the inbox holds only the sessions not dealt with yet. A session that goes on saving after its file was imported writes the file again; matching (stage 4) skips the sightings already in the log.

**In development (Decided, built).** The dev server reads `data/private/inbox/` (`/__local/inbox`, requests from this computer carrying the app's header only). The web app looks at it when it opens, when its tab comes back into view, and every 30 seconds:
- a bar under the masthead says how many sightings are waiting, with "Review and import" (opens the oldest session on the Import page) and "Not now" (hides it in this tab until the session saves more);
- the Import page lists the waiting sessions, each with Review and Discard;
- the CLI checks whether the dev server is running and says where to go.

**On the hosted site (Decided, built in phase 3 with sync).** The inbox is the `inbox` area of the user's storage, whatever the backend (S7, [12](12-storage-and-sync.md)). The CLI reaches that storage through the same backend interface as the web app:

| Storage | How the CLI reaches it |
|---------|------------------------|
| Google Drive | `touchdown login` signs the CLI in to Google once, with the installed-app flow from the same Google Cloud project as the web app and the same `drive.file` scope. The token stays in `data/private/`. Writing into a Google Drive for Desktop folder would not do, because the web app's `drive.file` access does not reach files another app created (Q-DRIVE-CLI). |
| Local folder | The CLI is given the folder's path once and writes into its `inbox/` directly. (Proposed) |
| This browser only | There is no shared place. `spot` saves the session file and the user opens it on the Import page. (Proposed) |
| Server backends (later) | The CLI signs in to the backend and writes to its `inbox` area. (Proposed) |

1. `spot` writes its session file to the inbox on every save.
2. The web app, on any device, lists the inbox during sync. It shows the same bar and list, and after an import it copies the file to `attachments/imports/<batchId>/` and deletes it from the inbox. If the session saves again after that, the CLI finds its file gone and writes a new one.
3. `spot` reads the user's log from the same storage for its "your log" lookups, instead of the local backup file.

**Importing.** The Import page reads the inbox like any other file (stages 4–10). What is still open shows as a warning on the row. The agent check panel is not shown, because the session already ran the check. On commit:
- the records get `sourceKind` `manual`;
- each value that came from somewhere other than the user's typing gets a `field_provenance` row:

  | Came from | `source` | `detail` |
  |-----------|----------|----------|
  | A lookup | `lookup` | the provider |
  | The user's log | `derived` | `your log` |
  | The agent | `agent` | `claude` or `codex` |
- the airframe facts are checked against the user's records and stored on the airframe, as in [13](13-reference-data.md), "Airframe facts";
- the batch records the agent (`agentChecker`) and how many rows the agent changed (`rowsEdited`).

Open: typing in the web app instead of the terminal, which needs the local bridge or the lookup service (phase 4).

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
