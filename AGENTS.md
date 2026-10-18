# AGENTS.md

Instructions for coding agents (Claude Code, Codex) working in this repo. `CLAUDE.md` imports this file, so both tools read the same rules.

## Project

Touchdown is a personal aircraft log: flights the user has flown on and aircraft the user has photographed, with statistics similar to my.flightradar24.com and Flighty. A few friends will use it too; each user's data is private and lives in storage they own (Google Drive first).

## Status

Planning. Do not write application code until the user approves the plan in `docs/`. Changes to `docs/` are fine.

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
- The hosted site stays behind the access gate (docs/30-architecture.md); never add a public route or an unauthenticated API endpoint.
- Do not put dates of research or planning sessions in docs ("researched on …", "answered on …").

## Data rules

- The schema in `packages/core/schema` is the single source of truth for stored data. No ad-hoc fields, no nested free-form JSON; lists are child tables. Storage code is generic over backends.
- Every precise time is an ISO 8601 date-time with UTC offset (`2025-03-15T00:12+01:00`). Never store a time without its date. Plain dates (`YYYY-MM-DD`) only for values that are dates by nature or where only the day is known.

## Planned stack (Decided unless noted)

- TypeScript everywhere: web app, shared core package, companion CLI.
- Static web app, data in the browser (IndexedDB) synced to the user's storage: JSON tables or a SQLite file (user's choice); server databases later.
- Details in `docs/30-architecture.md`.

## Commands

None yet. Add build, test, and lint commands here when the code exists.
