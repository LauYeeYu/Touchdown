# 23 Tracks and Maps

Flight paths: great circles, recorded tracks, and exported figures and videos (requirements F2, F4).

## Great circle (default)

- Used for every flight without a recorded track, except where the airline could not use airspace on it that day: then the drawing goes around it (see "Closed airspace").
- Distance: haversine with mean Earth radius 6,371.0088 km. The error against an ellipsoid is under 0.5%, which is below the spread already in the user's data. Derived, not stored (unless the user sets `distanceKmOverride`).
- Drawing: interpolated points along the great circle (d3-geo `geoInterpolate`), about one point per 50 km. The projection code splits lines at the antimeridian (e.g. NRT–LAX).
- Diverted flights use `from` → `divertedTo`.

## Closed airspace

Decided. Since 2021 and 2022 some airlines may not fly over Russia, Belarus or Ukraine, so a great circle across them is not a route their flights could have taken. Where a map draws a stretch nothing recorded (a flight's great circle, the dashed stretches of a partial track), a flight of an airline barred from an area on the flight's day is drawn around it.

| Airspace | From | Closed to |
|----------|------|-----------|
| Russia | 2022-02-28 | airlines of the EU, the UK, the US, Canada, Norway, Iceland, Switzerland, Albania, Montenegro and North Macedonia |
| Belarus | 2021-06-05 | airlines of the EU, the UK, Norway, Iceland and Switzerland |
| Ukraine | 2022-02-24 | all civil flights |

- The airline is the one that flew the flight (`operatingAirlineId`), else the one that sold it; its country comes from the reference table of operators. The closures and the routing are in core (`packages/core/src/geo/airspace.ts`); the outlines are Natural Earth's (world-atlas, as the maps draw), passed in by the web app (`apps/web/src/lib/airspace.ts`).
- The way round is the shortest path through fixed points on the corridors those airlines use (the Black Sea, the Caucasus, the Caspian, Central Asia and Mongolia; the Baltic west of Kaliningrad, and west of Belarus and Ukraine; the Arctic and the Bering Sea), each leg a great circle at least about 40 km from a closed border, or, where that leaves no way (an airport near a border), clear of it at all. A test checks that a way is found for long-haul pairs between Europe or North America and Asia. It is drawn as the great circle is, solid when the flight has no track and dashed for a gap; the flight page's legend says "Shortest way around closed airspace". It is a drawing, not a route flown: the great-circle distance stays the flight's distance.
- The outlines are rasterised to a grid of 0.25° cells, so a test is one lookup, and each way is worked out once per map. A ring that crosses the 180th meridian (Chukotka) is unwrapped past it first; read as it is written, its edges would span the whole map and fill a band of latitudes.

## Recorded tracks

A recorded track replaces the great circle in maps and exports. Its own distance is stored on the Track (`tracks.distanceKm`) and shown next to the great-circle distance.

A track has gaps where nothing was received: the stretch from the departure to its first point, from its last point to the arrival, and inside it wherever nothing came for over 10 minutes and 100 km (stored tracks keep a point every few minutes at most, so only a gap is that long; oceans, Central Asia, China). Maps draw the recorded stretches solid and the gaps dashed, as great circles or around closed airspace.

### Sources, in order of preference

Decided: recorded tracks come from files the user adds, a Flightradar24 download first (its tracks are the most complete, oceans and China included). The download is manual. adsb.lol is a fallback the user asks for, never a default.

1. **File upload.** The user uploads a track file for a flight:
   - FR24 CSV: `Timestamp,UTC,Callsign,Position,Altitude,Speed,Direction`, where Position is `"lat,lon"`, altitude is in feet, speed in knots.
   - FR24 KML, or any KML/GPX with a time-stamped line.

   Built: on the flight's page (Add track; once it has one, Track › Replace with a track file, or Remove the track) and with `touchdown track REF FILE` or `--remove` ([34](34-command-line.md)). The file is read in core (`readTrackFile` in `packages/core/src/tracks.ts`): an FR24 CSV; an FR24 KML trail (placemarks with a time and a point, altitude, speed and heading from each one's description) or any KML with a `gx:Track`; GPX track or route points with a time (elevation in metres, speed in metres a second). A line without times is not read. Before anything is saved the track is checked against that flight (`fitTrack`): its times must fall on the flight (overlapping takeoff to landing, with 3 hours' room on each side for a delay or a timetable time in the log, when both are known; else on the flight's day, give or take one), it must run from the departure towards the arrival, and a fragment too short to draw is refused; each refusal says why. A track whose ends are within 30 km of the airports is complete, otherwise partial. The page shows what the file holds (points, distance, times, source, the track it replaces) and saves it only when the user confirms. Either way the track is saved as a one-change import (`track` or `removeTrack`, [34](34-command-line.md), "Change files"), so the import history can undo it, the replaced track's points included. Simplified to at most 2,000 points, as every track is.
