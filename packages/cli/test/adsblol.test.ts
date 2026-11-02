import { describe, expect, it } from "vitest";
import { gunzipSync, gzipSync } from "node:zlib";
import { readFolder, type TarReader } from "../src/providers/adsblol.ts";

// A made-up day archive: a tar of folders of gzipped traces, in a shuffled order, one folder much smaller than the stride.
function header(name: string, size: number): Uint8Array {
  const h = new Uint8Array(512);
  const put = (at: number, text: string) => h.set(new TextEncoder().encode(text), at);
  put(0, name);
  put(100, "0000644\0");
  put(108, "0000000\0");
  put(116, "0000000\0");
  put(124, size.toString(8).padStart(11, "0") + "\0");
  put(136, "00000000000\0");
  put(148, "        ");
  put(156, "0");
  put(257, "ustar\0");
  put(263, "00");
  let sum = 0;
  for (const b of h) sum += b;
  put(148, sum.toString(8).padStart(6, "0") + "\0 ");
  return h;
}

function tar(files: { name: string; body: Uint8Array }[]): Uint8Array {
  const parts: Uint8Array[] = [];
  for (const f of files) {
    parts.push(header(f.name, f.body.length), f.body, new Uint8Array((512 - (f.body.length % 512)) % 512));
  }
  parts.push(new Uint8Array(1024));
  return Buffer.concat(parts);
}

const noise = (n: number, seed: number) => {
  const b = new Uint8Array(n);
  for (let i = 0; i < n; i++) b[i] = (seed = (seed * 1103515245 + 12345) % 2 ** 31) & 255;
  return b;
};

/** The folder of the first header within 64 KB of an offset, as the real sampling sees it, kept in `samples`. */
function sampler(data: Uint8Array, samples: Map<number, string>) {
  return async (off: number) => {
    for (let at = off - (off % 512); at < Math.min(data.length, off + 65536); at += 512) {
      const name = new TextDecoder().decode(data.subarray(at, at + 100)).replace(/\0.*$/s, "");
      if (new TextDecoder().decode(data.subarray(at + 257, at + 262)) === "ustar") {
        const f = /^\.\/traces\/([0-9a-f]{2})\//.exec(name)?.[1] ?? "";
        samples.set(off, f);
        return f;
      }
    }
    samples.set(off, "");
    return "";
  };
}

const trace = (hex: string) => gzipSync(JSON.stringify({ icao: hex, timestamp: 1, trace: [] }));

describe("finding an aircraft's folder in a day's archive", () => {
  it("finds a folder smaller than the stride between two samples", async () => {
    const files: { name: string; body: Uint8Array }[] = [];
    // Folders 00 to 0f with 40 files of 8 KB each (320 KB), except 0a with two small files, in a shuffled order.
    const order = ["03", "0e", "07", "0a", "01", "0c", "05", "0f", "09", "00", "0b", "02", "0d", "06", "08", "04"];
    for (const folder of order) {
      const n = folder === "0a" ? 2 : 40;
      for (let i = 0; i < n; i++) {
        const hex = `${(i + 1).toString(16).padStart(4, "0")}${folder}`;
        const body = folder === "0a" && i === 1 ? gzipSync(JSON.stringify({ icao: hex, timestamp: 1, trace: [] })) : noise(8000, i + 1);
        files.push({ name: `./traces/${folder}/trace_full_${hex}.json`, body });
      }
    }
    const data = tar(files);
    const archive: TarReader = { total: data.length, read: async (off, n) => data.subarray(off, Math.min(data.length, off + n)) };
    const samples = new Map<number, string>();
    const sampleAt = sampler(data, samples);
    // A stride of 384 KB: every big folder is sampled, the 16 KB one is not.
    const found = await readFolder(archive, "0a", new Set(["00020a"]), sampleAt, samples, 384 * 1024);
    expect([...found.keys()]).toEqual(["00020a"]);
    expect(JSON.parse(gunzipSync(found.get("00020a")!).toString("utf8"))).toMatchObject({ icao: "00020a" });
    // A folder that is not there is still not found.
    expect((await readFolder(archive, "1f", new Set(["00011f"]), sampleAt, samples, 384 * 1024)).size).toBe(0);
  });

  it("finds a folder that starts after the heatmaps, or after a sample that fell inside a large file", async () => {
    // Two heatmaps, then folder 0b right after them, 03, 04 opening with a 150 KB trace, 0a, 05 and 06.
    const files: { name: string; body: Uint8Array }[] = [
      { name: "./heatmap/00.bin.ttf", body: noise(200_000, 1) },
      { name: "./heatmap/01.bin.ttf", body: noise(200_000, 2) },
      { name: "./traces/0b/trace_full_00010b.json", body: trace("00010b") },
    ];
    const folder = (f: string, n: number) => Array.from({ length: n }, (_, i) => ({ name: `./traces/${f}/trace_full_${(i + 1).toString(16).padStart(4, "0")}${f}.json`, body: noise(8000, i + 3) }));
    files.push(...folder("03", 30), { name: "./traces/04/trace_full_000104.json", body: noise(150_000, 4) }, ...folder("04", 10).slice(1));
    files.push({ name: "./traces/0a/trace_full_00010a.json", body: noise(4000, 5) }, { name: "./traces/0a/trace_full_00020a.json", body: trace("00020a") });
    files.push(...folder("05", 30), ...folder("06", 30));
    const data = tar(files);
    const at = (name: string) => {
      let off = 0;
      for (const f of files) {
        if (f.name === name) return off;
        off += 512 + Math.ceil(f.body.length / 512) * 512;
      }
      throw new Error(name);
    };
    const archive: TarReader = { total: data.length, read: async (off, n) => data.subarray(off, Math.min(data.length, off + n)) };
    // Samples from an earlier search: one in 03, one inside 04's large trace (no header within 64 KB, so no folder),
    // one in 05 and one in 06. Nothing sampled 0b or 0a.
    const fresh = async () => {
      const samples = new Map<number, string>();
      const sampleAt = sampler(data, samples);
      const seen = await Promise.all([at("./traces/03/trace_full_000f03.json"), at("./traces/04/trace_full_000104.json") + 1536, at("./traces/05/trace_full_000f05.json"), at("./traces/06/trace_full_000f06.json")].map(sampleAt));
      expect(seen).toEqual(["03", "", "05", "06"]);
      return { samples, sampleAt };
    };
    // A stride longer than the archive: only its start is sampled again, and the heatmaps there show no folder.
    const after04 = await fresh();
    expect([...(await readFolder(archive, "0a", new Set(["00020a"]), after04.sampleAt, after04.samples, data.length)).keys()]).toEqual(["00020a"]);
    const afterHeatmaps = await fresh();
    expect([...(await readFolder(archive, "0b", new Set(["00010b"]), afterHeatmaps.sampleAt, afterHeatmaps.samples, data.length)).keys()]).toEqual(["00010b"]);
  });
});
