# 34. The command line

`./touchdown` on the user's computer, for the user and for agents working for them (Claude Code, Codex). This doc plans the CLI as a second way to use Touchdown, next to the web app ([31](31-ui.md)). The commands built so far are described where their subject is: spotting sessions and `add` in [21](21-import-export.md), the agent check in [22](22-agent-verification.md), sign-in in [33](33-accounts-and-sign-in.md).

## Principles

| | |
|---|---|
| Parity | Everything the web app does with the log, the CLI does too: read it, change it, review and import. (Decided) |
| Not the account | The account and the site stay in the web app: password, signed-in sessions, invitations, the Google link, the storage mode and Standard's terms. The CLI's session can reach only sign-in, sign-out and the storage access ([33](33-accounts-and-sign-in.md), "The command line"), so a leaked session file cannot change the password or invite anyone. (Decided) |
| Review first | Every change the CLI makes is written to the inbox as a file. The user reviews it in the web app's Import page, as now, or in the terminal with `touchdown review`. The CLI writes to the log only when a review imports a file. (Decided) |
| One implementation | A change is applied by the same code in both: importing and undoing an import (`packages/core/src/import/pipeline.ts`), and saving and deleting records, suggested fixes, accepting and reopening findings, airframe edits and merges, families and settings (`packages/core/src/edit.ts`). The web app's `AppData` only wraps them. (Decided, built) |
| For agents too | Every command an agent would run takes `--json` and has documented exit statuses, so an agent can run it, read the answer and go on: the reading and changing commands, `add`, `import`, `inbox`, `review`, `backup`, `airframes`, and `storage` and `agent` when they show the settings. `spot`, `check` and `login` are for a person at a terminal (an agent adds records with `add`). `export` prints CSV. Reports never include the log's private fields. (Decided, built) |
| Private fields | Ticket numbers and booking references can be added, changed and removed from the CLI, but it never shows them. (Decided, Q-CLI-PRIVATE) How, below in "Private fields". |

## Commands

Built commands are marked; the rest are Proposed. `REF` names a record: its id, or for a flight `XY123@2025-04-02`, for a sighting `G-ABCD@EGLL@2025-03-15`, for an aircraft its registration (on a date with `@DATE` when it was reused).

### Reading

Built, all of them. What they show is worked out by the code the web app's pages use (`@touchdown/core/view` and the statistics in the core package), so the figures and labels are the same, in the codes, distance unit and model names the log's settings choose. Lists default to all years; `stats` and `airport` open on this year when it has records, else the latest, as the pages do. Exit status 0 shown, 1 no such record (several are listed with their ids), 2 a wrong option or a log that cannot be read.

| In the web app | Command | Shows |
|---|---|---|
| Home, Statistics | `stats [--year Y \| all] [--by DIM [--cols DIM]]`, `stats --view NAME`, `stats views` | The lead sentence's figures, the fact list and the ranked lists; with `--by`, a pivot ([24](24-statistics.md)); with `--view`, a view saved on the Custom tab; `stats views` lists them. |
| Flights | `flights [--year Y] [--airline X] [--airport X] [--type X] [--search TEXT]` | The flight list, with the same filters. |
| A flight | `flight REF` | Every field, the aircraft, its findings, the track's source. A private field shows only whether it is recorded. |
| Spotting | `sightings [filters]`, `sessions [--year Y]` | Sightings; days out with their counts. |
| Aircraft | `aircraft [REF]` | The list, or one aircraft's facts, registrations and timeline of flights and sightings. |
| An airport | `airport CODE [--year Y]` | The airport page's facts and lists. |
| Issues | `issues [--severity S] [--rule ID] [--accepted]` | Fields changed on two devices (values shown except private ones; choosing is on the Issues page for now), then open findings, grouped as on the Issues page, each with its id and suggested fixes; or the accepted ones. |
| Import history | `imports` | The import batches, for `undo`. |
| Maps and the globe | (none) | Figures and videos come with `touchdown render` in phase 6 ([23](23-tracks-and-maps.md)). |

### Changing

Built, all of them. Each writes one inbox file and checks it first, as `add` does: against the log as it is now, with every rule, reporting what each change would do (before and after) and the findings it would bring. With an error among those, nothing is written unless `--keep-errors`; `--dry-run` writes nothing. A change with nothing left to do is reported and left out. The code is `packages/cli/src/change.ts`.

