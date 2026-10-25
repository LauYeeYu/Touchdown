import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { applyChanges, backupZip, readBackup, readInbox, RefIndex, saveFlight, saveSighting, Store, type InboxFile } from "@touchdown/core";
import { loadRefTables } from "@touchdown/refdata";

// The command line keeps its files in data/private/; here, in a folder of the test's own: the inbox the commands
// write to is the test's.
const dir = mkdtempSync(join(tmpdir(), "touchdown-change-"));
process.env.TOUCHDOWN_PRIVATE_DIR = dir;
const { deleteCommand, editCommand, familiesCommand, settingsCommand, undoCommand } = await import("../src/change.ts");
const { statsCommand } = await import("../src/stats.ts");
const { aircraftCommand } = await import("../src/aircraft.ts");
const { importsCommand, issuesCommand } = await import("../src/issues.ts");
afterAll(() => rmSync(dir, { recursive: true, force: true }));

// Every flight number, registration, date and private value here is made up; the private values are canaries.
const TICKET = "0019990000001";
const NEW_TICKET = "0019990000077";
const LOG = join(dir, "log.zip");
const INBOX = join(dir, "inbox");

beforeAll(() => {
  const ref = new RefIndex(loadRefTables());
  const store = new Store({ deviceId: "test" });
  saveFlight(store, ref, { scheduledDate: "2025-03-14", flightNumber: "BA9001", airlineRaw: "BA", fromRaw: "EGLL", toRaw: "KJFK", takeoffAt: "2025-03-14T11:00+00:00", seat: "12A", departureGate: "B7", registrationRaw: "G-ZZZA", typeCodeRaw: "B77W", ticketNumber: TICKET });
  // A G- registration on a US airline: a note to accept.
  saveFlight(store, ref, { scheduledDate: "2025-04-02", flightNumber: "DL9002", airlineRaw: "DL", fromRaw: "KJFK", toRaw: "KBOS", registrationRaw: "G-ZZZB", typeCodeRaw: "A21N" });
  saveSighting(store, ref, { seenOn: "2026-01-10", airportRaw: "KBOS", registrationRaw: "N9001Z", typeCodeRaw: "B738", operatorRaw: "DAL" }, undefined, ["night"]);
  saveSighting(store, ref, { seenOn: "2026-01-11", airportRaw: "KBOS", registrationRaw: "N9001Z", typeCodeRaw: "B738", operatorRaw: "DAL" });
  store.insert("import_batches", { createdAt: "2026-01-11T09:00:00Z", sourceKind: "sheet", fileName: "made-up.csv", rowsRead: 1, rowsAccepted: 1, status: "committed" });
  writeFileSync(LOG, backupZip(store));
});

class Exit extends Error {
  constructor(readonly code: number) {
    super(`exit ${code}`);
  }
}

async function run(command: (args: string[]) => Promise<unknown>, ...args: string[]) {
  const out: string[] = [];
  vi.spyOn(console, "log").mockImplementation((...a: unknown[]) => void out.push(a.join(" ")));
  vi.spyOn(console, "error").mockImplementation((...a: unknown[]) => void out.push(a.join(" ")));
  vi.spyOn(process, "exit").mockImplementation(((code: number) => {
    throw new Exit(code);
  }) as never);
  let code = 0;
  try {
    await command([...args, "--log", LOG]);
  } catch (e) {
    if (!(e instanceof Exit)) throw e;
    code = e.code;
  }
  vi.restoreAllMocks();
  const text = out.join("\n");
  return { text, code, json: () => JSON.parse(text) };
}
afterEach(() => vi.restoreAllMocks());

const inbox = () => readdirSync(INBOX).filter((n) => n.endsWith(".json")).sort();
const fileOf = (name: string) => JSON.parse(readFileSync(join(INBOX, name), "utf8")) as InboxFile;

/** The log as the backup holds it, to import a written file into. */
function theLog() {
  const ref = new RefIndex(loadRefTables());
  const store = new Store({ deviceId: "web" });
  for (const [t, rows] of readBackup(new Uint8Array(readFileSync(LOG))).tables) store.load(t, rows as never);
  return { ref, store };
}

