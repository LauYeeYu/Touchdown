// The preview pictures for chat apps that the build draws (type-previews.ts, site-preview.ts): 1200 × 630 on the light
// paper colour, the pages' typeface drawn as outlines, the logo, and the PNG file.

import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { Resvg } from "@resvg/resvg-js";
import * as fontkit from "fontkit";
import { COLOURS } from "../src/lib/figure.ts";
import { AIRLINER, AIRLINER_TRANSFORM, GROUND } from "../src/lib/wordmark.ts";

/** A chat app's picture: 1200 × 630, as a share link's preview (docs/32, "Previews"). */
export const W = 1200;
export const H = 630;
export const C = COLOURS.light;

// ——— Words as paths ———
// The picture is drawn without the system's fonts, so the logo's name is the pages' typeface (Source Sans 3) drawn as
// outlines, at the top bar's 600 from the fixed weights: the font library cannot vary the pages' variable font as it is
// compressed.

const fonts = join(dirname(createRequire(import.meta.url).resolve("@fontsource/source-sans-3/LICENSE")), "files");
const sans600 = fontkit.openSync(join(fonts, "source-sans-3-latin-600-normal.woff2")) as fontkit.Font;

export const num = (x: number) => String(Math.round(x * 100) / 100);

/** A line of words as outlines at 600, its left end at x and its baseline at y, `size` pixels high; and its width. */
function words(text: string, size: number, letterSpacing = 0): { width: number; at: (x: number, y: number, fill: string) => string } {
  const run = sans600.layout(text);
  const k = size / sans600.unitsPerEm;
  const glyphs: { d: string; x: number }[] = [];
  let x = 0;
  run.glyphs.forEach((g, i) => {
    glyphs.push({ d: g.path.toSVG(), x });
    x += run.positions[i]!.xAdvance * k + letterSpacing;
  });
  const width = x - letterSpacing;
  return {
    width,
    at: (x0, y0, fill) => `<g fill="${fill}">${glyphs.map((g) => `<path transform="translate(${num(x0 + g.x)} ${num(y0)}) scale(${k} ${-k})" d="${g.d}"/>`).join("")}</g>`,
  };
}

/**
 * The logo, as a share link's preview draws it (lib/figure.ts): the mark and the name, its name `size` high, its
 * bottom at `bottom` and its right end at `right`, or its middle at the picture's when `right` is not given.
 */
export function logo(size: number, bottom: number, right?: number): string {
  const markH = (size * 25) / 18;
  const markScale = markH / 20.5;
  const markW = 28 * markScale;
  const gap = right === undefined ? 0.5 * size : 13;
  const name = words("Touchdown", size, -0.015 * size);
  const width = markW + gap + name.width;
  const left = right === undefined ? (W - width) / 2 : right - width;
  return [
    `<g transform="translate(${num(left)} ${num(bottom - markH)}) scale(${markScale.toFixed(3)}) translate(-2 -6)">`,
    `<path d="${GROUND}" stroke="${C.paper}" stroke-width="4.4" stroke-linecap="round"/>`,
    `<path d="${GROUND}" stroke="${C.flown}" stroke-width="2.4" stroke-linecap="round"/>`,
    `<path transform="${AIRLINER_TRANSFORM}" d="${AIRLINER}" fill="${C.ink}" stroke="${C.paper}" stroke-width="2" paint-order="stroke"/>`,
    `</g>`,
    name.at(left + width - name.width, bottom - markH / 2 + 0.36 * size, C.ink),
  ].join("");
}

/** The picture: the paper colour under `body`. */
export const picture = (body: string) => `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><rect width="${W}" height="${H}" fill="${C.paper}"/>${body}</svg>`;

function png(svg: string): Buffer {
  return new Resvg(svg, { font: { loadSystemFonts: false }, fitTo: { mode: "original" } }).render().asPng();
}

/**
 * A picture written to `file`, and the hash of its contents to put in its address, so a chat app that kept an earlier
 * one asks for the new one.
 */
export function keep(file: string, svg: string): string {
  const bytes = png(svg);
  writeFileSync(file, bytes);
  return createHash("sha256").update(bytes).digest("hex").slice(0, 12);
}
