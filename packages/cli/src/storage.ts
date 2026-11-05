// Where the CLI finds the user's log and its inbox (docs/21, "Getting a session to the web app"): the storage the web
// app syncs with, Google Drive or a folder, through the backend interface (S7). The CLI reads the log and writes only
// to the inbox; it never creates a log or upgrades one. Without storage, the log is read from a backup file and
// files are saved in data/private/inbox/, where the web app's dev server finds them.

import { t } from "@touchdown/i18n/cli";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { operatorFromOverride, SCHEMA_NAME, SCHEMA_VERSION, Store, type RefIndex } from "@touchdown/core";
import { GoogleDrive, JsonTablesBackend, type FileAdapter } from "@touchdown/storage";
import { NodeFolder } from "./folder.ts";
import { BrowserDriveAuth, forgetDriveAccess, StandardDriveAuth } from "./google.ts";
import { savedSession, siteFetch } from "./site.ts";
import { privatePath, shownPath, userPath } from "./paths.ts";
import { savedStorage, saveStorage, type StorageChoice } from "./settings.ts";
import { bold, dim, green, red, tc } from "./term.ts";

export const storageHelp = () => t("cli.help.storage");

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

export const storageName = (c: StorageChoice) => (c.kind === "gdrive" ? t("cliWrite.storage.driveName", { account: c.account }) : shownPath(c.path));

function filesFor(c: StorageChoice): FileAdapter {
  if (c.kind === "folder") return new NodeFolder(c.path);
  if (!savedSession()) throw new Error(t("cli.notSignedIn"));
  return new GoogleDrive(c.via === "standard" ? new StandardDriveAuth() : new BrowserDriveAuth(c.account));
}

/** Open the storage and check that it holds a log this version reads. Nothing is written. */
export async function openStorage(c: StorageChoice, files: FileAdapter = filesFor(c)): Promise<OpenedStorage> {
  const found = await files.read("manifest.json");
  if (!found) throw new NoLog(c.kind === "gdrive" ? t("cliWrite.storage.noLogDrive", { place: storageName(c) }) : t("cliWrite.storage.noLogFolder", { place: storageName(c) }));
  let manifest: { schema?: string; backend?: string; schemaVersion?: number };
  try {
    manifest = JSON.parse(new TextDecoder().decode(found.data)) as typeof manifest;
  } catch {
    throw new Error(t("cliWrite.storage.badManifest", { place: storageName(c) }));
  }
  if (manifest.schema !== SCHEMA_NAME || manifest.backend !== "json_tables") throw new Error(t("cliWrite.storage.notJsonTables", { place: storageName(c) }));
  const version = Number(manifest.schemaVersion);
  if (version > SCHEMA_VERSION) throw new Error(t("cliWrite.storage.newerSchema", { version, known: SCHEMA_VERSION }));
  return { choice: c, name: storageName(c), files, backend: new JsonTablesBackend(files, "cli"), schemaVersion: version };
}

/** The storage chosen with `./touchdown storage`, opened; null when there is none. */
export async function chosenStorage(): Promise<OpenedStorage | null> {
  const c = savedStorage();
  return c ? openStorage(c) : null;
}

/** The whole log, read-only; with `tracks`, every track's points as well. The user's own operators are added to `ref`. */
export async function readLog(s: OpenedStorage, ref: RefIndex, opts: { tracks?: boolean } = {}): Promise<{ store: Store; problems: string[] }> {
  const pulled = await s.backend.pull({});
  const store = new Store({ deviceId: "cli", validate: false });
  for (const [table, rows] of pulled.tables) store.load(table, rows as never);
  if (opts.tracks) {
    // Read at once; the file adapter sends as many requests at a time as its storage takes.
    const read = await Promise.all(pulled.tracks.map((id) => s.backend.readTrack(id).catch((e: Error) => e)));
    pulled.tracks.forEach((id, i) => {
      const points = read[i]!;
      if (points instanceof Error) pulled.problems.push(`tracks/${id}.json: ${points.message}`);
      else store.load("track_points", points as never);
    });
  }
  for (const op of store.all("operator_overrides")) ref.addOperator(operatorFromOverride(op));
  return { store, problems: pulled.problems };
}

/** The inbox's files: sessions and additions waiting for review in the web app. */
export async function inboxFiles(s: OpenedStorage): Promise<string[]> {
  return (await s.backend.listFiles("inbox")).map((f) => f.name).filter((n) => n.endsWith(".json")).sort();
}

