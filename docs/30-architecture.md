# 30 Architecture

How the parts fit together. Built on the decisions in [12](12-storage-and-sync.md) (user-owned JSON storage) and [22](22-agent-verification.md) (local agent check).

## Components

```
                    ┌──────────────────────────────────────────┐
                    │ Web app (static, runs in the browser)    │
                    │  UI · local store (IndexedDB) · sync     │
                    │  core: model, identity, checks, stats    │
                    └───┬───────────────┬──────────────┬───────┘
                        │               │              │
          user's storage│      lookups  │              │ check request/result files
                        ▼               ▼              ▼
              ┌──────────────┐  ┌───────────────┐  ┌──────────────────────────┐
              │ Google Drive │  │ Lookup service│  │ Companion CLI (user's PC)│
              │ (or other)   │  │ (stateless)   │  │  core + claude / codex   │
              └──────────────┘  └──────┬────────┘  └──────────────────────────┘
                                       ▼
                              external data providers (13)
```

| Component | Runs where | Holds user data? | Decided / Proposed |
|-----------|-----------|------------------|--------------------|
| Web app | Static hosting; code runs in the browser | Only in the browser and the user's storage | Decided (static, TS) |
| Core package | Inside the web app and the CLI | No | Proposed |
| Storage package | Inside the web app and the CLI | Moves the user's rows between the local store and the chosen backend | Decided (generic, schema-driven; see 12) |
| Companion CLI | User's computer | Reads check requests only | Decided (local CLI) |
| Lookup service | Cloudflare Worker | No. It sees registrations and flight numbers being looked up, not who asked. | Decided (Q-LOOKUP) |
| Accounts and sharing | The same Worker, with Cloudflare D1 | Standard mode only: the user's email, an encrypted key to their storage, the terms accepted, their links' settings. Never the log. | Decided ([32](32-modes-and-sharing.md)) |
| Reference data build | Developer machine / CI | No | Proposed |

## Why a lookup service

The app is static, so it cannot hide API keys, and many data providers block browser requests from other sites (CORS). A small stateless function solves both:
- forwards lookups to providers, adding keys where needed;
- caches results so friends share one cache and the free quotas last longer;
- rate-limits per client;
- stores no user records and keeps no request logs beyond what the platform requires.

Most airframe facts do not need the service: the airframe index from [13](13-reference-data.md) is a set of static JSON shards served with the app. The service is needed for live fallbacks (adsbdb, hexdb), adsb.lol traces, and the optional AeroAPI calls. Its endpoints are listed in [13](13-reference-data.md).

If the user prefers no server at all, the alternative is that each user enters their own provider keys in settings and the browser calls providers directly. That only works for providers that allow browser requests, and track backfill from adsb.lol would likely not work. See Q-LOOKUP.

## Repo layout

```
apps/web/            web app; sign-in pages (signin.html); the Cloudflare Worker (worker/, wrangler.jsonc)
packages/server/     the server: sign-in, invitations, sessions, the gate (33); D1 or SQLite file; Node entry
packages/core/       schema (single source of truth) and generators, normalisation,
                     identity resolver, validation rules, stats, importers/exporters, geo/time math
packages/storage/    backend interface, sync engine, backends: json_tables, sqlite_file
                     (later: sqlite_local, postgres, d1), file adapters: gdrive, localfs, manual
packages/cli/        companion CLI (check, later: serve, track, render)
packages/refdata/    scripts that build reference JSON (airports, operators, types)
services/lookup/     lookup service
prompts/             agent instructions (verifier.md)
schema/              JSON Schemas generated from core (check request/result, files)
docs/
data/private/        personal data, git-ignored
```

One npm workspace (npm ships with Node, so there is no extra package manager to install). The core package has no browser or Node-specific code, so the web app and the CLI share it.

## Technology (proposed unless noted)

