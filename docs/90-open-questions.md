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
| Q-AGENT-FLAGS | Does Claude Code `--json-schema` work with all tools disabled? Which Codex features must be disabled in the installed version? | 5 |
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
| Q-PLANNED | Planned (future) flights? | Not supported. |
| Q-MOBILE | Phone support? | Web app in Chrome on Android. No iOS support needed. |
| Q-MODELS | Track die-cast models? | No. Misc is a note to the user; import it as notes. |
| — | How are times stored? | Always as a full date-time with UTC offset; never a time alone. Plain dates only where only the day is known. |
| — | How generic is storage? | One structured schema for every backend; Drive backends JSON tables or SQLite file (user chooses); later local SQLite, Postgres / Supabase, Cloudflare D1. |
