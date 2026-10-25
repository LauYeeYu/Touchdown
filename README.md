# Touchdown

A personal log of the flights you have flown on and the aircraft you have photographed, with statistics like my.flightradar24.com and Flighty.

- **The web app** holds your log: flights, spotting, aircraft, statistics, maps and imports. The hosted site has its own sign-in, and only invited people get an account. Your log is kept in your browser and synced through storage you own: Google Drive in Standard or Private mode, a folder in Private mode, or this browser only in Local mode ([docs/32](docs/32-modes-and-sharing.md)).
- **The command-line tools** (`./touchdown`) run on your computer. They log spotting by typing, add flights and sightings given as JSON (by you or an agent), look registrations up, have Claude Code or Codex check your records, and build backups.

## Set up

You need Node.js 22 or later. Claude Code or Codex (signed in) is optional, for the agent check; so is Google Chrome, for reading Flightradar24.

```sh
git clone <this repository>
cd Touchdown
npm install
./touchdown help        # the commands; on Windows: npm run touchdown -- help
npm test                # optional: check the install
```

## The web app in development

```sh
npm run dev -w @touchdown/web     # http://127.0.0.1:5173
```

- The dev server runs the real sign-in with its own accounts: make the first one at `/setup` with the secret in `data/private/dev-setup-token.txt`. For Google sign-in, save the web client's secret in `data/private/google-client-secret.txt`.
- An empty browser loads `data/private/touchdown-backup.zip` once; Shift-reload, or **Settings → Load the local backup**, loads it again.
- To import your existing records, use the **Import** page: the my.flightradar24.com export first, then spreadsheets in any layout. Nothing is saved until you click **Import**, and every import can be undone ([docs/21](docs/21-import-export.md)).

## The command line

| Command | Does |
|---|---|
| `./touchdown login [SITE]`, `logout` | Sign the command line in to Touchdown (the hosted site unless SITE is given): you allow it in the browser. It stays signed in until you sign it out. |
| `./touchdown storage [drive \| folder PATH \| none]` | Use your log where the web app syncs it. With Google Drive, Standard mode needs nothing more; in Private mode your browser gives the command line an hour's access at a time. |
| `./touchdown spot [--at AIRPORT]` | Type the aircraft you saw, one per line. Each registration is looked up, empty fields are filled, the agent checks them, and you are asked for what is missing. |
| `./touchdown add [FILE.json \| -] [--json] [--dry-run]` | Check flights and sightings given as JSON against your log, as the Import page would. Made for agents too: a JSON report, and exit status 0 written, 1 errors, 2 unreadable. |
| `./touchdown import FILE…` | Check a spreadsheet or your myFR24 export against your log, as the Import page does, and put it in the inbox for review. |
| `./touchdown inbox [show \| remove \| send]` | What `spot`, `add`, `import` and the changing commands saved, waiting for review. |
| `./touchdown review` | Review the oldest file waiting here in the terminal, and import it into your log, as the Import page does. |
| `./touchdown flights`, `stats`, `issues`, … | Your log as the web app shows it: also `flight REF`, `sightings`, `sessions`, `aircraft`, `airport CODE`, `imports`. `--json` for agents. |
| `./touchdown edit REF --set seat=14A`, `delete`, `undo`, … | Change your log: also `aircraft edit` and `merge`, `issues accept`, `reopen` and `fix`, `families`, `settings`. Each change waits in the inbox until you review and import it, on the Import page or with `./touchdown review`. |
| `./touchdown check FILE` | Have the agent check a spreadsheet, or a request saved from the Import page. |
| `./touchdown backup`, `export flights` | Download a backup of your log, or a table as CSV, as Settings does. |
| `./touchdown import FILES… --out FILE.zip` | Read files and write a backup from them alone, to restore in Settings (with `--airframes`, serial numbers and first flights). |
| `./touchdown airframes BACKUP.zip` | Fill serial numbers and first flight dates in a backup. |
| `./touchdown agent [claude \| codex \| none]` | Choose the agent, its rules, and whether notes are sent. |

What `spot`, `add` and `import` save is not in your log yet: it waits in the inbox, and the web app shows a bar to review and import it, on any device after it syncs. Without `storage`, files go to `data/private/inbox/`, which only the dev server reads. `./touchdown help COMMAND` lists each command's options; [docs/21](docs/21-import-export.md) has the details.

**The agent** runs on your computer with your own Claude Code or Codex subscription, only if you choose one. It runs locked down (no tools, files, web or MCP servers) and is never sent ticket numbers, booking references or seats ([docs/22](docs/22-agent-verification.md)).

**Flightradar24** (`--fr24`) is read through your own Chrome, started with remote debugging and signed in to Flightradar24, one page about every 10 seconds. On a Mac:

```sh
open -na "Google Chrome" --args --remote-debugging-port=9222 --user-data-dir="$HOME/.touchdown-chrome"
```

## Your files

Everything personal goes in `data/private/`, which Git ignores: your backup (`touchdown-backup.zip`), spreadsheets, the inbox, lookup caches and the OpenSky database (about 110 MB, downloaded once), the CLI's settings (`touchdown-cli.json`), sign-in (`touchdown-session.json`) and rows `review` has not finished sending (`cli-sync.json`), and the accounts of the dev and Node servers.

## Running the hosted site

The site runs as a Cloudflare Worker (the address is in `apps/web/wrangler.jsonc`), deployed by GitHub Actions on every push to `master` while the repository variable `DEPLOY` is `on`, or as a Node server on any machine (`npm run serve`). Setting it up and its secrets: [docs/33](docs/33-accounts-and-sign-in.md), "Hosting". Invite people in **Settings → People**; each link works once, for 7 days.

| Command | Does |
|---|---|
| `npm run build -w @touchdown/web` | Build the web app into `apps/web/dist`. |
| `npm run preview -w @touchdown/web` | Serve the build at http://127.0.0.1:4173 with the hosted site's headers. |
| `npm run serve` | Serve the build behind the sign-in, as the hosted site does (http://127.0.0.1:8787). |
| `npm test`, `npm run typecheck` | Run the tests; type-check. |

## Privacy and licence

Your records stay in your browser, your storage and `data/private/`. Lookups send only a registration (to adsbdb, and to Flightradar24 with `--fr24`). The hosted site's [privacy policy](PRIVACY.md) and [terms of service](TERMS.md) say what it keeps; it shows them at `/privacy` and `/terms`.

Touchdown is under the [Apache License 2.0](LICENSE). The reference data, the icons and the prototype's libraries keep their own licences; [NOTICE](NOTICE) lists them.

## More

- [docs/README.md](docs/README.md): the plan, data model, import formats, the agent check's threat model and the roadmap.
- [AGENTS.md](AGENTS.md): rules for coding agents working in this repository.
