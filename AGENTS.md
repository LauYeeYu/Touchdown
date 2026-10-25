# AGENTS.md

Instructions for coding agents (Claude Code, Codex) working in this repo. `CLAUDE.md` imports this file, so both tools read the same rules.

## Project

Touchdown is a personal aircraft log: flights the user has flown on and aircraft the user has photographed, with statistics similar to my.flightradar24.com and Flighty. A few friends will use it too; each user's data is private and lives in storage they own (Google Drive first).

## Status

The plan in `docs/` is approved. Phase 1 (core on real data) and phase 2 (web app on one device) from `docs/40-roadmap.md` are built, and so are the agent check of phase 5 (file hand-off) and the CLI spotting session (`touchdown spot`, a first part of phase 4's lookups). Phase 3 (sync) is under way: `packages/storage` has the JSON tables backend, the sync engine and the Google Drive adapter, and the web app syncs through Google Drive or a local folder in Private mode. The CLI reads the log from the same storage and writes to its inbox (`touchdown storage`, `add`, `inbox`), which the web app reads after each sync, and shows the log as the web app does (`flights`, `stats`, `issues` and the other reading commands of docs/34). The site's own sign-in (`packages/server`, docs/33) is built, and the site is deployed by GitHub Actions. Basic Standard mode (docs/32: terms, the server keeps an encrypted Google Drive key, no share links yet) is built. `PRIVACY.md` and `TERMS.md` describe the hosted site; keep them true when what it stores or sends changes. When the code and a doc disagree, ask the user which one is right, then fix the other.

## Docs

Start at `docs/README.md`. Docs are numbered from low level (data model) to high level (architecture, roadmap). Requirements have ids (G1, I3, ...) defined in `docs/00-requirements.md`; open questions have ids (Q-...) in `docs/90-open-questions.md`. Refer to them by id.

## Writing rules

- Plain, direct prose. No mannered or decorative writing, no filler, no marketing tone.
- UK English spelling in docs, interface copy, and comments (colour, organise, centre, licence as a noun). Code identifiers and third-party names keep their own spelling (`color` in CSS, "Authorized JavaScript origins" in Google's console).
- Prefer tables and lists for specs.
- Mark each design statement as Decided, Proposed, or Open when it matters.
- When something is uncertain, ask the user instead of guessing. Add it to `docs/90-open-questions.md` if it cannot be answered right away.

## Data and privacy

- Personal data (exports, sheets, FR24 CSV) goes in `data/private/`, which is git-ignored. Never commit it.
- Ticket numbers and booking references are private fields. Never put them in fixtures, docs, logs, or agent prompts.
- Test fixtures use made-up or scrubbed data.
- Docs and other committed files contain no personal information about the owner (subscriptions, devices, home airport, travel history, counts or example rows from their data). Write "a user may have X". Use made-up examples (registrations, flight numbers, seats, dates), never values from the owner's data. Real values go in `data/private/`.
- The hosted site stays behind its own sign-in (docs/33-accounts-and-sign-in.md); only invited people get an account. Never store a password or log a session token; passwords reach the server only as the browser-derived key. Without a session only these open: the sign-in pages (and their `/auth/` requests), the privacy policy and terms (`/privacy`, `/terms`, static pages built from `PRIVACY.md` and `TERMS.md`), and later the public share page `/p/<id>` (docs/32-modes-and-sharing.md), which serves one public link's content and nothing else. Never add another public route or an unauthenticated API endpoint.
- Standard mode's storage keys stay encrypted on the server: never log them, return them to a browser, or put them in fixtures or prompts. Private and Local users have nothing on the server.
- Do not put dates of research or planning sessions in docs ("researched on …", "answered on …").

## Data rules

- Imports are not tied to anyone's spreadsheet layout. Only the my.flightradar24.com export has a fixed reader; every other sheet goes through the column mapping in `packages/core/src/import/mapping.ts`. To read a new layout, add header names or value rules there, not a new reader.
- Features are not tied to one storage backend (S7). Google Drive is the first, not the only one: sync, the CLI's inbox, the agent check hand-off and anything added later go through the backend interface in `docs/12-storage-and-sync.md`, so they work on every backend. Do not build on what only one service offers (Drive's file sharing, Drive for Desktop). Google's own APIs are fine where a Google product is the subject, such as importing from or exporting to Google Sheets.
- The schema in `packages/core/schema` is the single source of truth for stored data. No ad-hoc fields, no nested free-form JSON; lists are child tables. Storage code is generic over backends.
- Every precise time is an ISO 8601 date-time with UTC offset (`2025-03-15T00:12+01:00`). Never store a time without its date. Plain dates (`YYYY-MM-DD`) only for values that are dates by nature or where only the day is known.

## Planned stack (Decided unless noted)

- TypeScript everywhere: web app, shared core package, companion CLI.
- Static web app, data in the browser (IndexedDB) synced to the user's storage: JSON tables or a SQLite file (user's choice); server databases later.
- Details in `docs/30-architecture.md`.

## Commands

One npm workspace (`packages/*`, `apps/*`). Packages are consumed as TypeScript source; there is no build step for them.

Setup and day-to-day use for people are in `README.md`. `./touchdown <command>` (a launcher at the repo root) is the same as `npm run touchdown -- <command>` without npm's banner; `./touchdown help` lists the commands.

