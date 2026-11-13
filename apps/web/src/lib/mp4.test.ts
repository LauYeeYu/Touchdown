import { describe, expect, it } from "vitest";
import { mp4, mp4Head, type Mp4Sample } from "./mp4.ts";

interface Box {
  type: string;
  start: number;
  size: number;
  body: number;
}

/** The boxes in bytes[from, to), and those inside the container boxes, by path ("moov/trak/mdia"). */
function boxes(bytes: Uint8Array): Map<string, Box> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const out = new Map<string, Box>();
  const containers = new Set(["moov", "trak", "mdia", "minf", "stbl", "edts", "dinf"]);
  const walk = (from: number, to: number, path: string) => {
    let at = from;
    while (at < to) {
      const size = view.getUint32(at);
      const type = String.fromCharCode(...bytes.subarray(at + 4, at + 8));
      expect(size).toBeGreaterThanOrEqual(8);
      expect(at + size).toBeLessThanOrEqual(to);
      const key = path ? `${path}/${type}` : type;
      out.set(key, { type, start: at, size, body: at + 8 });
      if (containers.has(type)) walk(at + 8, at + size, key);
      if (type === "stsd") walk(at + 16, at + size, key);
      at += size;
    }
    expect(at).toBe(to);
  };
  walk(0, bytes.length, "");
  return out;
}

const sample = (n: number, frame: number, key = false): Mp4Sample => ({ data: new Uint8Array(n).fill(frame + 1), key, frame });
const AVCC = new Uint8Array([1, 0x64, 0, 0x2a, 0xff, 0xe1, 0, 4, 0x67, 0x64, 0, 0x2a, 1, 0, 4, 0x68, 0xee, 0x3c, 0x80]);

