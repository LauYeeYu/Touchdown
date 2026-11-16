import { crc32, inflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { drawCompare, type CompareBase } from "../src/compare.ts";
import { zlib } from "../src/raster.ts";

const b64 = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64");

/** A PNG's header, palette and pixels, its chunks' checksums checked. */
function read(png: Uint8Array) {
  const buf = Buffer.from(png);
  expect([...buf.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
  const chunks = new Map<string, Buffer[]>();
  for (let at = 8; at < buf.length; ) {
    const length = buf.readUInt32BE(at);
    const type = buf.toString("latin1", at + 4, at + 8);
    expect(buf.readUInt32BE(at + 8 + length), type).toBe(crc32(buf.subarray(at + 4, at + 8 + length)));
    chunks.set(type, [...(chunks.get(type) ?? []), buf.subarray(at + 8, at + 8 + length)]);
    at += 12 + length;
  }
  const head = chunks.get("IHDR")![0]!;
  const [w, h] = [head.readUInt32BE(0), head.readUInt32BE(4)];
  const raw = inflateSync(Buffer.concat(chunks.get("IDAT")!));
  expect(raw.length).toBe((w + 1) * h);
  return { w, h, depth: head[8], colour: head[9], palette: chunks.get("PLTE")![0]!, at: (x: number, y: number) => raw[y * (w + 1) + 1 + x], filters: Array.from({ length: h }, (_, y) => raw[y * (w + 1)]) };
}

describe("the server's pictures", () => {
  it("compresses bytes so that zlib reads them back as they were", () => {
    let seed = 7;
    const random = () => (seed = (seed * 1103515245 + 12345) >>> 0) / 2 ** 32;
    for (const [row, rows] of [[1201, 40], [17, 9], [3, 1], [1, 1]] as const) {
      // Runs, rows like the one above, long stretches of the background and odd bytes, as a drawing has them.
      const raw = new Uint8Array(row * rows);
      for (let i = 0; i < raw.length; i++) {
        const r = random();
        raw[i] = r < 0.4 ? 0 : r < 0.7 && i >= row ? raw[i - row]! : r < 0.9 && i ? raw[i - 1]! : Math.floor(random() * 256);
      }
      raw.fill(0, Math.floor(raw.length / 3), Math.floor(raw.length / 2));
      expect(Buffer.compare(inflateSync(zlib(raw, row)), Buffer.from(raw)), `${row} × ${rows}`).toBe(0);
    }
  });

  it("draws Compare's two types over each other at one scale, the first filled softly and the second as its outline", () => {
    const palette = new Uint8Array(768).map((_, i) => i % 256);
    const base: CompareBase = { width: 1200, height: 630, palette: b64(palette), levels: 128, logo: { x: 1100, y: 600, w: 2, h: 1, pixels: b64(Uint8Array.from([200, 201])) } };
    // A square 10 m across and 10 m long, and a wider, shorter one: 20 m across and 5 m long, both noses at 0.
    const first = [[-500, 0, 500, 0, 500, 1000, -500, 1000]];
    const second = [[-1000, 0, 1000, 0, 1000, 500, -1000, 500]];
    const png = read(drawCompare(base, first, second));
    expect([png.w, png.h, png.depth, png.colour]).toEqual([1200, 630, 8, 3]);
    expect(Buffer.compare(png.palette, Buffer.from(palette))).toBe(0);
    expect(new Set(png.filters)).toEqual(new Set([0]));
    // 30 pixels a metre (20 m across in 600), the 10 m from nose to tail in the middle: the first from 450 to 750
    // across and 165 to 465 down, the second from 300 to 900 and 165 to 315.
    const soft = Math.round(0.22 * 127);
    expect(png.at(600, 400)).toBe(soft);
    expect(png.at(600, 200)).toBe(soft);
    expect(png.at(850, 200)).toBe(0);
    expect(png.at(902, 240)).toBe(127);
    expect(png.at(298, 240)).toBe(127);
    // The outline shows over the first's fill.
    expect(png.at(600, 317)).toBe(127);
    expect(png.at(850, 317)).toBe(127);
    expect(png.at(100, 100)).toBe(0);
    expect([png.at(1100, 600), png.at(1101, 600), png.at(1102, 600)]).toEqual([200, 201, 0]);
  });
});
