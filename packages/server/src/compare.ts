// Compare's picture for chat apps (docs/31-ui.md, "Aircraft types", "Previews"): the two types an address asks for, as
// the page draws them, over each other at one scale with their noses together on one centreline, the first filled
// softly and the second as its outline, and the logo at the bottom right. Every pair cannot be drawn ahead, so the
// server draws one when a chat app asks for it (types.ts), from each type's drawing and the picture's colours and logo,
// which the types pages' build writes (apps/web/scripts/type-previews.ts).

import { coverage, png, strokes, type Polygon } from "./raster.ts";

/** The picture's size, colours and logo, as the build writes them. */
export interface CompareBase {
  width: number;
  height: number;
  /** Three bytes a colour, base64. The first `levels` go from the paper to the ink, the rest are for the logo. */
  palette: string;
  levels: number;
  /** The logo's pixels as palette indexes, row by row, base64, and where they go. */
  logo: { x: number; y: number; w: number; h: number; pixels: string };
}

/** A type's drawing: its parts, each a polygon of x and y one after the other in centimetres, nose at 0, y to the tail. */
export type CompareDrawing = number[][];

/** Changed with the way the picture is drawn, so its address changes and a chat app asks for it again. */
export const DRAWN = "1";

/** The room the drawing has, as a type's own picture has it, so a chat app that cuts a square from the middle shows it. */
const ROOM = [600, 502] as const;
/** How far the second's outline reaches out of it, in pixels. */
const OUTLINE = 4;
/** The first's fill, as on the page. */
const SOFT = 0.22;

const bytes = (b64: string) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));

/** The picture of `first` and `second` as a PNG. */
export function drawCompare(base: CompareBase, first: CompareDrawing, second: CompareDrawing): Uint8Array<ArrayBuffer> {
  const { width: W, height: H } = base;
  // In metres: one scale for both, the wider and the longer of the two deciding it, the noses on a line.
  let [half, top, bottom] = [0, 0, 0];
  for (const part of [...first, ...second])
    for (let i = 0; i < part.length; i += 2) {
      half = Math.max(half, Math.abs(part[i]! / 100));
      top = Math.min(top, part[i + 1]! / 100);
      bottom = Math.max(bottom, part[i + 1]! / 100);
    }
  const scale = Math.min(ROOM[0] / (2 * half || 1), ROOM[1] / (bottom - top || 1));
  // The pixels the drawing reaches, with its outline and a pixel to spare, and the polygons placed in them.
  const margin = OUTLINE + 2;
  const x0 = Math.max(0, Math.floor(W / 2 - half * scale - margin));
  const y0 = Math.max(0, Math.floor(H / 2 - ((bottom - top) / 2) * scale - margin));
  const w = Math.min(W, Math.ceil(W / 2 + half * scale + margin)) - x0;
  const h = Math.min(H, Math.ceil(H / 2 + ((bottom - top) / 2) * scale + margin)) - y0;
  const place = (d: CompareDrawing): Polygon[] =>
    d.map((part) => part.map((v, i) => (i % 2 === 0 ? W / 2 + (v / 100) * scale - x0 : H / 2 + (v / 100 - (top + bottom) / 2) * scale - y0)));
  const a = place(first);
  const b = place(second);
  const fa = coverage(a, w, h);
  const fb = coverage(b, w, h);
  const sb = coverage(strokes(b, OUTLINE), w, h);

  const pixels = new Uint8Array(W * H);
  const { logo } = base;
  const mark = bytes(logo.pixels);
  for (let y = 0; y < logo.h; y++) pixels.set(mark.subarray(y * logo.w, (y + 1) * logo.w), (logo.y + y) * W + logo.x);
  const ink = base.levels - 1;
  const [ea, eb, es] = [fa.acc, fb.acc, sb.acc];
  for (let y = 0; y < h; y++) {
    let ca = 0;
    let cb = 0;
    let cs = 0;
    const out = (y0 + y) * W + x0;
    // Only the columns the row's edges reach: the first's and the outline's, which takes in the second's.
    const end = Math.min(w, Math.max(fa.to[y]!, sb.to[y]!));
    for (let x = Math.min(fa.from[y]!, sb.from[y]!), i = y * sb.stride + x; x < end; x++, i++) {
      ca += ea[i]!;
      cb += eb[i]!;
      cs += es[i]!;
      // The second's outline, its inside the paper's colour, then the first's soft fill over both.
      let v = Math.min(1, Math.abs(cs)) * (1 - Math.min(1, Math.abs(cb)));
      v += (1 - v) * SOFT * Math.min(1, Math.abs(ca));
      const k = (v * ink + 0.5) | 0;
      if (k > 0) pixels[out + x] = k;
    }
  }
  return png(pixels, W, H, bytes(base.palette));
}
