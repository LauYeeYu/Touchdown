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

Built (basic Standard, without share links): where the site has the encryption key and Google configured (`TOKEN_KEY`, `GOOGLE_CLIENT_SECRET`), Standard is offered and preselected, with the note "Share links come in a later version."; elsewhere it shows "Not available on this site." and Private is preselected.

### Changing mode

From Settings, at any time (Proposed):

| From → to | What happens |
|-----------|--------------|
| Local → Private | The user connects storage; the browser's log is written to it; sync starts. |
| Local or Private → Standard | The terms; the server connects the storage (a local folder must first move to online storage); in Private, the same storage is kept. |
| Standard → Private | Every link stops at once. The key is revoked with the storage provider and deleted. The user's server rows and the share files are deleted. The log in the storage is untouched; the browser connects to it on its own again. |
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
- **Status of the text.** Version 1 is built (`apps/web/src/components/StandardTerms.tsx`) and covers what basic Standard does: the key, its use for sync only, how it is protected, stopping, changes. The text below is the draft of version 2, which adds share links, for the owner to review (Q-TERMS-TEXT).

> **Standard mode: Touchdown's access to your storage**
>
> In Standard mode, Touchdown's server keeps a key to your storage, so the links you share keep working when you are offline and your devices sync without asking you to sign in to your storage each time.
>
> **Files we can open.** With the key, Touchdown's server can open the files Touchdown created in your storage (with Google Drive, the Touchdown folder, not your other files). That is your whole log, including ticket numbers and booking references if you entered them. The person who runs this site could technically use the key.
>
> **Use of the key.** The server opens only the file behind a link you made, when someone you allowed opens that link, and gives your own browser short-lived access for its sync. It does not read, copy, analyse or keep your log for anything else.
>
> **Protection of the key.** The key is encrypted, and the encryption key is kept apart from the database. Both are held with Cloudflare, which hosts this site. Requests are not logged with their contents. No ads, no selling, and nothing passed on to anyone unless the law requires it. Page views are counted with Cloudflare Web Analytics, as the privacy policy describes. Ticket numbers and booking references never go into a shared link.
>
> **People who see your links.** Only the people you chose for a link, and only its content. A public link can be opened by anyone who has it.
>
> **Stopping.** Switch to Private or Local in Settings at any time. Your links stop at once, the key is revoked with your storage provider and deleted from our server, and everything the server kept about you is deleted. You can also remove Touchdown's access in your Google account's settings.
>
> **Changes.** If these terms change, you will be asked again before anything new applies.
>
> [Accept and continue]  [Not now]

### Sharing

Decided (U6, Q-SHARE-SCOPE): a link can show one flight or sighting, an aircraft, the statistics for a period, or the whole log.

Decided (U6, Q-SHARE-AUDIENCE): the sharer chooses who can open each link.

| Audience | Who can open it | Address |
|----------|-----------------|---------|
| Chosen people | Invited users the sharer names by email | `/shared/<id>` |
| Everyone invited | Every user who passes the sign-in | `/shared/<id>` |
| Anyone with the link | Anyone; no sign-in | `/p/<id>` |

A chosen person must also be on the sign-in allowlist. When the sharer names an email, the app says that person also needs an invitation from the site's owner (it cannot read the allowlist).

Each link has (Proposed):
- what it shows;
- its audience;
- whether notes and photo links are included (both off by default);
- an optional end date;
- when it was made, when it was last opened, and how often.

Private fields are never included.

How a link is served (Proposed):

1. **The owner's app writes the content.** Each link's content goes into a file in the `shares` area of the owner's storage ([12](12-storage-and-sync.md)): the rows the link shows, in the JSON tables layout, private fields removed. The app rewrites the file during sync when those rows change. So a link shows the log as of the owner's last sync.
2. **The Worker checks the request.** When someone opens the link, the Worker checks that the link exists, has not been stopped or passed its end date, and that the viewer is allowed. A chosen-people link needs the signed-in email to be on its list; an everyone-invited link needs any valid sign-in; a public link needs nothing.
3. **The Worker returns the file.** It reads that one file from the owner's storage with the owner's key and returns it without parsing it. A short cache (about a minute) is purged when the link stops.
4. **The viewer shows it.** The page renders the content read-only, using the same core code as the app.

