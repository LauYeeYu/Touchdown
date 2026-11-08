// `touchdown backup` and `touchdown export` (docs/34, step 5): the web app's Settings, Data, from the command line.
// Both read the log and write nothing to it, so they need no review. A backup holds everything, private fields and
// track points included, as the web app's does; an export leaves the private fields out unless --private, which
// writes only to a file, never to the terminal.

import { t } from "@touchdown/i18n/cli";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { backupZip, RefIndex, tableCsv, todayIn, type TableName } from "@touchdown/core";
import { missingTracksCsv, myFr24Csv, myFr24Flights } from "@touchdown/core/view";
import { refTables } from "./reftables.ts";
import { privatePath, shownPath, userPath } from "./paths.ts";
import { argsOrHelp, EXIT, fail, openOrFail, printJson } from "./read.ts";
import { chosenStorage, readLog } from "./storage.ts";
import { dim, green, tc } from "./term.ts";

export const backupHelp = () => t("cli.help.backup");

const TABLE_OF: Record<string, TableName> = { flights: "flights", sightings: "sightings", aircraft: "airframes", airframes: "airframes" };

export const exportHelp = () => t("cli.help.export");

/** A file in data/private/ not taken yet: NAME.zip, else NAME-2.zip, … */
function freePath(name: string): string {
  for (let i = 1; ; i++) {
    const path = privatePath(i === 1 ? `${name}.zip` : `${name}-${i}.zip`);
    if (!existsSync(path)) return path;
  }
}

/** Write `data` to `out`, refusing to replace a file unless `force`. Readable only by the user. */
function writeTo(out: string, data: string | Uint8Array, force: boolean): string | null {
  if (existsSync(out) && !force) return t("cliWrite.backup.exists", { file: shownPath(out) });
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, data, { mode: 0o600 });
  return null;
}

/** `./touchdown backup …` */
export async function backupCommand(args: string[]) {
  const a = argsOrHelp(args, { values: ["--out"], flags: ["--force"] }, backupHelp());
  const json = a.flags.has("--json");
  if (a.values.has("--log")) return fail(json, t("cliWrite.backup.notFromBackup"));
  const out = a.values.has("--out") ? userPath(a.values.get("--out")!) : freePath(`touchdown-backup-${todayIn()}`);
  if (!out.endsWith(".zip")) return fail(json, t("cliWrite.backup.zipOnly"));

  let storage;
  try {
    storage = await chosenStorage();
  } catch (e) {
    return fail(json, (e as Error).message);
  }
  if (!storage) return fail(json, t("cliWrite.backup.noStorage"));
  if (!json) console.error(dim(t("cli.readingLog", { place: storage.name })));
  let read;
  try {
    read = await readLog(storage, new RefIndex(refTables()), { tracks: true });
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
    console.log(tc("cliWrite.backup.wrote", { place: storage.name, file: shownPath(out), flights: counts.flights, sightings: counts.sightings, aircraft: counts.aircraft, tracks }, { green }));
    for (const p of problems) console.log(dim(t("cliWrite.backup.unreadable", { file: p })));
    console.log(dim(t("cliWrite.backup.holdsPrivate")));
  }
  process.exit(EXIT.ok);
}

/** `./touchdown export TABLE …` */
export async function exportCommand(args: string[]) {
  const a = argsOrHelp(args, { values: ["--out"], flags: ["--private", "--force", "--new"] }, exportHelp(), [1, 1]);
  const json = a.flags.has("--json");
  if (json) return fail(json, t("cliWrite.export.noJson"));
  const missing = a.positional[0] === "missing-tracks";
  const fr24 = a.positional[0] === "myfr24";
  const table = Object.hasOwn(TABLE_OF, a.positional[0]!) ? TABLE_OF[a.positional[0]!] : undefined;
  if (!table && !missing && !fr24) return fail(false, `${t("cliWrite.export.choose")}\n\n${exportHelp()}`);
  const priv = a.flags.has("--private");
  if ((missing || fr24) && priv) return fail(false, t("cliWrite.export.nothingPrivate", { what: a.positional[0]! }));
  if (!fr24 && a.flags.has("--new")) return fail(false, t("cliWrite.export.newMyfr24Only"));
  if (priv && !a.values.has("--out")) return fail(false, t("cliWrite.export.privateNeedsOut"));
  const log = await openOrFail(false, a.values.get("--log"));
  const flights = fr24 ? myFr24Flights(log.store, a.flags.has("--new")) : [];
  const csv = missing ? missingTracksCsv(log.store, log.ref) : fr24 ? myFr24Csv(log.store, log.ref, flights) : tableCsv(log.store, table!, priv);
  if (!a.values.has("--out")) {
    process.stdout.write(csv);
    process.exit(EXIT.ok);
  }
  const out = userPath(a.values.get("--out")!);
  const problem = writeTo(out, csv, a.flags.has("--force"));
  if (problem) return fail(false, problem);
  const rows = missing ? csv.trimEnd().split("\r\n").length - 1 : fr24 ? flights.length : log.store.count(table!);
  const kind = missing ? "missing" : fr24 ? (a.flags.has("--new") ? "myfr24New" : "myfr24") : "table";
  console.log(tc("cliWrite.export.wrote", { kind, rows, table: a.positional[0]!, from: log.from, file: shownPath(out), priv: priv ? "yes" : "no" }, { green }));
  if (fr24) console.log(dim(t("cliWrite.export.importThere")));
  process.exit(EXIT.ok);
}
