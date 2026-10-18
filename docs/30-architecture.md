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
| Reference data build | Developer machine / CI | No | Proposed |

## Why a lookup service

The app is static, so it cannot hide API keys, and many data providers block browser requests from other sites (CORS). A small stateless function solves both:
- forwards lookups to providers, adding keys where needed;
- caches results so friends share one cache and the free quotas last longer;
- rate-limits per client;
- stores no user records and keeps no request logs beyond what the platform requires.

Most airframe facts do not need the service: the airframe index from [13](13-reference-data.md) is a set of static JSON shards served with the app. The service is needed for live fallbacks (adsbdb, hexdb), adsb.lol traces, and the optional AeroAPI calls. Its endpoints are listed in [13](13-reference-data.md).

If the user prefers no server at all, the alternative is that each user enters their own provider keys in settings and the browser calls providers directly. That only works for providers that allow browser requests, and track backfill from adsb.lol would likely not work. See Q-LOOKUP.

## Repo layout (proposed)

```
apps/web/            web app
packages/core/       schema (single source of truth) and generators, normalization,
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

One pnpm workspace. The core package has no browser or Node-specific code, so the web app and the CLI share it.

## Technology (proposed unless noted)

| Concern | Choice | Reason |
|---------|--------|--------|
| Language | TypeScript | Decided. |
| Web framework | React + Vite | Largest ecosystem for tables, maps, charts. Static build. |
| Routing / data tables | TanStack Router, TanStack Table | Typed, client-only. |
| Schema | Zod-based table definitions in `packages/core/schema` | One definition generates TypeScript types, validators, JSON Schemas, and SQL DDL for SQLite / D1 / Postgres. |
| SQLite in the browser | Official SQLite WebAssembly build | Opens and writes the SQLite file backend in Chrome (desktop and Android). |
| Local store | IndexedDB via Dexie | Offline, fast queries, survives reloads. |
| Time zones | Temporal API (polyfill until browsers ship it) | Correct local-time and day-offset math. |
| Interactive map | MapLibre GL JS with a free vector tile source | No API key needed. |
| Export rendering | d3-geo + Natural Earth (public domain) on canvas/SVG | Full control of the output, no tile licensing issues in exported images and videos. |
| Video encoding | WebCodecs + an MP4 muxer in the browser (supported in Chrome on desktop and Android); WebM via MediaRecorder as fallback; CLI with ffmpeg for long renders | No server needed. |
| Charts | Observable Plot | SVG output, simple API, easy to export. |
| CSV | Papa Parse | Handles quoting, encodings, large files. |
| Google auth | Google Identity Services token flow, scope `drive.file` | No backend needed for auth. |
| Offline | Service worker (PWA) | App loads without network; sync resumes later. |
| Lookup service | Cloudflare Worker + Cache API/KV | Free tier is enough. |
| Hosting | Cloudflare Pages (or GitHub Pages) | Free static hosting. |
| Tests | Vitest (core, CLI), Playwright (web flows) | |
| CLI packaging | Node, published to npm, run with `npx` | |

## Security and privacy

- No user accounts on our side; Google sign-in only grants access to the user's own Drive files.
- OAuth tokens stay in browser memory. No refresh tokens on any server.
- Strict Content Security Policy. No third-party analytics or ads.
- Private fields (ticket number, booking reference) never leave the user's storage and browser except in exports the user asks for with "include private fields".
- All imported text is treated as untrusted: escaped in the UI, never used as HTML, formula-guarded on CSV export.
- Dependencies pinned with a lockfile; no install scripts in the CLI.

## Multi-user

Each friend uses the same hosted web app and their own storage. There is nothing to share between users, so there is no server-side user data. The only shared parts are the static app, the reference data, and the lookup service cache.

## Cost

| Item | Cost |
|------|------|
| Static hosting, lookup service | Free tier |
| Google Cloud project for OAuth | Free (non-sensitive scope, no verification) |
| Domain | Optional, about $10/year |
| Paid data providers | None in the app. Users who have an FR24 subscription can download tracks manually (see 13). |
| Agent checks | Each user's own Claude or ChatGPT subscription |
