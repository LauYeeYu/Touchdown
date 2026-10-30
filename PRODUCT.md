# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

Responsive web app, installable as a PWA. Targets Chrome on desktop and Android. iOS is not a target.

## Stack

React + Vite, TypeScript everywhere (web app, shared core package, companion CLI). Deployed as one Cloudflare Worker with static assets: the built app plus the `/api/*` lookup service. Details in `docs/30-architecture.md`.

## Users

- Primary: the owner, an aviation enthusiast who both flies as a passenger and photographs aircraft (spotting). Job: keep one accurate record of every aircraft flown on and every aircraft photographed, and explore statistics about both.
- Secondary: a few friends with the same hobby, each using their own account and storage. Each user's data is private. The only sharing is the links a user makes to a flight, a sighting, an aircraft or the whole log; there are no other social features.

## Product Purpose

Touchdown records flights the user has flown on and aircraft the user has photographed, links both to the physical aircraft involved, and turns the log into statistics, maps, and exportable track figures and videos, similar to my.flightradar24.com and Flighty but covering spotting too.

Success: the owner retires their spreadsheets and trusts the numbers, because every entry is checked and every aircraft is counted once.

## Positioning

- **Flown and spotted in one log.** Flights and sightings share one aircraft identity, so the app can show, for example, aircraft the user both flew on and photographed.
- **Airframe-level accuracy.** Aircraft are counted as physical airframes (manufacturer serial number), not registrations; registration reuse and type mistakes are caught.
- **The user owns the data.** Data lives in the user's own storage (Google Drive first, as JSON tables or a SQLite file), defined by one structured schema, always exportable.
- **Spotter-grade statistics.** Flexible pivots (families by airline, by location, special liveries) beyond flight-tracker summaries.
- **Web and Android.** Flighty supports neither; Touchdown runs in any modern browser, including Chrome on Android.

## Operating Context

- Sightings are often logged on a phone at the airport, during spotting sessions that can include more than 100 aircraft.
- Imports, review of findings, and statistics happen mostly on a desktop browser.
- Existing data comes from a my.flightradar24.com CSV export and personal spreadsheets; recorded tracks come from FR24 track files the user downloads, and from free sources where available.
- Photos stay in Google Photos; the app stores optional share links only.
- An optional verification step runs Claude Code or Codex on the user's own computer through a companion CLI.

## Capabilities and Constraints

- Every field is optional; checks never block saving. Automatic fixes keep the raw input.
- Every precise time is stored as a date-time with UTC offset, never as a time alone.
- Airlines and airports are stored and accepted as both IATA and ICAO codes.
- Only flown flights are logged; no planned or future flights.
- The app does not store or serve photos.
- The hosted site is gated: only invited users who authenticate can reach the app or its API.
- Ticket numbers and booking references are private fields, excluded from exports by default and never sent to the lookup service or the agent check.
- Agent verification is advisory only: no tools, no network, user approves every suggestion.
- my.flightradar24.com has no API; import and export are manual CSV files.
- Full requirements and decisions: `docs/00-requirements.md` through `docs/40-roadmap.md`.
- Open: who hosts later server database backends (Q-SERVER-DB); whether to use the Google Photos Picker (Q-PHOTO-PICKER). See `docs/90-open-questions.md`.

## Brand Commitments

- Name: **Touchdown** (final).
- Voice: plain and direct wording, no mannered or decorative prose. This is the owner's stated preference for everything written for the product.
- Spelling: UK English in all product copy and docs.
- Punctuation: a semicolon only where nothing else will do, which is almost never. Split the sentence in two, join the parts with "and", "but" or "so", or separate the parts of a line with a middle dot (·). This holds for everything the site shows, its privacy policy and terms included.
- Wording: avoid sentences, headings and labels that open with "What", "Who", "Where" or "How" ("What you add is saved…", "Who is it for?", "What the checks will say"). Name the thing instead ("Anything you add is saved…", "The person's name", "Checks"). Use one only when nothing else reads as plainly, such as a real question the user is asked.
- Type: Source Sans 3 (sans-serif) for every role, and no serif faces in the interface.
- Ground: the warm paper colour #FAF8F1 stays as the light-theme page background (plain white is acceptable but not preferred).
- Themes: light and dark, following the device by default.
- App icon: an airliner touching down over a gold ground line, on the ink tile (DESIGN.md, "App icon"). No other logo rules exist yet.

## Evidence on Hand

- Planning docs in `docs/`.
- The owner's real data (myFR24 export, spreadsheets snapshot, recorded tracks) is in `data/private/`, git-ignored. It is for local testing only and must never appear in committed files, screenshots, demos, or public pages.
- There are no users beyond the owner yet, no testimonials, no usage metrics, no press. Do not fabricate any.

## Product Principles

1. **One aircraft, one identity.** Every flight and sighting resolves to a physical airframe; totals count airframes.
2. **Check, never block.** Accept incomplete data, flag what looks wrong, and let the user decide.
3. **The user owns the data.** User-chosen storage, one open schema, full export, private by default.
4. **Quick capture, deep review.** Logging at the airport on a phone takes seconds; analysis and cleanup get the full desktop view.
5. **Honest numbers.** Every statistic says what it counted and what it left out.
