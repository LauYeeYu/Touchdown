// adsb.lol's history (docs/13-reference-data.md, docs/23-tracks-and-maps.md): one GitHub release a UTC day, a tar of
// every aircraft's trace that day, each file gzipped on its own, 1.5 to 3.5 GB a day. Nothing that large is
// downloaded or kept. The day's files sit in 256 folders by the last two digits of the aircraft's hex code, in no
// fixed order, so small reads a few megabytes apart find the aircraft's folder (about 1/256 of the day) and only
// that folder is read through. What is found is kept in data/private/cache/adsblol: the aircraft's trace, a few
// hundred kilobytes, and the day's map of folders. Open data (ODbL): credited wherever a track is shown.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import type { ReadsbTrace } from "@touchdown/core";
import { privatePath } from "../paths.ts";

const USER_AGENT = "Touchdown/0.1 (personal aircraft log; reads a few aircraft a day)";
/** The first day in the history (test releases until early March 2023, with few receivers). */
export const ADSBLOL_FIRST_DAY = "2023-02-16";
// Each day's release, best first: the production server, then its staging copy, then the early test servers.
const SERIES = ["prod-0", "prod-0tmp", "staging-0", "staging-0tmp", "test-0", "test-1"];
const STRIDE = 4 << 20;
const WINDOW = 64 << 10;
const CHUNK = 1 << 20;
const PARALLEL = 8;

export interface ReadStats {
  requests: number;
  bytes: number;
}

interface Part {
  name: string;
  url: string;
  size: number;
  start: number;
}

interface Member {
  at: number;
  name: string;
  size: number;
}

const folderOf = (name: string) => /^\.\/traces\/([0-9a-f]{2})\//.exec(name)?.[1] ?? null;

/** What the folder search needs of a day's archive: its size and reads by range (DayArchive; an in-memory tar in tests). */
export interface TarReader {
  readonly total: number;
  read(off: number, n: number): Promise<Uint8Array>;
}

/** The first file header at or after `off`, reading on through a large file up to `reach`; null past it. */
async function firstHeaderIn(r: TarReader, off: number, reach = 8 << 20): Promise<Member | null> {
  let at = off - (off % 512);
  const end = Math.min(r.total, off + reach);
  while (at < end) {
    const b = await r.read(at, Math.min(WINDOW, end - at));
    for (let i = 0; i + 512 <= b.length; i += 512) {
      const h = headerAt(b, i);
      if (h) return { at: at + i, ...h };
    }
    at += b.length - (b.length % 512);
  }
  return null;
}

function headerAt(b: Uint8Array, i: number): { name: string; size: number } | null {
  if (b.length - i < 512) return null;
  if (String.fromCharCode(...b.subarray(i + 257, i + 262)) !== "ustar") return null;
  const text = (from: number, len: number) => String.fromCharCode(...b.subarray(i + from, i + from + len)).replace(/\0.*$/s, "").trim();
  let sum = 256;
  for (let k = 0; k < 512; k++) if (k < 148 || k >= 156) sum += b[i + k]!;
  if (parseInt(text(148, 8) || "0", 8) !== sum) return null;
  return { name: text(0, 100), size: parseInt(text(124, 12) || "0", 8) };
}

async function pool<T, R>(items: T[], n: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]!);
      }
    }),
  );
  return out;
}

/** One day's release: its parts read as one file, by ranges. */
class DayArchive {
  readonly stats: ReadStats = { requests: 0, bytes: 0 };
  constructor(
    readonly tag: string,
    private parts: Part[],
    private readonly reopen: () => Promise<Part[] | null>,
  ) {}

  get total() {
    const last = this.parts[this.parts.length - 1]!;
    return last.start + last.size;
  }

  async read(off: number, n: number): Promise<Uint8Array> {
    const out: Uint8Array[] = [];
    let at = off;
    let left = Math.min(n, this.total - off);
    while (left > 0) {
      const p = this.parts.find((x) => x.start <= at && at < x.start + x.size)!;
      const take = Math.min(left, p.start + p.size - at);
      out.push(await this.range(p, at - p.start, take));
      at += take;
      left -= take;
    }
    return out.length === 1 ? out[0]! : Buffer.concat(out);
  }