2. **adsb.lol history** (free, only when the user asks, to fill gaps; from 2023-02-16, thin until March 2023; [13](13-reference-data.md)). See below.
3. **AeroAPI** (automatic, last 10 days, only if the user set a key).
4. Nothing found: keep the great circle and record "no track found" with the date checked, so it is not retried every time.

### Matching an adsb.lol trace to a flight

adsb.lol stores one trace per aircraft (by ICAO hex) per UTC day. A day trace contains every flight that aircraft made that day.

```
1. Get the hex: from the airframe's RegistrationPeriod for the flight date,
   else from the lookup service. No hex -> stop (no track).
2. Time window: departure − 3 h to arrival + 3 h in UTC. If times are unknown,
   use `scheduledDate` from 00:00 local to the end of the next day.
3. Fetch the trace for every UTC date the window touches (overnight flights need two).
4. Split the trace into legs: a new leg starts after the aircraft is on the ground
   or after a gap of more than 30 minutes.
5. Pick the leg that starts within 30 km of `from` and ends within 30 km of `to`
   (or `divertedTo`), and overlaps the time window.
   - Exactly one -> use it.
   - Several (e.g. a return-to-gate) -> the one closest to the expected times;
     mark it for review.
   - None -> try a looser match (start or end within 30 km, partial coverage over oceans),
     mark it "partial"; otherwise stop.
6. Simplify (Visvalingam–Whyatt) to at most 2,000 points, keeping takeoff
   and landing points. Store as tracks/<flightId>.json.
```

Each track records its provider, so exports can show "Track data: adsb.lol (ODbL)".

### Backfill

Decided: no background job. adsb.lol is read only when the user runs `touchdown tracks`, for the flights still without a track; nothing looks it up by itself, in the CLI or the web app. (Earlier plan, dropped: a background job checking every flight since 2023-02-16.)

Built in the CLI as `touchdown tracks` ([34](34-command-line.md)), from adsb.lol's daily GitHub releases (adsb.lol's per-file server now answers scripts with a bot check, [13](13-reference-data.md)):

- The aircraft's hex code: the log's (`registration_periods.icaoHex`), else the FAA's scheme for a US N-number (`nNumberIcao` in core), else the OpenSky database's row for the registration (the one with the airframe's serial number, else the one registered on that day, else the newest).
- The UTC days: takeoff − 3 h to landing + 3 h; without times, the flight's day at the departure airport and the day after.
- A day's release is a tar of every aircraft's trace that day, in 256 folders by the last two hex digits, in a different order every day; each file is gzipped on its own. Small reads (64 KB, 4 MB apart, eight at a time) find the aircraft's folder, a bisection finds where it starts, and only that folder is read through: 10 to 60 MB and 50 to 800 requests a flight instead of 1.5 to 3.5 GB. The code is `packages/cli/src/providers/adsblol.ts`.
- The flight is cut out of the day's traces (`trackFromReadsb` in core): legs end where the aircraft was on the ground, where readsb marks a new leg, or at a gap it could not have flown through; a gap over an ocean flown at speed stays in the leg. Each leg is checked as an uploaded file is (`fitTrack`, with its 3 hours' room around the logged takeoff and landing), and a leg flown under the flight's own callsign (the airline's ICAO code and the number, `DLH400` for LH400; the trace records the callsign) up to 12 hours, which still rules out the same flight number on another day. The leg under that callsign wins, else a complete one, else the nearest to the logged times (among partial legs, the one with the most points). A track that lies outside the logged times is still written, with a note saying how far off it is, so the user can check the flight's times at the review.
- The tracks found go to the inbox as `track` changes, reviewed and imported as one undoable import. The flights without one are listed with the reason and remembered on that computer (`data/private/cache/adsblol/flights.json`), so the next run does not ask again unless `--refresh`. The traces read and each day's map of folders are kept in `data/private/cache/adsblol`, a few hundred kilobytes a flight.

### Helping each other

Decided, built. Flightradar24's tracks are the best, and downloading them is manual, so a user without a subscription can ask someone who has one. The user sends them a short list of the flights without a recorded track:

