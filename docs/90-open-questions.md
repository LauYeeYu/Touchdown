# 90 Open Questions

Questions that need an answer from the user (or a check during implementation). Docs refer to them by id. When one is answered, record the answer here, update the affected docs, and change the requirement status in [00](00-requirements.md).

## Blocking phase 1

None. Phase 1 test data is in `data/private/`.

## Blocking later phases

| Id | Question | Phase | Proposed default |
|----|----------|-------|------------------|
| Q-SERVER-DB | For the later server backends (Postgres / Supabase, Cloudflare D1): does each user bring their own instance, or does the owner host one for friends (their data would then sit in the owner's account)? | Later | Each user brings their own. |
| Q-PHOTO-PICKER | Use the Google Photos Picker to fill a sighting's date and time from a photo? (Google does not provide the photo's location.) | Later | Not in the first version. |

## Implementation checks (not for the user)

| Id | Check | Phase |
|----|-------|-------|
| Q-FR24-IMPORT | Does myFR24 import accept fewer than 19 columns? Must airline names match FR24's names exactly? Test with a 2-row file. | 7 |
| Q-DRIVE-CLI | With the `drive.file` scope, does a file the CLI creates through its own OAuth client (installed-app type, same Google Cloud project as the web client) show up for the web app's token? If not, the web app must create the inbox folder and the CLI must be given access to it. Test before building the inbox upload. | 3 |
| Q-DRIVE-QUOTA | Recheck Google's announced 2026 Drive API quota and charge changes before launch. | 3 |

## Answered

