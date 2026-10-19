// Helpers for the reference data build: cached downloads, CSV parsing, zip extraction, table output.

import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import type { RefTableFile } from "../../core/src/ref/types.ts";

export const packageDir = path.resolve(import.meta.dirname, "..");
export const cacheDir = path.join(packageDir, ".cache");
export const dataDir = path.join(packageDir, "data");

const USER_AGENT = "TouchdownRefdata/0.1 (reference data build for a personal aircraft log)";

/**
 * Returns the cached copy of a source file, downloading it first when it is missing or when
 * `refresh` is set. Files are kept as bytes so zips survive.
 */
export async function cached(fileName: string, url: string, refresh: boolean, init: RequestInit = {}): Promise<Buffer> {
  const file = path.join(cacheDir, fileName);
  if (!refresh && fs.existsSync(file)) return fs.readFileSync(file);
  console.log(`download ${url.length > 120 ? url.slice(0, 120) + "..." : url}`);
  const res = await fetch(url, { ...init, headers: { "User-Agent": USER_AGENT, ...(init.headers ?? {}) } });
  if (!res.ok) throw new Error(`GET ${url} failed: ${res.status} ${res.statusText}`);
  const body = Buffer.from(await res.arrayBuffer());
  fs.mkdirSync(cacheDir, { recursive: true });
  fs.writeFileSync(file, body);
  return body;
}

/** RFC 4180 CSV: quoted fields, doubled quotes, CRLF or LF line ends, optional BOM. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  let i = text.charCodeAt(0) === 0xfeff ? 1 : 0;
  for (; i < text.length; i++) {
    const ch = text[i]!;
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += ch;
  }
  if (field !== "" || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.length > 1 || r[0] !== "");
}

/** CSV with a header row, as one record per row keyed by column name. */
export function parseCsvRecords(text: string): Record<string, string>[] {
  const [header, ...rows] = parseCsv(text);
  if (!header) return [];
  return rows.map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ""])));
}

/** Extracts the named entries from a zip archive (stored or deflated entries only). */
export function unzip(zip: Buffer, names: string[]): Map<string, Buffer> {
  let eocd = -1;
  for (let i = zip.length - 22; i >= Math.max(0, zip.length - 65557); i--) {
    if (zip.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("not a zip file");
  const count = zip.readUInt16LE(eocd + 10);
  let p = zip.readUInt32LE(eocd + 16);
  const out = new Map<string, Buffer>();
  for (let n = 0; n < count; n++) {
    if (zip.readUInt32LE(p) !== 0x02014b50) throw new Error("bad zip central directory");
    const method = zip.readUInt16LE(p + 10);
    const compressedSize = zip.readUInt32LE(p + 20);
    const nameLen = zip.readUInt16LE(p + 28);
    const extraLen = zip.readUInt16LE(p + 30);
    const commentLen = zip.readUInt16LE(p + 32);
    const localOffset = zip.readUInt32LE(p + 42);
    const name = zip.toString("utf8", p + 46, p + 46 + nameLen);
    p += 46 + nameLen + extraLen + commentLen;
    if (!names.includes(name)) continue;
    const localNameLen = zip.readUInt16LE(localOffset + 26);
    const localExtraLen = zip.readUInt16LE(localOffset + 28);
    const start = localOffset + 30 + localNameLen + localExtraLen;
    const data = zip.subarray(start, start + compressedSize);
    if (method === 0) out.set(name, Buffer.from(data));
    else if (method === 8) out.set(name, zlib.inflateRawSync(data));
    else throw new Error(`zip entry ${name}: unsupported compression method ${method}`);
  }
  for (const name of names) if (!out.has(name)) throw new Error(`zip entry ${name} not found`);
  return out;
}

/**
 * Writes one reference table. The header is pretty-printed; each row is one line, so diffs
 * between builds stay readable.
 */
export function writeTable<T>(table: string, version: string, sources: string[], columns: readonly (keyof T & string)[], rows: T[]): RefTableFile {
  const file: RefTableFile = {
    table,
    version,
    sources,
    columns: [...columns],
    rows: rows.map((r) => columns.map((c) => r[c] ?? null)),
  };
  const head = JSON.stringify({ table, version, sources, columns: file.columns }, null, 2).replace(/\n}$/, "");
  const body = file.rows.map((r) => JSON.stringify(r)).join(",\n");
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(path.join(dataDir, `${table}.json`), `${head},\n  "rows": [\n${body}\n  ]\n}\n`);
  return file;
}

/** Simple string comparison that does not depend on the locale of the machine running the build. */
export function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Great-circle distance in kilometres. */
export function distanceKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad;
  const dLon = (lon2 - lon1) * rad;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(a));
}
