# 12 Storage and Sync

Where each user's data lives, how it is stored, and how devices stay in sync (requirements S1–S8, U1–U2). The data modes (Standard, Private, Local) are in [32](32-modes-and-sharing.md). The tables themselves are defined in [10](10-domain-model.md).

## Decisions

- One schema for every backend. Storage code is generic: it works on schema-defined tables and rows, never on hand-written file formats. (Decided)
- No central database by default. Each user's data lives in storage the user owns. (Decided)
- First backends, in the user's Google Drive, user's choice: **JSON tables** or a **SQLite file**. (Decided)
- Later backends: local SQLite file, Postgres / Supabase, Cloudflare D1. The interface is designed for them now; they are built later. (Decided)
- Google Drive is the first backend, not the platform (S7). Everything that reads or writes the user's data goes through the backend interface below, so it works on every backend: sync, the CLI's inbox, the agent check hand-off, import attachments, and anything added later. No feature relies on what only one service offers, such as Drive's file sharing or Drive for Desktop. Google's own APIs are used only where a Google product is the subject: importing a Google Sheet, exporting to Google Sheets. (Decided)
- Three data modes ([32](32-modes-and-sharing.md)): Standard (recommended; the server keeps an encrypted key to the storage, for sync and share links), Private (the server keeps nothing) and Local (this browser only, with the manual-file adapter). (Decided)
- CSV import/export always works, whatever the backend. (Decided)
- The browser always keeps a full local copy (IndexedDB), so the app works offline and loads fast. (Proposed)

## Layers

```
UI
 │
Repository            typed, schema-aware API used by the app (get, query, save, delete)
 │
Local store           IndexedDB in the browser; the app always reads and writes here
 │
Sync engine           row-level merge, pending queue, conflicts
 │
Backend               one of:
 ├─ file backends     JSON tables | SQLite file
 │    └─ file adapter Google Drive | local folder | manual file
 └─ server backends   (later) Postgres / Supabase | Cloudflare D1 | local SQLite via CLI
```

The UI never talks to a backend. All edits go to the local store first and the sync engine pushes them.

## Local store (browser)

Decided:

| Item | Rule |
|---|---|
| Layout | IndexedDB database `touchdown`. Store `rows`: one record per row, keyed by table and row key. Store `trackPoints`: one record per track, holding that track's point rows in sequence order. A track's points are always replaced together, and IndexedDB pays a fixed cost per record, so this reads about five times and writes about seven times faster than one record per point. The rows are the schema's rows either way. |
| Changing the layout | A layout change is a database version upgrade, run in one transaction. It checks the converted records against the original rows (every row, every column, every value) before removing the originals; if anything differs, the upgrade fails as a whole and the old layout stays as it was. Version 2 moved track points to one record per track. |
| Memory | Every row is loaded into memory when the app opens ([30](30-architecture.md)): about 240 bytes per track point, so about 0.2 MB per recorded track; flights and sightings are small. |
| Keeping it | Once the log has records, the app asks the browser for persistent storage, so the browser does not clear it when the disk runs low. Chrome decides without asking; Firefox asks the user. Settings shows whether the browser agreed. |
| Signing out | Once every change has synced, signing out removes the browser's copy ([31](31-ui.md), "Signing out"). |

## Backend interface

Every backend implements the same row-level interface. Built in `packages/storage` (`src/types.ts`); the server backends' `id` values come later:

