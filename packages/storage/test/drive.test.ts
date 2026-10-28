import { describe, expect, it } from "vitest";
import { GoogleDrive, SignInNeeded, type DriveAuth } from "../src/index.ts";
import { FakeDrive } from "./fakeDrive.ts";
import { conflicts, device, race, settle, snapshot, testClock } from "./helpers.ts";

const text = (s: string) => new TextEncoder().encode(s);
const read = (d: Uint8Array | undefined) => (d ? new TextDecoder().decode(d) : undefined);

function auth(tokens: string[] = ["good"]): DriveAuth & { refusedTokens: string[] } {
  const left = [...tokens];
  const refusedTokens: string[] = [];
  return {
    refusedTokens,
    async token() {
      if (!left.length) throw new SignInNeeded();
      return left[0]!;
    },
    refused(token) {
      refusedTokens.push(token);
      if (left[0] === token) left.shift();
    },
  };
}

function adapter(drive: FakeDrive, a: DriveAuth = auth(), now?: () => number, concurrency?: number) {
  const waits: number[] = [];
  const files = new GoogleDrive(a, { fetch: drive.fetch, wait: async (ms) => void waits.push(ms), now, concurrency });
  return Object.assign(files, { waits });
}

describe("Google Drive files", () => {
  it("keeps files at their paths in a Touchdown folder in My Drive", async () => {
    const drive = new FakeDrive();
    const files = adapter(drive);

    expect(await files.read("manifest.json")).toBeNull();
    expect(await files.list("")).toEqual([]);
    expect(drive.root()).toBeUndefined();
    const first = await files.write("tables/flights.json", text("one"));
    await files.write("attachments/imports/b1/My 'sheet'.xlsx", text("xlsx"));

    const root = drive.root()!;
    expect(root.name).toBe("Touchdown");
    expect(root.parents).toEqual(["root"]);
    expect(read(drive.current("tables/flights.json"))).toBe("one");
    expect(read(drive.current("attachments/imports/b1/My 'sheet'.xlsx"))).toBe("xlsx");
    expect(await files.list("tables")).toEqual([{ name: "flights.json", version: first.version }]);

    const second = await files.write("tables/flights.json", text("two"));
    expect(second.version).not.toBe(first.version);
    expect(read((await files.read("tables/flights.json"))?.data)).toBe("two");
    expect(drive.at("tables/flights.json")).toHaveLength(1);

    await files.remove("tables/flights.json");
    expect(await files.read("tables/flights.json")).toBeNull();
    expect(await files.list("tables")).toEqual([]);
  });

  it("finds the Touchdown folder from another device after the user renamed it", async () => {
    const drive = new FakeDrive();
    await adapter(drive).write("manifest.json", text("{}"));
    drive.root()!.name = "Touchdown (old phone)";

    const other = adapter(drive);
    expect(read((await other.read("manifest.json"))?.data)).toBe("{}");
    expect([...drive.files.values()].filter((f) => f.appProperties.touchdown === "log")).toHaveLength(1);
  });

  it("notices a file another device removed or replaced", async () => {
    const drive = new FakeDrive();
    const a = adapter(drive);
    const b = adapter(drive);
    await a.write("inbox/spot.json", text("1"));
    expect(read((await b.read("inbox/spot.json"))?.data)).toBe("1");

    await a.remove("inbox/spot.json");
    expect(await b.read("inbox/spot.json")).toBeNull();
    await a.write("inbox/spot.json", text("2"));
    expect(read((await b.read("inbox/spot.json"))?.data)).toBe("2");
  });

  it("uses one file when two devices create it at the same moment", async () => {
    const drive = new FakeDrive();
    const a = adapter(drive);
    const b = adapter(drive);
    await a.write("manifest.json", text("{}"));
    await b.read("manifest.json");
    drive.pause = async () => {
      for (let i = 0; i < 3; i++) await Promise.resolve();
    };

    await Promise.all([a.write("tables/flights.json", text("from a")), b.write("tables/flights.json", text("from b"))]);

    expect([...drive.files.values()].filter((f) => f.name === "tables")).toHaveLength(1);
    expect(drive.at("tables/flights.json")).toHaveLength(1);
    const stored = read(drive.current("tables/flights.json"));
    expect(read((await a.read("tables/flights.json"))?.data)).toBe(stored);
    expect(read((await b.read("tables/flights.json"))?.data)).toBe(stored);
  });

  it("uploads a file over 5 MB in a resumable upload", async () => {
    const drive = new FakeDrive();
    const files = adapter(drive);
    const big = new Uint8Array(6 * 1024 * 1024).fill(65);

    await files.write("tables/sightings.json", big);
    await files.write("tables/sightings.json", big.slice(1));

    expect(drive.log.filter((l) => l.includes("uploadType=resumable"))).toHaveLength(2);
    expect(drive.current("tables/sightings.json")?.length).toBe(big.length - 1);
  });

  it("drops a refused token, and asks for sign-in when there is no other", async () => {
    const drive = new FakeDrive();
    const renewing = auth(["expired", "good"]);
    await adapter(drive, renewing).write("manifest.json", text("{}"));
    expect(renewing.refusedTokens).toEqual(["expired"]);

    const browser = auth(["expired"]);
    await expect(adapter(drive, browser).read("manifest.json")).rejects.toBeInstanceOf(SignInNeeded);
  });

  it("asks for sign-in when the user did not allow access to Drive files", async () => {
    const drive = new FakeDrive();
    drive.failures.push([403, "insufficientPermissions"]);
    await expect(adapter(drive).list("tables")).rejects.toBeInstanceOf(SignInNeeded);
  });

  it("retries rate limits and server errors, waiting longer each time", async () => {
    const drive = new FakeDrive();
    const files = adapter(drive);
    drive.failures.push(429, [403, "userRateLimitExceeded"], 503);

    await files.write("manifest.json", text("{}"));

    expect(files.waits).toEqual([1000, 2000, 4000]);
    expect(read(drive.current("manifest.json"))).toBe("{}");
  });

  it("gives up after a few retries", async () => {
    const drive = new FakeDrive();
    drive.failures.push(500, 500, 500, 500, 500);
    await expect(adapter(drive).list("tables")).rejects.toThrow(/Google Drive/);
  });

  it("sends requests at once, never more than its limit", async () => {
    const drive = new FakeDrive();
    const names = Array.from({ length: 12 }, (_, i) => `tracks/t${i}.json`);
    const writer = adapter(drive);
    for (const n of names) await writer.write(n, text(n));
    let now = 0;
    let most = 0;
    drive.pause = async () => {
      most = Math.max(most, ++now);
      await new Promise((r) => setTimeout(r, 2));
      now--;
    };

    const files = adapter(drive, auth(), undefined, 4);
    await files.list("tracks");
    const read = await Promise.all(names.map((n) => files.read(n)));

    expect(read.map((r) => new TextDecoder().decode(r!.data))).toEqual(names);
    expect(most).toBe(4);
  });

  it("asks for one token when requests start at once", async () => {
    const drive = new FakeDrive();
    const names = ["tracks/a.json", "tracks/b.json", "tracks/c.json"];
    for (const n of names) await adapter(drive).write(n, text(n));
    let asked = 0;
    let kept: string | null = null;
    const slow: DriveAuth = {
      async token() {
        if (kept) return kept;
        asked++;
        await new Promise((r) => setTimeout(r, 2));
        return (kept = "good");
      },
      refused() {},
    };
    const files = adapter(drive, slow);
    await files.list("tracks");
    // The token runs out while every file is being read.
    kept = null;
    asked = 0;
    await Promise.all(names.map((n) => files.read(n)));
    expect(asked).toBe(1);
  });

  it("finds a log's files and folders in a few requests", async () => {
    const drive = new FakeDrive();
    const writer = adapter(drive);
    await writer.write("manifest.json", text("{}"));
    await writer.write("tables/flights.json", text("[]"));
    await writer.write("tracks/t1.json", text("[]"));
    drive.log.length = 0;

    const files = adapter(drive);
    await files.read("manifest.json");
    await Promise.all([files.list("tables"), files.list("tracks")]);
    await files.read("tables/flights.json");

    // The Touchdown folder, everything in it, the manifest, the two folders' files, one table.
    expect(drive.log).toHaveLength(6);
  });

  it("keeps a file it wrote while a listing of its folder was on the way", async () => {
    const drive = new FakeDrive();
    const files = adapter(drive);
    await files.write("inbox/a.json", text("a"));
    let hold: () => void = () => {};
    let held = false;
    drive.pause = async () => {
      if (held) return;
      held = true;
      await new Promise<void>((r) => (hold = r));
    };
    const listing = files.list("inbox");
    await Promise.resolve();
    drive.pause = async () => {};
    await files.write("inbox/b.json", text("b"));
    hold();
    await listing;

    await files.write("inbox/b.json", text("b2"));
    expect(drive.at("inbox/b.json")).toHaveLength(1);
    expect(read(drive.current("inbox/b.json"))).toBe("b2");
  });

  it("reads the account's email address", async () => {
    expect(await adapter(new FakeDrive()).account()).toBe("pilot@example.com");
  });
});

