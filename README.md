# Touchdown

A personal log of the flights you have flown on and the aircraft you have photographed, with statistics like my.flightradar24.com and Flighty.

It has two parts:

- **The web app** keeps your log in the browser: flights, spotting, aircraft, statistics, maps and the Import page.
- **The command-line tools** (`./touchdown`) run on your computer. They log new spotting by typing, look registrations up, have an agent (Claude Code or Codex) check your records, and build backups the web app can restore.

What works now: the web app, and the command-line tools. The web app asks where your log lives: Private syncs it through your Google Drive (any device) or a folder on your computer (Chrome or Edge; put the folder in Dropbox, OneDrive or iCloud Drive to reach your other computers), Local keeps it in one browser. Not yet: the hosted site and its sign-in. In development, Google sign-in works at `http://localhost:5173` and `http://127.0.0.1:5173`. In Local mode, export a backup from Settings now and then. The plan and the reasons behind it are in [docs/](docs/README.md).

## Set up

You need:

| What | Why | Check |
|------|-----|-------|
| Node.js 22 or later, with npm | Runs everything | `node --version` |
| Claude Code or Codex, installed and signed in (optional) | The agent check, which uses your own subscription | `claude --version` or `codex --version` |
| Google Chrome (optional) | Reading Flightradar24 aircraft pages, if you choose to | |

Then, in a terminal:

```sh
git clone <this repository>
cd Touchdown
npm install
./touchdown help        # the list of commands; on Windows: npm run touchdown -- help
```

`npm test` runs the tests if you want to check the install.

## The web app

```sh
npm run dev -w @touchdown/web
```

Open http://127.0.0.1:5173. Leave the terminal open while you use it.

- Your log is stored in this browser. **Settings → Export a backup (.zip)** saves it to a file; **Restore from a backup** replaces the browser's log with one.
- In development only: an empty browser loads `data/private/touchdown-backup.zip` once. A hard refresh (Shift-reload), or **Settings → Load the local backup**, loads it again and replaces what the browser has.
- **Signing in, in development:** the dev server runs the real sign-in, with its own accounts. Make the first account at http://127.0.0.1:5173/setup with the secret in `data/private/dev-setup-token.txt`. Without signing in, the dev server still opens the app, with the log your browser already has; signed in, each account has its own copy. For "Continue with Google", save the web client's secret in `data/private/google-client-secret.txt`.

## Your files

Everything personal goes in `data/private/`. Git ignores this folder, so nothing in it is ever committed.

| Path | What it is |
|------|------------|
| `data/private/touchdown-backup.zip` | Your log as a backup. `spot` looks registrations up in it, and the web app loads it in development. |
| `data/private/sheets/` | A good place for your spreadsheets and Flightradar24 exports. |
| `data/private/inbox/` | The files spotting sessions save for the Import page. |
| `data/private/reference/` | The OpenSky aircraft database, downloaded the first time it is needed (about 110 MB). |
| `data/private/cache/` | Saved lookup answers, the agent's self-test, and the lines you typed in `spot` (for ↑). |
| `data/private/touchdown-cli.json` | The agent you chose, your rules for it, and whether notes are sent. |
| `data/private/dev-server.sqlite`, `dev-setup-token.txt` | Accounts for signing in during development, and the secret for their first account. |
| `data/private/google-client-secret.txt` | The Google web client's secret, if you want Google sign-in in development. |
| `data/private/server.sqlite` | Accounts for `npm run serve` (the site on your own machine). |

## Getting your records in

### Your existing records (once)

On the web app's **Import** page, choose each file in turn: the my.flightradar24.com export (the CSV that "Export" gives you), then any spreadsheets of flights or sightings, as CSV or Excel (.xlsx). Flights already imported from the export are matched and merged.

Spreadsheets can be laid out any way. Touchdown works out what each column holds from its header and its values ("Reg", "Tail number" and "Registration" all work, and so does a column of registrations with no header). If something is unclear, or a column could be two things, the Import page first shows the columns: each with a few of its values and what it was read as. Change anything that's wrong, then **Read the rows**. The browser remembers the layout, so the next file laid out the same way goes straight to the review.