```ts
type StoredRow = Record<string, unknown>;   // a schema row, system columns included, validated by the schema
type FileArea = "inbox" | "checks" | "attachments" | "shares";   // files kept with the log

interface Backend {
  id: "json_tables" | "sqlite_file";          // later: "sqlite_local" | "postgres" | "d1"
  kind: "file" | "server";
  open(): Promise<{ schemaVersion: number; created: boolean }>;  // create, or report the stored version
  pull(cursor: Cursor): Promise<{
    tables: Map<TableName, StoredRow[]>;     // every row of each table changed since the cursor
    changedTracks: string[]; tracks: string[]; problems: string[]; cursor: Cursor }>;
  push(items: { table: TableName; row: StoredRow; replaces: string[] }[]):
    Promise<{ written: string[]; present: string[]; conflicts: string[] }>;
  readTrack(trackId: string): Promise<StoredRow[]>;             // a track's points, replaced as a whole
  writeTrack(trackId: string, points: StoredRow[]): Promise<void>;
  listFiles(area: FileArea): Promise<FileInfo[]>;                // the CLI's inbox, check hand-off, import sources
  readFile(area: FileArea, name: string): Promise<Uint8Array | null>;
  writeFile(area: FileArea, name: string, data: Uint8Array): Promise<void>;
  removeFile(area: FileArea, name: string): Promise<void>;
}

interface FileAdapter {                                         // used by file backends only
  list(path: string): Promise<FileInfo[]>;
  read(path: string): Promise<{ data: Uint8Array; version: string } | null>;
  write(path: string, data: Uint8Array): Promise<{ version: string }>;
  remove(path: string): Promise<void>;
}
```