| Concern | Choice | Reason |
|---------|--------|--------|
| Language | TypeScript | Decided. |
| Web framework | React + Vite | Largest ecosystem for tables, maps, charts. Static build. |
| Routing / data tables | TanStack Router, TanStack Table | Typed, client-only. |
| Schema | Zod-based table definitions in `packages/core/schema` | One definition generates TypeScript types, validators, JSON Schemas, and SQL DDL for SQLite / D1 / Postgres. |
| SQLite in the browser | Official SQLite WebAssembly build | Opens and writes the SQLite file backend in Chrome (desktop and Android). |
| Local store | IndexedDB via Dexie | Offline, survives reloads. One record per row, except track points: one record per track ([12](12-storage-and-sync.md), "Local store"). All rows are also held in memory (a personal log is a few MB), so pages compute from the core store directly; IndexedDB is the persistence under it. |
| Time zones | Temporal API (polyfill until browsers ship it) | Correct local-time and day-offset math. |
| Interactive map | d3-geo on Natural Earth land (world-atlas), drawn as SVG | Decided by the approved prototype: a quiet world map with arcs and spots, no tiles, no API key, same drawing code as the exports. |
| Export rendering | d3-geo + Natural Earth (public domain) on canvas/SVG | Full control of the output, no tile licensing issues in exported images and videos. |
| Video encoding | WebCodecs + an MP4 muxer in the browser (supported in Chrome on desktop and Android); WebM via MediaRecorder as fallback; CLI with ffmpeg for long renders | No server needed. |
| Charts | d3 scales and hand-drawn SVG | The few charts (months, altitude, ranked lists) follow the prototype's mark rules exactly; a chart library would add weight without saving code. |
| CSV | Papa Parse | Handles quoting, encodings, large files. |
| Google auth (Google Drive adapter) | Google Identity Services token flow, scope `drive.file` | No backend needed for auth. |
| Offline | Service worker (PWA) | App loads without network; sync resumes later. |
| Lookup service | The `/api/*` routes of the same Cloudflare Worker that serves the app; Cache API for caching | Free plan is enough (see Deployment). |
| Hosting | The server in `packages/server` ([33](33-accounts-and-sign-in.md)): a Cloudflare Worker with static assets and D1, or a Node server with a SQLite file on any machine | One codebase, so the site can move hosts. Starts on Cloudflare. |
| Tests | Vitest (core, CLI), Playwright (web flows) | |
| CLI packaging | Node, published to npm, run with `npx` | |

## Security and privacy

