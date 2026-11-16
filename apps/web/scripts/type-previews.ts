// The types pages' previews for chat apps (docs/31-ui.md, "Aircraft types", "Previews"): a picture of every type that
// has a drawing and one of the list, and each page's title and the line under it in every language, which the server
// puts in the page's head (packages/server/src/types.ts). The words are the pages' own. Compare's picture of two types
// is drawn by the server when asked (packages/server/src/compare.ts), from each type's drawing and the picture's colours
// and logo, written here too. Run after the types pages' build (package.json), into its directory;
// `--only A388,C172 --out DIR` draws only those types and the list, into DIR.

import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { RefIndex } from "@touchdown/core";
import { LOCALES, setLocale, t, type Locale } from "@touchdown/i18n";
import { loadRefTables } from "@touchdown/refdata";
import { previewFile, type CompareBase, type CompareDrawing, type TypePreviews } from "@touchdown/server";
import { typeName } from "../src/lib/format.ts";
import { extentOf, planformParts, planformPath } from "../src/lib/silhouette.ts";
import { slugOf, typeEntries } from "../src/lib/typeEntries.ts";
import { metres, weight } from "../src/lib/typeFigures.ts";
import { loadTypeInfo, type TypeInfo } from "../src/lib/typeInfo.ts";
import { C, H, W, keep as keepAt, logo, num, picture as paper, pixels } from "./picture.ts";

const { values: args } = parseArgs({ options: { only: { type: "string" }, out: { type: "string" } } });
const OUT = args.out ?? join(import.meta.dirname, "../dist/types-files/previews");

/** The logo at the bottom right, as a share link's preview has it. */
const corner = () => logo(26, H - 36, W - 44);
/** A types page's picture. */
const picture = (body: string) => paper(body + corner());

// ——— Drawings ———

type Drawing = { parts: ReturnType<typeof planformParts>; path: string; extent: [number, number, number, number] };

function drawingOf(code: string, info: TypeInfo, ref: RefIndex): Drawing | null {
  const p = info.planform(code, ref);
  if (!p) return null;
  const parts = planformParts(p);
  return { parts, path: planformPath(parts), extent: extentOf(parts) };
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

// ——— Compare ———

/**
 * The palette of Compare's picture and its logo's pixels in it. The server draws on the paper in the ink at the first
 * `levels` indexes, the paper to the ink. The logo, in the ink and the flown gold, takes the nearest of those and of
 * the paper to the gold and the gold to the ink.
 */
function compareBase(): CompareBase {
  const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const [paperC, inkC, goldC] = [rgb(C.paper), rgb(C.ink), rgb(C.flown)];
  const ramp = (from: number[], to: number[], n: number) => Array.from({ length: n }, (_, k) => from.map((v, c) => Math.round(v + ((to[c]! - v) * k) / (n - 1))));
  const levels = 128;
  const palette = [...ramp(paperC, inkC, levels), ...ramp(paperC, goldC, 64), ...ramp(goldC, inkC, 64)];
  // The logo's pixels as drawn on the paper, within the box where they differ from it.
  const rgba = pixels(paper(corner()));
  const differs = (i: number) => rgba[i * 4] !== paperC[0] || rgba[i * 4 + 1] !== paperC[1] || rgba[i * 4 + 2] !== paperC[2];
  let [x0, y0, x1, y1] = [W, H, -1, -1];
  for (let i = 0; i < W * H; i++)
    if (differs(i)) {
      const [x, y] = [i % W, Math.floor(i / W)];
      [x0, y0, x1, y1] = [Math.min(x0, x), Math.min(y0, y), Math.max(x1, x), Math.max(y1, y)];
    }
  const [w, h] = [x1 - x0 + 1, y1 - y0 + 1];
  const indexes = new Uint8Array(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = (y0 + y) * W + x0 + x;
      let best = 0;
      let near = Infinity;
      palette.forEach((p, k) => {
        const d = (p[0]! - rgba[i * 4]!) ** 2 + (p[1]! - rgba[i * 4 + 1]!) ** 2 + (p[2]! - rgba[i * 4 + 2]!) ** 2;
        if (d < near) [best, near] = [k, d];
      });
      indexes[y * w + x] = best;
    }
  const b64 = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64");
  return { width: W, height: H, palette: b64(Uint8Array.from(palette.flat())), levels, logo: { x: x0, y: y0, w, h, pixels: b64(indexes) } };
}

/** A drawing as the server reads it: x and y in whole centimetres. */
const compareDrawing = (d: Drawing): CompareDrawing => d.parts.map((part) => part.flatMap(([x, y]) => [Math.round(x * 100), Math.round(y * 100)]));

// ——— Files ———

/** A picture written under its name, its address carrying a hash of its contents, so a chat app asks for a new one. */
const keep = (name: string, svg: string): string => `${name}?v=${keepAt(join(OUT, name), svg)}`;

const ref = new RefIndex(loadRefTables());
const info = await loadTypeInfo();
const only = args.only ? new Set(args.only.split(",")) : null;
const { entries, manufacturers } = typeEntries(ref, info, { flown: new Map(), seen: new Map() });

// A whole run starts from nothing, so a type that lost its drawing loses its picture too.
if (!only) rmSync(OUT, { recursive: true, force: true });
mkdirSync(join(OUT, "drawings"), { recursive: true });

const drawings = new Map<string, Drawing>();
for (const type of ref.types.values()) {
  const d = drawingOf(type.designator, info, ref);
  if (d) drawings.set(type.designator, d);
}
const listImage = keep("list.png", listPicture(drawings));
const images = new Map<string, string>();
const started = Date.now();
for (const [code, d] of drawings)
  if (!only || only.has(code)) {
    images.set(code, keep(`${code}.png`, typePicture(d)));
    writeFileSync(join(OUT, "drawings", `${code}.json`), JSON.stringify(compareDrawing(d)));
  }
writeFileSync(join(OUT, "compare.json"), JSON.stringify(compareBase()));
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
