# 40 Roadmap

Build order, with what each phase delivers, how we know it is done, and where it stands. What each built part does is in the doc the phase names; this doc does not repeat it.

The order put the riskiest part first: the data model and identity rules were tested against the user's real data before any UI was built.

| Phase | Status |
|---|---|
| 0 Plan | Done: the plan is approved. |
| 1 Core on real data | Built |
| 2 Web app on one device | Built |
| 3 Sync | Built |
| 4 Sign-in, deployment, lookups | Built, but for the external rules |
| 5 Agent check | Built |
| 6 Tracks and exports | Built, with a few image and video options left |
| 7 Depth and friends | Built |
| 8 Standard mode and sharing | Built, with a few Settings lines left |
| 9 The command line on a par with the web app | Built |
| 10 Photos | Not started |
| 11 Planned flights | Built |
| 12 Stamps | Built |

Built outside the phases: the aircraft types pages ([31](31-ui.md), "Aircraft types"), the silhouettes (G11, [13](13-reference-data.md), "Silhouettes") and the translation of the interface (G12, [31](31-ui.md), "Language").

## Phase 0: Plan

- Deliver: these docs, answers to the blocking open questions ([90](90-open-questions.md)).
- Done when: the user approves the plan. Done.

## Phase 1: Core on real data (no UI)

- Deliver:
  - `packages/core`: the schema with its generators (types, validators, JSON Schema, SQL DDL), normalisation, registration rules, identity resolver (local), validation rules, stats engine, importers for the two sheets and the myFR24 CSV.
  - `packages/refdata`: airports + time zones, airlines, types, families, model patterns, registration prefixes.
  - A CLI command that imports files from `data/private/` and prints findings and summary stats.
- Done when:
  - The user's three sources import without crashes.
  - Findings include the known issues listed in the private snapshot (kinds described in [01](01-existing-data.md)).
  - Summary stats match the numbers in the private snapshot (`data/private/`), recomputed on the corrected data, and every difference is explained (airframes vs registrations, the row-4 formula bug, corrected data).
  - Rule fixtures pass.
- Status: built. The two fixed sheet readers were later replaced by the column mapping (Q-SHEET-LAYOUT).

## Phase 2: Web app on one device

- Deliver: flights and sightings (list, detail, quick add, session add), aircraft pages, import wizard with review and undo, issues page, summary stats, great-circle flights map, settings. Storage: browser only, plus JSON zip export/import.
- Done when: the user can migrate their data and log new flights and sightings on one device without the sheets.
- Status: built ([31](31-ui.md)).

## Phase 3: Sync

- Deliver: `packages/storage` with the backend interface, the JSON tables file backend, Google Drive adapter, sync engine with pending queue and conflict list, local-folder adapter, offline support (PWA), daily backups, schema migration mechanism. The CLI as a storage client, through the same backend interface as the web app: `spot` writing its sessions to the inbox and reading the log from the user's storage; the web app picking the inbox up during sync. The Private and Local modes, the mode choice at first run and the `dataMode` setting; Standard came in phase 8.
- Done when:
  - Two devices editing at the same time converge with no lost edits (scripted test with simulated races).
  - The app works offline and syncs on reconnect.
  - Sync, the inbox and the CLI work the same with the Google Drive and the local-folder adapters (S7).
  - The Google OAuth app is published "In production" with `drive.file` only.
