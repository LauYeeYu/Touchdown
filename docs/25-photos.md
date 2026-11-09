# 25 Photos

The user's own photos of the aircraft they saw and flew on, kept as copies beside the log and shown in the app and on share links (requirement P3). Optional: a user who adds none sees no change.

## Decisions

| Decision | Status |
|---|---|
| Copies of the user's photos are kept in the log's storage (Google Drive first, and every other backend, S7), in a `photos/` directory beside the tables. Google Photos is no longer used once this is built. Links to photos elsewhere stay as links (`photo_links`). | Decided |
| Optional. A user who adds no photos sees no change: no `photos/` directory, no extra requests, and the pictures from planespotters.net as today. | Decided |
| Photos come in as an export from the user's photo software (Lightroom first) into a directory on their computer, which the CLI reads (`touchdown photos`). Each photo is matched to its sighting or flight. | Decided |
| The photos are assumed not to name their aircraft (Q-PHOTO-REG): the agent reads the registration off each photo. | Decided |
| Backups (daily copies and downloaded backups) hold the photos' rows, not their files. | Decided |
| A full storage stops writing and says so in a dialog, for every write, not only photos. | Decided |
| Cloudflare's Workers Paid plan ($5 a month) is accepted if share links' photos need it. | Decided |
| The originals stay in the photo software. Touchdown keeps a display copy and a thumbnail of each photo. | Proposed |
| The web app adds photos too (a phone's photos on a sighting), after the CLI. | Proposed |

## Getting photos in

### The export

Proposed. A saved export preset in the photo software, used for every session. For Lightroom Classic:

| Setting | Value | Why |
|---|---|---|
| Format | JPEG | Read everywhere. Touchdown makes its own copies from it. |
| Size | Long edge 2,048 px or more | Touchdown's display copy is 2,048 px. |
| Metadata | All, except location ("Remove Location Info") | The capture time places the photo, and the photo software's id recognises it when exported again. The location is not needed. |
| Directory | One directory for every export | `touchdown photos` reads it again and only adds what is new or re-edited. |

Lightroom Classic's Hard Drive publish service keeps such a directory up to date: new photos are exported, and an edited photo is exported again. Other photo software works the same way if it writes JPEGs with their capture time.

### `touchdown photos DIR`

Proposed. For each image in the directory:

1. **Read.** The capture time (`DateTimeOriginal` with `OffsetTimeOriginal`; without an offset, the clock time at the airport of that day's records, as [21](21-import-export.md), "Building date-times from clock times"), the photo software's id for the photo (Lightroom's `xmpMM:OriginalDocumentID`, the same in every export of one photo), keywords, title, caption and file name.
2. **Known already.** A photo whose id the log has is skipped, or its files replaced when it was edited since. Re-exporting never adds a second copy.
3. **The registration.** Photos are assumed not to name their aircraft (Q-PHOTO-REG), so the agent reads the registration off each photo, when the user allows that ([The agent](#the-agent)). A keyword, title, caption or file name that does read as a registration (core's registration rules) is used first, and saves that photo a call. Without the agent, the photo has none until the review.
4. **Matching.** To the sighting of that registration on the photo's day. Else to a flight on that aircraft that day. Else a new sighting is proposed, at the airport of that day's other sightings, filled from the lookups as `touchdown spot` fills one ([21](21-import-export.md), "Source: spotting session").
5. **Checks.** The lookups' type for the registration against what the agent saw (a registration read as an A350's on a photo of a 737 is a finding), and a photo whose capture time falls on another day than its record's.
6. **Files.** A display copy (long edge 2,048 px, about 0.3–0.6 MB) and a thumbnail (long edge 480 px, about 30 KB), JPEG, with every metadata field removed. Written to the storage's `photos/` directory first, through the storage interface.
7. **Inbox.** One file, `photos-<date>-<time>.json`, with the photo rows and any new sightings, reviewed on the Import page or with `touchdown review` like every inbox file. A photo with no registration or no match is listed in the review with that day's records to choose from, grouped with the photos taken just before and after it, so a burst of one aircraft is placed with one choice. The files of photos the review turns down are removed.

Why the CLI uploads the photos: the site's Google access is `drive.file`, so it sees only files Touchdown made ([12](12-storage-and-sync.md), "Google Drive details"). Photos that Google Drive for Desktop put into the Touchdown directory would be invisible to the app.

Images are read and resized with `sharp` (Apache 2.0, with libvips, LGPL, as a separate library, so Touchdown's licence is unchanged).

### The agent

Decided: the agent is the main way a photo's registration is found, since the photos are assumed not to name their aircraft (Q-PHOTO-REG). The rest is Proposed. The agent reads registrations as the agent check reads rows, on the user's computer ([22](22-agent-verification.md)):
- **Allowed by the user.** `touchdown agent photos on|off`, kept with the CLI's other agent settings; `--photos` for one run. The first `touchdown photos` at a terminal asks, with "no" as the default, since it sends the user's photos to the agent's company. When off, no photo is sent, and every photo is placed by hand at the review.
- **Bursts.** Photos taken less than 30 seconds apart are one burst, most often of one aircraft, and go in one call. The registration is often readable on only some of a burst's frames, so the agent answers each photo and may give a frame the registration it read on another, saying so.
- **Sent.** A copy 1,024 px on the long edge with every metadata field removed, and for each photo its capture time, its day's airport and the registrations of that day's records. Nothing else: no file names, no notes, no other records.
- **Answer.** For each photo, the registration read (or none), how sure it is, and the aircraft family it sees. These are suggestions, checked against the lookups and the day's records, and confirmed at the review.
- **Locked down** as the check is: no tools, the image passed in the request (Q-AGENT-IMAGES).
- **Cost.** Every photo goes to the agent. One call for up to 10 photos, so a day of 200 photos is about 20 calls, which the CLI says before it starts, as `spot` does for a spreadsheet.

## In the log

Proposed. A child table, synced like the others:

**photos**: `ownerTable` (enum `flights`, `sightings`), `ownerId` (id), `file` (text; its name in `photos/`, ending in a hash of its content), `width`, `height` (integer; the display copy), `bytes` (integer; both files together), `takenAt` (datetime), `sourceId` (text; the photo software's id), `preview` (text; a blurred preview of a few hundred bytes, as a data URL), `position` (integer; the order on its record, the first being the record's picture).

- The next schema version adds it ([12](12-storage-and-sync.md), "Rules for a new version").
- `sightings.photoCount` stays as it is: how many photos the user took, as their sheets record it, not how many are stored.
- `photo_links` stays, for photos the user keeps elsewhere.

## Storage

Proposed:
- **Where.** `photos/` in the Touchdown directory, a new file area beside `inbox` and `checks` ([12](12-storage-and-sync.md), "Backend interface"). Sync never lists it and never reads from it: only the rows sync, so a log with thousands of photos opens and syncs as fast as one without.
- **Names.** A file's name ends with a hash of its content, so a file never changes under its name and can be cached for good. An edited photo gets new files and new names.
- **Order of writing.** The files go up before their rows. A row whose file is missing (still on its way, removed by hand, a restored backup) shows a grey frame saying the photo was not found.
- **Removing.** A deleted photo's files stay for 30 days, so undo brings it back, then are removed by the tab that makes the daily copies ([12](12-storage-and-sync.md), "Daily copies").
- **Space.** About 0.5 MB per photo, so 1,000 photos take about 0.5 GB. Settings › Data shows the photos' total.

## Full storage

Decided: a dialog warns the user. The rest is Proposed.
- **Every write.** Tables, tracks, daily copies, inbox files and photos. A full Google Drive stops sync for everyone who uses one, not only users with photos, so this comes first.
- **One error for every backend.** Each backend reports a full storage the same way (a `storage_full` error in the backend interface): Google Drive answers 403 with `storageQuotaExceeded`, and a local directory reports that the disk is full.
- **The dialog.** It opens once, at the first write refused. It says the storage is full, that the edits are kept in this browser and sent once there is space, and how to make space (a link to the account's storage page). **Try again** syncs again. Until then sync waits, and the sync status says the storage is full.
- **Before it is full.** The app asks the storage for its free space when it opens (Drive's `about` request, `storageQuota`, which it already sends for the account's address), and warns once when less than 500 MB is left.
- **The CLI.** `touchdown photos` adds up the files it is about to upload and stops before uploading any when they would not fit, saying how much space they need. Every other command reports a refused write with the same words as the dialog.
- **Daily copies.** A copy refused for space is skipped and tried at the next sync, as a copy left for later is.
- **Share links** only read, so a full storage does not stop them.

## Viewing

Proposed:
- **Reading.** The app reads a photo through the storage interface (from Google Drive with sync's own access), only when it is on screen. The row's preview shows first.
- **Kept in the browser.** Up to 300 MB of photos are kept in the browser, the least recently viewed dropped first, so a photo seen once opens at once and offline.
- **Where.** A sighting's page; an aircraft's page (its photos, newest first, the first one as the aircraft's picture); a thumbnail in the Spotting list; a flight's page. A record without photos shows planespotters.net's as today.
- **Full screen.** A photo opens over the page at its display size, with the next and previous photos of the record.

## Share links

Proposed:
- **Content.** A link's content includes the photo rows of the records it shows; the server reads `photos` for every kind ([32](32-modes-and-sharing.md), "What the server reads").
- **The files.** `GET /p/<id>/photos/<file>`, part of the link's content as its tracks are, and nothing else: the server sends a file only when a photo row in the link's content names it, reads it from the owner's storage with the owner's key, and passes it through without changing it. `Cache-Control: public, max-age=31536000, immutable`, and Cloudflare's cache in each data centre, so a photo is read from the storage about once per data centre.
- **Limits.** Each photo shown is one request to the Worker, against the free plan's 100,000 a day; the visitor's browser keeps it, so a second visit costs nothing. A rate-limiting rule on `/p/`, and the Workers Paid plan (10 million requests a month) if needed. A request makes 2 or 3 calls (the Drive access, usually cached, and the file), far under 50, and passing a file through uses almost no CPU.
- **Private mode** has no links, so its photos never pass through the server.

## Backups

Decided: backups hold the photos' rows, not their files.
- **Why.** A log of 1,000 photos would make each copy about 0.5 GB instead of under 1 MB, and daily copies are kept for years.
- **What is in a backup.** The `photos` rows, like every table. Restored, they show their photos while the files are still in the storage, and a grey frame where a file is gone.
- **The photos' own backup** is the originals in the photo software. When files are lost, or a backup is restored into new storage, `touchdown photos DIR` over a fresh export puts the files back for the rows it recognises by `sourceId`, with no new rows.
- **A copy of the photos.** `touchdown backup --photos` (Proposed) writes the photo files to a separate zip, for whoever wants one.

## Privacy

Proposed, for `PRIVACY.md` once built: the photos are in the user's storage. Touchdown's server only passes a shared record's photos to someone who opens its link, and Cloudflare's cache keeps them for a time. The copies carry no location or camera data. A photo is sent to the agent only when the user allows it.

## Build order

Proposed:
1. Full storage: the error, the dialog and the warning (needed without photos too).
2. The `photos` table, the `photos/` area, and viewing in the app.
3. `touchdown photos DIR`, with every photo placed by hand at the review.
4. The agent reading registrations, the main way photos are matched.
5. Share links.
6. Adding photos in the web app.