describe("sync through Google Drive", () => {
  it("brings a log, its edits and its tracks to another device", async () => {
    const clock = testClock();
    const drive = new FakeDrive();
    const a = await device(adapter(drive, auth(), clock.now), "dev_a", clock.now);
    const b = await device(adapter(drive, auth(), clock.now), "dev_b", clock.now);
    const f = a.store.insert("flights", { flightNumber: "XY100" });
    const tr = a.store.insert("tracks", { flightId: f.id, provider: "adsblol" });
    a.store.putRaw("track_points", [
      { trackId: tr.id, seq: 0, t: 0, lat: 51.47, lon: -0.45, altitudeFt: null, groundSpeedKt: null, headingDeg: null },
      { trackId: tr.id, seq: 1, t: 60, lat: 51.5, lon: -0.3, altitudeFt: 3000, groundSpeedKt: 180, headingDeg: 90 },
    ] as never);
    await settle([a, b]);

    clock.tick();
    a.store.update("flights", f.id, { seat: "1A" });
    clock.tick();
    b.store.update("flights", f.id, { seat: "2B" });
    await settle([a, b]);

    expect(snapshot(b.store)).toEqual(snapshot(a.store));
    expect(b.store.get("flights", f.id)?.seat).toBe("2B");
    expect(b.store.all("track_points")).toHaveLength(2);
    expect(conflicts(a.store)).toHaveLength(1);
    expect(drive.at(`tracks/${tr.id}.json`)).toHaveLength(1);
    expect(a.engine.waiting + b.engine.waiting).toBe(0);
  });
});

describe("sync through Google Drive under races", () => {
  for (let seed = 1; seed <= 20; seed++) {
    it(`converges with no lost edit (seed ${seed})`, async () => {
      const drive = new FakeDrive();
      await race(seed, {
        adapter: () => adapter(drive),
        setPause: (pause) => (drive.pause = pause),
        current: (path) => drive.current(path),
        overwrite: async (path, data) => drive.overwrite(path, data),
      });
    });
  }
});