| Command | Does |
|---------|------|
| `npm install` | Install all workspace dependencies. |
| `npm test` | Run every Vitest suite. |
| `npm run typecheck` | Type-check the packages. |
| `npm run touchdown -- import <files…>` | Phase 1 CLI: import files, print findings and summary statistics. `--apply-fixes` accepts single suggested fixes first; `--out backup.zip` writes a backup the web app can restore. |
| `npm run touchdown -- import <files…> --tracks DIR --tracks-adsblol DIR --airframes --out data/private/touchdown-backup.zip` | Build the owner's local backup, recorded tracks and airframe facts (OpenSky) included. |
| `npm run touchdown -- airframes data/private/touchdown-backup.zip [--fr24] --out data/private/touchdown-backup.zip` | Fill serial numbers and first flight dates in an existing backup (docs/13, "Airframe facts"). `--fr24` also reads Flightradar24 through a Chrome started with `--remote-debugging-port=9222` and signed in. |
| `npm run dev -w @touchdown/web` | Web app dev server at http://127.0.0.1:5173, with the real sign-in for `/auth/` (accounts in `data/private/dev-server.sqlite`). In development only, it lists spotting sessions waiting in `data/private/inbox/` for review and import, and an empty browser loads `data/private/touchdown-backup.zip` once; a hard refresh (Shift-reload) or the button in Settings loads it again; the production build contains none of this. |
| `./touchdown check <request.json \| file.xlsx> [--agent claude\|codex] [--limit N] [--dry-run]` | Agent check (docs/22): runs Claude Code or Codex, locked down, over a check request saved from the Import page or over a spreadsheet, and writes `<name>.result.json` for the Import page. `--dry-run` shows what would be sent. Uses the user's own agent subscription. |
| `./touchdown agent [claude\|codex\|none]` | Show or choose the agent for `spot` and `check` (saved in `data/private/touchdown-cli.json`; the first run of either asks, with no agent as the default). `--agent` overrides it for one run. `agent notes on\|off` and `agent rules [add "…" \| remove N]` set what it is sent; these settings belong to the computer, not the log. |
| `./touchdown spot [LINE… \| FILE.xlsx] [--at AIRPORT] [--fr24] [--agent codex\|none] [--map H=FIELD]` | Spotting session (docs/21): type aircraft one per line, or read a spreadsheet of sightings in any layout; each registration is looked up (the user's log, OpenSky, adsbdb, Flightradar24 with `--fr24`), empty fields are filled, the agent checks them, and what is still missing is asked for. Writes an inbox file for the Import page: to the inbox of the storage chosen with `storage`, else to `data/private/inbox/`. |
| `./touchdown login [SITE]`, `./touchdown logout` | Sign the CLI in to Touchdown as a browser is (docs/33, "The command line"); without SITE, the hosted site (`DEFAULT_SITE` in `packages/cli/src/site.ts`, equal to `SITE_ORIGINS` in `wrangler.jsonc`): the user allows it on `/cli/login`; the session lasts until signed out and may only reach `/auth/me`, sign-out and Standard's Drive access. Kept in `data/private/touchdown-session.json`. |
| `./touchdown storage [drive \| folder PATH \| none]` | Show or choose the storage the CLI uses, as the web app syncs it (docs/21): `drive` uses the web app's Google access, from the site in Standard mode or handed over by the browser (`/cli/drive`) in Private mode. The CLI reads the log and writes only to the inbox; it never creates or upgrades a log. |
| `./touchdown add [FILE.json \| -] [--dry-run] [--json] [--keep-errors]` | Flights and sightings given as JSON, by the user or an agent, checked against the log as the Import page would (row checks, matching, every rule), then written to the inbox and read back. Refuses ticket numbers and booking references. Exit 0 written or nothing new, 1 errors, 2 input or storage problem. |
| `./touchdown inbox [show NAME \| remove NAME --yes \| send] [--json]` | List, show or remove the files waiting in the inbox; send files saved in `data/private/inbox/` to the storage. |
| `./touchdown flights`, `flight REF`, `sightings`, `sessions`, `aircraft [REF]`, `airport CODE`, `stats [--by DIM]`, `issues`, `imports` | Read the log as the web app shows it (docs/34, "Reading"), from the chosen storage or `--log FILE`; `--json` for agents. The figures and labels come from the core package (`@touchdown/core/view`), shared with the web app. Ticket numbers and booking references are only reported as recorded. |
| `npm run build -w @touchdown/web` | Type-check and build the web app into `apps/web/dist`. |
| `npm run serve` | The server on any machine (`packages/server/src/serve.ts`): the built app behind the sign-in, accounts in `data/private/server.sqlite`, settings from the environment (`TOUCHDOWN_ORIGINS`, `SETUP_TOKEN`, …). |
| `npm run preview -w @touchdown/web` | Serve the build at http://127.0.0.1:4173 with the hosted site's headers (`packages/server/src/headers.ts`), to try its Content Security Policy. |
| (GitHub Actions) | `.github/workflows/deploy.yml` tests, type-checks and builds every push to `master`, and deploys the Worker (`apps/web/wrangler.jsonc`, `apps/web/worker/`) with `wrangler` while the repository variable `DEPLOY` is `on`. Do not deploy by hand. |
| `npm run build-data -w @touchdown/refdata` | Rebuild the reference tables in `packages/refdata/data/`. |
