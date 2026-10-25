import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { RefIndex, saveFlight, Store } from "@touchdown/core";
import { JsonTablesBackend, MemorySyncState, SyncEngine } from "@touchdown/storage";
import { loadRefTables } from "@touchdown/refdata";
import { NodeFolder } from "../src/folder.ts";

// The command line keeps its files in data/private/; here, in a folder of the test's own. The log is in another
// folder, chosen as the storage, as `./touchdown storage folder PATH` does.
const dir = mkdtempSync(join(tmpdir(), "touchdown-review-"));
const LOG = join(dir, "Touchdown");
process.env.TOUCHDOWN_PRIVATE_DIR = join(dir, "private");
const { saveStorage } = await import("../src/settings.ts");
const { reviewCommand } = await import("../src/review.ts");
const { addCommand } = await import("../src/add.ts");
const { editCommand } = await import("../src/change.ts");
afterAll(() => rmSync(dir, { recursive: true, force: true }));

// Every flight number and date here is made up; the ticket number is a canary no command may print.
const TICKET = "0019990000001";

/** The web app on another device, syncing with the folder. */
async function webApp() {
  const store = new Store({ deviceId: "dev_web" });
  const backend = new JsonTablesBackend(new NodeFolder(LOG), "dev_web");
  await backend.open();
  const engine = new SyncEngine(store, backend, new MemorySyncState());
  await engine.start();
  await engine.sync();
  return { store, engine };
}

let flightId = "";
beforeAll(async () => {
  mkdirSync(LOG, { recursive: true });
  const web = await webApp();
  flightId = saveFlight(web.store, new RefIndex(loadRefTables()), { scheduledDate: "2026-03-14", flightNumber: "BA9001", airlineRaw: "BA", fromRaw: "EGLL", toRaw: "KJFK", seat: "12A" }).row.id;
  await web.engine.sync();
  saveStorage({ kind: "folder", path: LOG });
});

class Exit extends Error {
  constructor(readonly code: number) {
    super(`exit ${code}`);
  }
}

async function run(command: (args: string[], ...rest: never[]) => Promise<unknown>, args: string[], stdin?: string) {
  const out: string[] = [];
  vi.spyOn(console, "log").mockImplementation((...a: unknown[]) => void out.push(a.join(" ")));
  vi.spyOn(console, "error").mockImplementation((...a: unknown[]) => void out.push(a.join(" ")));
  vi.spyOn(process, "exit").mockImplementation(((code: number) => {
    throw new Exit(code);
  }) as never);
  let code = 0;
  try {
    if (stdin !== undefined) {
      const file = join(dir, `input-${Math.random().toString(36).slice(2)}.json`);
      writeFileSync(file, stdin);
      await command([file, ...args], new RefIndex(loadRefTables()) as never);
    } else await command(args, new RefIndex(loadRefTables()) as never);
  } catch (e) {
    if (!(e instanceof Exit)) throw e;
    code = e.code;
  }
  vi.restoreAllMocks();
  const text = out.join("\n");
  return { text, code, json: () => JSON.parse(text.slice(text.indexOf("{"))) };
}
afterEach(() => vi.restoreAllMocks());

const inbox = () => (existsSync(join(LOG, "inbox")) ? readdirSync(join(LOG, "inbox")).filter((n) => n.endsWith(".json")) : []);

describe("reviewing in the terminal", () => {
  it("shows a file's review without importing, then imports it with the defaults, and the web app sees it", async () => {
    const added = await run(addCommand, ["--json"], JSON.stringify({ flights: [{ date: "2026-04-02", flightNumber: "DL9002", from: "KJFK", to: "KBOS", ticketNumber: TICKET }] }));
    expect(added.json()).toMatchObject({ written: { flights: 1 } });
    expect(inbox()).toHaveLength(1);

    const shown = await run(reviewCommand, ["--json"]);
    expect(shown.json()).toMatchObject({ ok: true, wouldImport: { rows: 1, changes: 0 }, rows: [{ kind: "new", title: "Flight DL9002 on 2026-04-02, KJFK → KBOS" }] });
    expect(inbox()).toHaveLength(1);

    const done = await run(reviewCommand, ["--yes", "--json"]);
    expect(done.json()).toMatchObject({ ok: true, imported: { rows: 1, changes: 0 }, waiting: 0, fileKept: "with the import" });
    expect(inbox()).toHaveLength(0);
    expect(readdirSync(join(LOG, "attachments", "imports"))).toHaveLength(1);

    const web = await webApp();
    expect(web.store.all("flights").find((f) => f.flightNumber === "DL9002")).toMatchObject({ ticketNumber: TICKET, fromRaw: "KJFK" });
    for (const r of [added, shown, done]) expect(r.text).not.toContain(TICKET);
  });

  it("keeps the log's value where a file differs, unless taken, and imports changes from the changing commands", async () => {
    await run(addCommand, ["--json"], JSON.stringify({ flights: [{ date: "2026-03-14", flightNumber: "BA9001", from: "EGLL", to: "KJFK", seat: "14C" }] }));
    const shown = (await run(reviewCommand, ["--json"])).json();
    expect(shown.rows[0]).toMatchObject({ kind: "conflict", differs: [{ field: "seat", yours: "12A", file: "14C" }] });
    await run(reviewCommand, ["--yes"]);
    expect((await webApp()).store.get("flights", flightId)!.seat).toBe("12A");

    expect((await run(editCommand, ["BA9001@2026-03-14", "--set", "seat=21F", "--json"])).json()).toMatchObject({ written: { changes: 1 } });
    const done = await run(reviewCommand, ["--yes", "--json"]);
    expect(done.json()).toMatchObject({ imported: { rows: 0, changes: 1 } });
    expect((await webApp()).store.get("flights", flightId)).toMatchObject({ seat: "21F" });
  });

  it("says when nothing is waiting, and asks only at a terminal", async () => {
    expect((await run(reviewCommand, ["--json"])).json()).toMatchObject({ ok: true, file: null });
    await run(addCommand, ["--json"], JSON.stringify({ sightings: [{ date: "2026-05-01", registration: "N9003Z", airport: "KBOS" }] }));
    expect(await run(reviewCommand, [])).toMatchObject({ code: 2, text: expect.stringMatching(/asks its questions at a terminal/) });
    expect(inbox()).toHaveLength(1);
  });
});