describe("changing the log from the command line", () => {
  it("writes an edit to the inbox, read back, for review; a dry run writes nothing", async () => {
    const dry = await run(editCommand, "BA9001@2025-03-14", "--set", "seat=14A", "--set", "takeoff=11:40", "--clear", "gate", "--dry-run", "--json");
    expect(dry.json()).toMatchObject({ ok: true, notWritten: "dry-run", changes: [{ action: "Edit", title: "BA9001 · 14 Mar 2025 · LHR → JFK", status: "pending" }] });
    expect(dry.json().changes[0].lines.map((l: { label: string; before: string; after: string }) => [l.label, l.before, l.after])).toEqual([
      ["Takeoff", "11:00 Fri 14 Mar · UTC+0", "11:40 Fri 14 Mar · UTC+0"],
      ["Gate", "B7", ""],
      ["Seat", "12A", "14A"],
    ]);
    expect(() => inbox()).toThrow();

    const r = await run(editCommand, "BA9001@2025-03-14", "--set", "seat=14A", "--json");
    expect(r).toMatchObject({ code: 0 });
    const name = r.json().written.file;
    expect(name).toMatch(/^edit-\d{4}-\d{2}-\d{2}-\d{6}\.json$/);
    const read = readInbox(fileOf(name), name, new RefIndex(loadRefTables()));
    if ("error" in read) throw new Error(read.error);
    expect(read.changes).toMatchObject([{ op: "edit", table: "flights", set: { seat: "14A" }, clear: [] }]);
    rmSync(join(INBOX, name));
  });

  it("takes a private value from JSON into the file, and never prints it; on the command line it is refused", async () => {
    expect(await run(editCommand, "BA9001@2025-03-14", "--set", `ticketNumber=${NEW_TICKET}`)).toMatchObject({ code: 2, text: expect.stringMatching(/Never give a ticket number on the command line/) });
    const edits = join(dir, "edits.json");
    writeFileSync(edits, JSON.stringify([{ ref: "BA9001@2025-03-14", set: { ticketNumber: NEW_TICKET } }]));
    for (const form of [[], ["--json"]]) {
      const r = await run(editCommand, edits, ...form);
      expect(r.text).not.toContain(TICKET);
      expect(r.text).not.toContain(NEW_TICKET);
      expect(r.text).toMatch(/Ticket number.*recorded.*changed/s);
    }
    const files = inbox();
    expect(files).toHaveLength(2);
    expect(fileOf(files[0]!).changes).toMatchObject([{ op: "edit", set: { ticketNumber: NEW_TICKET } }]);
    for (const f of files) rmSync(join(INBOX, f));
  });

  it("refuses a change that brings an error, unless --keep-errors", async () => {
    const r = await run(editCommand, "BA9001@2025-03-14", "--set", "typeCode=QQQQ", "--json");
    expect(r).toMatchObject({ code: 1 });
    expect(r.json()).toMatchObject({ ok: false, notWritten: "errors", findings: [{ rule: "V-TYPE-KNOWN", severity: "error" }] });
    const kept = await run(editCommand, "BA9001@2025-03-14", "--set", "typeCode=QQQQ", "--keep-errors", "--json");
    expect(kept).toMatchObject({ code: 0 });
    rmSync(join(INBOX, kept.json().written.file));
    expect(await run(editCommand, "XX0000@2025-01-01", "--set", "seat=1A")).toMatchObject({ code: 1 });
  });

  it("writes deletions, aircraft facts and merges, issues, undo, families and settings, which then import", async () => {
    // A note (info), shown with --severity all; notes and warnings can be accepted.
    const issues = (await run(issuesCommand, "--severity", "all", "--json")).json();
    const warning = issues.groups.find((g: { rule: string }) => g.rule === "V-REG-COUNTRY").findings[0];
    const commands: [(args: string[]) => Promise<unknown>, ...string[]][] = [
      [deleteCommand, "N9001Z@KBOS@2026-01-10"],
      [aircraftCommand, "edit", "G-ZZZA", "--set", "msn=30001", "--set", "firstFlight=2019-05-01"],
      [issuesCommand, "accept", warning.id, "--note", "leased"],
      [familiesCommand, "set", "E75L", "E170"],
      [settingsCommand, "codes", "icao", "distance", "nm"],
      [undoCommand, (await run(importsCommand, "--json")).json().imports[0].id],
    ];
    for (const [command, ...args] of commands) expect((await run(command, ...args, "--json")).json()).toMatchObject({ ok: true, written: { changes: 1 } });
    const names = inbox();
    expect(names.map((n) => n.split("-")[0])).toEqual(["aircraft", "delete", "families", "issues", "settings", "undo"]);

    // The web app's import of each file, with the same code.
    const { ref, store } = theLog();
    for (const n of names) {
      const read = readInbox(fileOf(n), n, ref);
      if ("error" in read) throw new Error(read.error);
      expect(applyChanges(store, ref, read.changes, () => true, { fileName: n })).toMatchObject({ applied: 1 });
    }
    expect(store.all("sightings").filter((s) => s.seenOn === "2026-01-10")).toEqual([]);
    expect(store.all("airframes").find((a) => a.msn === "30001")).toMatchObject({ firstFlightDate: "2019-05-01", provisional: false });
    expect(store.all("issue_acks")).toMatchObject([{ ruleId: "V-REG-COUNTRY", note: "leased" }]);
    expect(store.all("family_overrides")).toMatchObject([{ designator: "E75L", familyId: "E170" }]);
    expect(store.get("settings", "settings")).toMatchObject({ codeDisplay: "icao", distanceUnit: "nm" });
    for (const n of names) rmSync(join(INBOX, n));
  });

  it("says when there is nothing to change", async () => {
    expect((await run(editCommand, "BA9001@2025-03-14", "--set", "seat=12A", "--json")).json()).toMatchObject({ notWritten: "nothing to change", written: null });
    expect((await run(familiesCommand, "remove", "E75L", "--json")).json()).toMatchObject({ notWritten: "nothing to change" });
  });

  it("saves and removes a Statistics view through the inbox, and shows a saved one", async () => {
    const saved = await run(statsCommand, "views", "save", "Airlines by family", "--by", "airline", "--cols", "family", "--json");
    expect(saved.json()).toMatchObject({ ok: true, written: { changes: 1 }, changes: [{ action: "Save a view", title: "“Airlines by family”" }] });
    expect((await run(statsCommand, "views", "save", "Wrong", "--by", "phase", "--json")).json()).toMatchObject({ ok: false, error: "Phase is for sightings, not flights." });
    const [name] = inbox();
    expect(name).toMatch(/^stats-/);

    // Imported as the web app would, then shown from the log.
    const { ref, store } = theLog();
    const read = readInbox(fileOf(name!), name!, ref);
    if ("error" in read) throw new Error(read.error);
    applyChanges(store, ref, read.changes, () => true, { fileName: name! });
    rmSync(join(INBOX, name!));
    writeFileSync(LOG, backupZip(store));
    expect((await run(statsCommand, "views", "--json")).json().views).toMatchObject([{ name: "Airlines by family", of: "flights", by: "airline", cols: "family", measure: "records" }]);
    const shown = (await run(statsCommand, "--view", "airlines by family", "--year", "all", "--json")).json();
    expect(shown).toMatchObject({ view: "Airlines by family", of: "flights", by: "airline", cols: "family" });
    expect(shown.rows.map((r: { label: string }) => r.label)).toEqual(expect.arrayContaining(["British Airways", "Delta Air Lines"]));
    expect(await run(statsCommand, "--view", "Nothing", "--json")).toMatchObject({ code: 1 });
    expect((await run(statsCommand, "views", "save", "Airlines by family", "--by", "airline", "--json")).json()).toMatchObject({ ok: false, error: expect.stringMatching(/already/) });
    expect((await run(statsCommand, "views", "remove", "Airlines by family", "--json")).json()).toMatchObject({ written: { changes: 1 }, changes: [{ action: "Remove a view" }] });
    for (const n of inbox()) rmSync(join(INBOX, n));
  });

  it("reads an aircraft's facts from text copied off its page, warning when the page may be about another aircraft", async () => {
    const page = join(dir, "page.txt");
    writeFileSync(page, "airfleets.net\nSerial number\t30002\nLine number\t1234\nFirst flight date\t17/09/2011\n");
    const r = (await run(aircraftCommand, "edit", "G-ZZZA", "--paste", page, "--json")).json();
    expect(r).toMatchObject({ written: { changes: 1 }, notes: ["Read from text copied off airfleets.net."] });
    expect(r.changes[0].lines.map((l: { label: string; after: string }) => [l.label, l.after])).toEqual(expect.arrayContaining([["Serial number", "30002"], ["Line number", "1234"], ["First flight", "2011-09-17"]]));
    const file = inbox().find((n) => n.startsWith("aircraft-"))!;
    expect(fileOf(file).changes![0]).toMatchObject({ op: "airframe", set: { msn: "30002", lineNumber: "1234", firstFlightDate: "2011-09-17" } });
    rmSync(join(INBOX, file));

    writeFileSync(page, "Serial number: 30003\nFirst flight: 2026-01-01\n");
    const later = (await run(aircraftCommand, "edit", "G-ZZZA", "--paste", page, "--set", "msn=30004", "--dry-run", "--json")).json();
    expect(later.notes).toEqual([expect.stringMatching(/^This may be another aircraft: /)]);
    expect(later.changes[0].lines).toContainEqual(expect.objectContaining({ label: "Serial number", after: "30004" }));
    writeFileSync(page, "Nothing here\n");
    expect(await run(aircraftCommand, "edit", "G-ZZZA", "--paste", page, "--json")).toMatchObject({ code: 1 });
  });
});
