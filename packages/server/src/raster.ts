// Pictures the server draws (compare.ts, Compare's preview for chat apps): filled polygons as how much of each pixel
// they cover, and a PNG in palette colours. Standard JavaScript only, no canvas and no library, so it runs the same in a
// Worker and in Node, quickly enough for a request.

/** A polygon: its points' x and y one after the other, in pixels, y down. */
export type Polygon = ArrayLike<number>;

/** Twice a polygon's area, positive when it turns clockwise on the screen. */
function turn(p: Polygon): number {
  let a = 0;
  const n = p.length;
  for (let i = 0; i < n; i += 2) {
    const j = (i + 2) % n;
    a += p[i]! * p[j + 1]! - p[j]! * p[i + 1]!;
  }
  return a;
}

/**
 * How much of each pixel of a picture some polygons cover together, as what each edge adds to the pixels it crosses,
 * the area it closes off (as font rasterisers do): summed along a row, these are the cover, 0 to 1 once the sum's size
 * is taken and kept to 1. Each row has two columns more than the picture (`stride`): an edge on the right border adds
 * to the pixel past it. Outside the columns its edges reach (`from` to `to`) a row's sum is 0.
 */
export interface Coverage {
  acc: Float32Array;
  stride: number;
  from: Int32Array;
  to: Int32Array;
}

/**
 * The coverage of polygons in a `w` × `h` picture. They are turned alike first, so where they overlap they add up
 * rather than cancel.
 */
export function coverage(polygons: Polygon[], w: number, h: number): Coverage {
  const stride = w + 2;
  const acc = new Float32Array(stride * h);
  const from = new Int32Array(h).fill(stride);
  const to = new Int32Array(h);
  const line = (ax: number, ay: number, bx: number, by: number, sign: number) => {
    if (ay === by) return;
    let dir = sign;
    if (ay > by) {
      [ax, ay, bx, by] = [bx, by, ax, ay];
      dir = -dir;
    }
    const dxdy = (bx - ax) / (by - ay);
    let x = ay < 0 ? ax - ay * dxdy : ax;
    const top = Math.max(0, Math.floor(ay));
    const end = Math.min(h, Math.ceil(by));
    for (let y = top; y < end; y++) {
      const dy = Math.min(y + 1, by) - Math.max(y, ay);
      const next = x + dxdy * dy;
      const d = dy * dir;
      const row = y * stride;
      const x0 = Math.min(Math.max(Math.min(x, next), 0), w);
      const x1 = Math.min(Math.max(Math.max(x, next), 0), w);
      const x0f = Math.floor(x0);
      const x1c = Math.ceil(x1);
      if (x0f < from[y]!) from[y] = x0f;
      if (x1c + 2 > to[y]!) to[y] = x1c + 2;
      if (x1c <= x0f + 1) {
        // Within one pixel: the part right of the edge's middle there, and the rest to the next.
        const m = 0.5 * (x0 + x1) - x0f;
        acc[row + x0f]! += d - d * m;
        acc[row + x0f + 1]! += d * m;
      } else {
        // Across several: a triangle in the first and the last, a steady share in each between.
        const s = 1 / (x1 - x0);
        const f0 = x0 - x0f;
        const a0 = 0.5 * s * (1 - f0) * (1 - f0);
        const f1 = x1 - x1c + 1;
        const am = 0.5 * s * f1 * f1;
        acc[row + x0f]! += d * a0;
        if (x1c === x0f + 2) acc[row + x0f + 1]! += d * (1 - a0 - am);
        else {
          const a1 = s * (1.5 - f0);
          acc[row + x0f + 1]! += d * (a1 - a0);
          for (let xi = x0f + 2; xi < x1c - 1; xi++) acc[row + xi]! += d * s;
          const a2 = a1 + (x1c - x0f - 3) * s;
          acc[row + x1c - 1]! += d * (1 - a2 - am);
        }
        acc[row + x1c]! += d * am;
      }
      x = next;
    }
  };
  for (const p of polygons) {
    const sign = turn(p) < 0 ? -1 : 1;
    const n = p.length;
    for (let i = 0; i < n; i += 2) {
      const j = (i + 2) % n;
      line(p[i]!, p[i + 1]!, p[j]!, p[j + 1]!, sign);
    }
  }
  return { acc, stride, from, to };
}

/**
 * The polygons that cover a band `r` wide on each side of every edge of `polygons`, round at the corners: filled, the
 * polygons' outline drawn with a pen 2r wide.
 */
export function strokes(polygons: Polygon[], r: number): Polygon[] {
  const out: Polygon[] = [];
  const corner = Array.from({ length: 8 }, (_, k) => [Math.cos((k * Math.PI) / 4) * r, Math.sin((k * Math.PI) / 4) * r] as const);
  for (const p of polygons) {
    const n = p.length;
    for (let i = 0; i < n; i += 2) {
      const [ax, ay] = [p[i]!, p[i + 1]!];
      const j = (i + 2) % n;
      const [bx, by] = [p[j]!, p[j + 1]!];
      const len = Math.hypot(bx - ax, by - ay);
      if (len > 0) {
        const [nx, ny] = [(-(by - ay) / len) * r, ((bx - ax) / len) * r];
        out.push([ax + nx, ay + ny, bx + nx, by + ny, bx - nx, by - ny, ax - nx, ay - ny]);
      }
      out.push(corner.flatMap(([cx, cy]) => [ax + cx, ay + cy]));
    }
  }
  return out;
}

// ——— PNG ———