The review shows how each row matches your log and what the checks found. Nothing is saved until you click **Import**, and every import can be undone from the import history on the same page.

You can also build a backup in the terminal, which can add recorded tracks and serial numbers, and then restore it in Settings. Restoring replaces the browser's log, so do this only to start from scratch:

```sh
./touchdown import data/private/sheets/flightdiary.csv data/private/sheets/flights.xlsx data/private/sheets/spotting.xlsx \
  --airframes --out data/private/touchdown-backup.zip
```

### New spotting: type it (`./touchdown spot`)

This is the quickest way to log what you saw. You type the registration and anything else you know. Touchdown looks the rest up, an agent checks it, and you are asked only about what is still missing or doubtful.

```sh
./touchdown spot --at EGLL
```

The first time, it asks whether an agent should check your records: no agent (the default), Claude Code or Codex. It remembers your answer. Then type one aircraft per line:

```
EGLL · 2026-03-14 › landing                          ← a line with only a phase sets it for the next lines
EGLL · 2026-03-14 · landing › G-ABCD
  1  G-ABCD    A21N · A321-271NX · BAW British Airways · landing · EGLL · 2026-03-14
       type code, model, airline from adsbdb · OpenSky agrees · new to your log
EGLL · 2026-03-14 · landing · 1 to save › D-ABCD "Retro livery" taking off
EGLL · 2026-03-14 · landing · 2 to save ›            ← Enter on an empty line: check and save
```

What a line can hold, in any order after the registration:

| | Examples |
|-|----------|
| Place | `at EGLL`, `at LHR` |
| Date | `today`, `yesterday`, `on 2025-03-15`, `15/03/2025` |
| Phase | `approaching`, `landing`, `taking off`, `taxiing`, `parked`, `towing`, `overflight` |
| Airline | `BAW`, or `BA` in capitals |
| Type and model | `A320`, `B738`; `A320-232`, `737-8K5` |
| Anything else | `"Retro livery"`, with or without quotes. The agent puts it in a field such as special livery, or keeps it as a note. |

A line with only a place, date or phase sets it for the lines after it. The prompt shows what is set and how many aircraft are not saved yet.

For each aircraft:

1. **Lookup:** Touchdown checks your log, the OpenSky database and adsbdb (and Flightradar24 with `--fr24`).
2. **Fill:** the type, model and airline are filled in. A value you typed is never replaced without asking.
3. **Check:** when you press Enter on an empty line, the agent checks the aircraft typed since the last save. It sorts your extra words into fields and points out anything doubtful, such as an aircraft retired before the date.
4. **Questions:** you are asked about the agent's guesses and anything still missing; Enter skips a question. A line the agent doubts comes back for you to correct.
5. **Save:** the aircraft go to the inbox (`data/private/inbox/`). Keep typing to add more to the same session; `quit` ends it. **Saved is not yet in your log:** you review and import them in the web app (below).

Correcting and moving around:

| | Does |
|-|------|
| ↑ ↓ | Bring back earlier lines, including ones from earlier sessions. Change one and press Enter, and it replaces that aircraft; you are asked first if you changed the registration. |
| `edit` or `edit 3` | Bring back the last line, or line 3, to change it. |
| `list` | Show the aircraft in this session, numbered. |
| `drop 3`, `undo` | Remove line 3, or the last line not saved yet. |
| Tab | Complete commands, phases, registrations from your log, and airport codes after `at`. |
| `help` | Everything above. |

Typing the same aircraft again for the same place and day replaces the earlier line, because it is one sighting.

**Then, in the web app** (`npm run dev -w @touchdown/web` must be running; `spot` tells you if it is not):

1. A bar at the top says how many sightings are waiting. The app checks when it opens, when you come back to its tab, and every 30 seconds.
2. **Review and import** opens the session on the Import page. Rows with something still open are under "Need a look".
3. **Import** adds them to your log, and the session leaves the inbox (a copy is kept in `inbox/imported/` for 30 days). **Discard** on the Import page deletes a session you don't want.

Values from a lookup or the agent are saved with where they came from. The inbox only holds sessions you have not dealt with yet: each session is one file, and a file whose sightings are all in your log already is moved out by itself.

