# 34. The command line

`./touchdown` on the user's computer, for the user and for agents working for them (Claude Code, Codex). This doc plans the CLI as a second way to use Touchdown, next to the web app ([31](31-ui.md)). The commands built so far are described where their subject is: spotting sessions and `add` in [21](21-import-export.md), the agent check in [22](22-agent-verification.md), sign-in in [33](33-accounts-and-sign-in.md).

## Principles

| | |
|---|---|
| Parity | Everything the web app does with the log, the CLI does too: read it, change it, review and import. (Decided) |
| Not the account | The account and the site stay in the web app: password, signed-in sessions, invitations, the Google link, the storage mode and Standard's terms. The CLI's session can reach only sign-in, sign-out and the storage access ([33](33-accounts-and-sign-in.md), "The command line"), so a leaked session file cannot change the password or invite anyone. (Decided) |
| Review first | Every change the CLI makes is written to the inbox as a file. The user reviews it in the web app's Import page, as now, or in the terminal with `touchdown review`. The CLI writes to the log only when a review imports a file. (Decided) |
| One implementation | A change is applied by the same code in both: importing and undoing an import (`packages/core/src/import/pipeline.ts`), and saving and deleting records, suggested fixes, accepting and reopening findings, airframe edits and merges, families and settings (`packages/core/src/edit.ts`). The web app's `AppData` only wraps them. (Decided, built) |
| For agents too | Every command takes `--json` and has documented exit statuses, so an agent can run it, read the answer and go on. Reports never include the log's private fields. (Proposed) |
| Private fields | Ticket numbers and booking references can be added, changed and removed from the CLI, but it never shows them. (Decided, Q-CLI-PRIVATE) How, below in "Private fields". |

## Commands

Built commands are marked; the rest are Proposed. `REF` names a record: its id, or for a flight `XY123@2025-04-02`, for a sighting `G-ABCD@EGLL@2025-03-15`, for an aircraft its registration (on a date with `@DATE` when it was reused).

### Reading

| In the web app | Command | Shows |
|---|---|---|
| Home, Statistics | `stats [--year Y \| all] [--by DIM [--cols DIM]]` | The lead sentence's figures, the fact list and the ranked lists; with `--by`, a pivot ([24](24-statistics.md)). |
| Flights | `flights [--year Y] [--airline X] [--airport X] [--type X] [--search TEXT]` | The flight list, with the same filters. |
| A flight | `flight REF` | Every field, the aircraft, its findings, the track's source. A private field shows only whether it is recorded. |
| Spotting | `sightings [filters]`, `sessions [--year Y]` | Sightings; days out with their counts. |
| Aircraft | `aircraft [REF]` | The list, or one aircraft's facts, registrations and timeline of flights and sightings. |
| An airport | `airport CODE [--year Y]` | The airport page's facts and lists. |
| Issues | `issues [--severity S] [--rule ID] [--accepted]` | Open findings, grouped as on the Issues page, each with its id and suggested fixes; or the accepted ones. |
| Import history | `imports` | The import batches, for `undo`. |
| Maps and the globe | (none) | Figures and videos come with `touchdown render` in phase 6 ([23](23-tracks-and-maps.md)). |

### Changing

Each writes one inbox file and checks it first, as `add` does: against the log as it is now, with every rule, reporting only what the change brings.

| In the web app | Command |
|---|---|
| Add a flight, a sighting, a session | `add` (built), `spot` (built) |
| Edit a flight or a sighting | `edit REF --set FIELD=VALUE … --clear FIELD …`, or a JSON list of edits on stdin |
| Delete one | `delete REF…` |
| Edit an aircraft's facts | `aircraft edit REF --set msn=… --set firstFlight=…` |
| Merge two aircraft | `aircraft merge INTO FROM` |
| Issues: "This looks right", Reopen, a suggested fix | `issues accept ID [--note TEXT]`, `issues reopen ID`, `issues fix ID [N]` |
| Import a file (myFR24, any spreadsheet) | `import FILE…`: the rows read (with the column mapping remembered on this computer) go to the inbox. With `--out backup.zip` it keeps building a backup instead (built). |
| Undo an import | `undo BATCH` |
| Aircraft families | `families [set TYPE FAMILY \| remove TYPE]` |
| Settings kept in the log | `settings [codes iata\|icao\|both] [distance km\|mi\|nm] [models standard\|compact]` |
| Download a backup, a table as CSV | `backup --out FILE`, `export TABLE [--out FILE] [--private]` (these write nothing to the log, so they need no review). The backup holds everything, as the web app's does; `export` leaves the private fields out unless `--private`, which needs `--out`. |
| Restore a backup over the log | Not in the CLI: it replaces everything, and the web app asks twice. (Decided, Q-CLI-RESTORE) |
| Theme | Not in the CLI: it belongs to each browser. |

