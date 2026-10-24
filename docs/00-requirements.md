# 00 Requirements

This doc is self-contained. The original source documents will not stay available, so their content is copied here and in [01](01-existing-data.md).

Sources:
- **Doc**: the user's original requirement notes (four sections: General Requirement, Photos, History, Importing prompts). Full text in [Appendix A](#appendix-a-original-requirement-notes).
- **Chat**: answers given in the planning conversation. Recorded in [90](90-open-questions.md) under "Answered".
- **Sheet**: the user's two spreadsheets (a flight log and a spotting log). Structure, notes, and summary numbers are in [01](01-existing-data.md).

Status values: **Decided** (stated or confirmed by the user), **Proposed** (suggested in these docs, not yet confirmed), **Open** (needs an answer; see [90-open-questions.md](90-open-questions.md)).

## Scope

| ID | Requirement | Source | Status |
|----|-------------|--------|--------|
| G1 | Record flights the user has flown on. | Chat | Decided |
| G2 | Record aircraft the user has photographed (sightings). | Chat | Decided |
| G3 | Statistics comparable to my.flightradar24.com and Flighty. | Chat | Decided |
| G4 | Collect as many fields as possible, but every field is optional. Missing data must not block saving. | Chat | Decided |
| G5 | Import the existing data: FR24 CSV export, the flight log spreadsheet, the spotting spreadsheet. | Chat | Decided |
| G6 | Code in TypeScript (web app and companion CLI). | Chat | Decided |
| G7 | Store both IATA and ICAO codes for airlines and airports; accept either on input. | Chat | Decided |
| G8 | Every precise time is recorded as a date-time (date + time + UTC offset), never as a time alone. Avoids filing a takeoff after midnight under the previous day. | Chat | Decided |
| G9 | UK English spelling everywhere: interface copy, docs, and code comments (colour, organise, centre, licence as a noun). Third-party names keep their own spelling. | Chat | Decided |
| G10 | Light and dark themes. The default follows the device; the user can pick light or dark. | Chat | Decided |

## Users and storage

| ID | Requirement | Source | Status |
|----|-------------|--------|--------|
| U1 | Several users (the owner and friends). | Chat | Decided |
| U2 | Each user's data is private. The only sharing is the links a user in Standard mode makes (U6); no other social features. | Chat | Decided |
| U3 | The hosted site is gated: nobody reaches the app, its pages, or its API without authenticating, and only invited users are let in. The one exception: a public share link (U6) opens without sign-in and shows only that link's content. | Chat | Decided: Cloudflare Access (Q-ACCESS); public links (Q-SHARE-AUDIENCE) |
| U4 | Three data modes: Standard (recommended; Touchdown's server keeps a key to the user's storage), Private (no key on the server, no sharing) and Local (this browser only). Users can switch at any time. | Chat | Decided (Q-MODES) |
| U5 | Before Standard mode is turned on, terms say that Touchdown will have access to the user's storage and how it protects the data; the acceptance is recorded. | Chat | Decided |
| U6 | In Standard mode a user can share links to one flight or sighting, an aircraft, statistics for a period, or the whole log. The sharer chooses per link who can open it: chosen invited users, every invited user, or anyone with the link. | Chat | Decided (Q-SHARE-SCOPE, Q-SHARE-AUDIENCE) |
| U7 | The first run asks for the mode, with Standard preselected. Declining its terms leads to Private or Local; Local warns that the log can be lost. | Chat | Decided (Q-MODE-DEFAULT) |
| S1 | Think through how data is stored. | Doc | Done in [12](12-storage-and-sync.md) |
| S2 | Data syncs across a user's devices. | Chat | Decided |
| S3 | Each user's data lives in storage the user owns (Google Drive first), not in a central database. | Chat | Decided |
| S4 | First backends in the user's Drive: JSON tables or a SQLite file, chosen by the user. | Chat | Decided |
| S5 | Each user can pick their own sync method. CSV import/export is the fallback that always works. | Chat | Decided |
| S6 | Storage is generic: one structured schema (typed, flat tables) for every backend, so database backends (local SQLite, Postgres / Supabase, Cloudflare D1) can be added later without changing the data model. | Chat | Decided |
| S7 | No feature depends on one storage backend. Google Drive is the first backend, not the only one: sync, the CLI's inbox, the agent check hand-off and anything added later work on every backend. | Chat | Decided (Q-STORAGE-ANY) |
| S8 | The storage backend is recorded, in the user's settings and, in Standard mode, on the server, and these records are ready for new backends and for moving between them. | Chat | Decided (Q-BACKEND-FIELD) |

## Aircraft identity

