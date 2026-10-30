import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { attachTrack, readBackup, RefIndex, saveFlight, Store, todayIn } from "@touchdown/core";
import { JsonTablesBackend, MemorySyncState, SyncEngine } from "@touchdown/storage";
import { loadRefTables } from "@touchdown/refdata";
import { NodeFolder } from "../src/folder.ts";

// The command line keeps its files in data/private/; here, in a folder of the test's own. The log is in another
// folder, chosen as the storage, as `./touchdown storage folder PATH` does.
const dir = mkdtempSync(join(tmpdir(), "touchdown-importfile-"));
const LOG = join(dir, "Touchdown");
const PRIVATE = join(dir, "private");
process.env.TOUCHDOWN_PRIVATE_DIR = PRIVATE;
const { saveStorage } = await import("../src/settings.ts");
const { importCommand } = await import("../src/importfile.ts");
const { inboxCommand } = await import("../src/inbox.ts");
const { reviewCommand } = await import("../src/review.ts");
const { backupCommand, exportCommand } = await import("../src/backup.ts");
const { storageCommand } = await import("../src/storage.ts");
afterAll(() => rmSync(dir, { recursive: true, force: true }));

// Every flight number, date and registration here is made up; the ticket number is a canary no command may print.
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
  const points = Array.from({ length: 30 }, (_, i) => ({ t: 1773500000 + i * 60, lat: 51.47 + i * 0.1, lon: -0.45 - i * 0.5, altitudeFt: 30000, groundSpeedKt: 450, headingDeg: 280 }));
  attachTrack(web.store, flightId, points, { provider: "fr24_csv", attribution: "Track data: test", coverage: "partial" });
  await web.engine.sync();
  saveStorage({ kind: "folder", path: LOG });
});

class Exit extends Error {
  constructor(readonly code: number) {
    super(`exit ${code}`);
  }
}

async function run(command: (args: string[], ref: RefIndex) => Promise<unknown>, args: string[]) {
  const out: string[] = [];
  vi.spyOn(console, "log").mockImplementation((...a: unknown[]) => void out.push(a.join(" ")));
  vi.spyOn(console, "error").mockImplementation((...a: unknown[]) => void out.push(a.join(" ")));
  vi.spyOn(process.stdout, "write").mockImplementation(((s: string) => void out.push(String(s))) as never);
  vi.spyOn(process, "exit").mockImplementation(((code: number) => {
    throw new Exit(code);
  }) as never);
  let code = 0;
  try {
    await command(args, new RefIndex(loadRefTables()));
  } catch (e) {
    if (!(e instanceof Exit)) throw e;
    code = e.code;
  }
  vi.restoreAllMocks();
  const text = out.join("\n");
  return { text, code, json: () => JSON.parse(text.slice(text.indexOf("{"))) };
}
afterEach(() => vi.restoreAllMocks());

const importing = (args: string[], ref: RefIndex) => importCommand(args, ref, "help");
const inbox = () => (existsSync(join(LOG, "inbox")) ? readdirSync(join(LOG, "inbox")).filter((n) => n.endsWith(".json")) : []);
const csv = (name: string, text: string) => {
  const path = join(dir, name);
  writeFileSync(path, text);
  return path;
};