Field names in `--set` and in JSON are the ones `add` takes ([21](21-import-export.md), "Source: records from the command line"), so values are read the same way (codes resolved, clock times at their airport's UTC offset).

### Reviewing

| Command | Does |
|---|---|
| `inbox` (built) | Lists the files waiting, shows one, removes one, sends files saved on this computer. |
| `review [NAME]` | Reviews the oldest file waiting, or NAME, in the terminal, then imports it on confirmation. |

### Private fields

Ticket numbers and booking references (AGENTS.md, "Data and privacy"):

| | |
|---|---|
| Given | In the JSON that `add` and `edit` read (a file, or stdin), as `ticketNumber` and `bookingRef`; or typed at a prompt that does not echo them, with `--set ticketNumber` and no value (`edit`), or `--ticket` and `--booking` (`add`, for its first flight). Never as a value on the command line, where the shell's history and other users' process lists would keep it. |
| Shown | Never. Reports, reviews, `flight REF` and `--json` say only that one is recorded, added, changed or removed (`"private": {"ticketNumber": "added"}`). Error messages do not quote them. |
| Stored | In the inbox file with the rest of the change, so in the same storage as the log, and after the import with the import's copy of the file. |
| Not sent | To the agent, ever ([22](22-agent-verification.md), "What is sent"), whatever the command. |
| Removed | `edit REF --clear ticketNumber`; deleting a flight removes them with it. |

An agent that writes the JSON for `add` or `edit` has seen what it writes; giving it a ticket number is the user's choice. The CLI adds nothing to what the agent sees.

## Change files

The inbox file grows a version 3 (versions 1 and 2 are still read) with a list of changes next to the flights and sightings:

```json
{
  "format": "touchdown-inbox", "version": 3, "madeBy": "edit", "createdAt": "2026-10-24T15:30:00+01:00",
  "changes": [
    { "op": "edit", "table": "flights", "id": "01J…", "rev": 4, "set": { "seat": "14A" }, "clear": ["gate"] },
    { "op": "delete", "table": "sightings", "id": "01J…", "rev": 2 },
    { "op": "airframe", "id": "01J…", "rev": 1, "set": { "msn": "1234" } },
    { "op": "merge", "into": "01J…", "from": "01J…" },
    { "op": "accept", "ruleId": "C-FLIGHT-OVERLAP", "fingerprint": "…", "note": null },
    { "op": "reopen", "ackId": "01J…" },
    { "op": "fix", "ruleId": "V-TYPE-KNOWN", "fingerprint": "…", "fix": 0 },
    { "op": "undo", "batchId": "01J…" },
    { "op": "family", "designator": "E75L", "familyId": "E170" },
    { "op": "settings", "set": { "codeDisplay": "icao" } }
  ]
}
```

- `rev` is the record's version the change was made against. If the record changed after that (in the web app, or by another import), the review shows both versions and leaves the record alone unless the user takes the change.
- A private field travels in the file only when the user gave one ("Private fields", above).
- A finding is named by its rule and fingerprint, so a change file about a finding that has gone away (fixed meanwhile) is reported as such, not applied to something else.
- File names say what made them: `edit-<date>-<time>.json`, `delete-…`, `issues-…`, `undo-…`, as `add-…` and `spot-…` do now.

## The review

The same steps in both places, from the same core code:

1. Read the file and the log as they are now.
2. Show each record it adds, fills or changes (before → after), each deletion, merge, accepted finding and undo, and the findings the file brings. In the terminal a private field shows as added, changed or removed, never its value; the web app shows it as its flight page does.
3. The user decides what the Import page lets them decide now: leave a record out, take or keep each differing value, keep or reject a time moved past midnight, take the change to a record edited since.
4. Import: one import batch, recorded in the log's history, so it can be undone like any import. The file is then moved to `attachments/imports/<batchId>/`, as the web app does.

In the terminal, `review` lists the records with their numbers and asks one question at a time, with the safe answer as the default (leave it, keep the stored value). `--yes` imports with every default; `--json` prints the review without importing, for an agent to read. In the web app, a change file opens on the Import page like any inbox file; changes show as before and after lines.

## Writing the log from the command line

So far the CLI reads the log and never writes it ([21](21-import-export.md), "With the user's storage"). `review` is the one exception, and it writes as the web app does: (Proposed)

- It reads the whole log from the storage (a few MB; a few seconds on Google Drive), applies the import in memory, and sends the changed rows with the sync engine ([12](12-storage-and-sync.md), "Sync algorithm"), so a change made at the same time in the web app is merged row by row, and the later of two edits to the same row wins with the other kept as a sync conflict.
- Its device id (each row records which device last edited it) is made once per computer and kept in `data/private/touchdown-cli.json`.
- Rows not yet shown back by the storage are kept in `data/private/cli-sync.json` and sent again on the next command, as the browser keeps its queue in IndexedDB. A review that stops halfway (offline, the laptop closed) is finished by the next run, not lost.
- It still never creates the Touchdown folder or a log, and never upgrades one. It writes only to a log at its own schema version: an older log asks the user to open the web app once (which upgrades it); a newer one asks them to update the CLI.
- In Local mode there is no storage it can reach, so `review` is not available; files are reviewed in the web app.

## Build order (Proposed)

Each step is usable on its own.

1. Move the web app's operations to the core package; the web app uses them unchanged. (Built)
2. The reading commands, with `--json`.
3. Change files (version 3), the changing commands, and their review on the Import page.
4. Writing the log from the CLI: the sync engine in Node, the device id, the queue file, and `touchdown review`.
5. `import FILE` to the inbox, `backup` and `export`.