- Sign-in (U3, Decided, Q-ACCESS): the site signs people in itself ([33](33-accounts-and-sign-in.md)), with email and password or Google, and only people the owner invites get an account. No sign-in service sits in front of it, so it is not tied to one host. Passwords are hashed in the browser and never reach the server. The one exception to the sign-in is the public share page `/p/<id>` ([32](32-modes-and-sharing.md)), which serves one public link's content and nothing else.
- The gate (Decided, built in `packages/server`): every request, for a page, a file or `/api/*`, goes through the server first, which checks the session cookie; without a valid session only the sign-in pages answer ([33](33-accounts-and-sign-in.md)).
- Inside the gate, each user still connects their own storage (for Google Drive, a Google sign-in with the `drive.file` scope; a local folder needs only the browser's permission). In Standard mode the server makes the connection and keeps an encrypted key ([32](32-modes-and-sharing.md)). The gate decides who may use the app; the storage connection decides whose data is read. Neither gives anyone access to another user's data.
- The installed app (PWA) keeps working offline from its cache; when the session expires, the next online request sends the user to the sign-in page.
- On the server, per user: the account (email, name, role), how they sign in (a hash of the browser's password key, the Google account id) and their sessions ([33](33-accounts-and-sign-in.md)); in Standard mode also an encrypted key to the storage and their links' settings ([32](32-modes-and-sharing.md)). Connecting storage only grants access to the user's own storage (with Google Drive, only the files Touchdown created).
- Private mode: Google's access token stays in the browser until it expires (an hour), and no refresh token is on any server. Standard mode: one refresh token per user, encrypted, never logged or returned to a browser ([32](32-modes-and-sharing.md)).
- Strict Content Security Policy. No third-party analytics or ads.
- Private fields (ticket number, booking reference) never leave the user's storage and browser except in exports the user asks for with "include private fields".
- All imported text is treated as untrusted: escaped in the UI, never used as HTML, formula-guarded on CSV export.
- Dependencies pinned with a lockfile; no install scripts in the CLI.

## Deployment (Cloudflare)

Built: the server (`packages/server`), the Worker that wraps it (`apps/web/worker/`, config in `apps/web/wrangler.jsonc`, D1 bound as `DB`) and the GitHub Actions workflow (`.github/workflows/deploy.yml`). The steps for the person running the site are in the README, "Running the hosted site".

```
Worker "touchdown" (or the same server on any machine, 33)
     every request       the session is checked first; without one, only the sign-in pages
     /signin, /join/<id>, /reset/<id>, /setup, /auth/*
                          the site's own sign-in, invitations and sessions (33)
     static assets        apps/web build output + reference JSON + airframe index shards
                          (single-page-app fallback for unknown paths)
     /api/*               lookup service (13)
     /api/storage/*       Standard mode: connecting storage, short-lived tokens (32)
     /api/shares/*        Standard mode: links and their content (32)
     /shared/<id>         a link for invited users, inside the app
     /p/<id>              public share page; the only app path outside the sign-in
     D1                   accounts, sessions, invitations (33); Standard-mode storage keys
                          and link settings (32)
     secrets              setup secret, Google client secret, provider API keys,
                          token encryption key; set with `wrangler secret put`
```

- One Worker serves both the app and the API, so they share one origin: no CORS setup, one deployment.
- The `workers.dev` and preview addresses are turned off in `wrangler.jsonc`, so the site has one address (built).
- Free plan: every request runs the Worker (the session check, one database read), so pages and files count towards the 100,000 requests a day, with 10 ms of CPU each; a few users stay far below that. Password hashing happens in the browser, which keeps sign-in within the 10 ms ([33](33-accounts-and-sign-in.md)). The lookup service mostly waits on upstream servers, which does not count as CPU. The paid plan ($5/month) is the fallback if limits are reached. Recheck the limits before launch.
- Airframe index shards (about 1,300 small files) ship as static assets. If the plan's per-version file limit is too low, they move to R2.
- Deploys (Decided, built): GitHub Actions on every push to `master` runs the tests and the type check, builds the app and deploys with `wrangler` (pinned in `apps/web/package.json`), using a Cloudflare API token kept as a GitHub Actions secret. The deploy step runs only while the repository variable `DEPLOY` is `on`, which the owner sets once the sign-in is built, so the site is never open. Wrangler's telemetry is off in the workflow.
- The Worker's config (`wrangler.jsonc`) names the custom domain and is committed (Decided): the address is not a secret, and the gate protects the site.
- Reference data and the airframe index are rebuilt weekly in GitHub Actions (the source files are about 100 MB, too heavy for a Worker cron), then deployed with `wrangler`.
- Google OAuth: the production origin (`*.workers.dev` or a custom domain) and a fixed staging origin are registered under Google's "Authorized JavaScript origins" setting. Sign-in with Google registers `/auth/google/callback` under "Authorized redirect URIs" ([33](33-accounts-and-sign-in.md)); for Standard mode, `/api/storage/callback` is registered there too ([32](32-modes-and-sharing.md)). Per-upload preview URLs change, so they are not used for sign-in.
- Headers (built, `packages/server/src/headers.ts`; `vite preview` serves the build with the same ones):
  - Content Security Policy: everything from the site itself, plus Google's sign-in script and the Drive API, and planespotters.net's API and photos. No eval (the app tells Zod not to probe for it), but WebAssembly may be compiled (`'wasm-unsafe-eval'`, for the password hash and later SQLite); no inline styles, no frames of the site elsewhere. The theme is applied by a small inline script before first paint, so the policy allows that one script by hash; a test checks the hash against `index.html`. Google's sign-in script adds an inline style for its own sign-in button, which Touchdown does not use; it is blocked.
  - `Strict-Transport-Security`, `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin`, a `Permissions-Policy` turning off the camera, microphone, location and payment, and `X-Robots-Tag: noindex`.
  - `Cross-Origin-Opener-Policy: same-origin-allow-popups`, which Google's sign-in popup needs. No full cross-origin isolation (COEP), because it would break that popup. The SQLite backend therefore uses the `opfs-sahpool` storage mode (or an in-memory database), which needs no cross-origin isolation.
- Caching (Decided: the version stamp; built): `index.html` is served with `Cache-Control: no-cache`, so a browser always checks for a new version. Every stylesheet link in it carries `?v=<build date-time>` (UTC, basic ISO 8601, e.g. `20261023T153012Z`), added at build time, so a new deployment reloads the CSS without depending on the browser's cache. Built files also carry a content hash in their names and are served with `Cache-Control: public, max-age=31536000, immutable`. The service worker (phase 3) fetches `index.html` from the network first.
- Logs: Worker logs are off (`observability` disabled), because page addresses and lookups reveal which aircraft a user is interested in. When `/api/*` needs logs, they stay minimal (no request bodies, no client identifiers).
- Cloudflare D1 holds the Standard-mode tables ([32](32-modes-and-sharing.md)). D1 as a storage backend (later, Q-SERVER-DB) can live in the same account.
- Not on Cloudflare: the log (each user's storage) and the companion CLI (each user's computer). In Standard mode Cloudflare holds an encrypted key to the storage and the links' settings ([32](32-modes-and-sharing.md)).

## Multi-user

Each friend uses the same hosted web app and their own storage. Server-side user data exists only in Standard mode: an encrypted key to the user's storage and their links' settings ([32](32-modes-and-sharing.md)); the log itself stays in the user's storage. Users see each other's data only through links shared with them. The other shared parts are the static app, the reference data, and the lookup service cache.

## Cost

| Item | Cost |
|------|------|
| Static hosting, lookup service | Free tier |
| Accounts, sessions, Standard-mode keys and links (Cloudflare D1) | Free tier |
| Google Cloud project for OAuth | Free (non-sensitive scope, no verification) |
| Domain | Optional, about $10/year |
| Paid data providers | None in the app. Users who have an FR24 subscription can download tracks manually (see 13). |
| Agent checks | Each user's own Claude or ChatGPT subscription |
