// The types pages' previews for chat apps (docs/31-ui.md, "Aircraft types", "Previews"): a picture of every type that
// has a drawing and one of the list, and each page's title and the line under it in every language, which the server
// puts in the page's head (packages/server/src/types.ts). The words are the pages' own. Run after the types pages' build
// (package.json), into its directory; `--only A388,C172 --out DIR` draws only those types and the list, into DIR.

import { createHash } from "node:crypto";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { parseArgs } from "node:util";
import { Resvg } from "@resvg/resvg-js";
import * as fontkit from "fontkit";
import { RefIndex } from "@touchdown/core";
import { LOCALES, setLocale, t, type Locale } from "@touchdown/i18n";
import { loadRefTables } from "@touchdown/refdata";
import { previewFile, type TypePreviews } from "@touchdown/server";
import { typeName } from "../src/lib/format.ts";
import { COLOURS } from "../src/lib/figure.ts";
import { extentOf, planformParts, planformPath } from "../src/lib/silhouette.ts";
import { slugOf, typeEntries } from "../src/lib/typeEntries.ts";
import { metres, weight } from "../src/lib/typeFigures.ts";
import { loadTypeInfo, type TypeInfo } from "../src/lib/typeInfo.ts";
import { AIRLINER, AIRLINER_TRANSFORM, GROUND } from "../src/lib/wordmark.ts";

/** A chat app's picture: 1200 × 630, as a share link's preview (docs/32, "Previews"). */
const W = 1200;
const H = 630;
const C = COLOURS.light;

const { values: args } = parseArgs({ options: { only: { type: "string" }, out: { type: "string" } } });
const OUT = args.out ?? join(import.meta.dirname, "../dist/types-files/previews");

// ——— Words as paths ———
// The picture is drawn without the system's fonts, so the logo's name is the pages' typeface (Source Sans 3) drawn as
// outlines, at the top bar's 600 from the fixed weights: the font library cannot vary the pages' variable font as it is
// compressed.

const fonts = join(dirname(createRequire(import.meta.url).resolve("@fontsource/source-sans-3/LICENSE")), "files");
const sans600 = fontkit.openSync(join(fonts, "source-sans-3-latin-600-normal.woff2")) as fontkit.Font;

const num = (x: number) => String(Math.round(x * 100) / 100);

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

/** The logo at the bottom right, as a share link's preview draws it (lib/figure.ts): the mark and the name. */
function logo(): string {
  const nameSize = 26;
  const markH = (nameSize * 25) / 18;
  const markScale = markH / 20.5;
  const markW = 28 * markScale;
  const name = words("Touchdown", nameSize, -0.015 * nameSize);
  const right = W - 44;
  const bottom = H - 36;
  const left = right - (markW + 13 + name.width);
  return [
    `<g transform="translate(${num(left)} ${num(bottom - markH)}) scale(${markScale.toFixed(3)}) translate(-2 -6)">`,
    `<path d="${GROUND}" stroke="${C.paper}" stroke-width="4.4" stroke-linecap="round"/>`,
    `<path d="${GROUND}" stroke="${C.flown}" stroke-width="2.4" stroke-linecap="round"/>`,
    `<path transform="${AIRLINER_TRANSFORM}" d="${AIRLINER}" fill="${C.ink}" stroke="${C.paper}" stroke-width="2" paint-order="stroke"/>`,
    `</g>`,
    name.at(right - name.width, bottom - markH / 2 + 0.36 * nameSize, C.ink),
  ].join("");
}

const picture = (body: string) => `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><rect width="${W}" height="${H}" fill="${C.paper}"/>${body}${logo()}</svg>`;

// ——— Drawings ———

type Drawing = { path: string; extent: [number, number, number, number] };

function drawingOf(code: string, info: TypeInfo, ref: RefIndex): Drawing | null {
  const p = info.planform(code, ref);
  if (!p) return null;
  const parts = planformParts(p);
  return { path: planformPath(parts), extent: extentOf(parts) };
}

/** A drawing in metres, its middle at cx, cy, `scale` pixels a metre. */
function placed(d: Drawing, cx: number, cy: number, scale: number, fill: string): string {
  const [x0, y0, x1, y1] = d.extent;
  return `<path transform="translate(${num(cx - ((x0 + x1) / 2) * scale)} ${num(cy - ((y0 + y1) / 2) * scale)}) scale(${scale.toFixed(4)})" d="${d.path}" fill="${fill}"/>`;
}

/**
 * A type: its drawing as large as the picture's middle holds, nose up, as on its page. A chat app that shows a square
 * cuts it from the middle, so the drawing stays within it.
 */
function typePicture(d: Drawing): string {
  const [x0, y0, x1, y1] = d.extent;
  const scale = Math.min(600 / (x1 - x0), 502 / (y1 - y0));
  return picture(placed(d, W / 2, H / 2, scale, C.ink));
}

