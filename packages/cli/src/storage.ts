// Where the CLI finds the user's log and its inbox (docs/21, "Getting a session to the web app"): the storage the web
// app syncs with, Google Drive or a folder, through the backend interface (S7). The CLI reads the log and writes only
// to the inbox; it never creates a log or upgrades one. Without storage, the log is read from a backup file and
// files are saved in data/private/inbox/, where the web app's dev server finds them.

import { existsSync } from "node:fs";
import { join } from "node:path";
import { operatorFromOverride, SCHEMA_NAME, SCHEMA_VERSION, Store, type RefIndex } from "@touchdown/core";
import { GoogleDrive, JsonTablesBackend, type FileAdapter } from "@touchdown/storage";
import { NodeFolder } from "./folder.ts";
import { BrowserDriveAuth, forgetDriveAccess, StandardDriveAuth } from "./google.ts";
import { savedSession, siteFetch } from "./site.ts";
import { shownPath, userPath } from "./paths.ts";
import { savedStorage, saveStorage, type StorageChoice } from "./settings.ts";
import { bold, dim, green, plural, red } from "./term.ts";

export const STORAGE_HELP = `Usage: ./touchdown storage [drive | folder PATH | none]

Where the CLI finds your log and sends what you add: the storage the web app syncs with. With it, spot
looks registrations up in your log as it is now, and spot and add put their files in the log's inbox, which
the web app shows for review on any device. The CLI only reads your log; it writes nothing but the inbox.

  (nothing)     show the storage and what it holds
  drive         use the log in your Google Drive (sign in first with ./touchdown login). In Standard mode
                the site gives the access, as it gives your browser. In Private mode your browser does:
                a Touchdown page opens and passes an hour's access to the command line, and opens again
                when the hour is over
  folder PATH   use the log in a folder on this computer: the folder the web app syncs with
  none          no storage: spot reads data/private/touchdown-backup.zip and files are saved in
                data/private/inbox/ (the web app's dev server picks them up)

The choice belongs to this computer (data/private/touchdown-cli.json). Private mode's hour of access is
kept in data/private/google-access.json until it runs out.`;

/** The storage holds no Touchdown log, or none the CLI can see. */
export class NoLog extends Error {}

export interface OpenedStorage {
  choice: StorageChoice;
  /** As the user knows it: "Google Drive (address)", or the folder's path. */
  name: string;
  files: FileAdapter;
  backend: JsonTablesBackend;
  schemaVersion: number;
}

export const storageName = (c: StorageChoice) => (c.kind === "gdrive" ? `Google Drive (${c.account})` : shownPath(c.path));

function filesFor(c: StorageChoice): FileAdapter {
  if (c.kind === "folder") return new NodeFolder(c.path);
  if (!savedSession()) throw new Error("The command line is not signed in to Touchdown. Sign in with ./touchdown login.");
  return new GoogleDrive(c.via === "standard" ? new StandardDriveAuth() : new BrowserDriveAuth(c.account));
}

/** Open the storage and check that it holds a log this version reads. Nothing is written. */
export async function openStorage(c: StorageChoice, files: FileAdapter = filesFor(c)): Promise<OpenedStorage> {
  const found = await files.read("manifest.json");
  if (!found) throw new NoLog(c.kind === "gdrive" ? `There is no Touchdown log the CLI can see in ${storageName(c)}.` : `${storageName(c)} holds no Touchdown log (no manifest.json).`);
  let manifest: { schema?: string; backend?: string; schemaVersion?: number };
  try {
    manifest = JSON.parse(new TextDecoder().decode(found.data)) as typeof manifest;
  } catch {
    throw new Error(`${storageName(c)}: manifest.json is not valid JSON.`);
  }
  if (manifest.schema !== SCHEMA_NAME || manifest.backend !== "json_tables") throw new Error(`${storageName(c)} does not hold a Touchdown log in JSON tables.`);
  const version = Number(manifest.schemaVersion);
  if (version > SCHEMA_VERSION) throw new Error(`The log uses schema version ${version}; this copy of Touchdown reads up to ${SCHEMA_VERSION}. Update it: git pull, then npm install.`);
  return { choice: c, name: storageName(c), files, backend: new JsonTablesBackend(files, "cli"), schemaVersion: version };
}

/** The storage chosen with `./touchdown storage`, opened; null when there is none. */
export async function chosenStorage(): Promise<OpenedStorage | null> {
  const c = savedStorage();
  return c ? openStorage(c) : null;
}

