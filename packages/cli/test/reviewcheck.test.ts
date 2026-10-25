import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { RefIndex, Store } from "@touchdown/core";
import { JsonTablesBackend, MemorySyncState, SyncEngine } from "@touchdown/storage";
import { loadRefTables } from "@touchdown/refdata";
import { NodeFolder } from "../src/folder.ts";

// A stand-in for Claude Code: it answers in the schema, suggesting B38M for a made-up B738, and nothing else. No
// agent runs in this test.
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
          verdict: r.fields.registration === "N9005Z" ? "wrong" : "ok",
          note: "",
          suggestions: r.fields.registration === "N9005Z" ? [{ field: "typeCode", current: "B738", suggested: "B38M", confidence: "high", basis: "model_knowledge", reason: "A made-up reason." }] : [],
        })),
      },
    };
  },
}));

const dir = mkdtempSync(join(tmpdir(), "touchdown-reviewcheck-"));
const LOG = join(dir, "Touchdown");
process.env.TOUCHDOWN_PRIVATE_DIR = join(dir, "private");
const { saveStorage } = await import("../src/settings.ts");
const { reviewCommand } = await import("../src/review.ts");
const { addCommand } = await import("../src/add.ts");
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

beforeAll(async () => {
  mkdirSync(LOG, { recursive: true });
  await webApp();
  saveStorage({ kind: "folder", path: LOG });
});

class Exit extends Error {
  constructor(readonly code: number) {
    super(`exit ${code}`);
  }
}

async function run(command: (args: string[], ref: RefIndex) => Promise<unknown>, args: string[], stdin?: string) {
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
      await command([file, ...args], new RefIndex(loadRefTables()));
    } else await command(args, new RefIndex(loadRefTables()));
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

describe("the agent check in touchdown review", () => {
  it("shows the agent's suggestions, uses only those the user takes, and saves them with the agent as source", async () => {
    await run(addCommand, ["--json"], JSON.stringify({ sightings: [{ date: "2026-05-01", registration: "N9005Z", airport: "KBOS", typeCode: "B738" }, { date: "2026-05-01", registration: "N9006Z", airport: "KBOS", typeCode: "A21N" }] }));
    expect(inbox()).toHaveLength(1);

    const shown = await run(reviewCommand, ["--check", "--agent", "claude", "--json"]);
    expect(shown.json()).toMatchObject({ ok: true, suggestions: [{ field: "typeCode", current: "B738", suggested: "B38M", confidence: "high", used: false }], wouldImport: { rows: 2 } });
    // The self-test ran first, then the file's rows, without private fields or seats.
    expect(sent.some((p) => p.includes("N9005Z"))).toBe(true);
    expect(sent.join("")).not.toMatch(/ticketNumber|bookingRef|"seat"/);
    expect(inbox()).toHaveLength(1);

    const done = await run(reviewCommand, ["--check", "--agent", "claude", "--use-high", "--yes", "--json"]);
    expect(done.json()).toMatchObject({ ok: true, imported: { rows: 2 }, suggestions: [{ suggested: "B38M", used: true }] });
    const web = await webApp();
    const s = web.store.all("sightings").find((x) => x.registration === "N9005Z")!;
    expect(s).toMatchObject({ typeCode: "B38M" });
    expect(web.store.all("field_provenance").filter((p) => p.ownerId === s.id).map((p) => `${p.field}:${p.source}/${p.detail}`)).toContain("typeCode:agent/claude");
    expect(web.store.all("import_batches").find((b) => b.agentChecker === "claude")).toBeTruthy();
  });

  it("is for files of records, and needs --check for its options", async () => {
    expect((await run(reviewCommand, ["--use-high", "--json"])).json()).toMatchObject({ ok: false, error: expect.stringMatching(/go with --check/) });
    expect((await run(reviewCommand, ["--check", "--agent", "gpt", "--json"])).json()).toMatchObject({ ok: false, error: "--agent takes claude or codex." });
  });
});
