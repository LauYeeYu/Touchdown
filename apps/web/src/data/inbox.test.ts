import { describe, expect, it } from "vitest";
import { commitImport, matchCandidates, readInbox, RefIndex, Store, type InboxFile } from "@touchdown/core";
import { refTables } from "../../../../packages/core/test/fixtures.ts";
import type { AppData } from "./app.ts";
import { markImported, refreshInbox, waitingNow } from "./inbox.ts";
import type { StorageInbox } from "./sync.ts";

// Every flight, registration and date here is made up.
const encoder = new TextEncoder();
const file = (sightings: string[], flights: string[] = []): InboxFile => ({
  schema: "touchdown-inbox",
  version: 2,
  createdAt: "2026-10-24T10:00Z",
  checker: null,
  sightings: sightings.map((registration) => ({ values: { registration, date: "2026-10-20", airport: "EGLL" }, sources: {}, open: [], missing: [], aircraft: null })),
  flights: flights.map((flightNumber) => ({ values: { flightNumber, date: "2026-10-18", from: "EGLL", to: "KJFK" }, open: [] })),
});

/** The storage's inbox, in memory, and the app around it. */
function setUp() {
  const files = new Map<string, Uint8Array>();
  const kept = new Map<string, Uint8Array>();
  const inbox: StorageInbox = {
    list: async () => [...files.keys()],
    read: async (name) => files.get(name) ?? null,
    imported: async (name, batchId, data) => {
      kept.set(`imports/${batchId}/${name}`, data);
      files.delete(name);
    },
    remove: async (name) => void files.delete(name),
  };
  const ref = new RefIndex(refTables);
  const store = new Store({ deviceId: "web" });
  const app = { sync: { inbox: () => inbox }, ref, store } as unknown as AppData;
  const put = (name: string, f: InboxFile) => files.set(name, encoder.encode(JSON.stringify(f)));
  const importFile = (name: string) => {
    const r = readInbox(JSON.parse(new TextDecoder().decode(files.get(name)!)), name, ref);
    if ("error" in r) throw new Error(r.error);
    return commitImport(store, ref, r.source, matchCandidates(store, r.source.candidates)).batchId;
  };
  return { files, kept, app, put, importFile };
}

describe("the inbox in the user's storage", () => {
  it("lists what is waiting, flights and sightings, and keeps an imported file with its import", async () => {
    const { files, kept, app, put, importFile } = setUp();
    put("add-2026-10-24-100000.json", file(["G-ABCD"], ["BA117"]));
    await refreshInbox(app);
    expect(waitingNow().map((w) => [w.name, w.where, w.flights, w.sightings])).toEqual([["add-2026-10-24-100000.json", "storage", 1, 1]]);

    const batchId = importFile("add-2026-10-24-100000.json");
    await markImported(app, "add-2026-10-24-100000.json", batchId);
    expect([...files.keys()]).toEqual([]);
    expect([...kept.keys()]).toEqual([`imports/${batchId}/add-2026-10-24-100000.json`]);
    expect(waitingNow()).toEqual([]);
  });

  it("leaves a file saved again after it was read, for the records added to it", async () => {
    const { files, kept, app, put, importFile } = setUp();
    put("spot-2026-10-24-1000.json", file(["G-ABCD"]));
    await refreshInbox(app);
    const batchId = importFile("spot-2026-10-24-1000.json");
    put("spot-2026-10-24-1000.json", file(["G-ABCD", "G-ABCE"]));
    await markImported(app, "spot-2026-10-24-1000.json", batchId);
    expect([...files.keys()]).toEqual(["spot-2026-10-24-1000.json"]);
    expect(kept.size).toBe(0);
    expect(waitingNow().map((w) => [w.name, w.sightings])).toEqual([["spot-2026-10-24-1000.json", 1]]);
  });

  it("removes a file whose records are all in the log already", async () => {
    const { files, app, put, importFile } = setUp();
    put("a.json", file(["G-ABCD"]));
    importFile("a.json");
    await refreshInbox(app);
    expect(waitingNow()).toEqual([]);
    expect(files.size).toBe(0);
  });
});