describe("the video's MP4 file", () => {
  it("has its index before its frames, every frame the same length, and each chunk where the index says", async () => {
    const samples = Array.from({ length: 75 }, (_, i) => sample(10 + (i % 7), i, i % 60 === 0));
    const bytes = new Uint8Array(await mp4({ codec: "avc1.64002A", width: 1920, height: 1080, fps: 30, description: AVCC, colour: { primaries: "bt709", transfer: "iec61966-2-1", matrix: "bt709", fullRange: false } }, samples).arrayBuffer());
    const b = boxes(bytes);
    const view = new DataView(bytes.buffer);
    expect([...b.keys()].filter((k) => !k.includes("/"))).toEqual(["ftyp", "moov", "mdat"]);
    expect(b.get("moov/trak/mdia/minf/stbl/stsd/avc1")).toBeDefined();
    // Thirty frames a second: a timescale of 30,000 and 1,000 ticks a frame, 2.5 seconds.
    const mdhd = b.get("moov/trak/mdia/mdhd")!.body;
    expect(view.getUint32(mdhd + 12)).toBe(30000);
    expect(view.getUint32(mdhd + 16)).toBe(75000);
    const stts = b.get("moov/trak/mdia/minf/stbl/stts")!.body;
    expect([view.getUint32(stts + 4), view.getUint32(stts + 8), view.getUint32(stts + 12)]).toEqual([1, 75, 1000]);
    // Key frames: the first and the 61st.
    const stss = b.get("moov/trak/mdia/minf/stbl/stss")!.body;
    expect([view.getUint32(stss + 4), view.getUint32(stss + 8), view.getUint32(stss + 12)]).toEqual([2, 1, 61]);
    // Chunks of a second: 30, 30 and 15 frames, each starting where the index says, with its first frame's bytes.
    const stco = b.get("moov/trak/mdia/minf/stbl/stco")!.body;
    expect(view.getUint32(stco + 4)).toBe(3);
    for (const [i, first] of [[0, 0], [1, 30], [2, 60]] as const) expect(bytes[view.getUint32(stco + 8 + i * 4)]).toBe(first + 1);
    const stsz = b.get("moov/trak/mdia/minf/stbl/stsz")!.body;
    expect(view.getUint32(stsz + 8)).toBe(75);
    expect(view.getUint32(stsz + 12)).toBe(10);
    // The colour space: BT.709 primaries and matrix, sRGB's transfer, limited range.
    const colr = b.get("moov/trak/mdia/minf/stbl/stsd/avc1")!;
    const at = [...bytes.subarray(colr.start, colr.start + colr.size)].findIndex((_, k) => String.fromCharCode(...bytes.subarray(colr.start + k, colr.start + k + 4)) === "nclx");
    const nclx = colr.start + at + 4;
    expect([view.getUint16(nclx), view.getUint16(nclx + 2), view.getUint16(nclx + 4), bytes[nclx + 6]]).toEqual([1, 13, 1, 0]);
    expect(b.get("mdat")!.size).toBe(8 + samples.reduce((n, s) => n + s.data.length, 0));
  });

  it("gives frames that come out of order their place, and hides the delay", async () => {
    // Decoding order I P B B P…: frame numbers 0, 3, 1, 2, 6, 4, 5.
    const order = [0, 3, 1, 2, 6, 4, 5];
    const bytes = new Uint8Array(await mp4({ codec: "avc1.640028", width: 640, height: 360, fps: 60, description: AVCC }, order.map((f, i) => sample(5, f, i === 0))).arrayBuffer());
    const b = boxes(bytes);
    const view = new DataView(bytes.buffer);
    const ctts = b.get("moov/trak/mdia/minf/stbl/ctts")!.body;
    expect(view.getUint32(ctts + 4)).toBe(7);
    const offsets = order.map((_, i) => view.getUint32(ctts + 12 + i * 8));
    // Presentation time minus decoding time, plus the largest delay (frame 1 is decoded third: one frame), so never
    // negative, and the edit starts the video that one frame in.
    expect(offsets).toEqual(order.map((f, i) => (f - i + 1) * 1000));
    const elst = b.get("moov/trak/edts/elst")!.body;
    expect(view.getInt32(elst + 12)).toBe(1000);
  });

  it("writes VP9 with its configuration box", async () => {
    const bytes = new Uint8Array(await mp4({ codec: "vp09.00.41.08", width: 1080, height: 1920, fps: 30 }, [sample(20, 0, true)]).arrayBuffer());
    const b = boxes(bytes);
    expect(b.get("moov/trak/mdia/minf/stbl/stsd/vp09")).toBeDefined();
    expect(() => mp4({ codec: "avc1.640028", width: 2, height: 2, fps: 30 }, [])).toThrow();
  });

  it("writes its head from the frames' sizes alone, the frames then following it", async () => {
    const samples = Array.from({ length: 40 }, (_, i) => sample(7 + (i % 5), i, i === 0));
    const track = { codec: "avc1.640028", width: 640, height: 360, fps: 30, description: AVCC };
    const whole = new Uint8Array(await mp4(track, samples).arrayBuffer());
    const head = mp4Head(track, samples.map((s) => ({ size: s.data.length, key: s.key, frame: s.frame })));
    const joined = new Uint8Array(head.length + samples.reduce((n, s) => n + s.data.length, 0));
    joined.set(head);
    let at = head.length;
    for (const s of samples) {
      joined.set(s.data, at);
      at += s.data.length;
    }
    expect(joined).toEqual(whole);
  });

  it("uses 64-bit offsets and a 64-bit frames' box past 4 GB", () => {
    // Five minutes at 60 frames a second, 300 kB a frame: 5.4 GB of frames, only their sizes given.
    const frames = Array.from({ length: 18000 }, (_, i) => ({ size: 300_000, key: i % 120 === 0, frame: i }));
    const head = mp4Head({ codec: "avc1.640033", width: 3840, height: 2160, fps: 60, description: AVCC }, frames);
    const view = new DataView(head.buffer);
    const text = String.fromCharCode(...head);
    expect(text).toContain("co64");
    expect(text).not.toContain("stco");
    // The frames' box closes the head: size 1, "mdat", then its 64-bit size.
    const mdat = head.length - 16;
    expect(view.getUint32(mdat)).toBe(1);
    expect(String.fromCharCode(...head.subarray(mdat + 4, mdat + 8))).toBe("mdat");
    expect(view.getBigUint64(mdat + 8)).toBe(BigInt(16 + 18000 * 300_000));
    // The first chunk starts right after the head, the second a second's frames later.
    const co64 = text.indexOf("co64") + 8;
    expect(view.getUint32(co64)).toBe(300);
    expect(view.getBigUint64(co64 + 4)).toBe(BigInt(head.length));
    expect(view.getBigUint64(co64 + 12)).toBe(BigInt(head.length + 60 * 300_000));
  });
});