  private async range(p: Part, from: number, length: number, attempt = 0): Promise<Uint8Array> {
    this.stats.requests++;
    const res = await fetch(p.url, { headers: { Range: `bytes=${from}-${from + length - 1}`, "User-Agent": USER_AGENT } }).catch(() => null);
    if (res?.status === 206) {
      const body = new Uint8Array(await res.arrayBuffer());
      this.stats.bytes += body.length;
      return body;
    }
    await res?.arrayBuffer().catch(() => null);
    if (attempt >= 3) throw new Error(`adsb.lol's archive for ${this.tag} could not be read (${res ? `HTTP ${res.status}` : "no answer"}).`);
    // The download addresses GitHub hands out expire: get fresh ones, and wait a little on a busy server.
    if (res && (res.status === 401 || res.status === 403 || res.status === 410)) {
      const parts = await this.reopen();
      if (parts) this.parts = parts;
      p = this.parts.find((x) => x.name === p.name) ?? p;
    } else await new Promise((r) => setTimeout(r, 2000 * 2 ** attempt));
    return this.range(p, from, length, attempt + 1);
  }

  /** The first file header at or after `off`, reading on through a large file; null past the end. */
  firstHeader(off: number, reach = 8 << 20): Promise<Member | null> {
    return firstHeaderIn(this, off, reach);
  }
}

async function probe(url: string): Promise<{ url: string; size: number } | null> {
  const res = await fetch(url, { headers: { Range: "bytes=0-0", "User-Agent": USER_AGENT } });
  await res.arrayBuffer().catch(() => null);
  if (res.status === 404) return null;
  const total = Number(res.headers.get("content-range")?.split("/")[1]);
  if (res.status !== 206 || !Number.isFinite(total)) throw new Error(`adsb.lol's archive could not be reached (HTTP ${res.status}).`);
  return { url: res.url, size: total };
}

/** The parts of a release: one .tar, or .tar.aa, .tar.ab, … */
async function partsOf(year: string, tag: string): Promise<Part[] | null> {
  const base = `https://github.com/adsblol/globe_history_${year}/releases/download/${tag}/${tag}`;
  const single = await probe(`${base}.tar`);
  if (single) return [{ name: ".tar", ...single, start: 0 }];
  const parts: Part[] = [];
  for (const c of "abcdefghijklmnop") {
    const p = await probe(`${base}.tar.a${c}`);
    if (!p) break;
    const start = parts.length ? parts[parts.length - 1]!.start + parts[parts.length - 1]!.size : 0;
    parts.push({ name: `.tar.a${c}`, ...p, start });
  }
  return parts.length ? parts : null;
}

interface DayCache {
  tag: string | null;
  /** Sampled offsets and the folder of the first file there ("" for another folder, such as the heatmaps). */
  samples: [number, string][];
}

const dayDir = (day: string) => privatePath("cache/adsblol", day);

function readDayCache(day: string): DayCache | null {
  const path = join(dayDir(day), "day.json");
  try {
    return existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as DayCache) : null;
  } catch {
    return null;
  }
}

function writeDayCache(day: string, c: DayCache) {
  mkdirSync(dayDir(day), { recursive: true });
  writeFileSync(join(dayDir(day), "day.json"), JSON.stringify(c));
}

async function openDay(day: string, known: DayCache | null): Promise<DayArchive | null> {
  const year = day.slice(0, 4);
  const dotted = day.replaceAll("-", ".");
  const tags = known?.tag ? [known.tag] : SERIES.map((s) => `v${dotted}-planes-readsb-${s}`);
  for (const tag of tags) {
    const parts = await partsOf(year, tag);
    if (parts) return new DayArchive(tag, parts, () => partsOf(year, tag));
  }
  return null;
}

export interface DayTraces {
  /** Each aircraft's trace that day, or null when it has none. */
  traces: Map<string, ReadsbTrace | null>;
  /** No release for the day (before the history, or not published yet). */
  noDay: boolean;
  read: ReadStats;
}

/**
 * The traces of these aircraft (hex codes) on one UTC day, from the cache or the day's release. Throws when the
 * archive cannot be read; a day without a release, or an aircraft without a trace, is an answer.
 */
