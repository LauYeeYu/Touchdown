// `touchdown stamps` (docs/34, "Reading"): the Stamps tab's stamps, worked out by core. Every record here is made up.
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { backupZip, RefIndex, saveFlight, Store } from "@touchdown/core";
import { loadRefTables } from "@touchdown/refdata";

const dir = mkdtempSync(join(tmpdir(), "touchdown-stamps-"));
process.env.TOUCHDOWN_PRIVATE_DIR = dir;
const { stampsCommand } = await import("../src/stamps.ts");
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const LOG = join(dir, "log.zip");

beforeAll(() => {
  const ref = new RefIndex(loadRefTables());
  const store = new Store({ deviceId: "test" });
  saveFlight(store, ref, { scheduledDate: "2025-03-14", flightNumber: "BA9001", airlineRaw: "BA", fromRaw: "EGLL", toRaw: "YSSY", typeCodeRaw: "B744" });
  store.insert("sightings", { seenOn: "2025-06-01", airportId: "ap_kpae", typeCode: "B77W", registration: "N1002A" });
  writeFileSync(LOG, backupZip(store));
});

class Exit extends Error {
  constructor(readonly code: number) {
    super(`exit ${code}`);
  }
}

async function run(...args: string[]) {
  const out: string[] = [];
  vi.spyOn(console, "log").mockImplementation((...a: unknown[]) => void out.push(a.join(" ")));
  vi.spyOn(console, "error").mockImplementation((...a: unknown[]) => void out.push(a.join(" ")));
  vi.spyOn(process, "exit").mockImplementation(((code: number) => {
    throw new Exit(code);
  }) as never);
  try {
    await stampsCommand([...args, "--log", LOG]);
  } catch (e) {
    if (!(e instanceof Exit)) throw e;
  }
  vi.restoreAllMocks();
  return out.join("\n");
}
afterEach(() => vi.restoreAllMocks());

describe("touchdown stamps", () => {
  it("lists the stamps earned with the record that earned them", async () => {
    const j = JSON.parse(await run("--json"));
    const ids = j.stamps.map((b: { id: string }) => b.id);
    expect(ids).toEqual(expect.arrayContaining(["queen", "equator", "fourEngines", "factory.boeing"]));
    expect(ids).not.toContain("superjumbo");
    const queen = j.stamps.find((b: { id: string }) => b.id === "queen");
    expect(queen).toMatchObject({ name: "Queen of the Skies", earned: "2025-03-14", by: { table: "flights" } });
    const boeing = j.stamps.find((b: { id: string }) => b.id === "factory.boeing");
    expect(boeing.parts.find((p: { label: string }) => p.label === "PAE")).toMatchObject({ done: true });
  });

  it("adds those still to earn with --all, never a hidden one", async () => {
    const j = JSON.parse(await run("--all", "--json"));
    const ids = j.stamps.map((b: { id: string }) => b.id);
    expect(ids).toContain("superjumbo");
    expect(ids).not.toContain("supersonic");
    expect(j.earned).toBe(j.stamps.filter((b: { earned: string | null }) => b.earned).length);
    expect(await run()).toMatch(/Queen of the Skies\s+14 Mar 2025\s+BA9001/);
  });
});