/** `storage --json`: the storage chosen and what it holds, for agents and scripts. Exit 2 when it cannot be read. */
async function storageJson(ref: RefIndex) {
  const c = savedStorage();
  if (!c) return void console.log(JSON.stringify({ ok: true, storage: null, inbox: shownPath(privatePath("inbox")) }, null, 2));
  try {
    const s = await openStorage(c);
    const { store, problems } = await readLog(s, ref);
    console.log(JSON.stringify({ ok: true, storage: { kind: c.kind, name: s.name, schemaVersion: s.schemaVersion }, log: { flights: store.count("flights"), sightings: store.count("sightings") }, inbox: (await inboxFiles(s)).length, problems }, null, 2));
  } catch (e) {
    console.log(JSON.stringify({ ok: false, storage: { kind: c.kind, name: storageName(c) }, error: (e as Error).message }, null, 2));
    process.exit(2);
  }
}

async function describe(s: OpenedStorage, ref: RefIndex) {
  const { store, problems } = await readLog(s, ref);
  const waiting = await inboxFiles(s);
  // Labels lined up in a column of nine.
  const gap = (label: string) => " ".repeat(Math.max(1, 9 - label.length));
  const label = (l: string) => `  ${l}${gap(l)}`;
  console.log(`${bold(t("cliWrite.storage.label.storage"))}${gap(t("cliWrite.storage.label.storage"))}${s.name}`);
  console.log(`${label(t("cliWrite.storage.label.log"))}${tc("cliWrite.storage.log", { flights: store.all("flights").length, sightings: store.all("sightings").length, version: s.schemaVersion }, { dim })}`);
  console.log(`${label(t("cliWrite.storage.label.inbox"))}${t("cliWrite.storage.inbox", { files: waiting.length })}`);
  for (const p of problems) console.log(red(`  ${p}`));
}

/** `./touchdown storage …`: show or choose where the log is. */
export async function storageCommand(args: string[], ref: RefIndex): Promise<void> {
  if (args[0] === "--json" && args.length === 1) return storageJson(ref);
  const [what, ...rest] = args;
  if (what === "--help" || what === "-h" || (what && !["drive", "folder", "none"].includes(what)) || (what !== "folder" && rest.length) || (what === "folder" && rest.length !== 1)) {
    console.log(storageHelp());
    process.exit(what === "--help" || what === "-h" ? 0 : 1);
  }
  const current = savedStorage();

  if (!what) {
    if (!current) {
      console.log(t("cliWrite.storage.noneChosen"));
      console.log(dim(t("cliWrite.storage.chooseOne")));
      return;
    }
    await describe(await openStorage(current), ref);
    return;
  }

  if (what === "none") {
    forgetDriveAccess();
    saveStorage(null);
    console.log(t("cliWrite.storage.none"));
    return;
  }

  let choice: StorageChoice;
  if (what === "folder") {
    const path = userPath(rest[0]!);
    const root = existsSync(join(path, "manifest.json")) ? path : existsSync(join(path, "Touchdown", "manifest.json")) ? join(path, "Touchdown") : null;
    if (!root) {
      console.error(red(t("cliWrite.storage.folderNoLog", { path: shownPath(path) })));
      process.exit(1);
    }
    choice = { kind: "folder", path: root };
  } else {
    const session = savedSession();
    if (!session) {
      console.error(red(t("cliWrite.storage.signInFirst")));
      process.exit(1);
    }
    // Standard mode when the site keeps a working key for this account; Private mode's browser hand-over otherwise.
    const st = (await (await siteFetch("/api/storage")).json()) as { connected?: boolean; account?: string | null; status?: string | null };
    if (st.connected && st.account && st.status === "ok") {
      choice = { kind: "gdrive", account: st.account, via: "standard" };
      console.log(t("cliWrite.storage.standard", { account: st.account }));
    } else {
      if (st.connected) console.log(dim(t("cliWrite.storage.keyBroken")));
      forgetDriveAccess();
      const account = await new BrowserDriveAuth(current?.kind === "gdrive" ? current.account : null, { say: (l) => console.log(dim(l)) }).signedInAccount();
      choice = { kind: "gdrive", account, via: "browser" };
      console.log(t("cliWrite.storage.private", { account }));
    }
  }

  let opened: OpenedStorage;
  try {
    opened = await openStorage(choice);
  } catch (e) {
    if (!(e instanceof NoLog)) throw e;
    console.error(red(e.message));
    if (choice.kind === "gdrive") console.error(t("cliWrite.storage.notSynced"));
    process.exit(1);
  }
  saveStorage(choice);
  console.log(green(t("cliWrite.storage.saved")));
  await describe(opened, ref);
}