| ID | Requirement | Source | Status |
|----|-------------|--------|--------|
| I1 | One aircraft identification system. Every flight and sighting is linked through it. | Doc (Photos) | Decided |
| I2 | Tolerate one registration being used by different aircraft over time. | Doc | Decided |
| I3 | Answer: is registration + type code enough to identify an aircraft? Answer: no. See [11](11-aircraft-identity.md). | Doc | Proposed |
| I4 | "Number of aircraft" counts physical airframes. An airframe seen under two registrations counts once. | Chat | Decided |

## Data entry, filling, checking

| ID | Requirement | Source | Status |
|----|-------------|--------|--------|
| D1 | Automatic consistency check, e.g. the same aircraft recorded with different type codes. | Doc | Decided |
| D2 | Sanity check every time data is entered. | Doc | Decided |
| D3 | Use standard aircraft type naming, like the one Flightradar24 uses. | Doc (Importing prompts) | Decided |
| D4 | The model is stored once in the standard manufacturer form (e.g. Boeing `777-322(ER)`). The display style is a setting: standard (`Boeing 777-322(ER)`) or the sheet's compact house style (one-letter manufacturer prefix, no spaces, no parentheses: `B777-322ER`). Input in either style is accepted. | Sheet (note column), Chat | Decided |
| D5 | Automated filling: fill missing fields from known data and external sources. | Doc | Decided |
| D6 | Connect to an API or website to pull information automatically. | Doc | Decided |
| D7 | Special livery field. Only real special liveries and stickers go there; regular livery variants (e.g. an airline's alternate standard colour schemes) go to a separate `livery` field and are not counted as special. | Doc, Chat | Decided |
| D8 | Imports go through a round of checking before they are saved. | Doc | Decided |
| D9 | The user can choose Claude Code or Codex to verify imports. | Doc | Decided |
| D10 | Minimise the risk that the agent causes harm. | Doc | Decided |
| D11 | The agent check runs through a companion CLI on the user's own computer. | Chat | Decided |

## Photos

| ID | Requirement | Source | Status |
|----|-------------|--------|--------|
| P1 | Summary page: number of aircraft, airlines, plane families, type codes, special liveries; most frequent airline, family, type code. | Doc | Decided |
| P2 | Flexible statistics beyond the summary, e.g. families by airline. | Doc | Decided |
| P3 | Photo files stay in Google Photos. The app does not store or serve images. A link to the photo is optional. | Chat | Decided |

## Flight history

| ID | Requirement | Source | Status |
|----|-------------|--------|--------|
| F1 | Work with my.flightradar24.com export and import. | Doc | Decided |
| F2 | Get the recorded track (CSV/KML) for each flight. Draw a great-circle path when no track exists. | Doc, Chat | Decided |
| F3 | Adding a flight must be quick. | Doc | Decided |
| F4 | Export the path as a figure and as a video, for a single flight, a date range or year, and all flights. | Doc, Chat | Decided |

## Out of scope (for now)

- Hosting or serving photos.
- Social features beyond share links: friend lists, feeds, public profiles (U2).
- A native mobile app. The web app must work in Chrome on Android. iOS is not a target. (Decided)
- Planned (future) flights. Only flights already flown are logged. (Decided)
- Tracking a die-cast model collection. The sheet's Misc column is only a note to the user. (Decided)

## Appendix A: Original requirement notes

The user's notes, copied word for word. Each line is mapped to the requirement ids above.

### General Requirement

| Original text | Requirement |
|---------------|-------------|
| Needs automatic consistency check (the same aircraft but has wrong or mismatched type code) | D1 |
| Needs to tolerate the same registration number but different aircraft | I2 |
| Is registration + type code good enough for identifying an aircraft? This is the unique aircraft identifier | I3 |
| Needs automated filling system that can help fill the table | D5 |
| Needs to connect to some API or website to pull the information automatically | D6 |
| Fields (special livery) | D7 |
| When importing, it needs to be able to do a round of checking. Let user choose whether to use the claude code or codex to do verification. Be careful about the potential threat brought by the agent, and try to minimise it. | D8, D9, D10 |
| Consider about the way of storing data. | S1 |
| Whenever the new data is entered, it should have some sanity check. | D2 |

### Photos

| Original text | Requirement |
|---------------|-------------|
| All information should go through the unique aircraft identification system | I1 |
| Needs to have: Summary page: Number of aircraft, airlines, plane families, type codes, special liveries; Most Frequent Airlines/aircraft family/type code | P1 |
| Other flexible way of doing statistics, including families by airlines, … | P2 |

### History

| Original text | Requirement |
|---------------|-------------|
| Be able to connect to the my.flightradar24.com export and import system | F1 |
| Needs to pull the csv information for the flight (use great circle track by default) | F2 |
| Easy to add | F3 |
| Export the trace (video and figure) | F4 |

### Importing prompts

Rules the user wants given to the agent during import checks ([22](22-agent-verification.md)). This list is expected to grow; it is the starting rule until the user keeps rules of their own with the CLI (`touchdown agent rules`).

1. The aircraft type is not standard. Please use a standard one (like the one on flightradar24).
