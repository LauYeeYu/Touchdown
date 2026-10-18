---
version: 1
slug: "prototype-index-html"
primary_target: "prototype/index.html"
related_targets: []
---

# Surface brief: web app prototype (Home, Flights, Flight detail)

## Scope and mode

Operate. Clickable prototype of three views of the Touchdown web app: Home, Flights list, Flight detail. Synthetic sample data only, labelled as sample. Desktop browser and Chrome on Android.

## Audience and task

The owner (and friends) reviewing their own log: what this year looked like, finding a flight, reading one flight in full. Each view has one main subject; supporting context sits below it, never a wall of panels.

## Constraints

- Owner's references: two personal sites they built (a lab site: white page, system sans, narrow column, hairline rules, one blue tag; a photo gallery: warm paper ground #FAF8F1, serif, rounded photo cards with a tinted caption block) plus Google statistics pages (one leading figure, range chips, a quiet key-value grid). Adapt the blog feel to a statistics product.
- Owner's later decisions: sans-serif only; keep #FAF8F1; support dark mode; UK English copy; the period selector must not change width when the selection changes (Material 3 segmented buttons as a loose reference).
- Owner's answers: reference photos from planespotters.net with photographer credit and link; avoid "too bare": keep useful context visible.
- Every date-time shown with its date; IATA and ICAO both available.
- No personal data in the prototype; sample data is invented around real public aircraft.

## Direction contract

THESIS: Each view states its main point as a written sentence, the owner's blog voice, with the figures inside it, and puts one subject at full size under it: the year's map on Home, the route on a flight, the period's routes on Flights. Refuses the KPI-tile grid and the FR24 panel wall.

OWN-WORLD: Warm paper ground #FAF8F1 (owner chose it over white), a slightly deeper paper band for the header; ink #1F1D1A. One family: the system sans for everything, display weight 650 with tight tracking for the lead sentence, route codes and section titles; tabular figures for data. Two data inks and nothing else in colour: flown blue #2B6CB8, spotted orange #D0742A (dark theme: #4F92E0, #D4773A on #171613, validated); status only with icon and word. Hairline rules #E4DFD3. Aircraft appear as credited photo cards with a tinted caption block, 12px corners. Period selection is an outlined segmented control with a check on the selected segment and constant width. Light and dark themes, following the device by default.

STORY: The visitor reads one sentence and knows the year, the period, or the flight; points at a phrase to see its part of the map or its aircraft; drops to context (most recent, flown and photographed, month by month, the flight list) only if they want more.

FIRST VIEWPORT: Home: header band (wordmark, nav, sync state, theme, Add), the period control, the lead sentence at display size, then the world map at full width cropped to the period's latitudes: blue great-circle arcs, orange spotting dots. Flight detail: big route codes with an arc between them, then the date line, the lead sentence, the track map at full width, and the times strip with dated local times.

FORM: Pinned by the owner's references; the owner-pinned direction beats the roll (seed:b4c6fe3264f051f5). Signature move: phrases in the lead sentence carry a 2px underline in their data ink. On Home a phrase highlights its map layer (arcs, spots, or both); on Flights a route phrase highlights that route's arcs and rows; on a flight the phrases point at the aircraft card (scroll and a brief highlight), because the flight map has no layers to isolate.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

## Unresolved

- Spotting, Aircraft, Stats views are not in this prototype.