| In the web app | Command |
|---|---|
| Add a flight, a sighting, a session | `add` (built), `spot` (built) |
| Edit a flight or a sighting | `edit REF --set FIELD=VALUE … --clear FIELD …`, or a JSON list of edits (a file, or `-` for stdin): `[{ "ref": "XY123@2025-04-02", "set": { "seat": "14A" }, "clear": ["gate"] }]`. A sighting's `phase` takes every phase it was seen in, comma-separated (`--set phase=landing,taxiing`). |
| Delete one | `delete REF…` |
| (CLI only) Find recorded tracks | `tracks [--only REF,…] [--limit N] [--refresh]`: every flight without a track looked up in adsb.lol's history and written as `track` changes, the flights without one listed with the reason ([23](23-tracks-and-maps.md), "Backfill") |
| Add, replace or remove a flight's recorded track | `track REF FILE` (an FR24 CSV or KML, or a KML or GPX file with times), `track REF --remove`: the file is read and checked against the flight as the flight page does ([23](23-tracks-and-maps.md), "Sources"); a refusal says why and writes nothing |
| Edit an aircraft's facts | `aircraft edit REF --set msn=… --set firstFlight=…`, or `--paste FILE` (or `-`): text copied off the aircraft's page, read and checked as the aircraft page's "Paste from a web page" does (`pastedFactsFor` in core), with the same warning when the page may be about another aircraft |
| Merge two aircraft | `aircraft merge INTO FROM` |
| (CLI only) Look up aircraft facts | `airframes [lookup options]`: serial numbers and first flights from OpenSky (and Flightradar24 with `--fr24`), found on a copy of the log and written as `facts` changes, checked again at the review ([13](13-reference-data.md), "Airframe facts") |
| Issues: "This looks right", Reopen, a suggested fix | `issues accept ID [--note TEXT]`, `issues reopen ID`, `issues fix ID [N]` |
| Import a file (myFR24, any spreadsheet) | `import FILE… [--map "Header=field"]`: each file is read as the Import page reads it (the columns worked out; a layout confirmed before used again; at a terminal, unclear columns asked about and a new layout confirmed and remembered on this computer), checked against the log, and put in the inbox as one file holding its rows and columns ([21](21-import-export.md), "Source: spotting session", version 3). The review reads it as it would read the file itself. A file whose rows are all in the log or waiting in the inbox already is left out. With `--out backup.zip` it builds a backup from the files alone instead, as before. The code is `packages/cli/src/importfile.ts`. |
| Undo an import | `undo BATCH [--force]`: a record changed after the import is left as it is unless `--force`, as the web app asks before undoing it |
| Aircraft families | `families [set TYPE FAMILY \| remove TYPE]` |
| Settings kept in the log | `settings [codes iata\|icao\|both] [distance km\|mi\|nm] [models standard\|compact]` |
| Save or remove a view on the Statistics page's Custom tab | `stats views save NAME --by DIM [--cols DIM] [--of DATA] [--measure M]`, `stats views remove NAME` |
| Download a backup, a table as CSV | `backup [--out FILE.zip]`, `export flights\|sightings\|aircraft [--out FILE.csv] [--private]` (these write nothing to the log, so they need no review). The backup holds everything, as the web app's does: every table, private fields and recorded tracks, read from the storage; by default it goes to `data/private/touchdown-backup-DATE.zip`. `export` prints the CSV, or writes it with `--out`; it leaves the private fields out unless `--private`, which needs `--out`. Files are written readable only by the user and replace nothing without `--force`. The code is `packages/cli/src/backup.ts`. |
| Restore a backup over the log | Not in the CLI: it replaces everything, and the web app asks twice. (Decided, Q-CLI-RESTORE) |
| Delete everything, remove this browser's copy | Not in the CLI, for the same reason as restoring. |
| Theme | Not in the CLI: it belongs to each browser. |

Field names in `--set` and in JSON are the ones `add` takes ([21](21-import-export.md), "Source: records from the command line"), read the same way (codes resolved, clock times at their airport's UTC offset on the record's date), and the ones the web app's forms set besides: for a flight `seatPosition`, `cabin`, `bookingClass`, `fare`, `reason` and `terminal`; for a sighting `time`, `spot`, `photos` and `tags`. An aircraft takes `manufacturer`, `msn`, `lineNumber`, `typeCode`, `model`, `firstFlight`, `delivered`, `status` and `notes`. The change records the stored fields this sets (`takeoffAt`, `airlineId`, …), worked out against the log when the command runs (`packages/core/src/import/changes.ts`).

