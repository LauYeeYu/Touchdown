# 40 Roadmap

Build order, with what each phase delivers and how we know it is done. No phase starts until the plan is approved (phase 0).

The order puts the riskiest part first: the data model and identity rules are tested against the user's real data before any UI is built.

## Phase 0: Plan

- Deliver: these docs, answers to the blocking open questions ([90](90-open-questions.md)).
- Done when: the user approves the plan.

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

## Phase 2: Web app on one device

- Deliver: flights and sightings (list, detail, quick add, session add), aircraft pages, import wizard with review and undo, issues page, summary stats, great-circle flights map, settings. Storage: browser only, plus JSON zip export/import.
- Done when: the user can migrate their data and log new flights and sightings on one device without the sheets.

## Phase 3: Sync

- Deliver: `packages/storage` with the backend interface, both file backends (JSON tables, SQLite file) and conversion between them, Google Drive adapter, sync engine with pending queue and conflict list, local-folder adapter, offline support (PWA), daily backups, schema migration mechanism. The CLI as a storage client, through the same backend interface as the web app: `spot` writing its sessions to the inbox and reading the log from the user's storage (`touchdown storage drive` for Google Drive); the web app picking the inbox up during sync ([21](21-import-export.md)). The Private and Local modes, the mode choice at first run and the `dataMode` setting ([32](32-modes-and-sharing.md)); Standard is offered from phase 8.
- Done when:
  - Two devices editing at the same time converge with no lost edits (scripted test with simulated races).
  - The app works offline and syncs on reconnect.
  - Sync, the inbox and the CLI work the same with the Google Drive and the local-folder adapters (S7).
  - The Google OAuth app is published "In production" with `drive.file` only.
- Built so far: `packages/storage` with the backend interface, the JSON tables backend, an in-memory folder for tests, and the sync engine with its race test; schema version 2 (`basedOn`) with upgrading of older files. In the web app: the local-folder adapter, the Private and Local modes with the first-run choice and Settings, sync in the background with its state in the masthead, and Local's backup reminder; schema version 3 (`settings.dataMode`, `settings.storageAccount`). The Google Drive adapter (in `packages/storage`, for the web app and the CLI) with the browser's Google sign-in, tested against a fake Drive, including the race test with each device keeping its own file lookups. The Google OAuth app is published "In production" with `drive.file` only. The CLI as a storage client: `touchdown login` (the CLI signed in to the site as a browser is, [33](33-accounts-and-sign-in.md)) and `touchdown storage` (Google Drive with the web app's access, or a folder), `spot` reading the log from the storage and writing its sessions to the inbox, `touchdown add` (flights and sightings as JSON, checked against the log, for people and agents) and `touchdown inbox`; inbox file version 2 with flights; the web app reading the inbox after each sync ([21](21-import-export.md)). Offline support: a service worker keeps the app's files, so the app opens without a network in every mode, and sync waits for the network and runs when it returns ([30](30-architecture.md), "Offline").

## Phase 4: Lookups and auto-fill

- Deliver: the site's own sign-in ([33](33-accounts-and-sign-in.md): passwords and Google, invitations, sessions, People and Account in Settings) and the server that runs on Cloudflare or any machine; the first deployment (Worker with static assets and D1, custom domain, GitHub Actions deploys) behind it, airframe index build, lookup service, auto-fill suggestions, external rules (X-), reference links to airfleets / planespotters / aviation.flights.
- Done when: most of the user's records link to confirmed airframes, the provisional share is reported, and auto-fill never overwrites a user value.
- Built so far: the site's own sign-in ([33](33-accounts-and-sign-in.md)): the server in `packages/server` (accounts, passwords hashed in the browser, Google, invitations, reset links, sessions, the gate), the sign-in pages, Settings → Account and People, one browser database per account; the Cloudflare Worker with D1 and the Node server (`npm run serve`), both tried locally; the security headers; the GitHub Actions deploy and the first deployment. `touchdown spot` looks registrations up from the CLI (the user's log, the OpenSky snapshot, adsbdb, Flightradar24 opt-in) and fills sightings typed in a session ([21](21-import-export.md)).

## Phase 5: Agent check

- Deliver: `touchdown check` for Claude Code and Codex, request/result schemas, verifier prompt, user rules, version check, self-test with injection canaries, file hand-off through the user's storage.
- Done when: injection test rows produce only schema-valid output with no side effects, and suggestions appear in the import review.

## Phase 6: Tracks and exports

- Deliver: track file upload (FR24 CSV/KML, GPX), adsb.lol matching and backfill, figure export, video export (browser), `touchdown render` for long videos.
- Done when: any flight can take a track file the user adds (Flightradar24 first; built), the flights without one can be listed to ask someone for them (built), adsb.lol fills gaps only when asked (`touchdown tracks`, built); exports work for single flight, range/year, and all flights.
- Built: figure export and video export in the browser, for a flight, a year or all time, Home's period with its sightings, and an aircraft's flights ([23](23-tracks-and-maps.md)). Left: `touchdown render`.

## Phase 7: Depth and friends