const CRC = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC[(c ^ bytes[i]!) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** Deflate's fixed codes: a literal, a length's symbol or the end, its code with its bits reversed and its length. */
const FIXED = Array.from({ length: 288 }, (_, v) => {
  const [code, bits] = v < 144 ? [0x30 + v, 8] : v < 256 ? [0x190 + v - 144, 9] : v < 280 ? [v - 256, 7] : [0xc0 + v - 280, 8];
  let r = 0;
  for (let k = 0; k < bits; k++) r |= ((code >> k) & 1) << (bits - 1 - k);
  return [r, bits] as const;
});
const LENGTH_BASE = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258];
const LENGTH_EXTRA = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0];
const DISTANCE_BASE = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577];
const DISTANCE_EXTRA = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13];
/** Each length's place in LENGTH_BASE, from 3 to 258. */
const LENGTH_CODE = Uint8Array.from({ length: 259 }, (_, n) => Math.max(0, LENGTH_BASE.findLastIndex((b) => b <= n)));

/**
 * `raw` compressed as a zlib stream in one block of deflate's fixed codes, each byte either written or copied: from the
 * byte before it, for a run of one colour, or from `row` bytes before, the row above. A picture of a few flat colours
 * comes out small, quicker than a general compressor would make it. A run is found four bytes at a time, however long,
 * and the stream's checksum (Adler-32) is summed on the way, a run's at once.
 */
export function zlib(raw: Uint8Array, row: number): Uint8Array {
  let out = new Uint8Array(1024 + (raw.length >> 3));
  let at = 0;
  let bits = 0;
  let held = 0;
  const put = (value: number, count: number) => {
    bits |= value << held;
    held += count;
    while (held >= 8) {
      if (at === out.length) {
        const more = new Uint8Array(out.length * 2);
        more.set(out);
        out = more;
      }
      out[at++] = bits & 0xff;
      bits >>>= 8;
      held -= 8;
    }
  };
  const symbol = (v: number) => put(FIXED[v]![0], FIXED[v]![1]);
  // The two distances copied from, the byte before and the row above, as their codes, extra bits and those bits' value.
  const distance = (n: number) => {
    const d = DISTANCE_BASE.findLastIndex((b) => b <= n);
    // A distance's 5-bit code, reversed as Huffman codes are.
    let r = 0;
    for (let k = 0; k < 5; k++) r |= ((d >> k) & 1) << (4 - k);
    return [r, DISTANCE_EXTRA[d]!, n - DISTANCE_BASE[d]!] as const;
  };
  const [before, above] = [distance(1), distance(row)];
  const copy = (length: number, from: readonly [number, number, number]) => {
    const l = LENGTH_CODE[length]!;
    symbol(257 + l);
    put(length - LENGTH_BASE[l]!, LENGTH_EXTRA[l]!);
    put(from[0], 5);
    put(from[2], from[1]);
  };
  put(0x78, 8);
  put(0x01, 8);
  // The last block, in fixed codes.
  put(1, 1);
  put(1, 2);
  const n = raw.length;
  const words = raw.byteOffset % 4 === 0 ? new Uint32Array(raw.buffer, raw.byteOffset, n >> 2) : null;
  const M = 65521;
  let a = 1;
  let b = 0;
  for (let i = 0; i < n; ) {
    const last = i >= 1 ? raw[i - 1]! : -1;
    if (raw[i] === last) {
      // A run of the byte before, however long: four bytes at a time where they line up.
      let end = i + 1;
      while (end < n && end & 3 && raw[end] === last) end++;
      if (words) {
        const four = (last * 0x01010101) >>> 0;
        while (end + 4 <= n && words[end >> 2] === four) end += 4;
      }
      while (end < n && raw[end] === last) end++;
      let length = end - i;
      b = (b + (length % M) * a + ((last * length * (length + 1)) / 2) % M) % M;
      a = (a + (length % M) * last) % M;
      i = end;
      while (length >= 3) {
        // Copies of up to 258, none leaving fewer than 3 for the next.
        let l = Math.min(258, length);
        if (length - l > 0 && length - l < 3) l = length - 3;
        copy(l, before);
        length -= l;
      }
      for (; length > 0; length--) symbol(last);
      continue;
    }
    // Else as the row above, up to where a run starts, or the byte itself.
    const most = Math.min(258, n - i);
    let up = 0;
    if (i >= row) while (up < most && raw[i + up] === raw[i + up - row] && (up === 0 || raw[i + up] !== raw[i + up - 1])) up++;
    if (up >= 3) {
      for (let k = 0; k < up; k++) {
        a += raw[i + k]!;
        b += a;
      }
      a %= M;
      b %= M;
      copy(up, above);
      i += up;
    } else {
      const v = raw[i++]!;
      a = (a + v) % M;
      b = (b + a) % M;
      symbol(v);
    }
  }
  symbol(256);
  if (held > 0) put(0, 8 - held);
  const sum = ((b << 16) | a) >>> 0;
  const end = new Uint8Array(at + 4);
  end.set(out.subarray(0, at));
  new DataView(end.buffer).setUint32(at, sum);
  return end;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

/** A PNG of a `w` × `h` picture in palette colours: one index a pixel, row by row, and three bytes a colour. */
export function png(pixels: Uint8Array, w: number, h: number, palette: Uint8Array): Uint8Array<ArrayBuffer> {
  const header = new Uint8Array(13);
  const view = new DataView(header.buffer);
  view.setUint32(0, w);
  view.setUint32(4, h);
  header.set([8, 3, 0, 0, 0], 8);
  // Each row after a byte for its filter: none, the best for palette colours.
  const raw = new Uint8Array((w + 1) * h);
  for (let y = 0; y < h; y++) raw.set(pixels.subarray(y * w, (y + 1) * w), y * (w + 1) + 1);
  const parts = [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", header), chunk("PLTE", palette), chunk("IDAT", zlib(raw, w + 1)), chunk("IEND", new Uint8Array())];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}