- File backends implement `pull`/`push` by reading whole files through a file adapter, merging, and writing them back.
- Server backends implement them with SQL: `pull` selects rows with `updated_at` after the cursor; `push` uses conditional writes (`UPDATE … WHERE id = ? AND rev = ?`) so the database itself detects conflicts.
- File areas (`inbox`, `checks`, `attachments`, `shares`) are folders in file backends and a files table (or the provider's file storage) in server backends, so the CLI's inbox and the agent check hand-off work the same on every backend. (Proposed)
- Validation runs on both sides of every backend: rows that do not match the schema are rejected, never stored.

## Sync algorithm

The same for every backend, because it works on rows:

1. **Pull** rows changed since the last cursor (file backends: the whole file, when its version marker changed).
2. **Merge per row.** Only on one side: keep it. On both sides, in different versions:
   - If one was edited on top of the other, the later one is kept. A row names the other device's version it was edited from (`basedOn`, [10](10-domain-model.md)), and one device's versions of a row follow each other.
   - Otherwise the row was edited on two devices since they last agreed. The higher `(updatedAt, updatedBy, rev)` wins (last writer wins per row, not per file), and the losing version goes to `record_history` with reason `sync_conflict` and is listed for review. Both devices may notice the same conflict; the kept row's id is made from the conflict, so it is kept once.
3. **Push** local rows the backend does not have yet.
4. **Confirm.** A device keeps the rows edited on it in a local queue until the storage shows them back: a later pull, or a push that finds them there already. This covers file backends whose storage has no compare-and-swap (Google Drive): if two devices write at nearly the same moment and one write overwrites the other, the overwritten device still has its rows queued and pushes them again. A confirmed row that an overwrite later removes is found by the next pull (the stored version is older, or was edited beside it) and handled by step 2.

Sync runs on app start, a few seconds after edits, on focus, and every few minutes while the app is open. The first sync after the app starts reads every table file again, not only the changed ones, so an edit whose queue entry was lost (the browser closed before it was saved) is still found and sent.

Built: the sync engine in `packages/storage` (`src/sync.ts`), with a test where three devices edit, sync at the same time with their file reads and writes interleaved, and sometimes write a stale copy back; every run ends with the same log on every device and no edit lost.

## File backend: JSON tables

A visible folder in the user's storage, created by the app:

```
Touchdown/
  manifest.json            { "schema": "touchdown", "schemaVersion": 7, "backend": "json_tables",
                             "tables": { "flights": "tables/flights.json", ... }, "lastWriter": "dev_8f2c" }
  tables/
    flights.json
    sightings.json
    airframes.json
    registration_periods.json
    ...                    one file per user table from 10
  tracks/
    <trackId>.json         track_points of one track
  attachments/
    imports/<batchId>/<original file name>   the source file of an import, unchanged
  checks/
    <batchId>.request.json / .result.json     agent check hand-off (22)
  inbox/
    spot-<date>-<time>.json   a spotting session from the CLI, waiting to be imported (21); removed once imported
  shares/
    <shareId>.json         what a shared link shows, private fields removed (Standard mode, 32)
  backups/
    <YYYY-MM-DD>/...       daily copy of manifest + tables, last 14 kept
```

Table file format:

```json
{
  "schema": "touchdown",
  "schemaVersion": 7,
  "table": "flights",
  "columns": ["id", "rev", "updatedAt", "updatedBy", "deleted", "scheduledDate", "flightNumber", "takeoffAt", "..."],
  "rows": [
    { "id": "01J…", "rev": 3, "updatedAt": "2025-01-02T10:00:00Z", "updatedBy": "dev_8f2c", "deleted": false,
      "scheduledDate": "2025-02-03", "flightNumber": "XY123", "takeoffAt": "2025-02-03T08:05-05:00", "...": null }
  ]
}
```

- Every row has exactly the columns listed, in schema order; missing values are `null`. Unknown keys, missing columns, or wrong types make the file invalid.
- An invalid file is not merged. The app keeps the last valid copy, shows the problem, and offers the backup.
- Track points use the same layout (`columns` + `rows`) in `tracks/<trackId>.json`.

Size check: 1,000 flights ≈ 1 MB; 10,000 sightings ≈ 5 MB. One file per table is fine at that size. If a table passes 10 MB, it is split by year (`sightings.2026.json`), listed in the manifest.

Why a visible folder and not Drive's hidden `appDataFolder`: the user can see, download, and back up the files, and the companion CLI can read them through Google Drive for Desktop. The CLI writes (the inbox) through the Drive API, signed in to the same Google Cloud project: with `drive.file`, the web app does not see files another app, such as Drive for Desktop, created (Q-DRIVE-CLI).

## File backend: SQLite file

```
Touchdown/
  touchdown.sqlite         all user tables from 10, plus a `meta` table (schema name, version, last writer)
  attachments/ checks/ backups/   as above
```

- Table definitions are generated from the schema. Track points are a normal table.
- In the browser the file is opened with SQLite compiled to WebAssembly (works in Chrome on desktop and Android).
- Sync: download the file, merge its rows into the local store by the rules above, write a new file, upload it. The whole file is replaced on each push; the pending queue covers concurrent writes, as for JSON tables.
- Users can open the file with any SQLite tool. Editing it outside the app is possible; the app validates every row on the next sync and rejects invalid ones.

## Switching storage

Moving the log to other storage (another folder, Google Drive, another account) starts sync over: the sync position (the versions of the files last read) is cleared, so every row is compared with the new storage, and edits still waiting stay queued. Kept, the old position would make tracks the new storage lacks look deleted. (Decided, built)

On a device joining a log, the mode and storage account are written into `settings` after the first sync, so the log's settings row is edited, not replaced by the new device's defaults. (Decided, built)

## Switching backends

Both file backends hold the same tables, so converting is lossless: the app reads everything from one backend and writes it to the other ("Convert to SQLite" / "Convert to JSON tables" in settings). The same path will move data to a server backend later.

## Server backends (later)

| Backend | Notes |
|---------|-------|
| Local SQLite file | Through the companion CLI or a desktop wrapper, for users who want a file outside Drive. Uses the same generated tables as the SQLite file backend. |
| Postgres / Supabase | Rows sync through the backend interface; conflicts detected by conditional updates. Supabase row-level security would isolate users if one project holds several users. |
| Cloudflare D1 | SQLite on Cloudflare, next to the lookup Worker. The Worker would expose the backend interface over HTTPS. |

Who hosts these, and whether each user brings their own instance, is open (Q-SERVER-DB). Bringing your own keeps the "user owns the data" rule; an owner-hosted instance means friends' data sits in the owner's account.

## Schema migrations

- The stored schema version is in `manifest.json` (JSON tables) or the `meta` table (SQLite, server backends).
- Migration steps are defined once in core (add column, rename column, add table, transform values). Each backend has a runner: JSON tables rewrite the files; SQL backends run generated DDL plus data updates.
- Built so far: adding columns (`MIGRATIONS` and `upgradeTableFile` in core). Table files and backups from an older version are upgraded as they are read, and written in the current version from then on; opening a JSON tables folder moves its manifest to the current version.
- Before migrating, the app writes a backup. Rows' previous forms go to `record_history` with reason `migration` when values are transformed.
- If the stored version is newer than the app understands, the app opens read-only and asks the user to reload.

## File adapters

| Adapter | How | Sync across devices | Notes |
|---------|-----|---------------------|-------|
| Google Drive | Drive API v3 from the browser, OAuth scope `drive.file`. | Yes | First adapter, built. Details below. |
| Local folder | File System Access API (Chromium desktop browsers). | Yes, if the folder is inside a Dropbox / OneDrive / iCloud / Google Drive desktop sync folder. | Gives other sync services on desktop. Not available on Android, so a phone syncs through an adapter that reaches the storage over the internet: Google Drive first, later Dropbox, OneDrive or a server backend. |
| Manual file | Export a `.zip` of the folder; import it on another device. | Manual | Works everywhere. The adapter of Local mode. |
| Dropbox API, OneDrive API | Later, if a friend needs it. | Yes | Dropbox has an "App folder" mode. OneDrive has no per-file scope like `drive.file`. |

Local folder (built, `apps/web/src/data/folder.ts`):
- The user picks a folder. A folder that holds a Touchdown log (`manifest.json`) is used as it is; any other folder gets a `Touchdown` folder inside it, so picking Dropbox's top folder does not scatter files there.
- A file's version is its modification time and size.
- Browsers forget the permission between visits. The app then shows a bar asking the user to allow the folder again (a click is required), and keeps changes in the browser until they do.
- In the browser, the connection (the folder handle and its name) is kept in IndexedDB, not in the synced settings, since it belongs to this browser.

CSV export/import per table is available with every backend. It is the fallback the user asked for, and it is lossy for some details (child tables are flattened).

## Google Drive details

- Scope: `drive.file` only. It is a non-sensitive scope: the app can only see files it created or files the user picked with the Google Picker. The account's address (`settings.storageAccount`) comes from Drive's own `about` request, so no sign-in scopes (`openid`, `email`) are asked for.
- With only non-sensitive scopes, Google does not require app verification. Publish the OAuth app as **In production**, not **Testing**: in Testing mode, consent expires after 7 days.
- Do not request `drive`, `drive.readonly` (restricted), or `spreadsheets` (sensitive). They would trigger verification and a 100-user cap on the unverified-app screen.
- Reading a user's existing Google Sheets for a one-time import: the user picks the sheet with the Google Picker (with `setAppId` set to the Cloud project number). That grants `drive.file` access to that one file, and the Sheets API accepts it.
- Private mode: the browser gets an access token with Google Identity Services' token flow, in a popup. The token lasts an hour and is kept in the browser (IndexedDB) until then, never on a server. Browsers open the popup only on a click, so when the token runs out, sync waits with a "Sign in" bar and the edits stay queued; while the user is signed in to Google, the popup closes by itself (Q-DRIVE-RENEW). Signing in as another Google account than the log's is refused. Standard mode: the server keeps an encrypted refresh token and gives the browser short-lived access tokens ([32](32-modes-and-sharing.md)).
- Built (`packages/storage/src/drive.ts`, plain `fetch`, so the CLI can use it too; the browser's sign-in is `apps/web/src/data/google.ts`):
  - The Touchdown folder is made in My Drive and carries an app property (`touchdown=log`), so it is found wherever the user moves it and whatever they rename it to.
  - Drive finds files by id, and a folder may hold two files with the same name. Paths are looked up by name in their folder. When two devices create the same file or folder at the same moment, each checks right after, the older one is used, and the newer one is removed (its content written into the older one).
  - A file's version is its MD5 checksum. A folder listed in the last 30 seconds answers "not there" without asking Drive again.
  - Files over 5 MB go up as resumable uploads. Rate limits and server errors are retried four times, waiting 1, 2, 4 and 8 seconds. A refused token is dropped; with no other token, sync waits for sign-in.
- Quotas (Drive: 325,000 quota units per minute per user) are far above what a personal log needs. Google announced quota changes and charges above "standard daily thresholds" later in 2026; recheck before launch.

## What is never stored in user data

- OAuth tokens, API keys, session tokens.
- Data from other users.

## Private fields

`ticketNumber` and `bookingRef` are stored in the user's own data (it is their data), but:
- they are excluded from CSV exports unless the user ticks "include private fields";
- they are never sent to the lookup service or to the agent check;
- they are hidden in exported stats images and videos.
