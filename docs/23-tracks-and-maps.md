# 23 Tracks and Maps

Flight paths: great circles, recorded tracks, and exported figures and videos (requirements F2, F4).

## Great circle (default)

- Used for every flight without a recorded track.
- Distance: haversine with mean Earth radius 6,371.0088 km. The error against an ellipsoid is under 0.5%, which is below the spread already in the user's data. Derived, not stored (unless the user sets `distanceKmOverride`).
- Drawing: interpolated points along the great circle (d3-geo `geoInterpolate`), about one point per 50 km. The projection code splits lines at the antimeridian (e.g. NRT–LAX).
- Diverted flights use `from` → `divertedTo`.

## Recorded tracks

A recorded track replaces the great circle in maps and exports. Its own distance is stored on the Track (`tracks.distanceKm`) and shown next to the great-circle distance.

### Sources, in order of preference

1. **File upload.** The user uploads a track file for a flight:
   - FR24 CSV: `Timestamp,UTC,Callsign,Position,Altitude,Speed,Direction`, where Position is `"lat,lon"`, altitude is in feet, speed in knots.
   - FR24 KML, or any KML/GPX with a time-stamped line.

   Built: on the flight's page (Add track; once it has one, Track › Replace with a track file, or Remove the track) and with `touchdown track REF FILE` or `--remove` ([34](34-command-line.md)). The file is read in core (`readTrackFile` in `packages/core/src/tracks.ts`): an FR24 CSV; an FR24 KML trail (placemarks with a time and a point, altitude, speed and heading from each one's description) or any KML with a `gx:Track`; GPX track or route points with a time (elevation in metres, speed in metres a second). A line without times is not read. Before anything is saved the track is checked against that flight (`fitTrack`): its times must fall on the flight (between takeoff and landing when both are known, else on the flight's day, give or take one), it must run from the departure towards the arrival, and a fragment too short to draw is refused; each refusal says why. A track whose ends are within 30 km of the airports is complete, otherwise partial. The page shows what the file holds (points, distance, times, source, the track it replaces) and saves it only when the user confirms. Either way the track is saved as a one-change import (`track` or `removeTrack`, [34](34-command-line.md), "Change files"), so the import history can undo it, the replaced track's points included. Simplified to at most 2,000 points, as every track is.
2. **adsb.lol history** (automatic, free, from 2023-02-16, thin until March 2023; [13](13-reference-data.md)). See below.
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

A background job checks every flight since 2023-02-16 that has a registration and no track. It runs slowly (one trace request every few seconds), goes through the lookup service cache, and can be paused. The user sees found / partial / not found per flight.

Built in the CLI as `touchdown tracks` ([34](34-command-line.md)), from adsb.lol's daily GitHub releases (adsb.lol's per-file server now answers scripts with a bot check, [13](13-reference-data.md)):

- The aircraft's hex code: the log's (`registration_periods.icaoHex`), else the FAA's scheme for a US N-number (`nNumberIcao` in core), else the OpenSky database's row for the registration (the one with the airframe's serial number, else the one registered on that day, else the newest).
- The UTC days: takeoff − 3 h to landing + 3 h; without times, the flight's day at the departure airport and the day after.
- A day's release is a tar of every aircraft's trace that day, in 256 folders by the last two hex digits, in a different order every day; each file is gzipped on its own. Small reads (64 KB, 4 MB apart, eight at a time) find the aircraft's folder, a bisection finds where it starts, and only that folder is read through: 10 to 60 MB and 50 to 800 requests a flight instead of 1.5 to 3.5 GB. The code is `packages/cli/src/providers/adsblol.ts`.
- The flight is cut out of the day's traces (`trackFromReadsb` in core): legs end where the aircraft was on the ground, where readsb marks a new leg, or at a gap it could not have flown through; a gap over an ocean flown at speed stays in the leg. Each leg is checked as an uploaded file is (`fitTrack`); a complete one wins, else the partial one with the most points.
- The tracks found go to the inbox as `track` changes, reviewed and imported as one undoable import. The flights without one are listed with the reason and remembered on that computer (`data/private/cache/adsblol/flights.json`), so the next run does not ask again unless `--refresh`. The traces read and each day's map of folders are kept in `data/private/cache/adsblol`, a few hundred kilobytes a flight.

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
- Flights: tracks or great circles, filterable by year, airline, type. Line weight by how often a route was flown.
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
