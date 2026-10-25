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
- Built so far: `packages/storage` with the backend interface, the JSON tables backend, an in-memory folder for tests, and the sync engine with its race test; schema version 2 (`basedOn`) with upgrading of older files. In the web app: the local-folder adapter, the Private and Local modes with the first-run choice and Settings, sync in the background with its state in the masthead, and Local's backup reminder; schema version 3 (`settings.dataMode`, `settings.storageAccount`). The Google Drive adapter (in `packages/storage`, for the web app and the CLI) with the browser's Google sign-in, tested against a fake Drive, including the race test with each device keeping its own file lookups. The Google OAuth app is published "In production" with `drive.file` only. The CLI as a storage client: `touchdown login` (the CLI signed in to the site as a browser is, [33](33-accounts-and-sign-in.md)) and `touchdown storage` (Google Drive with the web app's access, or a folder), `spot` reading the log from the storage and writing its sessions to the inbox, `touchdown add` (flights and sightings as JSON, checked against the log, for people and agents) and `touchdown inbox`; inbox file version 2 with flights; the web app reading the inbox after each sync ([21](21-import-export.md)).

## Phase 4: Lookups and auto-fill

- Deliver: the site's own sign-in ([33](33-accounts-and-sign-in.md): passwords and Google, invitations, sessions, People and Account in Settings) and the server that runs on Cloudflare or any machine; the first deployment (Worker with static assets and D1, custom domain, GitHub Actions deploys) behind it, airframe index build, lookup service, auto-fill suggestions, external rules (X-), reference links to airfleets / planespotters / aviation.flights.
- Done when: most of the user's records link to confirmed airframes, the provisional share is reported, and auto-fill never overwrites a user value.
- Built so far: the site's own sign-in ([33](33-accounts-and-sign-in.md)): the server in `packages/server` (accounts, passwords hashed in the browser, Google, invitations, reset links, sessions, the gate), the sign-in pages, Settings → Account and People, one browser database per account; the Cloudflare Worker with D1 and the Node server (`npm run serve`), both tried locally; the security headers; the GitHub Actions deploy and the first deployment. `touchdown spot` looks registrations up from the CLI (the user's log, the OpenSky snapshot, adsbdb, Flightradar24 opt-in) and fills sightings typed in a session ([21](21-import-export.md)).

## Phase 5: Agent check

- Deliver: `touchdown check` for Claude Code and Codex, request/result schemas, verifier prompt, user rules, version check, self-test with injection canaries, file hand-off through the user's storage.
- Done when: injection test rows produce only schema-valid output with no side effects, and suggestions appear in the import review.

## Phase 6: Tracks and exports

- Deliver: track file upload (FR24 CSV/KML, GPX), adsb.lol matching and backfill, figure export, video export (browser), `touchdown render` for long videos.
- Done when: flights since 2023-03 with a registration get a track or a clear "not found" reason; exports work for single flight, range/year, and all flights.

## Phase 7: Depth and friends

- Deliver: pivot builder and saved views, combined stats, per-year summary, myFR24 export, Google Sheets export, onboarding guide for friends.
- Done when: a friend can start from zero with their own Google account and import a myFR24 CSV.

## Phase 8: Standard mode and sharing

- Deliver: Standard mode ([32](32-modes-and-sharing.md)): connecting storage through the Worker (Google Drive first), encrypted keys in D1, the terms with recorded acceptance, mode changes in Settings, share links of the four kinds with the three audiences, the public share page, Settings "Sharing and access".
- Needs: phase 3 (storage and sync) and the sign-in and server of phase 4.
- Built so far: basic Standard, without share links: terms version 1, connecting Google Drive through the server with the key encrypted (`storage_connections`, `consents`), short-lived access for sync, new devices following Standard, leaving it revokes and deletes the key. Does not depend on phases 5–7.
- Done when:
  - Leaving Standard stops every link at once, revokes the key with the provider and leaves no row for the user on the server (scripted test).
  - A link opens only for its audience; any other request, a guessed id included, gets the same "not found".
  - No token appears in logs, responses or the browser (test with a canary token).
  - The public page serves nothing but public links' content.

## Phase 9: The command line on a par with the web app

- Deliver: [34](34-command-line.md): the web app's operations in the core package; reading commands with `--json`; change files (inbox version 3) for edits, deletions, aircraft edits and merges, issues, undo, families and settings, reviewed on the Import page; `touchdown review`, which writes the log through the sync engine; `import FILE` to the inbox, `backup`, `export`. (Proposed)
- Needs: phase 3 (sync). The account and the site stay in the web app.
- Done when:
  - Every change the web app can make to the log can be made from the CLI, and reaches the log only through a review (in the web app or in the terminal).
  - A change reviewed in the terminal and one made at the same time in the web app both arrive, merged row by row (scripted test).
  - A review stopped halfway is finished by the next command, with nothing lost or written twice.
  - Ticket numbers and booking references can be added, changed and removed from the CLI, and no command prints one or sends one to the agent (test with a canary value).

## Later (not scheduled)

- Local bridge between the web app and the CLI.
- AeroAPI flight lookup and "capture during flight".
- Dropbox / OneDrive adapters.
- Server backends: local SQLite file, Postgres / Supabase, Cloudflare D1 (Q-SERVER-DB).
- Google Photos Picker to fill sighting date and time from a photo (no location available from Google).
- Field-level merge for same-record conflicts.