export async function adsbLolTraces(day: string, hexes: string[], log: (line: string) => void = () => {}): Promise<DayTraces> {
  const out: DayTraces = { traces: new Map(), noDay: false, read: { requests: 0, bytes: 0 } };
  const wanted: string[] = [];
  for (const hex of new Set(hexes.map((h) => h.toLowerCase()))) {
    const base = join(dayDir(day), hex);
    if (existsSync(`${base}.json.gz`)) out.traces.set(hex, JSON.parse(gunzipSync(readFileSync(`${base}.json.gz`)).toString("utf8")) as ReadsbTrace);
    else if (existsSync(`${base}.none`)) out.traces.set(hex, null);
    else wanted.push(hex);
  }
  if (!wanted.length) return out;
  const cache = readDayCache(day) ?? { tag: null, samples: [] };
  const archive = await openDay(day, cache);
  if (!archive) {
    out.noDay = true;
    return out;
  }
  cache.tag = archive.tag;
  const samples = new Map(cache.samples);
  const sampleAt = async (off: number) => {
    if (samples.has(off)) return samples.get(off)!;
    const h = await archive.firstHeader(off, WINDOW);
    const f = h ? (folderOf(h.name) ?? "") : "";
    samples.set(off, f);
    return f;
  };
  const byFolder = new Map<string, string[]>();
  for (const hex of wanted) byFolder.set(hex.slice(-2), [...(byFolder.get(hex.slice(-2)) ?? []), hex]);
  try {
    for (const [folder, inFolder] of byFolder) {
      log(`  ${day}: looking for folder ${folder} in ${archive.tag} (${(archive.total / 2 ** 30).toFixed(1)} GB)`);
      const found = await readFolder(archive, folder, new Set(inFolder), sampleAt, samples);
      for (const hex of inFolder) {
        const body = found.get(hex) ?? null;
        mkdirSync(dayDir(day), { recursive: true });
        if (body) writeFileSync(join(dayDir(day), `${hex}.json.gz`), body);
        else writeFileSync(join(dayDir(day), `${hex}.none`), "");
        out.traces.set(hex, body ? (JSON.parse(gunzipSync(body).toString("utf8")) as ReadsbTrace) : null);
      }
    }
  } finally {
    writeDayCache(day, { tag: archive.tag, samples: [...samples].sort((a, b) => a[0] - b[0]) });
    out.read = archive.stats;
  }
  return out;
}

/**
 * Find a folder and read it through: sample every STRIDE bytes (in a shuffled order, until the folder turns up),
 * close in on where it starts, then read file by file to its end. Returns the gzipped trace of each wanted aircraft
 * found there.
 */