Once the site is hosted, sessions will travel through your storage instead (Google Drive or a local folder; more later). With Google Drive, `./touchdown login` will sign the terminal in to Google once. `spot` will write each session to the inbox in your storage, and the website will show them waiting on any device after it syncs. This comes with sync (phase 3).

Other ways to run it:

- `./touchdown spot sightings.xlsx` reads a spreadsheet of sightings, in any layout, as if you had typed each row. Each row is looked up and checked; the empty fields are filled, and what disagrees with the sources is listed for your review in the web app. It shows the columns it worked out first, asks about unclear ones, and remembers the layout. It also says how many agent calls a large sheet would take before running them.
- `./touchdown spot "G-ABCD landing" "D-ABCD"` reads lines given as arguments.
- `./touchdown spot < list.txt` reads lines from a file. Without a terminal there are no questions; what is open is listed instead.

Options: `--on DATE`, `--phase PHASE`, `--agent claude|codex|none` (for one run), `--fr24`, `--offline`, `--no-adsbdb`, `--dry-run` (shows what the agent would be sent). `./touchdown spot --help` lists them all.

### Check a file with an agent (`./touchdown check`)

On the Import page, after choosing a file, the **Check with an agent** panel:

1. saves a request file to your downloads;
2. shows the command to run, for example `./touchdown check ~/Downloads/touchdown-check-….json`;
3. loads the result it writes.

The suggestions then appear on each row, with **Use** and **Dismiss**. You can also run it on a spreadsheet directly with `./touchdown check data/private/sheets/spotting.xlsx`, then choose the same file on the Import page and load the result. In the terminal, `--map "Header=field"` says what a column holds when Touchdown cannot tell.

### Serial numbers and first flights (`./touchdown airframes`)

```sh
./touchdown airframes data/private/touchdown-backup.zip --out data/private/touchdown-backup.zip
```

This fills serial numbers and first flight dates from the OpenSky database, and with `--fr24` from Flightradar24.

## The agent

Claude Code or Codex runs on your computer with your own subscription. Each check costs a few cents of usage.

- **Choosing:** no agent is used unless you choose one. The first `spot` or `check` asks (no agent is the default), `./touchdown agent` shows or changes the choice, and `--agent` on a command overrides it for one run. The choice belongs to this computer (it is kept in `data/private/touchdown-cli.json`), also for checks started from the web app's Import page.
- **Your rules:** plain sentences added to the agent's instructions, for example how you want liveries written. `./touchdown agent rules` lists them, `./touchdown agent rules add "…"` adds one, `./touchdown agent rules remove N` removes one.
- **Lockdown:** the agent runs with no tools, files, web access, MCP servers or hooks, in an empty folder. Before the first use of each version, a self-test sends it a record that tries to take it over; an agent that follows the instruction is not used.
- **What it is sent:** dates, airports, registrations, types, models, airlines, liveries and phases, and what the lookups said. When it helps with a spreadsheet's unclear columns: their headers and up to five sample values. Never ticket numbers, booking references, seats or photo links. Notes are sent only after `./touchdown agent notes on` (or with `--notes` for one run); in `spot`, the agent gets the words of your line it has to sort.
- **What it can change:** values backed by a lookup, and your own words sorted into fields, are used straight away. A guess from the agent's own knowledge, or a change to something you typed, is asked about first.

## Flightradar24 through Chrome (optional)

`--fr24` reads Flightradar24's aircraft pages through your own Chrome, one page about every 10 seconds, with answers kept for 90 days. Chrome needs remote debugging on a profile of its own. On a Mac:

```sh
open -na "Google Chrome" --args --remote-debugging-port=9222 --user-data-dir="$HOME/.touchdown-chrome"
```

Sign in to Flightradar24 in that window, then run the command with `--fr24`. If Flightradar24 shows a bot check, Touchdown stops using it for that run.

## Commands