- Deliver: pivot builder and saved views, combined stats, per-year summary, myFR24 export, Google Sheets export, onboarding guide for friends.
- Done when: a friend can start from zero with their own Google account and import a myFR24 CSV.
- Built: the custom view (a pivot) and saved views, the combined statistics and the per-year figures ([24](24-statistics.md)); the myFR24 export, in Settings from the flights the user chooses and as `touchdown export myfr24 [--new]`; the Google Sheets export, the three tables as one Google Sheet in the user's Drive; Getting started (`/guide`, [31](31-ui.md)). Left: trying a file of a few flights in myFR24's import (Q-FR24-IMPORT), and the Statistics page's tables as CSV ([21](21-import-export.md), "Exports").

## Phase 8: Standard mode and sharing

- Deliver: Standard mode ([32](32-modes-and-sharing.md)): connecting storage through the Worker (Google Drive first), encrypted keys in D1, the terms with recorded acceptance, mode changes in Settings, share links of the four kinds (flight, sighting, aircraft, the whole log), public and lasting until stopped, the share page `/p/<id>`, the Shared links page and the Share buttons.
- Needs: phase 3 (storage and sync) and the sign-in and server of phase 4.
- Built so far: Standard with share links: terms version 2, connecting Google Drive through the server with the key encrypted (`storage_connections`, `consents`), short-lived access for sync, new devices following Standard, leaving it revokes and deletes the key and stops every link. Private data in its own table and folder (schema version 7). Share links of the four kinds, read from the log live (`shares`, `/api/shares`, `/p/<id>`), the share page on the app's own pages, read-only, with recorded tracks read in batches (`/share-files/`), the Share dialog and the Shared links page. Does not depend on phases 5–7. Mode changes, the storage connection and the terms are in Settings too.
- Done when:
  - Leaving Standard stops every link at once, revokes the key with the provider and leaves no row for the user on the server (scripted test).
  - A stopped link and a guessed id get the same "not found".
  - No link's content holds a ticket number, a booking reference, a deleted entry or a sync column, and the server never reads a file in `private/` (tests over every kind).
  - Every write leaves the flights' private columns empty, two devices moving private data at once end with one `flight_private` row per flight, and a deleted record's link says it is no longer shared while an aircraft's link follows a merge (tests).
  - No token appears in logs, responses or the browser (test with a canary token).
  - The share page serves nothing but one link's content.

## Phase 9: The command line on a par with the web app

- Deliver: [34](34-command-line.md): the web app's operations in the core package; reading commands with `--json`; change files (inbox version 3) for edits, deletions, aircraft edits and merges, issues, undo, families and settings, reviewed on the Import page; `touchdown review`, which writes the log through the sync engine; `import FILE` to the inbox, `backup`, `export`. (Built)
- Needs: phase 3 (sync). The account and the site stay in the web app.
- Built so far: step 1, the web app's changes to the log in the core package (`packages/core/src/edit.ts`), shared with the CLI; step 2, the reading commands (`flights`, `flight`, `sightings`, `sessions`, `aircraft`, `airport`, `stats`, `issues`, `imports`), on the web app's view code moved to `@touchdown/core/view`; step 3, change files (inbox version 3), the changing commands (`edit`, `delete`, `aircraft edit` and `merge`, `issues accept`, `reopen` and `fix`, `undo`, `families`, `settings`), `add` taking private fields, and the review of change files on the Import page, imported as one batch that undo puts back; step 4, `touchdown review`, which reviews records and changes in the terminal and writes the log through the sync engine (a review and a web edit at the same time both arrive; a review stopped halfway is finished by the next run: scripted tests); step 5, `import FILE` to the inbox (a spreadsheet's rows and columns in an inbox file, reviewed as the file itself), `backup` and `export`; step 6, saved Statistics views, facts pasted from an aircraft's page, lookups of aircraft facts into the log through the inbox, the agent check in `touchdown review`, and `--json` for `storage` and `agent`.
- Done when:
  - Every change the web app can make to the log can be made from the CLI, and reaches the log only through a review (in the web app or in the terminal).
  - A change reviewed in the terminal and one made at the same time in the web app both arrive, merged row by row (scripted test).
  - A review stopped halfway is finished by the next command, with nothing lost or written twice.
  - Ticket numbers and booking references can be added, changed and removed from the CLI, and no command prints one or sends one to the agent (test with a canary value).

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

## Later (not scheduled)

- Local bridge between the web app and the CLI.
- AeroAPI flight lookup and "capture during flight".
- Dropbox / OneDrive adapters.
- Server backends: local SQLite file, Postgres / Supabase, Cloudflare D1 (Q-SERVER-DB).
- Field-level merge for same-record conflicts.
- Aircraft silhouettes (G11): a drawing for each family or type in the reference data, shown on aircraft and flight pages only once a person has checked it (Q-SILHOUETTE).
- Translation (G12, Q-I18N). Built: the interface text is in message files (`packages/i18n`), UK English, with named arguments and plural forms. This covers the web app, the share and sign-in pages, the findings' messages from the core package, the CLI and the server. Dates, numbers and units follow the chosen language, and the date format is a choice of its own ([31](31-ui.md), "Language"). The web pages, the CLI and the server are also in American English, German, Simplified Chinese and Traditional Chinese for Taiwan: the web pages in the browser's language or the one chosen in Settings, the CLI in the system's ([34](34-command-line.md), "Language") and the server's errors in the request's.