- Status: built ([12](12-storage-and-sync.md); the CLI's storage and inbox in [21](21-import-export.md), "Getting a session to the web app"; the modes in [32](32-modes-and-sharing.md); offline in [30](30-architecture.md), "Offline"). Left: rechecking Google's Drive quota changes (Q-DRIVE-QUOTA).

## Phase 4: Sign-in, deployment, lookups and auto-fill

- Deliver: the site's own sign-in (passwords and Google, invitations, sessions, People and Account in Settings) and the server that runs on Cloudflare or any machine ([33](33-accounts-and-sign-in.md)); the first deployment (Worker with static assets and D1, custom domain, GitHub Actions deploys) behind it; registration lookups and auto-fill in the CLI (`touchdown spot`, `touchdown airframes`), external rules (X-), reference links to airfleets / planespotters / aviation.flights. The web app does not look registrations up (Decided): sightings are added mostly on a computer, where the CLI looks them up and the agent checks them, and the web app has the user's log and text pasted from an airframe page.
- Done when: most of the user's records link to confirmed airframes, the provisional share is reported, and auto-fill never overwrites a user value.
- Status: built, but for the external rules (X-, [20](20-validation.md)), which need the lookup service ("Later" below). The lookups are in [13](13-reference-data.md), "Live lookups" and "Airframe facts".

## Phase 5: Agent check

- Deliver: `touchdown check` for Claude Code and Codex, request/result schemas, verifier prompt, user rules, version check, self-test with injection canaries, file hand-off through the user's storage.
- Done when: injection test rows produce only schema-valid output with no side effects, and suggestions appear in the import review.
- Status: built ([22](22-agent-verification.md)), with the check of records already in the log (`touchdown check log`) added since. The request and result travel as files the user saves and loads; the `checks` area of the storage and the local bridge are not built ("Later" below).

## Phase 6: Tracks and exports

- Deliver: track file upload (FR24 CSV/KML, GPX), adsb.lol matching and backfill, figure export, video export (browser), `touchdown render` for long videos.
- Done when: any flight can take a track file the user adds, the flights without one can be listed to ask someone for them, adsb.lol fills gaps only when asked (`touchdown tracks`); exports work for single flight, range/year, and all flights.
- Status: built ([23](23-tracks-and-maps.md); `touchdown render` in [34](34-command-line.md), "Videos"). Left: the image's other projections, colours by airline, year or type, a custom size and hiding flight numbers and dates ([23](23-tracks-and-maps.md), "Export: figure"), and sound in videos.

## Phase 7: Depth and friends

- Deliver: pivot builder and saved views, combined stats, per-year summary, myFR24 export, Google Sheets export, onboarding guide for friends.
- Done when: a friend can start from zero with their own Google account and import a myFR24 CSV.
- Status: built ([24](24-statistics.md); the exports in [21](21-import-export.md), "Exports"; Getting started in [31](31-ui.md)). Left: trying a file of a few flights in myFR24's import (Q-FR24-IMPORT).

## Phase 8: Standard mode and sharing

- Deliver: Standard mode ([32](32-modes-and-sharing.md)): connecting storage through the Worker (Google Drive first), encrypted keys in D1, the terms with recorded acceptance, mode changes in Settings, share links of the four kinds (flight, sighting, aircraft, the whole log), public and lasting until stopped, the share page `/p/<id>`, the Shared links page and the Share buttons.
- Needs: phase 3 (storage and sync) and the sign-in and server of phase 4.
- Done when:
  - Leaving Standard stops every link at once, revokes the key with the provider and leaves no row for the user on the server (scripted test).
  - A stopped link and a guessed id get the same "not found".
  - No link's content holds a ticket number, a booking reference, a deleted entry or a sync column, and the server never reads a file in `private/` (tests over every kind).
  - Every write leaves the flights' private columns empty, two devices moving private data at once end with one `flight_private` row per flight, and a deleted record's link says it is no longer shared while an aircraft's link follows a merge (tests).
  - No token appears in logs, responses or the browser (test with a canary token).
  - The share page serves nothing but one link's content.
- Status: built, with each link's preview for chat apps added since. Left: Settings' lines on the storage connection and the terms accepted ([32](32-modes-and-sharing.md), "Settings in Standard mode"), and what [32](32-modes-and-sharing.md), "Later", lists.

## Phase 9: The command line on a par with the web app

- Deliver: [34](34-command-line.md): the web app's operations in the core package; reading commands with `--json`; change files (inbox version 3) for edits, deletions, aircraft edits and merges, issues, undo, families and settings, reviewed on the Import page; `touchdown review`, which writes the log through the sync engine; `import FILE` to the inbox, `backup`, `export`.
- Needs: phase 3 (sync). The account and the site stay in the web app.
- Done when:
  - Every change the web app can make to the log can be made from the CLI, and reaches the log only through a review (in the web app or in the terminal).
  - A change reviewed in the terminal and one made at the same time in the web app both arrive, merged row by row (scripted test).
  - A review stopped halfway is finished by the next command, with nothing lost or written twice.
  - Ticket numbers and booking references can be added, changed and removed from the CLI, and no command prints one or sends one to the agent (test with a canary value).
- Status: built. Left: adding an airport of the user's own from the CLI (Open, [34](34-command-line.md), "Changing").

## Phase 10: Photos

- Deliver ([25](25-photos.md), in its build order): a full storage reported in a dialog for every write; the `photos` table and the storage's `photos/` directory, with photos shown in the app; `touchdown photos DIR` over an export from the photo software, matching by the photos' words, then by the agent; photos on share links; later, adding photos in the web app. Optional: nothing changes for a user who adds no photos.
- Needs: phase 3 (storage and sync), phase 8 (share links) for the photos on links, the agent of phase 5 for reading registrations.
- Done when:
  - A full storage, Google Drive's or a local directory's, opens the dialog at the first refused write, keeps every edit in the browser and sends them after Try again once there is space (scripted test with a backend that refuses writes).
  - Exporting the same photos again adds no second copy, and an edited photo replaces its files.
  - A log with thousands of photos opens and syncs as fast as without them: sync never lists `photos/` (test).
  - A link sends only the photos of the records it shows, and a file not named by its content gets the same "not found" as a guessed one (tests over every kind).
  - No copy carries the location or camera data, and no photo reaches the agent unless the user allowed it (tests).
  - Backups and daily copies hold the photos' rows, not their files.
- Status: not started. Open checks: Q-AGENT-IMAGES, Q-PHOTO-SOURCEID.

## Phase 11: Planned flights

- Deliver (F5, [31](31-ui.md), "Planned flights"): schema version 9 (`flights.planned`, `flights.remindAt`), a flight's status worked out in core and used by every figure, list and map, in the web app, on share links and in the command line; the form's times for a flight still to come; Home's "Coming up"; dashed routes; the reminder bar and the flight page's band with "Remind me later"; the period control's years.
- Needs: phase 3 (sync) for `remindAt` across devices, phase 8 (share links), phase 9 (the command line).
- Done when:
  - A flight saved with its departure still to come is planned, and one saved after it is flown, whatever the time zone of the computer and of the airports (tests across zones, a date alone included).
  - A planned flight counts nowhere until its time has passed, then everywhere, at the same moment in the app, on a link and in the command line, without a reload (tests).
  - The reminder shows once its time has passed, "Remind me later" quiets it on every device until the time chosen, and Confirm, an edit after its time or an import ends it (tests).
  - A link shows planned flights as the app does and never the reminder or `remindAt` (tests over every kind).
  - The period control shows the current year and All time at every width, and the years menu and All time on the narrowest screen (checked in en-GB and zh-CN).
- Status: built.

## Phase 12: Stamps

- Deliver (G13, [24](24-statistics.md), "Stamps"; [31](31-ui.md), "Stamps"): every stamp worked out in core from the log, with the factory airfields and continents curated beside it; the stamps on Statistics' Stamps tab, on Home, on a flight's page and in Coming up; a whole log's share link; `touchdown stamps`. Then the stamps the site's owner gives from People, kept on the server with the account (Q-STAMP-GRANTED), and the first press of a hidden stamp, recorded in the log so it plays once (Q-STAMP-SEEN, schema version 10).
- Needs: phase 8 (share links), phase 9 (the command line), phase 11 (planned flights, for what counts and Coming up).
- Done when:
  - Each stamp is earned by the record its rule names, on that record's day, and by no record that falls short of it (tests per stamp, a time zone and a date line case included).
  - A planned flight earns nothing until its time has passed, and Coming up names what it would earn (tests).
  - A hidden stamp does not show until earned, and one not yet earned shows greyed with its rule.
  - A whole log's link shows the stamps as the app does, and a link to one record shows none.
  - The stamps read right in en-GB and zh-CN, light and dark, at a desktop's width and a phone's.
  - Only the owner gives a stamp, only one of core's list, and it shows on the account's pages and its whole log's link at once and goes with the account (tests).
  - A hidden stamp is pressed once on any device: recorded when it lands, two devices' records settled into one, and never on a share link (tests).
- Status: built.

## Later (not scheduled)

- Local bridge between the web app and the CLI, and the agent check's files handed over through the `checks` area of the storage ([22](22-agent-verification.md), "Flow").
- The lookup service ([30](30-architecture.md), "Why a lookup service"; [13](13-reference-data.md), "Lookup service API"), and with it the external rules (X-, [20](20-validation.md)), AeroAPI flight lookups and "capture during flight".
- A registration lookup in the web app: adsbdb from the browser (it allows any site), then the airframe index for serial numbers ([13](13-reference-data.md), "Airframe index"). Not planned while sightings are added mostly on a computer.
- Importing a Google Sheet picked with the Google Picker ([21](21-import-export.md), "Source: any spreadsheet").
- Dropbox / OneDrive adapters.
- Server backends: local SQLite file, Postgres / Supabase, Cloudflare D1 (Q-SERVER-DB).
- The SQLite file backend in the user's storage, with conversion to and from JSON tables ([12](12-storage-and-sync.md), "File backend: SQLite file"): the log as one file the user can open with SQLite tools. Not a way to open faster: the app opens from the browser's copy, and a first download waits on requests, not on size.
- Opening faster. A browser's first download makes its requests before the tables arrive one after another: Standard's status, then its Google Drive key, the Touchdown directory, the manifest and the three directories' listings. More of them could be made at the same time. At every opening, the browser's copy for the account last signed in could be read while the server checks the account, and dropped if the account differs.
