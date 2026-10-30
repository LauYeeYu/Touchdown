# 32 Data Modes and Sharing

How the hosted site treats each user's data: three data modes, the terms for the one that lets Touchdown's server reach the user's storage, sharing links, and what the server stores (requirements U2–U7, S7–S8). Storage itself is in [12](12-storage-and-sync.md); the gate and the Worker are in [30](30-architecture.md).

## The three modes

Decided: three modes, named Standard, Private and Local (Q-MODES).

| | Standard | Private | Local |
|---|---|---|---|
| Where the log lives | The user's online storage, plus a copy in each browser | The user's storage (online or a local folder), plus a copy in each browser | This browser only |
| Sync across devices | Yes | Yes | No. A backup file moves it. |
| Share links | Yes | No | No |
| What Touchdown's server keeps | The user's email, an encrypted key to their storage, the terms they accepted, their links' settings. Never the log. | Nothing | Nothing |
| Storage it works with | Storage the server can reach over the internet: Google Drive first; later Dropbox, OneDrive, server backends | Any adapter: Google Drive, local folder, later others | None |
| Terms to accept | Yes ([Terms](#terms)) | No | No |

All three sit behind the sign-in (U3). The mode decides where the data lives and what the server may do with it, not who may open the app.

Decided (U4): Standard is the recommended mode. Private and Local are for users who want more privacy and accept what they give up. A user can switch at any time ([Changing mode](#changing-mode)).

The choice is titled "Sync mode", and each mode has one short line (Decided, built). What Standard means for the user's storage is in the terms, shown in a dialog when they choose it.

| Mode | Line |
|------|------|
| Standard (recommended) | Sync and share links. |
| Private | Sync without sharing. |
| Local | No sync. Saved in this browser only. |

Under the title: "You can change it later in Settings."

### Choosing a mode at first run

Decided (Q-MODE-DEFAULT): the first run asks, with Standard preselected and marked as recommended.

1. The mode choice, Standard preselected.
2. Standard: the terms. "Accept and continue" goes on to [connecting storage](#connecting-storage). "Not now" returns to the choice with Private preselected; the user may pick Local instead.
3. Private: connect storage as in [31](31-ui.md), "First run" (Google Drive or a local folder).
4. Local: the warning below, confirmed with a checkbox before going on.

The Local warning (Decided that there is one; wording Proposed):

> Your log is kept only in this browser. Clearing the browser's data, using a private window or losing the device deletes it. Export a backup from Settings now and then.

Settings shows the same warning while the user is in Local mode. A note bar reminds the user to export a backup when the last one is more than 30 days old (counted from choosing Local when there has been none) and the log has changed since; it offers "Export a backup" and "Not now" (built).

Built: where the site has the encryption key and Google configured (`TOKEN_KEY`, `GOOGLE_CLIENT_SECRET`), Standard is offered and preselected; elsewhere it shows "Not available on this site." and Private is preselected.

### Changing mode

From Settings, at any time (Proposed):

| From → to | What happens |
|-----------|--------------|
| Local → Private | The user connects storage; the browser's log is written to it; sync starts. |
| Local or Private → Standard | The terms; the server connects the storage (a local folder must first move to online storage); in Private, the same storage is kept. |
| Standard → Private | Every link stops at once. The key is revoked with the storage provider and deleted. The user's server rows are deleted. The log in the storage is untouched; the browser connects to it on its own again. |
| Standard or Private → Local | The browser makes sure it holds the whole log, then disconnects the storage (and, from Standard, does everything in the row above). The log in the storage is left as it is; the app offers to delete it. The Local warning is shown first. |

## Recording the backend

Decided (S8): the backend is recorded wherever the data or a key to it is kept, and Google Drive is one value among several (S7).

| Where | Fields |
|-------|--------|
| User data, `settings` ([10](10-domain-model.md)) | `dataMode`, `storageBackend` (format), `storageAdapter` (where), `storageAccount`, `storageLocation` |
| Server, `storage_connections` ([below](#what-the-server-stores)) | `backend`, `format`, `location`, `externalAccount`, `tokenFormat` |

Prepared for change (Proposed):
- **One list of backends.** The values come from one registry in core, used by the web app, the CLI and the Worker. Adding a backend means adding an entry and an adapter; stored data keeps working.
- **New values in user data.** There they are enums under the schema version. A new value bumps the version, and an older app that meets it stops syncing and asks for a reload, keeping edits made meanwhile ([12](12-storage-and-sync.md), "Schema migrations").
- **New values on the server.** There they are text checked against the registry, so a new backend needs no database change.
- **Provider token changes.** `tokenFormat` numbers what is inside the encrypted token, so a provider change is handled row by row.
- **Moving to other storage.** The app reads the whole log from the current storage and writes it to the new one, the same path as converting formats in 12. In Standard, the server connects the new storage first and then revokes the old key. Links keep their addresses, and their files are written again in the new storage.
- **Old connections.** A user has one connection at a time. The old row is deleted when a move finishes.

## Standard mode

### Connecting storage

Built, for Google Drive (`packages/server/src/handler.ts`, "Standard mode"):

1. The terms are accepted (`POST /api/storage/terms`), then the app sends the browser to `/api/storage/connect?next=<page>`, behind the sign-in. Without the current terms accepted, it returns to the page with `storage-error=terms`.
2. The server redirects to Google's consent page: the authorisation-code flow with PKCE, the scopes `openid`, `email` and `drive.file`, `access_type=offline` and `prompt=consent` (Google gives a refresh token only with consent), and a sign-in under way tied to the signed-in account and this browser ([33](33-accounts-and-sign-in.md), "Google").
3. Google returns to `/auth/google/callback`, the address sign-in with Google already uses, so no second redirect address is registered. The server exchanges the code using the client secret, checks that Drive was allowed and a refresh token given, then encrypts and stores it, and returns to the page with `storage=connected`. The access token is not stored. The Google account connected also signs in to Touchdown from then on, unless the account has a Google account already or another account uses this one ([33](33-accounts-and-sign-in.md), "Google").
4. From then on, the browser gets short-lived access tokens for its own sync from `POST /api/storage/token`, instead of Google's popup. The refresh token never leaves the server. `GET /api/storage` says whether Standard is offered, the terms version and whether it was accepted, and the connection's Google account and state.
5. A browser follows Standard by itself when it comes back with `storage=connected`, when it has not chosen a mode yet (a new device), or when it syncs the same Google Drive in Private.

Problems on the way back (`storage-error=`): `cancelled`, `no-drive` (Drive was unticked on Google's screen), `no-key` (no refresh token), `expired`, `failed`, `terms`, `unavailable`; the page shows a sentence for each.

Notes:
- **Scope.** It stays `drive.file`, so the key opens only the files Touchdown created, not the rest of the user's Drive. No Google verification is needed ([12](12-storage-and-sync.md), "Google Drive details").
- **Same Google client.** Private and Standard use the same Google Cloud project and web client, so files created in either mode stay reachable (implementation check Q-DRIVE-SERVER).
- **Other providers.** Dropbox ("App folder" access with offline tokens) and OneDrive (app folder with `offline_access`) follow the same steps when they are added.
- **Local folder.** It cannot be used in Standard, because the server cannot reach it.
- **Broken key.** If the key stops working (the user revoked it, or Google expired it after six months unused), the server marks it `broken`, links show "not available right now", and the owner's app asks them to connect again ("Reconnect Google Drive"). Connecting again replaces the key in the same row; the old key is not revoked, because with Google that would end the new one too (they belong to the same grant).
- **Testing status.** While the Google app is in Testing, Google ends refresh tokens after 7 days; publish it before using Standard.

### Terms

Decided (U5): the terms are shown when the user chooses Standard, at first run or in Settings, and say that Touchdown will have access and how it protects the data. Built: they open in a modal dialog when Standard is chosen, and again on Continue at first run while Standard is selected, so they cannot be scrolled past. The text scrolls inside the dialog; "Accept and connect Google Drive" and "Not now" stay in view. Nothing else on the page can be used until the user answers; Escape is "Not now".

- **Versions.** Each version has a number. The server records the version accepted and when, as a date-time with offset.
- **Changes.** When the text changes, a user in Standard is asked again the next time they open the app. Declining offers Private or Local, as at first run. Until they answer, their links keep working.
- **Status of the text.** Version 2 is built (`apps/web/src/components/StandardTerms.tsx`, `TERMS_VERSION` in the server's `handler.ts`): version 1's key, sync, protection, stopping and changes, with share links added. A user who accepted version 1 accepts version 2 in the Share dialog before their first link; making a link without it is refused. The text below is the draft it was written from, for the owner to review (Q-TERMS-TEXT).

> **Standard mode: Touchdown's access to your storage**
>
> In Standard mode, Touchdown's server keeps a key to your storage, so the links you share keep working when you are offline and your devices sync without asking you to sign in to your storage each time.
>
> **Files we can open.** With the key, Touchdown's server can open the files Touchdown created in your storage (with Google Drive, the Touchdown folder, not your other files). That is your whole log, including ticket numbers and booking references if you entered them. The person who runs this site could technically use the key.
>
> **Use of the key.** The server opens only the file behind a link you made, when someone opens that link, and gives your own browser short-lived access for its sync. It does not read, copy, analyse or keep your log for anything else.
>
> **Protection of the key.** The key is encrypted, and the encryption key is kept apart from the database. Both are held with Cloudflare, which hosts this site. Requests are not logged with their contents. No ads, no selling, and nothing passed on to anyone unless the law requires it. Page views are counted with Cloudflare Web Analytics, as the privacy policy describes. Ticket numbers and booking references never go into a shared link.
>
> **People who see your links.** Anyone who has one of your links can open it, without signing in, until you stop sharing it. They see only that link's page, with the notes and photo links on it.
>
> **Stopping.** Switch to Private or Local in Settings at any time. Your links stop at once, the key is revoked with your storage provider and deleted from our server, and everything the server kept about you is deleted. You can also remove Touchdown's access in your Google account's settings.
>
> **Changes.** If these terms change, you will be asked again before anything new applies.
>
> [Accept and continue]  [Not now]

### Sharing

Decided (U6, Q-SHARE-SCOPE, changed): a link can show one flight or sighting, an aircraft, or the whole log. There is no link for statistics alone: the whole log's link includes Statistics.

Decided (Q-SHARE-AUDIENCE, changed): for now every link is public. Anyone who has the address can open it, without signing in. A link lasts until its owner stops it: there are no end dates. Choosing who can open a link (chosen invited users, every invited user) may come later ([Later](#later)).

Decided: links are a Standard-mode feature. The server reads a link's file from the owner's storage with the owner's key, so a link works while the owner is offline. Private and Local show no Share button.

#### What a link shows

Decided (changed), built. A link opens on the app's own pages, read-only ([The public page](#the-public-page)), and the viewer receives only what those pages need.

| Kind | Made from | The pages | The viewer receives |
|------|-----------|-----------|---------------------|
| `flight` | A flight's page | The app's flight page: the sentence, the livery band, the map or globe with the recorded track, the times, the altitude, the seat and details, the aircraft card | The flight, its track and photo links, the aircraft's facts. Not the user's other flights on that aircraft. |
| `sighting` | The sighting's page (its edit page today) | A sighting page made from the app's parts (the app has none): the aircraft's photo, registration, type, airline, place, day, statuses and livery | The sighting, its statuses, tags and photo links, the aircraft's facts |
| `aircraft` | An aircraft's page | The app's aircraft page: the sentence, the livery band, the facts, the timeline; and the pages of the user's flights on it and sightings of it | The aircraft, its registration and operator periods, the user's flights on it with their tracks, and sightings of it |
| `log` | Home's share icon, or Shared links ("Share your whole log") | The app's pages: Home (the sentence, facts, map and globe, the latest flight and session, month by month), Flights and Spotting with their search and filters, Aircraft, Statistics with its globe, and the flight, aircraft, airport and sighting pages they open, all inside the link | Every flight, sighting and aircraft and their child rows, and every recorded track |

Notes and photo links are shared with their records: the page shows them as the app does. There is no switch to leave them out. Of the settings, only the owner's display choices are sent (distance unit, code style, model naming), so the pages read as the owner's do. The viewer never receives private data, deleted entries, the rows' sync columns (`rev`, `updatedBy`, `versionVector`, …) or import bookkeeping (`sourceBatchId`, `sourceRow`), and nothing else that is not the log's records: the rest of the settings (where the log is stored, the home airport), imports, issues, checks, saved views, history, the inbox.

The pages speak of the log, not to its owner: "So far in 2026, 41 flights …", "Flown on twice", not "you have flown". They leave out what changes the log, the owner's checks and the owner's tools (the list of flights without a track, saved views). A link to a page the link does not show, such as an airport inside a flight's link, is plain text.

#### One link per thing

Decided, built. A flight, sighting or aircraft has at most one link, and there is one link for the whole log. Share on a page that has a link shows that link. A new address for the same thing means stopping the link and sharing again.

#### Address

Decided, built: `https://<site>/p/<id>`, where the id is 128 random bits in base64url (22 characters), not made from the record. Pages inside a link follow a `#`, with the app's own addresses ([31](31-ui.md), "Addresses"): `/p/<id>#/flights/2025-03-14T0812-AMS-MAD`. The part after `#` never reaches the server. A flight, sighting or aircraft link opens on its record's page.

#### Reading the log live

Decided (changed), built (`packages/server/src/share.ts`, `packages/core/src/share.ts`): a link shows the log as it is in the owner's storage now. There are no share files: when a link is opened, the server reads the log's own table files, picks out what the link shows and sends only that. An edit shows on the shared page as soon as it reaches the storage, from any device or the CLI.

How:

1. **Share.** The app asks the server for a link (`POST /api/shares` with the kind, the subject and, for an aircraft, an anchor record). The server makes the id and the row, and the dialog shows the address at once.
2. **Opening it.** The server finds the row (none: not found), then lists the log's `tables/` folder with each file's version, one request. It reads only the files the kind needs ([What the server reads](#what-the-server-reads)), from its cache when it holds that version of a file, otherwise from the owner's storage with the owner's key.
3. **Picking out.** A core function per kind takes those tables and the subject and returns the link's content: the subject's rows and the rows they point to, without deleted entries, private columns, sync columns or import bookkeeping. The result is cached under the link's id and the versions of the files it came from, so it is worked out again only after one of them changed.
4. **Counting.** The server counts the opening (how many times, and when last). It does not record who opened it. A page load without the content (a chat app's preview) is not counted.
5. **The viewer** shows the content ([The public page](#the-public-page)).

Why this is safe when the log changes:
- **Links never write.** Opening a link only reads, so links add nothing to what devices write and merge ([12](12-storage-and-sync.md), "Sync algorithm").
- **Files changing while read.** A device may be writing several table files during a sync while the server reads them, so a flight can name an aircraft not written yet. The content is built from what each file held; the viewer shows what is there (the registration as typed when the aircraft is missing), and the next opening after the files settle shows them together, since the cache follows each file's version.
- **A stopped link** fails at the first step, so no cache needs purging.
- **A log of another version.** The server never writes the log and never upgrades it, whatever version it is at. A table file an older version wrote is brought up to date in memory as it is read, as the app reads one (`upgradeTableFile` in core). A file written by a newer version than the server makes the link "not available right now" rather than show it wrongly. The server and the app are deployed together, so this lasts only while an older server runs beside a newer app ([12](12-storage-and-sync.md), "Old copies and upgrades").

When things change:
- **The record is deleted,** on any device or from the CLI. The link stays, and its page says "This flight is no longer shared." The Shared links page says the flight was deleted, with Stop sharing. If the record comes back (an undone import), the link shows it again.
- **The aircraft is merged** into another, as happens when its serial number becomes known. An aircraft link keeps one of the aircraft's flights or sightings as its anchor. When the aircraft is gone, the server shows the aircraft the anchor record belongs to now. A record keeps its id through a merge, so this follows every kind of merge without anything new in the log.
- **The key is broken** ([Connecting storage](#connecting-storage), "Broken key"). The link says "This link is not available right now." until the owner connects again.
- **The owner leaves Standard.** Every link stops, as in [Changing mode](#changing-mode). Coming back to Standard does not bring them back.

#### What the server reads

Decided, built. The server reads a fixed list of tables for each kind, and never anything else:

| Kind | Tables |
|------|--------|
| `flight` | `flights`, `airframes`, `photo_links`, `tracks` (to find the flight's track) and that track's points |
| `sighting` | `sightings`, `sighting_phases`, `sighting_tags`, `photo_links`, `airframes` |
| `aircraft` | `airframes`, `registration_periods`, `operator_periods`, `flights`, `sightings`, `sighting_phases`, `tracks`, and the points of its flights' tracks |
| `log` | All of the above, and the track points of its flights |
| Every kind | The owner's corrections and groupings: `airport_overrides`, `operator_overrides`, `aircraft_type_overrides`, `family_overrides`; and `settings`, of which only the display choices are sent |

Private data is kept apart in the storage ([Private data](#private-data)), so the files on this list hold none: a link never reads a ticket number, even to leave it out.

The log's folder: the server finds it as the app does, by the mark the app puts on the Touchdown folder (the oldest such folder), when the first link is made, and keeps its id on the storage connection (`location`). Connecting Google Drive again keeps it.

Reference data (airports, airlines, aircraft types) is not read from the log: the viewer loads the same reference files as the app, from its own files ([The public page](#the-public-page)), and applies the owner's corrections it received.

Built for the JSON tables layout. A SQLite-file log would need a SQLite reader in the server before its links work.

#### Private data

Decided (changed), built (`packages/core/src/private.ts`, schema version 7): data that must never leave the owner's devices is kept in its own files, apart from the tables a link reads.

- **The `flight_private` table** holds a flight's ticket number and booking reference, one row per flight, with the flight's own id as its id ([10](10-domain-model.md)). Two devices adding a ticket number to the same flight make the same row, which sync merges field by field like any other ([12](12-storage-and-sync.md), "Sync algorithm").
- **On the way in.** A flight's `ticketNumber` and `bookingRef` still arrive with the flight (the form, an import row, `touchdown add`), as a sighting's `phase` does. Writing the flight moves them into `flight_private` in the same change, and they stay empty in `flights`. Each sync does the same for any flight that still holds them (a log or a backup from before, an edit queued on a device that had not updated), once the storage's rows are in, as an ordinary edit that syncs and merges like any other ([12](12-storage-and-sync.md), "Sync algorithm", step 3). A Local copy does it when it opens.
- **The `private/` folder** holds every table whose rows can contain a private value: `flight_private`; `record_history`, which keeps earlier versions of whole rows; and `sync_conflicts`, which keeps both values of a field in conflict ([12](12-storage-and-sync.md), "File backend: JSON tables").
- **The rule in the schema.** A table marked private is stored under `private/`. A column marked private in any other table only carries a value on its way in. Tests check that every write leaves those columns empty, and the server drops any column marked private from what it sends anyway.

#### Rules

Decided, built:
- **Not found means not found.** An id that never existed and a stopped link give the same page.
- **No guessing.** Ids are random, and requests to `/p/` are limited to 120 a minute per IP address, in each instance of the server.
- **Owners are not named.** A shared page does not say whose log it is (Q-SHARE-NAME).

#### Requests

Decided, built. The `/api/shares` requests need a browser's session (not the command line's) and a working Standard connection.

| Request | Does |
|---------|------|
| `GET /api/shares` | The account's links. |
| `POST /api/shares` | Make a link: kind, subject and, for an aircraft, its anchor. Gives the id and the address, or the existing link for that thing. Refused until the current terms are accepted. |
| `DELETE /api/shares/<id>` | Stop one link. |
| `DELETE /api/shares` | Stop every link. |
| `GET /p/<id>` | The viewer page, without a session. |
| `GET /p/<id>/content` | The link's content, without a session. |
| `GET /p/<id>/tracks?flights=<id>,…` | The recorded tracks of up to 15 of the link's flights, without a session. A flight the link does not show, or one without a track, is left out. The server reads the track files 6 at a time and keeps the answer whole, under the versions of its files ([Costs and limits](#costs-and-limits)). |

### The public page

Decided (U3): `/p/<id>` is the only route with user content outside the sign-in; the others are the sign-in pages, the privacy policy and the terms ([33](33-accounts-and-sign-in.md)). It serves the content of one link and nothing else.

Decided (changed), built (`apps/web/src/share/`):
- **The app's pages, not the app.** A page with its own build (`share.html`, `vite.share.config.ts`), as the sign-in pages have, that shows the app's own pages (`src/pages`) over the link's content: a read-only stand-in for the app's data (`src/share/data.ts`, `readOnly`), and the app's routes at `#` addresses (`src/share/router.tsx`). It never opens the app's database and never syncs. Its files are served from `/share-files/`, which holds code, styles, fonts, the world map and the reference data, no user content, and opens without a session as `/signin-files/` does.
- **Its requests.** `GET /p/<id>` gives the page (or the not-found page), `GET /p/<id>/content` the content, and `GET /p/<id>/tracks?flights=…` the recorded tracks. No other API.
- **Tracks.** Read once the page shows, as the app's sync reads them: newest flights first, 10 a request and 6 requests at a time, each request's tracks drawn as they arrive. A request the server could not answer is asked again once, in two halves. Until a flight's track is in, its maps draw the great circle, and the masthead counts them ("Tracks 12 of 40").
- **Read-only.** The app's masthead with the wordmark, and for a whole log the main navigation (the bottom bar on phones). No editing, no Issues, no menus, no links into the app ([What a link shows](#what-a-link-shows)). Photos come from planespotters.net, as in the app.
- **The visitor's browser.** Nothing is kept beyond the tab: where each page was scrolled, the page's choices (such as the year shown) and the photos found, in session storage. No database, no local storage, no cookies.
- **Footer.** "Shared from Touchdown, a log of flights and aircraft. Read only, and as it is now in its owner's log.", the data credits, the privacy policy and the terms.
- **No analytics.** The share page carries no page-view counting, so people who open a link are not counted by anyone but the link's own count: its HTML is sent with `Cache-Control: no-transform`, so Cloudflare adds no script, and its Content Security Policy would block one anyway.
- **Headers.** `X-Robots-Tag: noindex`, `Referrer-Policy: no-referrer`, and a Content Security Policy of its own (`SHARE_CSP` in `packages/server/src/headers.ts`): its own files and planespotters.net, no Google and no Cloudflare Web Analytics. Link previews in chat apps get a plain title ("Shared from Touchdown") and nothing from the log (Q-SHARE-PREVIEW).
- **The gate.** The server lets `/p/*` and `/share-files/*` through without a session; every other address still needs one ([33](33-accounts-and-sign-in.md)).

### Managing links

Decided, built (`apps/web/src/pages/SharedLinks.tsx`, `components/ShareDialog.tsx`). Each user manages their links on a **Shared links** page (`/shares`), in Standard mode, opened from the More menu and from every Share dialog.

- **Sentence.** "You have 4 shared links. Anyone with a link can open it."
- **Rows.** One per link, newest first: what it shows, named from the browser's copy of the log ("Flight ZZ778 LHR → JFK, 14 Oct 2025", "Aircraft G-ZZLV", "Whole log"), when it was made, and how often and when it was last opened.
- **State.** A row says so when its record was deleted, or when the storage needs connecting again.
- **Actions.** Copy link, Open (a new tab) and Stop sharing, with a confirmation. "Stop all links" at the end.
- **Whole log.** "Share your whole log" at the top, when there is no such link.
- **Empty.** "No shared links. Share a flight, a sighting or an aircraft from its page, or your whole log from here."
- **Other modes.** In Private and Local the page says links need Standard mode, with "Change in Settings".

The Share button sits on the flight, sighting and aircraft pages, in Standard mode only, and reads "Shared" when the thing has a link. The whole log's is an icon at the end of Home's period control, a link icon once the log is shared. Both open a dialog:

| | The dialog |
|---|---|
| No link yet | "Share this flight". "Anyone with the link can see this flight, notes and photo links included. Ticket numbers and booking references are never shared." "Create link". |
| A link | The address with Copy (and, on phones, the system's share sheet), how often it was opened, "Stop sharing", and "All shared links". |
| Terms not accepted | Standard users who accepted version 1 accept version 2, which covers links, before their first link ([Terms](#terms)). |

The CLI cannot manage links yet: its session reaches only `/auth/me`, sign-out and Standard's storage access ([33](33-accounts-and-sign-in.md), "The command line").

### Settings in Standard mode

Proposed, apart from the line on links, which is built:
- **Data mode:** the current mode, and "Change".
- **Shared links:** how many, and "Manage links", which opens Shared links (built).
- **Storage connection:** the backend, the account, connected since, and status, with Reconnect. Disconnecting means leaving Standard.
- **Terms:** the version accepted and when, with a way to read them again.

### Later

Not in the first version (Proposed):
- **Audiences.** Links for chosen invited users or for every invited user, at `/shared/<id>` inside the app, and a `share_people` table.
- **End dates.**
- **Managing links from the CLI.**

## What the server stores

Every user has an account for signing in ([33](33-accounts-and-sign-in.md)). Standard mode adds the tables below. They are defined with the server's other tables in `packages/server/src/db.ts` and live in its SQLite database: Cloudflare D1, or a file with the Node server (Proposed).

| Table | Columns |
|-------|---------|
| `storage_connections` | `id`, `accountId`, `backend`, `format`, `location`, `externalAccount`, `scope`, `tokenCiphertext`, `tokenIv`, `tokenKeyId`, `tokenFormat`, `status` (`ok`, `broken`), `statusAt`, `createdAt`, `lastUsedAt` |
| `consents` | `accountId`, `termsVersion`, `acceptedAt` |
| `shares` | `id`, `accountId`, `kind` (`flight`, `sighting`, `aircraft`, `log`), `subject` (the record's id; empty for `log`), `anchor` (an aircraft link's flight or sighting, as `flights/<id>` or `sightings/<id>`), `createdAt`, `timesOpened`, `lastOpenedAt` |
| `meta` | `schemaVersion` |

Not stored on the server: the log or any part of it (a link's row names its record only by id; the server's cache of a link's content lives in the Worker's cache, not the database, and expires on its own), access tokens, who opened a link, and request contents.

Leaving Standard deletes the user's rows in these tables; the account stays. Built: `storage_connections` (AES-256-GCM under the `TOKEN_KEY` secret, `tokenKeyId` 1, `tokenFormat` 1: the refresh token in JSON; the row and account ids bound in as additional data), `consents` and `shares` (server schema version 4).

Protection (Proposed):
- **Encryption.** Refresh tokens are encrypted with AES-256-GCM (Web Crypto in the Worker). The key is a Worker secret, and `tokenKeyId` allows rotation. The row id and account id are bound in as additional data, so a ciphertext cannot be moved to another row.
- **Handling.** A token is decrypted only inside the request that needs it. It is never logged and never returned to a browser or the command line; they get short-lived access made with it.
- **Who can reach the database.** Only the server, and the operator through the hosting account (Cloudflare) or the machine. The operator holds both the database and the secret, and the terms say so.
- **Removed users.** Removing someone in Settings → People deletes their account and these rows (Q-USER-REMOVAL).

## Private mode

As in [12](12-storage-and-sync.md):
- **Connecting.** The browser connects to the storage itself: Google's sign-in popup, or a local folder through the browser (built). A Google token lasts an hour and stays in the browser until then; after that, sync waits until the user clicks "Sign in" ([12](12-storage-and-sync.md), "Google Drive details"). Not having to sign in again is one of the things Standard gives.
- **Server.** It keeps nothing about the user.
- **Sharing.** There are no Share buttons.
- **CLI inbox.** It works as in [21](21-import-export.md).
- **Command line and Google Drive.** The command line gets an hour's access from the browser, which posts it to the command line on the same computer; the server never sees it ([33](33-accounts-and-sign-in.md), "The command line"). In Standard mode the command line gets it from the server with its own session, as the browser does.

## Local mode

- **Where the log is.** Only in this browser (IndexedDB). The app asks the browser for persistent storage ([12](12-storage-and-sync.md), "Local store").
- **Warning and reminder.** The warning and the backup reminder are as [above](#choosing-a-mode-at-first-run).
- **CLI sessions.** A session file from the CLI is opened on the Import page ([21](21-import-export.md)).
- **Signing out.** The log is kept ([31](31-ui.md), "Signing out").

## Costs and limits

- **D1.** The free plan's limits are far above what a few users' accounts and links need. Recheck them before launch.
- **Each link opening.** One row read and one count written in D1, one listing of the `tables/` folder, and a read of a table file only when the server's cache does not hold that version of it, plus a token refresh when the Worker has no access token in memory. Access tokens are kept only in the Worker's memory, never stored.
- **Calls per request.** Decided: Cloudflare's free plan lets one request make 50 calls to Google Drive, D1 and the cache together, and a request over it fails with error 1101. A tracks request makes at most 29 besides its downloads (the Worker's table check, the Drive access, the folder search, the content read again when the cache has lost it), so it takes at most 15 flights and keeps its answer in the cache as one entry, not one per track. `packages/server/test/share.test.ts` counts the calls of the largest request with nothing kept.
- **CPU.** Picking a link's content out of the tables means parsing them: about 0.8 MB of JSON for a log of a few thousand records, a few milliseconds, within the free plan's 10 ms. It runs only on the first opening after a change, since the result is cached by file version. A much larger log may need the paid plan.
