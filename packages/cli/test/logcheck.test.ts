import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { RefIndex, saveSighting, Store } from "@touchdown/core";
import { JsonTablesBackend, MemorySyncState, SyncEngine } from "@touchdown/storage";
import { loadRefTables } from "@touchdown/refdata";
import { NodeFolder } from "../src/folder.ts";

// A stand-in for Claude Code: it answers in the schema, suggesting B38M for a made-up B738, and nothing else. No
// agent runs in this test, and no source is asked: the lookups say nothing.
const sent: string[] = [];
vi.mock("../src/agents.ts", async (original) => ({
  ...(await original<typeof import("../src/agents.ts")>()),
  findAgent: () => ({ checker: "claude", name: "Claude Code", command: "claude", version: "0.0.0-test", restricted: true, disableSlashCommands: true, disable: [] }),
  runAgent: async (_agent: unknown, _prompt: string, payload: string) => {
    sent.push(payload);
    const records = (JSON.parse(payload) as { records: { recordId: string; fields: Record<string, string> }[] }).records;
    return {
      model: "test",
      costUsd: 0,
      answer: {
        records: records.map((r) => ({
          recordId: r.recordId,
          verdict: r.fields.registration === "N9007Z" && r.fields.typeCode === "B738" ? "wrong" : "ok",
          note: "",
          suggestions: r.fields.registration === "N9007Z" && r.fields.typeCode === "B738" ? [{ field: "typeCode", current: "B738", suggested: "B38M", confidence: "high", basis: "model_knowledge", reason: "A made-up reason." }] : [],
        })),
      },
    };
  },
}));
vi.mock("../src/lookups.ts", () => ({
  registrationLookups: () => ({ lookUp: async () => [], openSky: async () => new Map(), usesAdsbdb: false, usesFr24: () => false, close: async () => {} }),
}));

const dir = mkdtempSync(join(tmpdir(), "touchdown-logcheck-"));
const LOG = join(dir, "Touchdown");
process.env.TOUCHDOWN_PRIVATE_DIR = join(dir, "private");
const { saveStorage } = await import("../src/settings.ts");
const { checkCommand } = await import("../src/check.ts");
const { reviewCommand } = await import("../src/review.ts");
afterAll(() => rmSync(dir, { recursive: true, force: true }));

async function webApp() {
  const store = new Store({ deviceId: "dev_web" });
  const backend = new JsonTablesBackend(new NodeFolder(LOG), "dev_web");
  await backend.open();
  const engine = new SyncEngine(store, backend, new MemorySyncState());
  await engine.start();
  await engine.sync();
  return { store, engine };
}

class Exit extends Error {
  constructor(readonly code: number) {
    super(`exit ${code}`);
  }
}

async function run(command: (args: string[]) => Promise<unknown>, args: string[]) {
  const out: string[] = [];
  vi.spyOn(console, "log").mockImplementation((...a: unknown[]) => void out.push(a.join(" ")));
  vi.spyOn(console, "error").mockImplementation((...a: unknown[]) => void out.push(a.join(" ")));
  vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  vi.spyOn(process, "exit").mockImplementation(((code: number) => {
    throw new Exit(code);
  }) as never);
  let code = 0;
  try {
    await command(args);
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

beforeAll(async () => {
  mkdirSync(LOG, { recursive: true });
  // Two sightings added in the web app, which no agent has checked.
  const web = await webApp();
  const ref = new RefIndex(loadRefTables());
  saveSighting(web.store, ref, { seenOn: "2026-05-02", airportRaw: "KBOS", registrationRaw: "N9007Z", typeCodeRaw: "B738", operatorRaw: "DAL" });
  saveSighting(web.store, ref, { seenOn: "2026-05-02", airportRaw: "KBOS", registrationRaw: "N9008Z", typeCodeRaw: "A21N", operatorRaw: "DAL" });
  await web.engine.sync();
  saveStorage({ kind: "folder", path: LOG });
});

describe("touchdown check log", () => {
  it("sends the records the agent has not seen and writes the suggestions taken as edits naming the agent", async () => {
    const first = await run(checkCommand, ["log", "--agent", "claude", "--use-high"]);
    expect(first.code).toBe(0);
    expect(first.text).toMatch(/2 records the agent has not seen/);
    expect(first.text).toMatch(/B738 → .*B38M/);
    expect(sent.some((p) => p.includes("N9007Z") && p.includes("N9008Z"))).toBe(true);
    const files = inbox();
    expect(files).toHaveLength(1);
    expect(files[0]).toMatch(/^check-/);
    const file = JSON.parse(readFileSync(join(LOG, "inbox", files[0]!), "utf8")) as { changes: { op: string; agent?: string; set: Record<string, unknown> }[] };
    expect(file.changes).toEqual([expect.objectContaining({ op: "edit", table: "sightings", agent: "claude", set: expect.objectContaining({ typeCode: "B38M" }) })]);

    // Seen: the next run sends nothing, the one with a suggestion taken included.
    const again = await run(checkCommand, ["log", "--agent", "claude"]);
    expect(again.text).toMatch(/Nothing to check/);

    // Imported, the agent is the new type's source, and the record is still not sent again.
    expect((await run(reviewCommand, ["--yes", "--json"])).json()).toMatchObject({ ok: true, imported: { changes: 1 } });
    const web = await webApp();
    const s = web.store.all("sightings").find((x) => x.registration === "N9007Z")!;
    expect(s).toMatchObject({ typeCode: "B38M" });
    expect(web.store.all("field_provenance").filter((p) => p.ownerId === s.id).map((p) => `${p.field}:${p.source}/${p.detail}`)).toContain("typeCode:agent/claude");
    expect((await run(checkCommand, ["log", "--agent", "claude"])).text).toMatch(/Nothing to check/);

    // Asked for, every record goes again; without a terminal and --use-high nothing is taken.
    const all = await run(checkCommand, ["log", "--agent", "claude", "--all-records"]);
    expect(all.text).toMatch(/2 records/);
    expect(all.text).toMatch(/found nothing to change in 2 records/);
  });

  it("refuses a date it cannot read", async () => {
    const r = await run(checkCommand, ["log", "--since", "May 2026"]);
    expect(r.code).toBe(2);
    expect(r.text).toMatch(/--since takes a date/);
  });
});