export async function readFolder(archive: TarReader, folder: string, hexes: Set<string>, sampleAt: (off: number) => Promise<string>, samples: Map<number, string>, stride = STRIDE): Promise<Map<string, Uint8Array>> {
  const offsets: number[] = [];
  for (let o = 0; o < archive.total; o += stride) offsets.push(o);
  // A shuffle that is the same every run, so a second run reuses the samples kept.
  let seed = parseInt(folder, 16) + 1;
  for (let i = offsets.length - 1; i > 0; i--) {
    seed = (seed * 1103515245 + 12345) % 2 ** 31;
    const j = seed % (i + 1);
    [offsets[i], offsets[j]] = [offsets[j]!, offsets[i]!];
  }
  let hit: number | null = [...samples].filter(([, f]) => f === folder).map(([o]) => o).sort((a, b) => a - b)[0] ?? null;
  for (let k = 0; hit === null && k < offsets.length; k += PARALLEL * 2) {
    const batch = offsets.slice(k, k + PARALLEL * 2);
    const folders = await pool(batch, PARALLEL, sampleAt);
    batch.forEach((o, i) => {
      if (folders[i] === folder && (hit === null || o < hit)) hit = o;
    });
  }
  // A folder smaller than the stride can lie between two samples: look where the sampled folders change.
  if (hit === null) hit = await betweenSamples(archive, folder, samples, sampleAt);
  if (hit === null) return new Map();
  // The start lies after the last offset known to be in another folder, before the hit.
  const g = async (off: number) => {
    const h = await firstHeaderIn(archive, off);
    return h ? folderOf(h.name) : null;
  };
  let lo = Math.max(0, ...[...samples].filter(([o, f]) => o < hit! && f !== folder).map(([o]) => o));
  if ((await g(lo)) === folder) lo = 0;
  let hi = hit;
  while (hi - lo > WINDOW) {
    let mid = Math.floor((lo + hi) / 2);
    mid -= mid % 512;
    if ((await g(mid)) === folder) hi = mid;
    else lo = mid;
  }
  // Read file by file from just before the folder to its end.
  const found = new Map<string, Uint8Array>();
  const start = await firstHeaderIn(archive, lo);
  if (!start) return found;
  let bufStart = start.at;
  let buf: Uint8Array = await archive.read(bufStart, CHUNK);
  const ensure = async (from: number, length: number) => {
    // Keep `buf` covering [from, from + length).
    if (from >= bufStart && from + length <= bufStart + buf.length) return;
    const keep = from >= bufStart && from < bufStart + buf.length ? buf.subarray(from - bufStart) : new Uint8Array(0);
    const more = await archive.read(from + keep.length, Math.max(CHUNK, length - keep.length));
    buf = keep.length ? Buffer.concat([keep, more]) : more;
    bufStart = from;
  };
  let at = start.at;
  let inside = false;
  while (at + 512 <= archive.total) {
    await ensure(at, 512);
    const h = headerAt(buf, at - bufStart);
    if (!h) break;
    const f = folderOf(h.name);
    if (inside && f !== folder) break;
    if (f === folder) inside = true;
    const hex = /\/trace_full_([0-9a-f]{6})\.json$/.exec(h.name)?.[1];
    if (f === folder && hex && hexes.has(hex)) {
      await ensure(at + 512, h.size);
      found.set(hex, buf.slice(at + 512 - bufStart, at + 512 - bufStart + h.size));
      if (found.size === hexes.size) break;
    }
    at += 512 + Math.ceil(h.size / 512) * 512;
  }
  return found;
}

/**
 * Where two neighbouring samples are in different folders, the folders that start between them are found one after
 * another (the first file after the end of each, closed in on by halving), until the one wanted turns up or the second
 * sample's folder is reached. The offsets looked at are kept with the samples. Returns where the folder starts, or null.
 */
async function betweenSamples(archive: TarReader, folder: string, samples: Map<number, string>, sampleAt: (off: number) => Promise<string>): Promise<number | null> {
  // Every sample, those that saw no folder too (inside a large file, or the heatmaps): a folder can end where they start.
  const known = [...samples].sort((a, b) => a[0] - b[0]);
  const changes = known.slice(1).map((b, i) => [known[i]!, b] as const).filter(([[, f1], [, f2]]) => f1 && f1 !== f2);
  /** The first header after `from` that is not in folder `cur`, looking no further than `until` plus a window. */
  const after = async (from: number, cur: string, until: number): Promise<Member | null> => {
    let lo = from;
    let hi = until;
    while (hi - lo > WINDOW) {
      let mid = Math.floor((lo + hi) / 2);
      mid -= mid % 512;
      if ((await sampleAt(mid)) === cur) lo = mid;
      else hi = mid;
    }
    // Walk the headers from `lo`, read a few windows at a time: the files of `cur` first, then the next folder's first one.
    let h = await firstHeaderIn(archive, lo);
    let bufAt = h?.at ?? 0;
    let buf = h ? await archive.read(bufAt, 2 * WINDOW) : new Uint8Array(0);
    while (h && folderOf(h.name) === cur && h.at <= until + WINDOW) {
      const next = h.at + 512 + Math.ceil(h.size / 512) * 512;
      if (next >= archive.total) return null;
      if (next + 512 > bufAt + buf.length) [bufAt, buf] = [next, await archive.read(next, 2 * WINDOW)];
      const n = headerAt(buf, next - bufAt);
      h = n ? { at: next, ...n } : await firstHeaderIn(archive, next);
    }
    return h;
  };
  for (const [[o1, f1], [o2, f2]] of changes) {
    let from = o1;
    let cur = f1;
    // A few small folders can sit between two samples.
    for (let k = 0; k < 16; k++) {
      const h = await after(from, cur, o2);
      const f = h ? folderOf(h.name) : null;
      if (!h || f === null || f === f2) break;
      samples.set(h.at, f);
      if (f === folder) return h.at;
      [from, cur] = [h.at, f];
    }
  }
  return null;
}
