import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { applyChanges, SCHEMA_VERSION, Store } from "@touchdown/core";
import { JsonTablesBackend, MemoryFolder, MemorySyncState, SyncEngine } from "@touchdown/storage";
import type { OpenedStorage } from "../src/storage.ts";

// The command line keeps its files in data/private/; here, in a folder of the test's own.
const dir = mkdtempSync(join(tmpdir(), "touchdown-write-"));
process.env.TOUCHDOWN_PRIVATE_DIR = dir;
const { openForWriting, sendChanges, SYNC_FILE } = await import("../src/write.ts");
afterAll(() => rmSync(dir, { recursive: true, force: true }));

/** A folder that can stop taking table writes, as a storage gone offline halfway through a send. */
class FlakyFolder extends MemoryFolder {
  failWrites = false;
  override async write(path: string, data: Uint8Array) {
    if (this.failWrites && path.startsWith("tables/")) throw new Error("offline");
    return super.write(path, data);
  }
}

/** The web app on another device, syncing with the same storage. */
async function webApp(folder: MemoryFolder) {
  const store = new Store({ deviceId: "dev_web" });
  const backend = new JsonTablesBackend(folder, "dev_web");
  await backend.open();
  const engine = new SyncEngine(store, backend, new MemorySyncState());
  await engine.start();
  return { store, engine };
}

const storageOf = (folder: MemoryFolder): OpenedStorage => ({ choice: { kind: "folder", path: "/made-up/log" }, name: "the test folder", files: folder, backend: new JsonTablesBackend(folder, "cli"), schemaVersion: SCHEMA_VERSION });

// Every flight number is made up.
async function aLog(folder: MemoryFolder) {
  const web = await webApp(folder);
  const a = web.store.insert("flights", { flightNumber: "XY100", scheduledDate: "2026-01-02" });
  const b = web.store.insert("flights", { flightNumber: "XY200", scheduledDate: "2026-01-03" });
  await web.engine.sync();
  return { web, a, b };
}

const editOf = (cli: { store: Store }, id: string, set: Record<string, string>) => {
  const row = cli.store.get("flights", id)!;
  return { op: "edit" as const, table: "flights" as const, id, rev: row.rev, set, clear: [] };
};

describe("writing the log from the command line", () => {
  it("sends an import made at the same time as an edit in the web app, and both arrive", async () => {
    const folder = new MemoryFolder();
    const { web, a, b } = await aLog(folder);
    const cli = await openForWriting(() => {}, storageOf(folder));
    expect(cli.store.count("flights")).toBe(2);

    web.store.update("flights", a.id, { seat: "12A" });
    await web.engine.sync();
    const r = applyChanges(cli.store, cli.ref, [editOf(cli, b.id, { seat: "14C" })], () => true, { fileName: "edit-made-up.json" });
    expect(await sendChanges(cli)).toMatchObject({ waiting: 0 });

    await web.engine.sync();
    expect(web.store.get("flights", a.id)).toMatchObject({ seat: "12A" });
    expect(web.store.get("flights", b.id)).toMatchObject({ seat: "14C" });
    expect(web.store.get("flights", b.id)!.updatedBy).toMatch(/^cli_[0-9a-z]{10}$/);
    expect(web.store.get("import_batches", r.batchId)).toMatchObject({ fileName: "edit-made-up.json", status: "committed" });
  });

  it("finishes a send that stopped halfway in the next run, losing nothing and writing nothing twice", async () => {
    const folder = new FlakyFolder();
    const { web, b } = await aLog(folder);
    const cli = await openForWriting(() => {}, storageOf(folder));
    const r = applyChanges(cli.store, cli.ref, [editOf(cli, b.id, { seat: "14C" })], () => true, { fileName: "edit-made-up.json" });
    const history = cli.store.all("record_history").filter((h) => h.batchId === r.batchId).length;
    folder.failWrites = true;
    await expect(sendChanges(cli)).rejects.toThrow("offline");

    // The rows still to send are kept, with their values, for this user only.
    expect(statSync(SYNC_FILE).mode & 0o077).toBe(0);
    const saved = Object.values(JSON.parse(readFileSync(SYNC_FILE, "utf8")) as Record<string, { rows: { table: string }[] }>)[0]!;
    expect(saved.rows.map((x) => x.table)).toEqual(expect.arrayContaining(["flights", "import_batches", "record_history"]));

    folder.failWrites = false;
    const next = await openForWriting(() => {}, storageOf(folder));
    expect(next.resent).toBeGreaterThan(0);
    expect(await sendChanges(next)).toMatchObject({ waiting: 0 });
    await web.engine.sync();
    expect(web.store.get("flights", b.id)).toMatchObject({ seat: "14C" });
    expect(web.store.all("import_batches").filter((x) => x.fileName === "edit-made-up.json")).toHaveLength(1);
    expect(web.store.all("record_history").filter((h) => h.batchId === r.batchId)).toHaveLength(history);
  });

  it("writes only with storage, and only to a log at its own schema version", async () => {
    await expect(openForWriting(() => {}, null)).rejects.toThrow(/No storage chosen/);
    const folder = new MemoryFolder();
    await aLog(folder);
    await expect(openForWriting(() => {}, { ...storageOf(folder), schemaVersion: SCHEMA_VERSION - 1 })).rejects.toThrow(/Open the web app once/);
  });
});
