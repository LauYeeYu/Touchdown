// `touchdown backup` and `touchdown export` (docs/34, step 5): the web app's Settings, Data, from the command line.
// Both read the log and write nothing to it, so they need no review. A backup holds everything, private fields and
// track points included, as the web app's does; an export leaves the private fields out unless --private, which
// writes only to a file, never to the terminal.

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { backupZip, RefIndex, tableCsv, todayIn, type TableName } from "@touchdown/core";
import { missingTracksCsv } from "@touchdown/core/view";
import { loadRefTables } from "@touchdown/refdata";
import { privatePath, shownPath, userPath } from "./paths.ts";
import { argsOrHelp, EXIT, fail, openOrFail, printJson } from "./read.ts";
import { chosenStorage, readLog } from "./storage.ts";
import { dim, green, plural } from "./term.ts";

export const BACKUP_HELP = `Usage: ./touchdown backup [--out FILE.zip] [--force] [--json]

Downloads a backup of your log from the storage chosen with ./touchdown storage, as Settings, Data, "Export a
backup" does in the web app: every table, private fields and recorded tracks included. Restore it in the web app
(Settings, Data); the command line does not restore.

  --out FILE.zip   where to write it (default data/private/touchdown-backup-DATE.zip, or -2, -3, … when taken)
  --force          replace FILE.zip if it exists
  --json           print what was written as JSON

The file holds your ticket numbers and booking references: keep it in data/private/ or somewhere only you can
read. It is written readable only by you.

Exit status: 0 written; 2 the storage could not be read, or the file exists.`;

const TABLE_OF: Record<string, TableName> = { flights: "flights", sightings: "sightings", aircraft: "airframes", airframes: "airframes" };

export const EXPORT_HELP = `Usage: ./touchdown export flights|sightings|aircraft [--out FILE.csv [--private] [--force]] [--log FILE]
       ./touchdown export missing-tracks [--out FILE.csv [--force]] [--log FILE]

Writes a table of your log as CSV, as Settings, Data does in the web app: one row per record, every stored
field as a column. Without --out it is printed, for a pipe or a spreadsheet.

missing-tracks is the short list the Flights page downloads: the flights without a recorded track, with their
date, flight number, route, registration, type and UTC times, nothing private. Send it to someone who can find
the tracks (a Flightradar24 subscriber, say); the files they send back go in with ./touchdown track or Add track.

  --out FILE.csv   write it to a file
  --private        include ticket numbers and booking references (flights); only with --out, and the file
                   is written readable only by you
  --force          replace FILE.csv if it exists
  --log FILE       read a backup instead of the log in your storage

Exit status: 0 written; 2 a wrong option, a log that cannot be read, or the file exists.`;

/** A file in data/private/ not taken yet: NAME.zip, else NAME-2.zip, … */
function freePath(name: string): string {
  for (let i = 1; ; i++) {
    const path = privatePath(i === 1 ? `${name}.zip` : `${name}-${i}.zip`);
    if (!existsSync(path)) return path;
  }
}

/** Write `data` to `out`, refusing to replace a file unless `force`. Readable only by the user. */
function writeTo(out: string, data: string | Uint8Array, force: boolean): string | null {
  if (existsSync(out) && !force) return `${shownPath(out)} exists. Give another name, or --force to replace it.`;
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, data, { mode: 0o600 });
  return null;
}

/** `./touchdown backup …` */
export async function backupCommand(args: string[]) {
  const a = argsOrHelp(args, { values: ["--out"], flags: ["--force"] }, BACKUP_HELP);
  const json = a.flags.has("--json");
  if (a.values.has("--log")) return fail(json, "backup reads your log from the storage; a backup file is one already.");
  const out = a.values.has("--out") ? userPath(a.values.get("--out")!) : freePath(`touchdown-backup-${todayIn()}`);
  if (!out.endsWith(".zip")) return fail(json, "A backup is a .zip file: give --out FILE.zip.");

  let storage;
  try {
    storage = await chosenStorage();
  } catch (e) {
    return fail(json, (e as Error).message);
  }
  if (!storage) return fail(json, "No storage chosen. backup reads your log where the web app syncs it: choose it with ./touchdown storage drive (or folder PATH). In Local mode, export a backup in the web app's Settings.");
  if (!json) console.error(dim(`Reading your log from ${storage.name}…`));
  let read;
  try {
    read = await readLog(storage, new RefIndex(loadRefTables()), { tracks: true });
  } catch (e) {
    return fail(json, (e as Error).message);
  }
  const { store, problems } = read;
  const problem = writeTo(out, backupZip(store), a.flags.has("--force"));
  if (problem) return fail(json, problem);

  const tracks = new Set(store.all("track_points").map((p) => p.trackId)).size;
  const counts = { flights: store.count("flights"), sightings: store.count("sightings"), aircraft: store.count("airframes"), tracks };
  if (json) printJson({ ok: true, file: shownPath(out), from: storage.name, counts, problems });
  else {
    console.log(`${green("Wrote")} a backup of your log in ${storage.name} to ${shownPath(out)}: ${plural(counts.flights, "flight")}, ${plural(counts.sightings, "sighting")}, ${plural(counts.aircraft, "aircraft", "aircraft")} and ${plural(tracks, "recorded track")}.`);
    for (const p of problems) console.log(dim(`Could not read ${p}; it is not in the backup.`));
    console.log(dim("It holds your private fields. Restore it in the web app under Settings, Data."));
  }
  process.exit(EXIT.ok);
}

/** `./touchdown export TABLE …` */
export async function exportCommand(args: string[]) {
  const a = argsOrHelp(args, { values: ["--out"], flags: ["--private", "--force"] }, EXPORT_HELP, [1, 1]);
  const json = a.flags.has("--json");
  if (json) return fail(json, "export prints CSV; it has no --json.");
  const missing = a.positional[0] === "missing-tracks";
  const table = Object.hasOwn(TABLE_OF, a.positional[0]!) ? TABLE_OF[a.positional[0]!] : undefined;
  if (!table && !missing) return fail(false, `Choose flights, sightings, aircraft or missing-tracks.\n\n${EXPORT_HELP}`);
  const priv = a.flags.has("--private");
  if (missing && priv) return fail(false, "missing-tracks holds nothing private; it takes no --private.");
  if (priv && !a.values.has("--out")) return fail(false, "--private writes ticket numbers and booking references, so only to a file: give --out FILE.csv as well.");
  const log = await openOrFail(false, a.values.get("--log"));
  const csv = missing ? missingTracksCsv(log.store, log.ref) : tableCsv(log.store, table!, priv);
  if (!a.values.has("--out")) {
    process.stdout.write(csv);
    process.exit(EXIT.ok);
  }
  const out = userPath(a.values.get("--out")!);
  const problem = writeTo(out, csv, a.flags.has("--force"));
  if (problem) return fail(false, problem);
  const rows = missing ? csv.trimEnd().split("\r\n").length - 1 : log.store.count(table!);
  console.log(`${green("Wrote")} ${plural(rows, missing ? "flight" : "row")} ${missing ? "without a track" : `of ${a.positional[0]}`} from ${log.from} to ${shownPath(out)}${priv ? ", private fields included" : ""}.`);
  process.exit(EXIT.ok);
}