### Reviewing

| Command | Does |
|---|---|
| `inbox` (built) | Lists the files waiting, shows one, removes one, sends files saved on this computer. |
| `review [NAME]` (built) | Reviews the oldest file waiting, or NAME, in the terminal, then imports it on confirmation. With `--check`, the agent checks the file's rows first, as "Check with an agent" on the Import page ([22](22-agent-verification.md)). |

### Private fields

Ticket numbers and booking references (AGENTS.md, "Data and privacy"):

| | |
|---|---|
| Given | In the JSON that `add` and `edit` read (a file, or stdin), as `ticketNumber` and `bookingRef`; or typed at a prompt that does not echo them, with `--set ticketNumber` and no value (`edit`), or `--ticket` and `--booking` (`add`, for its first flight). Never as a value on the command line, where the shell's history and other users' process lists would keep it. |
| Shown | Never. `flight REF` and its JSON say whether one is recorded (`"private": {"ticketNumber": true}`); `add` reports which were given; a change's review shows "recorded → changed" (or added, removed). Error messages do not quote them. (Built, with a canary test) |
| Stored | In the inbox file with the rest of the change, so in the same storage as the log, and after the import with the import's copy of the file. |
| Not sent | To the agent, ever ([22](22-agent-verification.md), "What is sent"), whatever the command. |
| Removed | `edit REF --clear ticketNumber`; deleting a flight removes them with it. |

An agent that writes the JSON for `add` or `edit` has seen what it writes; giving it a ticket number is the user's choice. The CLI adds nothing to what the agent sees.

## Change files

Decided, built. The inbox file has a version 3 (versions 1 and 2 are still read) with a list of changes next to the flights and sightings:

```json
{
  "schema": "touchdown-inbox", "version": 3, "createdAt": "2026-10-24T14:30:00Z", "checker": null,
  "sightings": [], "flights": [],
  "changes": [
    { "op": "edit", "table": "flights", "id": "01J…", "rev": 4, "set": { "seat": "14A" }, "clear": ["departureGate"] },
    { "op": "delete", "table": "sightings", "id": "01J…", "rev": 2 },
    { "op": "airframe", "id": "01J…", "rev": 1, "set": { "msn": "1234" }, "clear": [] },
    { "op": "merge", "into": "01J…", "from": "01J…" },
    { "op": "accept", "ruleId": "C-FLIGHT-OVERLAP", "fingerprint": "…", "note": null },
    { "op": "reopen", "ackId": "01J…" },
    { "op": "fix", "ruleId": "V-TYPE-KNOWN", "fingerprint": "…", "fix": 0 },
    { "op": "undo", "batchId": "01J…" },
    { "op": "family", "designator": "E75L", "familyId": "E170" },
    { "op": "settings", "set": { "codeDisplay": "icao" } },
    { "op": "track", "flightId": "01J…", "provider": "fr24_csv", "attribution": "Track data: …", "coverage": "complete", "distanceKm": 5541.2, "points": [[1741600000, 51.47, -0.46, 0, 12, 270], …] },
    { "op": "removeTrack", "flightId": "01J…" }
  ]
}
```

- `set` and `clear` name stored fields; a sighting's edit may carry `tags`, its full list.
- A `track` change carries the whole track, at most 2,000 points, each `[unix seconds, lat, lon, altitude ft, ground speed kt, heading]` (the last three may be null), and its distance along every point of the file. It replaces the flight's track; one the flight has already is done.
- `rev` is the record's version the change was made against. If the record changed after that (in the web app, or by another import), the review says so and leaves the record alone unless the user takes the change; taken, it changes only the fields it names. A change whose values the log has already is done, and a file whose changes are all done leaves the inbox.
- A private field travels in the file only when the user gave one ("Private fields", above).
- A finding is named by its rule and fingerprint, so a change file about a finding that has gone away (fixed meanwhile) is reported as such, not applied to something else.
- File names say what made them: `edit-<date>-<time>.json`, `delete-…`, `track-…`, `aircraft-…`, `issues-…`, `undo-…`, `families-…`, `settings-…`, as `add-…` and `spot-…` do.
- Imported, the changes are one import batch (`mappingPreset` `touchdown_changes`). Every row they touch, the airframe links worked out again included, gets a history row with its version before (none for a row they create), so undoing the import puts each back, a deleted row included. A track's points have no versions of their own: the points each track had before go into one history row for that track, so undoing a `track` or `removeTrack` change puts the old track back whole. Undoing an import whose records were changed since, by an edit or by a later import, asks first.