| Id | Question | Answer |
|----|----------|--------|
| — | Where does the app run? | Hosted web app; each user's data in storage they own. |
| — | Who uses it? | The user and some friends; data private per user. |
| — | Storage format? | JSON files in the user's Google Drive; other sync methods pluggable; CSV fallback. Superseded by the generic schema decision below. |
| — | Where does the agent check run? | Local companion CLI. |
| — | How to count aircraft? | Once per airframe. |
| — | Language? | TypeScript everywhere. |
| — | Trace export scope? | Single flight, date range/year, all flights. |
| — | "Pull the CSV for the flight"? | The recorded track (CSV/KML), great circle when missing. |
| — | Photos? | Stay in Google Photos; optional link; app does not serve images. |
| — | Livery? | `specialLivery` is for special liveries and stickers only. Regular variants (e.g. an airline's alternate standard colour schemes) go to `livery`. |
| — | IATA or ICAO codes? | Both. |
| Q-NAMING | How should aircraft models be named? | Store the standard manufacturer form; display style is a setting (standard `Boeing 777-322(ER)` or compact `B777-322ER`); accept both on input. |
| Q-TIMES | What are "Departure Time" and "Landing Time" in the flight log spreadsheet? | Follow Flightradar24: takeoff (FR24 "ATD") and touchdown (FR24 "Landed"), in local airport time. Confirmed by Q-FR24-TIMES. |
| Q-COUNTRY | What is "Country" in the spotting spreadsheet? | Registration country. Derived from the registration prefix, not stored. |
| Q-SIGHTING-UNIT | Is one aircraft photographed several times at one place on one day one sighting? | Yes. |
| Q-FR24-TIMES | Are myFR24 export times local or UTC, takeoff or gate? | Local airport time; "Dep time" = takeoff, "Arr time" = touchdown. Checked against FR24 track files: within 1 minute. The flight log spreadsheet uses the same values. |
| Q-LOOKUP | Lookup service or no server? | Cloudflare Worker. The owner will set API keys as Worker secrets; keys are not shared in chat. |
| Q-BUDGET, Q-FR24-SUB | Paid data? FR24 subscription? | No paid source in the app. A user might have an FR24 subscription (Silver 90 days, Gold 365 days, Business 3 years of track downloads) and use it for manual track downloads. |
| Q-LICENSES | OpenSky DB and tar1090-db for the airframe index? | Acceptable; no need to ask the maintainers. |
| Q-FIRST-FLIGHT | Exact first flight dates can be read automatically only with a site's permission or paid data. Ask or pay, or keep the paste flow? | Keep the paste flow ([13](13-reference-data.md), "Airframe facts"). |
| Q-FR24-MONTH | Store FR24's age month (a month, not a day), for example as a first-flight month column? | No. A first flight date is stored only when the exact day is known; FR24's month is used only as a loose check (it is not always the first flight). |
| Q-FR24-BROWSER | Read Flightradar24 aircraft pages through the user's own signed-in Chrome (remote debugging), although FR24's terms allow only a human-operated browser? | Yes, as an opt-in CLI option (`--fr24`) for the user's own lookups, slow and cached, stopping at any bot check. Airfleets, aviation.flights and planespotters are not read this way. |
| Q-SPOT-AIRLINE | When a lookup fills a sighting's airline and Flightradar24 names both an airline and a different operator (a regional company flying in a larger airline's colours), which one is the sighting's airline? | The airline whose colours the aircraft wears (FR24 "AIRLINE"). The operating company goes to the agent as a note. |
| Q-SHEET-LAYOUT | Should importing depend on the owner's spreadsheet layouts? | No. Any spreadsheet is read through a column mapping worked out from headers and values; the user confirms unclear columns; the agent helps only with unclear columns, and only when one is chosen. The owner's two fixed readers were removed once the general reader gave the same result on both sheets. |
| Q-STORAGE-ANY | Should features rely on Google Drive? | No. Drive is the first storage backend, not the only one. Sync, the CLI's inbox, the agent check hand-off and anything added later go through the backend interface, so they work on every backend (S7). |
| Q-AGENT-DEFAULT | Is an agent used by default? | No. The first run of `spot` or `check` asks, with no agent as the default; `./touchdown agent` changes it. |
| Q-SPOT-LIVERY | When the log has an aircraft in a special livery, is a new sighting of it filled with that livery? | No, the user is asked each time (spot, quick add, session add), since special liveries are painted over. Records already in the log that lack a livery the aircraft surely wore are found by C-LIVERY-MISSING, with a fix. |
| Q-SPOT-ARRIVAL | How do sightings typed with `touchdown spot` reach the web app? | They wait for review: a bar and a list on the Import page, then Import. On the hosted site they travel through the inbox in the user's storage, whatever the backend (with Google Drive, the CLI signs in to Google once and uploads each session). |
| Q-PLANNED | Planned (future) flights? | Not supported. |
| Q-MOBILE | Phone support? | Web app in Chrome on Android. No iOS support needed. |
| Q-MODELS | Track die-cast models? | No. Misc is a note to the user; import it as notes. |
| — | How are times stored? | Always as a full date-time with UTC offset; never a time alone. Plain dates only where only the day is known. |
| — | How generic is storage? | One structured schema for every backend; Drive backends JSON tables or SQLite file (user chooses); later local SQLite, Postgres / Supabase, Cloudflare D1. |
| — | Spelling? | UK English in copy, docs, and comments. |
| — | Type and colour constraints for the interface? | Sans-serif only; keep the warm paper ground #FAF8F1 (white acceptable, not preferred); support dark mode. |
| Q-AGENT-FLAGS | Does Claude Code `--json-schema` work with all tools disabled? Which Codex features must be disabled? | Claude Code 2.1: the answer comes through the `StructuredOutput` tool, so `--disallowedTools "*"` blocks it; use `--tools "" --allowedTools StructuredOutput`. Codex 0.156: turn off every feature that is on except a short list of plumbing features; with that, structured output and stdin work. Details in [22](22-agent-verification.md). |
| Q-ACCESS | How is the hosted site gated? | Cloudflare Access: allowlist of invited emails; sign in with Google or a one-time email code; the Worker also checks the Access token on `/api/*`. |