/** The whole log, read-only. The user's own operators are added to `ref`. */
export async function readLog(s: OpenedStorage, ref: RefIndex): Promise<{ store: Store; problems: string[] }> {
  const pulled = await s.backend.pull({});
  const store = new Store({ deviceId: "cli", validate: false });
  for (const [table, rows] of pulled.tables) store.load(table, rows as never);
  for (const op of store.all("operator_overrides")) ref.addOperator(operatorFromOverride(op));
  return { store, problems: pulled.problems };
}

/** The inbox's files: sessions and additions waiting for review in the web app. */
export async function inboxFiles(s: OpenedStorage): Promise<string[]> {
  return (await s.backend.listFiles("inbox")).map((f) => f.name).filter((n) => n.endsWith(".json")).sort();
}

async function describe(s: OpenedStorage, ref: RefIndex) {
  const { store, problems } = await readLog(s, ref);
  const waiting = await inboxFiles(s);
  console.log(`${bold("Storage")}  ${s.name}`);
  console.log(`  Log      ${plural(store.all("flights").length, "flight")}, ${plural(store.all("sightings").length, "sighting")} ${dim(`(schema version ${s.schemaVersion})`)}`);
  console.log(`  Inbox    ${waiting.length ? `${plural(waiting.length, "file")} waiting for review in the web app` : "empty"}`);
  for (const p of problems) console.log(red(`  ${p}`));
}

/** `./touchdown storage …`: show or choose where the log is. */
export async function storageCommand(args: string[], ref: RefIndex): Promise<void> {
  const [what, ...rest] = args;
  if (what === "--help" || what === "-h" || (what && !["drive", "folder", "none"].includes(what)) || (what !== "folder" && rest.length) || (what === "folder" && rest.length !== 1)) {
    console.log(STORAGE_HELP);
    process.exit(what === "--help" || what === "-h" ? 0 : 1);
  }
  const current = savedStorage();

  if (!what) {
    if (!current) {
      console.log("No storage chosen. spot reads your log from data/private/touchdown-backup.zip, and files are saved in");
      console.log("data/private/inbox/, where the web app's dev server picks them up.");
      console.log(dim("Choose one with ./touchdown storage drive, or ./touchdown storage folder PATH."));
      return;
    }
    await describe(await openStorage(current), ref);
    return;
  }

  if (what === "none") {
    forgetDriveAccess();
    saveStorage(null);
    console.log("No storage. spot reads data/private/touchdown-backup.zip, and files are saved in data/private/inbox/.");
    return;
  }

  let choice: StorageChoice;
  if (what === "folder") {
    const path = userPath(rest[0]!);
    const root = existsSync(join(path, "manifest.json")) ? path : existsSync(join(path, "Touchdown", "manifest.json")) ? join(path, "Touchdown") : null;
    if (!root) {
      console.error(red(`${shownPath(path)} holds no Touchdown log. Give the folder the web app syncs with (it has manifest.json in it).`));
      process.exit(1);
    }
    choice = { kind: "folder", path: root };
  } else {
    const session = savedSession();
    if (!session) {
      console.error(red("Sign in to Touchdown first: ./touchdown login."));
      process.exit(1);
    }
    // Standard mode when the site keeps a working key for this account; Private mode's browser hand-over otherwise.
    const st = (await (await siteFetch("/api/storage")).json()) as { connected?: boolean; account?: string | null; status?: string | null };
    if (st.connected && st.account && st.status === "ok") {
      choice = { kind: "gdrive", account: st.account, via: "standard" };
      console.log(`Standard mode: the site gives the command line access to Google Drive (${st.account}).`);
    } else {
      if (st.connected) console.log(dim("The site's key to your Google Drive no longer works; your browser gives the access instead."));
      forgetDriveAccess();
      const account = await new BrowserDriveAuth(current?.kind === "gdrive" ? current.account : null, { say: (l) => console.log(dim(l)) }).signedInAccount();
      choice = { kind: "gdrive", account, via: "browser" };
      console.log(`Private mode: your browser gave the command line an hour's access to Google Drive (${account}).`);
    }
  }

  let opened: OpenedStorage;
  try {
    opened = await openStorage(choice);
  } catch (e) {
    if (!(e instanceof NoLog)) throw e;
    console.error(red(e.message));
    if (choice.kind === "gdrive") console.error("The web app does not sync to this Google account yet (in the web app: Settings, Sync mode). The storage is not changed.");
    process.exit(1);
  }
  saveStorage(choice);
  console.log(green("Saved."));
  await describe(opened, ref);
}