## The review

The same steps in both places, from the same core code:

1. Read the file and the log as they are now.
2. Show each record it adds, fills or changes (before → after), each deletion, merge, accepted finding and undo, and the findings the file brings. In the terminal a private field shows as added, changed or removed, never its value; the web app shows it as its flight page does.
3. The user decides what the Import page lets them decide now: leave a record out, take or keep each differing value, keep or reject a time moved past midnight, take the change to a record edited since.
4. Import: one import batch, recorded in the log's history, so it can be undone like any import. The file is then moved to `attachments/imports/<batchId>/`, as the web app does.

In the terminal (built, `packages/cli/src/review.ts`), `review` shows each row as new, filling in a record or differing from one, with its findings, and each change before and after, then asks one question at a time with the safe answer as the default: take the file's value where it differs (no), keep a takeoff moved past midnight (yes), make a change to a record edited since (no), and import (no). `--yes` imports with every default without asking; `--json` prints the review without importing, for an agent to read, and with `--yes` imports and prints the result. Private values print only as "(private)" or as given. A file with nothing left to do leaves the inbox, as the web app removes it. Exit status 0 imported or nothing to import, 1 not imported, 2 the storage or the file could not be read.

In the web app (built, `apps/web/src/components/ChangeReview.tsx`), a change file opens on the Import page from the inbox list or the "Review and import" bar, or when chosen as a file. Each change is a tonal box with a checkbox: what it is (Edit, Delete, Aircraft facts, …) and what it is about, a note when it has nothing left to do or its record was changed since (that one starts unticked), and its values as before → after lines, as the agent's suggestions show theirs. Below come the findings the changes taken would bring, without their fixes, and "Import N changes" with "Discard this file". The import history names such an import "N changes made", and Undo puts them back.

## Writing the log from the command line

Apart from `review`, the CLI reads the log and never writes it ([21](21-import-export.md), "With the user's storage"). `review` writes as the web app does (Decided, built, `packages/cli/src/write.ts`):

- It reads the whole log from the storage (a few MB; a few seconds on Google Drive), settles what two devices made side by side as the web app does ([12](12-storage-and-sync.md), "Settling what two devices made"), applies the import in memory, and sends the changed rows with the sync engine ([12](12-storage-and-sync.md), "Sync algorithm"), so a change made at the same time in the web app is merged field by field, and a field edited on both is listed on the Issues page. The reading commands settle the same in the copy they read, so they show what the web app shows.
- Its device id (each row records which device last edited it) is made once per computer and kept in `data/private/touchdown-cli.json`.
- After sending, it reads the storage again: rows the storage shows are confirmed. Rows not yet shown back are kept, with their values, in `data/private/cli-sync.json` (readable only by the user, as they may hold private fields) and sent again by the next `review`, as the browser keeps its queue in IndexedDB. A review that stops halfway (offline, the laptop closed) is finished by the next run, with nothing lost or written twice (scripted test).
- It still never creates the Touchdown folder or a log, and never upgrades one. It writes only to a log at its own schema version: an older log asks the user to open the web app once (which upgrades it); a newer one asks them to update the CLI.
- In Local mode there is no storage it can reach, so `review` is not available; files are reviewed in the web app.

## Build order (Proposed)

Each step is usable on its own.

1. Move the web app's operations to the core package; the web app uses them unchanged. (Built)
2. The reading commands, with `--json`. (Built)
3. Change files (version 3), the changing commands, and their review on the Import page. (Built)
4. Writing the log from the CLI: the sync engine in Node, the device id, the queue file, and `touchdown review`. (Built)
5. `import FILE` to the inbox, `backup` and `export`. (Built)
6. What remained: saved Statistics views (`stats --view`, `stats views`), facts pasted from an aircraft's page (`aircraft edit --paste`), lookups of aircraft facts into the log (`airframes`, as `facts` changes), the agent check in the review (`review --check`), and `--json` for `storage` and `agent`. (Built)
