# Touchdown Plan

Touchdown is a personal log of aircraft flown on and aircraft photographed, with statistics similar to my.flightradar24.com and Flighty. These docs are the plan. No code is written until the plan is approved.

The docs are self-contained. The user's original requirement notes are copied in [00, Appendix A](00-requirements.md#appendix-a-original-requirement-notes), and the structure of the owner's old spreadsheets is in [01](01-existing-data.md). No external document is needed to read the plan. The docs contain no personal data; values from the owner's data are kept in `data/private/` (git-ignored).

## Reading order

Docs are numbered from low level to high level. Each one depends only on lower numbers.

| # | Doc | Layer | Contents |
|---|-----|-------|----------|
| 00 | [Requirements](00-requirements.md) | Input | Every requirement with an id, source, and status. |
| 01 | [Existing data](01-existing-data.md) | Input | The user's sheets and FR24 export, column mapping, issues found. |
| 10 | [Domain model and schema](10-domain-model.md) | Data | Every table, column, and type; one schema for all backends. |
| 11 | [Aircraft identity](11-aircraft-identity.md) | Data | Why registration + type code is not enough; how records link to airframes. |
| 12 | [Storage and sync](12-storage-and-sync.md) | Data | Generic backend interface, JSON tables and SQLite file backends, sync, migrations, adapters. |
| 13 | [Reference data](13-reference-data.md) | Data | Sources for airports, airlines, types, airframes, flights, tracks; licences and costs. |
| 20 | [Validation](20-validation.md) | Logic | Sanity and consistency rules, auto-fill. |
| 21 | [Import and export](21-import-export.md) | Logic | Import pipeline, myFR24 and sheet formats, exports, undo. |
| 22 | [Agent verification](22-agent-verification.md) | Logic | Claude Code / Codex check through the companion CLI; threat model. |
| 23 | [Tracks and maps](23-tracks-and-maps.md) | Logic | Great circles, recorded tracks, figure and video export. |
| 24 | [Statistics](24-statistics.md) | Logic | Metric definitions, pivots. |
| 30 | [Architecture](30-architecture.md) | System | Components, tech stack, repo layout, security, cost. |
| 31 | [UI](31-ui.md) | System | Pages and flows. |
| 32 | [Data modes and sharing](32-modes-and-sharing.md) | System | Standard, Private and Local modes, the terms, share links, what the server stores. |
| 40 | [Roadmap](40-roadmap.md) | Delivery | Phases and exit criteria. |
| 90 | [Open questions](90-open-questions.md) | Tracking | Unanswered questions and recorded answers. |

## Key decisions so far

- Hosted static web app. Each user's data lives in their own storage (Google Drive first), as JSON tables or a SQLite file, both from one structured schema. Server databases can be added later. CSV always available. No central database by default.
- Every precise time is a full date-time with UTC offset; never a time alone.
- UK English spelling. Sans-serif interface on a warm paper ground, with light and dark themes.
- Three data modes: Standard (recommended; the server keeps an encrypted key to the user's storage, for sync and share links), Private (no key on the server, no sharing) and Local (this browser only). Users can switch at any time.
- Private per user, except the links a user shares. Friends use the same app with their own storage.
- An aircraft is a physical airframe, identified by manufacturer + serial number. Registration is a dated attribute. Aircraft counts are per airframe.
- Every field is optional. Checks never block saving.
- The optional agent check runs Claude Code or Codex on the user's own computer, with no tools, and only produces suggestions.
- Recorded tracks where available (adsb.lol, uploaded FR24 files); great circle otherwise.
- TypeScript everywhere.

## Status markers

Docs mark statements as **Decided** (confirmed by the user), **Proposed** (suggested, not yet confirmed), or **Open** (listed in [90](90-open-questions.md)).