/**
 * The list's picture: well-known types from a light aircraft to the largest airliner, to one scale and side by side,
 * their noses on a line, as the pages compare types.
 */
const LINEUP = ["C172", "AT76", "A320", "B789", "B744", "A388"];

function listPicture(drawings: Map<string, Drawing>): string {
  const shown = LINEUP.map((c) => {
    const d = drawings.get(c);
    if (!d) throw new Error(`${c} has no drawing for the list's picture.`);
    return d;
  });
  const margin = 56;
  const gap = 4;
  const spans = shown.map((d) => d.extent[2] - d.extent[0]);
  const scale = (W - 2 * margin) / (spans.reduce((a, b) => a + b, 0) + gap * (shown.length - 1));
  // The lineup in the middle, a little above it, clear of the logo.
  const top = (H - Math.max(...shown.map((d) => d.extent[3] - d.extent[1])) * scale) / 2 - 16;
  let x = margin;
  const drawn = shown.map((d, i) => {
    const w = spans[i]! * scale;
    const out = placed(d, x + w / 2, top + ((d.extent[3] - d.extent[1]) / 2) * scale, scale, C.ink);
    x += w + gap * scale;
    return out;
  });
  return picture(drawn.join(""));
}

// ——— Files ———

function png(svg: string): Buffer {
  return new Resvg(svg, { font: { loadSystemFonts: false }, fitTo: { mode: "original" } }).render().asPng();
}

/** A picture written under its name, its address carrying a hash of its contents, so a chat app asks for a new one. */
function keep(name: string, svg: string): string {
  const bytes = png(svg);
  writeFileSync(join(OUT, name), bytes);
  return `${name}?v=${createHash("sha256").update(bytes).digest("hex").slice(0, 12)}`;
}

const ref = new RefIndex(loadRefTables());
const info = await loadTypeInfo();
const only = args.only ? new Set(args.only.split(",")) : null;
const { entries, manufacturers } = typeEntries(ref, info, { flown: new Map(), seen: new Map() });

// A whole run starts from nothing, so a type that lost its drawing loses its picture too.
if (!only) rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

const drawings = new Map<string, Drawing>();
for (const type of ref.types.values()) {
  const d = drawingOf(type.designator, info, ref);
  if (d) drawings.set(type.designator, d);
}
const listImage = keep("list.png", listPicture(drawings));
const images = new Map<string, string>();
const started = Date.now();
for (const [code, d] of drawings) if (!only || only.has(code)) images.set(code, keep(`${code}.png`, typePicture(d)));
console.log(`${images.size} pictures of types in ${((Date.now() - started) / 1000).toFixed(1)} s.`);

if (!only) {
  const families = entries.filter((e) => e.family).length;
  const codes = entries.reduce((n, e) => n + e.codes.length, 0);
  for (const lang of Object.keys(LOCALES) as Locale[]) {
    await setLocale(lang);
    const pages: TypePreviews = {};
    pages["/types"] = [t("aircraft.types.title"), t("aircraft.types.lead.visitor", { families, codes }), listImage];
    // Compare's line names the two types the address asks for, which the server puts in place of these.
    pages["/types/compare"] = [t("aircraft.types.compare.title"), t("aircraft.types.compare.drawing", { first: "{first}", second: "{second}" }), listImage];
    for (const e of entries) {
      for (const code of e.codes) {
        const s = info.specs(code);
        const rotor = info.planform(code, ref)?.shape.kind === "helicopter";
        const name = typeName(code, ref);
        const lead = s?.lengthM && s.spanM ? t("aircraft.types.page.lead", { name, length: metres(s.lengthM), span: metres(s.spanM), rotor: rotor ? "yes" : "no", hasMtow: s.mtowKg ? "yes" : "no", mtow: s.mtowKg ? weight(s.mtowKg) : "" }) : "";
        pages[`/types/${code}`] = [name, lead, images.get(code) ?? listImage];
      }
      if (e.family) {
        const year = e.firstFlight?.slice(0, 4) ?? "none";
        pages[`/types/families/${slugOf(e.family.name)}`] = [e.family.name, t("aircraft.types.family.lead", { codes: e.codes.length, year }), images.get(e.usual) ?? listImage];
      }
    }
    for (const m of manufacturers) pages[`/types/manufacturers/${m.slug}`] = [m.name, t("aircraft.types.manufacturer.lead", { codes: m.codes, families: m.families }), listImage];
    // In the files the server reads each page's from.
    const files = new Map<string, TypePreviews>();
    for (const [page, preview] of Object.entries(pages)) {
      const name = previewFile(lang, page);
      if (!files.has(name)) files.set(name, {});
      files.get(name)![page] = preview;
    }
    for (const [name, part] of files) writeFileSync(join(OUT, name), JSON.stringify(part));
  }
  console.log(`Titles and lines for ${Object.keys(LOCALES).length} languages.`);
}