| Command | Does |
|---------|------|
| `./touchdown help [command]` | List the commands, or show one command's options. |
| `./touchdown spot` | Log spotting by typing (above). |
| `./touchdown check <file>` | Have the agent check a file or a request from the Import page. |
| `./touchdown import <files…>` | Read files, print findings and statistics, and optionally write a backup (`--out`). |
| `./touchdown airframes <backup.zip>` | Fill serial numbers and first flights in a backup. |
| `./touchdown agent [claude\|codex\|none]` | Show or choose the agent; `agent notes on\|off` and `agent rules` set what it is sent. |
| `npm run dev -w @touchdown/web` | Run the web app at http://127.0.0.1:5173. |
| `npm run build -w @touchdown/web` | Build the web app into `apps/web/dist`. |
| `npm run preview -w @touchdown/web` | Serve the build at http://127.0.0.1:4173 with the hosted site's headers. |
| `npm run serve` | Serve the build behind the sign-in, as the hosted site does (http://127.0.0.1:8787). |
| `npm test`, `npm run typecheck` | Run the tests; type-check. |

`./touchdown <command>` is the same as `npm run touchdown -- <command>`, without npm's extra output.

## Running the hosted site

The site signs people in itself: email and password, or Google, and only people you invite get an account ([docs/33](docs/33-accounts-and-sign-in.md)). It runs as a Cloudflare Worker at the address in `apps/web/wrangler.jsonc`, or as a Node server on any machine. GitHub Actions tests and builds every push to `master`, and deploys to Cloudflare while the repository variable `DEPLOY` is `on`.

**On Cloudflare**, once:

1. **Domain:** the domain's nameservers point to Cloudflare.
2. **Database:** in the Cloudflare dashboard, create a D1 database named `touchdown` (Storage & databases → D1). Put its id in `apps/web/wrangler.jsonc` (`database_id`) and commit. The id is not a secret.
3. **Deploying:** create a Cloudflare API token from the "Edit Cloudflare Workers" template, add the permission Account → D1 → Edit, and limit it to your account and the domain. In GitHub, under Settings → Secrets and variables → Actions, add the secrets `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`, then the variable `DEPLOY` with the value `on`. The next push deploys.
4. **Secrets:** in the dashboard, Workers & Pages → touchdown → Settings → Variables and Secrets, add `SETUP_TOKEN` (a long random string) and, for Google sign-in, `GOOGLE_CLIENT_SECRET` (the web client's secret). Until `SETUP_TOKEN` is set nobody can make the first account, so the site stays closed.
5. **Google Cloud:** in the "Touchdown web" client, add the site's address under Authorized JavaScript origins, and `<address>/auth/google/callback` under Authorized redirect URIs. Publish the consent screen ("In production") before friends use Google.
6. **First account:** open `<address>/setup`, enter the setup secret, and make yours. You can then remove `SETUP_TOKEN`.

**On any machine:** build the app and start the server behind a web server that handles HTTPS (Caddy, nginx), which forwards to it:

```sh
npm ci && npm run build -w @touchdown/web
TOUCHDOWN_ORIGINS=https://touchdown.example.org SETUP_TOKEN=… npm run serve
```

It listens on 127.0.0.1:8787 and keeps accounts in `data/private/server.sqlite`; the other settings are at the top of `packages/server/src/serve.ts`.

**People:** invite someone in Settings → People: you get a link that works once, for 7 days, and send it yourself. "Reset link" there is for a forgotten password; "Remove" ends someone's account at once. While the Google consent screen is in Testing, only its test users can use Google.

## Privacy

- Your records stay in your browser and in `data/private/`, on your computer.
- Lookups send only a registration: to adsbdb (online, answers kept for 90 days), and to Flightradar24 if you use `--fr24`. The OpenSky database is a local file.
- The agent runs on your computer under your own account, and sees only what is listed above.

## Licence

The hosted site's [privacy policy](PRIVACY.md) and [terms of service](TERMS.md) say what it keeps and on what terms. The site shows them at `/privacy` and `/terms`, built from these files.

Touchdown is under the [Apache License 2.0](LICENSE). The reference data, the icons and the prototype's libraries come from others and keep their own licences; [NOTICE](NOTICE) lists them.

## More

- [docs/README.md](docs/README.md): the plan, data model, import formats, the agent check's threat model and the roadmap.
- [AGENTS.md](AGENTS.md): rules for coding agents working in this repository.