Rules (Proposed):
- **Not found means not found.** A link that does not exist, has stopped, or is not open to this viewer gives the same "not found", so its existence is not revealed.
- **Unguessable ids.** Link ids are 128 random bits (base64url), not made from the record.
- **Changing audience changes the address.** Moving a link between invited and public changes it between `/shared/` and `/p/`; the old address answers "not found".

### The public page

Decided (U3, changed): `/p/<id>` is the only route with user content outside the sign-in; the others are the sign-in pages, the privacy policy and the terms ([33](33-accounts-and-sign-in.md)). It serves the content of one public link and nothing else.

- **Not the app.** It is a small separate viewer page with its own build entry. The app itself stays behind the sign-in.
- **Two requests only.** It answers `GET /p/<id>` and `GET /p/<id>/content`, and offers no other API.
- **Headers.** `X-Robots-Tag: noindex`, `Referrer-Policy: no-referrer`, and the same strict Content Security Policy as the app.
- **Rate limit.** Requests are limited per IP address.
- **The gate.** The server lets `/p/*` through without a session; every other address still needs one ([33](33-accounts-and-sign-in.md)).

### Settings: Sharing and access

Shown in Standard (Proposed):

- **Data mode:** the current mode, and "Change".
- **Links:** one row per link, with what it shows, its audience, when it was made, and when and how often it was opened. Each row has Copy link, Change audience or end date, and Stop sharing. "Stop all links" ends them all.
- **Storage connection:** the backend, the account, connected since, and status, with Reconnect. Disconnecting means leaving Standard.
- **Terms:** the version accepted and when, with a way to read them again.

Pages that can be shared (a flight, a sighting, an aircraft, Statistics, and the Flights list for the whole log) get a Share button in Standard. Other modes show no Share button.

## What the server stores

Every user has an account for signing in ([33](33-accounts-and-sign-in.md)). Standard mode adds the tables below. They are defined with the server's other tables in `packages/server/src/db.ts` and live in its SQLite database: Cloudflare D1, or a file with the Node server (Proposed).

| Table | Columns |
|-------|---------|
| `storage_connections` | `id`, `accountId`, `backend`, `format`, `location`, `externalAccount`, `scope`, `tokenCiphertext`, `tokenIv`, `tokenKeyId`, `tokenFormat`, `status` (`ok`, `broken`), `statusAt`, `createdAt`, `lastUsedAt` |
| `consents` | `accountId`, `termsVersion`, `acceptedAt` |
| `shares` | `id`, `accountId`, `kind` (`flight`, `sighting`, `aircraft`, `period`, `log`), `subject` (the record's address or the period), `audience` (`people`, `invited`, `public`), `includeNotes`, `includePhotoLinks`, `fileName`, `createdAt`, `updatedAt`, `endsAt`, `timesOpened`, `lastOpenedAt` |
| `share_people` | `shareId`, `email` |
| `meta` | `schemaVersion` |

Not stored on the server: the log or any part of it (share files stay in the user's storage), access tokens, who opened a link, and request contents.

Leaving Standard deletes the user's rows in these tables; the account stays. Built: `storage_connections` (AES-256-GCM under the `TOKEN_KEY` secret, `tokenKeyId` 1, `tokenFormat` 1: the refresh token in JSON; the row and account ids bound in as additional data) and `consents`. `shares` and `share_people` come with share links.

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
- **Each link opening.** One read from the owner's storage, plus a token refresh when the Worker has no access token in memory. Access tokens are kept only in the Worker's memory, never stored.
- **CPU.** The Worker passes the file through without parsing it, so a link fits the free plan's CPU time.