describe("importing a file to the inbox", () => {
  it("checks a spreadsheet against the log, puts it in the inbox without printing private values, and review imports it", async () => {
    const file = csv("flights.csv", `Date,Flight,From,To,Seat,Ticket\n2026-03-14,BA9001,EGLL,KJFK,14C,\n2026-04-02,DL9002,KJFK,KBOS,21F,${TICKET}\n`);
    const r = await run(importing, [file, "--json"]);
    expect(r.code).toBe(0);
    const report = r.json().files[0];
    expect(report).toMatchObject({ file: "flights.csv", format: "sheet", kind: "flights", rows: 2, counts: { new: 1, conflict: 1, identical: 0, waiting: 0 }, notWritten: null });
    expect(report.columns).toContainEqual({ header: "Ticket", field: "ticketNumber" });
    expect(report.differs).toEqual([{ row: 2, title: expect.stringContaining("BA9001"), fields: [{ field: "seat", label: "Seat", yours: "12A", file: "14C" }] }]);
    expect(report.written).toMatch(/^import-\d{4}-\d{2}-\d{2}-\d{6}-flights\.csv\.json$/);
    expect(inbox()).toEqual([report.written]);

    // The same file again: its rows are waiting in the inbox already.
    const again = (await run(importing, [file, "--json"])).json().files[0];
    expect(again).toMatchObject({ counts: { new: 0, conflict: 0, waiting: 2 }, written: null, notWritten: "nothing new" });
    expect(inbox()).toHaveLength(1);

    // The inbox shows the columns, and a private column only as given.
    const shown = await run(inboxCommand, ["show", report.written, "--json"]);
    expect(shown.json()).toMatchObject({ sheet: { file: "flights.csv", rows: 2 }, records: [{}, { values: { Flight: "DL9002", Ticket: "(given)" } }] });
    const text = await run(inboxCommand, ["show", report.written]);
    expect(text.text).toMatch(/File flights\.csv from \.\/touchdown import/);

    const done = await run(reviewCommand, ["--yes", "--json"]);
    expect(done.json()).toMatchObject({ ok: true, imported: { rows: 2, changes: 0 } });
    const web = await webApp();
    const dl = web.store.all("flights").find((f) => f.flightNumber === "DL9002")!;
    expect(dl).toMatchObject({ ticketNumber: null, seat: "21F" });
    expect(web.store.get("flight_private", dl.id)).toMatchObject({ ticketNumber: TICKET });
    expect(web.store.get("flights", flightId)!.seat).toBe("12A");
    expect(web.store.all("import_batches").find((b) => b.fileName === "flights.csv")).toMatchObject({ status: "committed" });
    for (const x of [r, shown, text, done]) expect(x.text).not.toContain(TICKET);

    // Imported: one row is in the log, and the other still differs (the log's seat was kept).
    const after = (await run(importing, [file, "--dry-run", "--json"])).json().files[0];
    expect(after).toMatchObject({ counts: { identical: 1, conflict: 1 }, notWritten: "dry-run" });
  });

  it("reads the Flightradar24 export with its own reader, and keeps a file with errors out unless --keep-errors", async () => {
    const header = "Date,Flight number,From,To,Dep time,Arr time,Duration,Airline,Aircraft,Registration,Seat number,Seat type,Flight class,Flight reason,Note";
    const fr24 = csv("fr24.csv", `${header}\n2026-05-01,UA9003,Boston (BOS/KBOS),Seattle (SEA/KSEA),08:00:00,11:10:00,06:10:00,United Airlines (UA/UAL),Boeing 737 MAX 9 (B39M),N9003Z,14A,1,1,1,\n`);
    const r = (await run(importing, [fr24, "--json"])).json().files[0];
    expect(r).toMatchObject({ format: "fr24_csv", columns: null, counts: { new: 1 } });
    const kept = JSON.parse(readFileSync(join(LOG, "inbox", r.written), "utf8"));
    expect(kept.sheet).toMatchObject({ fileName: "fr24.csv", mapping: null, firstRow: 2 });

    const wrong = csv("wrong.csv", "Date,Flight,From,To\n2026-05-02,UA9004,KSEA,QQQQ\n");
    const refused = await run(importing, [wrong, "--json"]);
    expect(refused.code).toBe(1);
    expect(refused.json().files[0]).toMatchObject({ notWritten: "errors", written: null });
    expect(refused.json().files[0].problems.some((p: { severity: string }) => p.severity === "error")).toBe(true);
    const keptErrors = await run(importing, [wrong, "--keep-errors", "--json"]);
    expect(keptErrors).toMatchObject({ code: 0 });
    expect(keptErrors.json().files[0].written).toMatch(/^import-.*-wrong\.csv\.json$/);
  });

  it("asks for --out with the options that build a backup, and reports a file it cannot read", async () => {
    expect(await run(importing, ["x.csv", "--tracks", "dir"])).toMatchObject({ code: 2, text: expect.stringMatching(/--tracks is for building a backup/) });
    expect((await run(importing, [join(dir, "missing.csv"), "--json"])).json()).toMatchObject({ ok: false, files: [{ file: "missing.csv", error: expect.stringMatching(/could not be read/) }] });
  });
});

describe("the storage, for agents", () => {
  it("is shown as JSON with what it holds", async () => {
    expect((await run(storageCommand, ["--json"])).json()).toMatchObject({ ok: true, storage: { kind: "folder", schemaVersion: expect.any(Number) }, log: { flights: expect.any(Number) }, problems: [] });
  });
});

describe("backup and export", () => {
  it("downloads a backup with private fields and tracks, readable only by the user, without replacing one", async () => {
    const zip = join(dir, "out", "backup.zip");
    const r = await run(backupCommand, ["--out", zip, "--json"]);
    expect(r.json()).toMatchObject({ ok: true, counts: { tracks: 1 } });
    expect(statSync(zip).mode & 0o077).toBe(0);
    const b = readBackup(new Uint8Array(readFileSync(zip)));
    expect(b.problems).toEqual([]);
    const dl = b.tables.get("flights")!.find((f) => f.flightNumber === "DL9002")!;
    expect(dl).toMatchObject({ ticketNumber: null });
    expect(b.tables.get("flight_private")!.find((p) => p.id === dl.id)).toMatchObject({ ticketNumber: TICKET });
    expect(b.tables.get("track_points")).toHaveLength(30);
    expect(r.text).not.toContain(TICKET);

    expect(await run(backupCommand, ["--out", zip])).toMatchObject({ code: 2, text: expect.stringMatching(/exists/) });
    expect(await run(backupCommand, ["--out", zip, "--force"])).toMatchObject({ code: 0 });
    await run(backupCommand, []);
    await run(backupCommand, []);
    expect(readdirSync(PRIVATE).filter((n) => n.startsWith("touchdown-backup-")).sort()).toEqual([`touchdown-backup-${todayIn()}-2.zip`, `touchdown-backup-${todayIn()}.zip`]);
  });

  it("exports a table as CSV, with private fields only to a file", async () => {
    const shown = await run(exportCommand, ["flights"]);
    expect(shown.code).toBe(0);
    expect(shown.text).toMatch(/^id,/);
    expect(shown.text).toContain("DL9002");
    expect(shown.text).not.toContain(TICKET);
    expect(shown.text).not.toMatch(/ticketNumber/);

    expect(await run(exportCommand, ["flights", "--private"])).toMatchObject({ code: 2, text: expect.stringMatching(/only to a file/) });
    const out = join(dir, "flights-private.csv");
    const written = await run(exportCommand, ["flights", "--private", "--out", out]);
    expect(written.text).not.toContain(TICKET);
    expect(readFileSync(out, "utf8")).toContain(TICKET);
    expect(statSync(out).mode & 0o077).toBe(0);
    expect(await run(exportCommand, ["aircraft"])).toMatchObject({ code: 0, text: expect.stringMatching(/^id,.*,msn,/) });
    expect(await run(exportCommand, ["toString"])).toMatchObject({ code: 2 });
  });
});