- In the web app: the Flights page's "N without a track (CSV)" button, beside the filters. In the CLI: `touchdown export missing-tracks [--out FILE.csv]`. Both write the same CSV (`missingTracksCsv` in `packages/core/src/view/missing.ts`), of every year, oldest first.
- Columns: `Date` (the flight's local date), `Flight`, `From`, `To` (IATA, else ICAO), `Registration`, `Type`, `Takeoff (UTC)`, `Landing (UTC)`. Nothing private: no seat, ticket number, booking reference or notes. It is still the user's travel history, so sending it is their choice.
- The helper downloads the tracks by hand, within their source's terms (Flightradar24's are for them to check), and sends the files back. The user adds each on its flight's page (Add track) or with `touchdown track REF FILE`; each file is checked against its flight first.
- Nobody's log or account is shared: the helper sees only the list and returns only files.

### Plausibility checks on any track

- Starts and ends near the right airports.
- Timestamps fall on the flight date.
- No jumps faster than 1,200 kt between points (bad data).

Failures are findings, not silent drops.

## Maps in the app

- Desktop overview maps: Equal Earth, full width, cropped to the latitudes the period covers. The central meridian is chosen so the map's edge falls in the widest band of longitudes with no flights or spots, so routes such as trans-Pacific ones are never cut.
- Phone overview maps: a disc centred on the period's routes (an orthographic globe when they fit on one hemisphere, an azimuthal equal-area disc otherwise), cropped to the routes, so the map stays about as tall as it is wide instead of a thin world strip.
- Flight maps: an orthographic globe centred on the route.
- The interactive globe (Statistics, and the Map / Globe switch on flight and airport pages, [31](31-ui.md)): a canvas orthographic globe that can be turned and zoomed. A one-flight globe draws the whole recorded track; overview globes draw tracks cut to 400 points.
- Labels are placed so they never overlap each other, a marker, or the frame edge; a label that does not fit is dropped and stays available on hover.

- Drawn with d3-geo on Natural Earth land (world-atlas) as SVG, no map tiles.
- Flights: tracks (recorded stretches solid, gaps dashed) or great circles, around closed airspace where the airline could not use it, filterable by year, airline, type. Line weight by how often a route was flown.
- Airports: circles sized by visits.
- Sightings: spots and airports with aircraft counts.

## Export: figure

| Option | Values |
|--------|--------|
| Scope | single flight, date range or year, all flights (requirement F4) |
| Projection | auto (fit to the paths), world (Equal Earth), regional (conic), globe (orthographic) |
| Base map | Natural Earth land and borders (public domain), light or dark style |
| Lines | colour by airline, year, type, or one colour; recorded tracks drawn as recorded, others as great circles |
| Labels | airport codes (IATA/ICAO/none), title, date range, totals (flights, distance) |
| Size | 1920×1080, 1080×1080, 1080×1920, A4/A3 at 300 dpi, custom |
| Format | PNG, SVG |
| Privacy | never shows private fields; option to hide flight numbers and exact dates |

Rendered with d3-geo on canvas (PNG) or as SVG. No map tiles in exports, so there are no tile licensing limits.

## Export: video

| Mode | What it shows |
|------|---------------|
| Single flight | An aircraft marker moves along the track (or great circle). Optional readout of time, altitude, and speed when a recorded track exists. The view fits the route or follows the aircraft. |
| Date range / year | Flights appear in date order, each line drawn from origin to destination. A date ticker and running totals (flights, distance, airports). |
| All flights | Same as date range over the whole history. |

| Option | Values |
|--------|--------|
| Length | 5–120 s; time scale computed from the length |
| Frame rate | 30 or 60 fps |
| Size | same presets as figures |
| Format | MP4 (H.264) where the browser supports WebCodecs encoding; WebM otherwise |

Rendering runs in the browser: frames are drawn on a canvas and encoded with WebCodecs plus an MP4 muxer, with MediaRecorder (WebM) as fallback. Long or 4K renders can run in the companion CLI instead (`touchdown render`, node canvas + ffmpeg), using the same drawing code from the core package.

## Notes from testing the sources

- FR24 downloads give complete gate-to-gate tracks for flights inside the subscription's history window.
- adsb.lol gives complete tracks over the US and Europe; long oceanic flights only near the coasts (hours-long gaps over the ocean); almost nothing in regions with few community receivers, such as China. No traces were found for dates after mid-November 2025.
- Flights outside both sources stay on great circles unless the user uploads a file.

Matching lessons:
- Match on takeoff time within ±3 hours plus both airports; allow the date to be off by one (see the myFR24 Date rule in [21](21-import-export.md)).
- When the registration in the log does not match, search by flight number and date, then confirm by airports and times.
