// Share links (docs/32-modes-and-sharing.md, "Sharing"): the owner's /api/shares requests, and /p/<id>, the one route
// with user content outside the sign-in. A link reads the log live: when it is opened, the server lists the log's
// tables/ folder in the owner's Google Drive, reads only the files the link's kind needs (never one in private/), and
// sends what core's shareContent picks out of them. The result is kept under the versions of the files it came from.

import { SCHEMA_VERSION, SHARE_KINDS, SHARE_TABLES, shareContent, shareTracks, upgradeTableFile, type ShareAnchor, type ShareContent, type ShareKind, type ShareTables, type TableFile } from "@touchdown/core/share";
import type { TableName } from "@touchdown/core";
import { googleAccess, GoogleError } from "./google.ts";
import { b64url } from "./crypto.ts";
import { body, checkOrigin, Fail, json, siteOrigin, standardOn, storageKey, TERMS_VERSION, toUtcIso, type Server, type StorageRow } from "./handler.ts";

/** What the server keeps a link's content in, under the versions of the files it came from. */
export interface ShareCache {
  get(key: string): Promise<string | null>;
  put(key: string, value: string): Promise<void>;
}

/** A cache in this process's memory, for the Node server and tests; the Worker uses Cloudflare's. */
export function memoryCache(limit = 100): ShareCache {
  const m = new Map<string, string>();
  return {
    get: async (k) => m.get(k) ?? null,
    put: async (k, v) => {
      m.set(k, v);
      while (m.size > limit) m.delete(m.keys().next().value!);
    },
  };
}

const fallbackCache = memoryCache();

interface ShareRow {
  id: string;
  accountId: string;
  kind: ShareKind;
  subject: string;
  anchor: string | null;
  createdAt: string;
  timesOpened: number;
  lastOpenedAt: string | null;
}

/** 128 random bits, base64url: 22 characters. */
const SHARE_ID = /^[A-Za-z0-9_-]{22}$/;
const RECORD_ID = /^[A-Za-z0-9_-]{1,64}$/;
const newShareId = () => b64url(crypto.getRandomValues(new Uint8Array(16)));

const shareJson = (s: Server, url: URL, r: ShareRow) => ({
  id: r.id,
  url: `${siteOrigin(s, url)}/p/${r.id}`,
  kind: r.kind,
  subject: r.subject || null,
  anchor: r.anchor,
  createdAt: r.createdAt,
  timesOpened: r.timesOpened,
  lastOpenedAt: r.lastOpenedAt,
});

// ---------- the owner's requests ----------

/** /api/shares: the signed-in account's links. Needs a browser's session, not the command line's. */
export async function shareApi(request: Request, s: Server, url: URL, now: number, accountId: string): Promise<Response> {
  checkOrigin(request, s);
  const path = url.pathname.replace(/\/$/, "");
  const method = request.method;
  const nowIso = toUtcIso(now);

  if (method === "GET" && path === "/api/shares") {
    const rows = await s.db.all<ShareRow>("SELECT * FROM shares WHERE accountId = ? ORDER BY createdAt DESC", [accountId]);
    const conn = await s.db.first<{ status: string }>("SELECT status FROM storage_connections WHERE accountId = ?", [accountId]);
    return json(200, { shares: rows.map((r) => shareJson(s, url, r)), storage: conn?.status ?? null });
  }

  if (method === "POST" && path === "/api/shares") {
    const b = await body(request);
    const kind = b.kind as ShareKind;
    if (!SHARE_KINDS.includes(kind)) throw new Fail(400, "Not a kind of link.");
    const subject = kind === "log" ? "" : typeof b.subject === "string" && RECORD_ID.test(b.subject) ? b.subject : null;
    if (subject === null) throw new Fail(400, "Say which record to share.");
    const anchor = kind === "aircraft" && typeof b.anchor === "string" && /^(flights|sightings)\/[A-Za-z0-9_-]{1,64}$/.test(b.anchor) ? b.anchor : null;

    const conn = await s.db.first<StorageRow>("SELECT * FROM storage_connections WHERE accountId = ?", [accountId]);
    if (!conn || !standardOn(s)) throw new Fail(409, "Share links need Standard mode.");
    if (conn.status === "broken") throw new Fail(409, "The key to your Google Drive no longer works. Connect Google Drive again.");
    if (!(await s.db.first("SELECT accountId FROM consents WHERE accountId = ? AND termsVersion = ?", [accountId, TERMS_VERSION]))) {
      return json(409, { error: "Accept the updated terms for Standard mode first.", terms: TERMS_VERSION });
    }
    // The log's folder, found as the app finds it: the server reads the link's tables from there.
    if (!conn.location) {
      const token = await accessFor(s, conn, now);
      if (token === "broken") throw new Fail(409, "The key to your Google Drive no longer works. Connect Google Drive again.");
      if (!(await logFolder(s, conn, token))) throw new Fail(409, "Your log was not found in your Google Drive. Let it sync, then share again.");
    }

    const existing = await s.db.first<ShareRow>("SELECT * FROM shares WHERE accountId = ? AND kind = ? AND subject = ?", [accountId, kind, subject]);
    if (existing) return json(200, shareJson(s, url, existing));
    const row: ShareRow = { id: newShareId(), accountId, kind, subject, anchor, createdAt: nowIso, timesOpened: 0, lastOpenedAt: null };
    await s.db.run("INSERT INTO shares (id, accountId, kind, subject, anchor, createdAt, timesOpened, lastOpenedAt) VALUES (?, ?, ?, ?, ?, ?, 0, NULL)", [row.id, accountId, kind, subject, anchor, nowIso]);
    return json(201, shareJson(s, url, row));
  }

  if (method === "DELETE" && path === "/api/shares") {
    const n = await s.db.run("DELETE FROM shares WHERE accountId = ?", [accountId]);
    return json(200, { stopped: n });
  }

  const one = path.match(/^\/api\/shares\/([A-Za-z0-9_-]{22})$/);
  if (one && method === "DELETE") {
    await s.db.run("DELETE FROM shares WHERE id = ? AND accountId = ?", [one[1]!, accountId]);
    return json(200, { ok: true });
  }

  throw new Fail(404, "Not found.");
}

// ---------- opening a link ----------

const NOT_FOUND = () => json(404, { error: "not-found" });
const NOT_AVAILABLE = () => json(503, { error: "not-available" }, { "Retry-After": "60" });

/** Requests to /p/ per address, per minute, in this instance of the server. */
const PER_MINUTE = 120;
const hits = new Map<string, { at: number; n: number }>();
function tooMany(request: Request, now: number): boolean {
  const ip = request.headers.get("CF-Connecting-IP") ?? request.headers.get("X-Forwarded-For")?.split(",")[0]?.trim() ?? "local";
  const h = hits.get(ip);
  if (!h || now - h.at > 60_000) {
    hits.set(ip, { at: now, n: 1 });
    if (hits.size > 10_000) hits.clear();
    return false;
  }
  return ++h.n > PER_MINUTE;
}

/**
 * Flights whose tracks one request may ask for. Cloudflare's free plan lets a request make 50 calls to Google Drive,
 * the database and the cache together. A tracks request makes at most 29 besides its downloads, with nothing kept yet
 * and the content read again, so 15 track files leave room.
 */
const TRACKS_AT_ONCE = 15;
/** Track files read from Google Drive at the same time, for one request. */
const READS_AT_ONCE = 6;

/** A table file written by a newer version of the app than this server: the link waits until the server is updated. */
class NewerLog extends Error {}

/**
 * The rows of a table file as this version reads them. The server never writes the log or upgrades it: a file from an
 * older version is brought up to date here, in memory, as the app does when it reads one, and a newer one is refused.
 */
function rowsOf(text: string, table: TableName): Record<string, unknown>[] {
  const file = JSON.parse(text) as TableFile;
  if (typeof file.schemaVersion === "number" && file.schemaVersion > SCHEMA_VERSION) throw new NewerLog();
  return upgradeTableFile(file, table).rows ?? [];
}

/** Run `work` on every item, `n` at a time. */
async function inTurn<T>(items: T[], n: number, work: (item: T) => Promise<void>) {
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (next < items.length) await work(items[next++]!);
  }));
}

/**
 * /p/<id>: the share page, /p/<id>/content: what the link shows, /p/<id>/tracks?flights=a,b: the recorded tracks of
 * those of its flights that have one, read at once. Without a session. A link that does not exist and one that was
 * stopped answer the same.
 */
export async function sharePage(request: Request, s: Server, url: URL, now: number, shareFiles: string): Promise<Response> {
  if (request.method !== "GET" && request.method !== "HEAD") return json(405, { error: "Not allowed." });
  if (tooMany(request, now)) return json(429, { error: "Too many requests. Wait a minute." }, { "Retry-After": "60" });
  const m = url.pathname.match(/^\/p\/([^/]+)(?:\/(content|tracks))?\/?$/);
  const id = m?.[1] && SHARE_ID.test(m[1]) ? m[1] : null;
  const share = id ? await s.db.first<ShareRow>("SELECT * FROM shares WHERE id = ?", [id]) : null;

  if (!m?.[2]) {
    // The page itself: the share page's own build, the same for every link, which then asks for the content.
    const page = await s.assets.fetch(new Request(new URL(`${shareFiles}share.html`, url), { headers: request.headers }));
    return new Response(page.body, { status: share ? 200 : 404, headers: page.headers });
  }
  if (!share) return NOT_FOUND();
  const flights = m[2] === "tracks" ? [...new Set((url.searchParams.get("flights") ?? "").split(",").filter(Boolean))] : [];
  if (m[2] === "tracks" && (!flights.length || flights.length > TRACKS_AT_ONCE || !flights.every((f) => RECORD_ID.test(f)))) return json(400, { error: `Ask for 1 to ${TRACKS_AT_ONCE} flights.` });

  const conn = await s.db.first<StorageRow>("SELECT * FROM storage_connections WHERE accountId = ?", [share.accountId]);
  if (!conn || conn.status === "broken" || !standardOn(s)) return NOT_AVAILABLE();
  const cache = s.cache ?? fallbackCache;
  try {
    const token = await accessFor(s, conn, now);
    if (token === "broken") return NOT_AVAILABLE();
    const place = await foldersOf(s, conn, token);
    if (!place) return NOT_AVAILABLE();
    const listed = new Map((await children(s, token, place.tables)).map((f) => [f.name, f] as const));
    const need = SHARE_TABLES[share.kind];
    const versions = need.map((t) => `${t}:${listed.get(`${t}.json`)?.version ?? "-"}`).join(",");
    const read = async (): Promise<ShareTables> => {
      const out: ShareTables = {};
      await Promise.all(
        need.map(async (t: TableName) => {
          const f = listed.get(`${t}.json`);
          if (f) out[t] = rowsOf(await download(s, token, f.id), t);
        }),
      );
      return out;
    };
    // The content, kept under the versions of the files it came from: the tracks' requests use it too.
    const key = `content|${share.id}|${share.kind}|${share.subject}|${share.anchor ?? ""}|${versions}`;
    let text = await cache.get(key);
    if (!text) {
      text = JSON.stringify(shareContent(share.kind, share.subject || null, (share.anchor as ShareAnchor | null) ?? null, await read()));
      await cache.put(key, text);
    }

    if (m[2] === "content") {
      // Counted when the content is asked for, so a chat app's preview of the page is not.
      await s.db.run("UPDATE shares SET timesOpened = timesOpened + 1, lastOpenedAt = ? WHERE id = ?", [toUtcIso(now), share.id]);
      return new Response(text, { status: 200, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" } });
    }

    // Only the tracks of flights the link shows; a flight outside it is left out, as one without a track is.
    const allowed = shareTracks(JSON.parse(text) as ShareContent);
    const wanted = flights.flatMap((f) => {
      const t = allowed.get(f);
      return t && RECORD_ID.test(t) ? [{ flightId: f, trackId: t }] : [];
    });
    let out = '{"tracks":{}}';
    if (wanted.length && place.tracks) {
      const names = wanted.map((w) => `name = '${w.trackId}.json'`).join(" or ");
      const files = new Map((await children(s, token, place.tracks, `(${names})`)).map((f) => [f.name, f] as const));
      const found = wanted.flatMap((w) => {
        const file = files.get(`${w.trackId}.json`);
        return file ? [{ ...w, file }] : [];
      });
      // The answer is kept whole, under the versions of its files: one call to the cache however many tracks it holds.
      const key = `tracks|${found.map((f) => `${f.flightId}:${f.file.id}:${f.file.version}`).join(",")}`;
      const kept = found.length ? await cache.get(key) : null;
      if (kept) out = kept;
      else if (found.length) {
        const tracks: Record<string, unknown[]> = {};
        await inTurn(found, READS_AT_ONCE, async (f) => {
          tracks[f.flightId] = rowsOf(await download(s, token, f.file.id), "track_points");
        });
        out = JSON.stringify({ tracks });
        await cache.put(key, out);
      }
    }
    return new Response(out, { status: 200, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" } });
  } catch (e) {
    // Google down, the folder gone or out of reach, or a log written by a newer version: the page says the link is
    // not available right now.
    if (e instanceof GoogleError || e instanceof DriveError || e instanceof NewerLog || e instanceof TypeError || e instanceof SyntaxError) return NOT_AVAILABLE();
    throw e;
  }
}

// ---------- Google Drive, read only ----------

const DRIVE = "https://www.googleapis.com/drive/v3/files";
const FOLDER = "application/vnd.google-apps.folder";

class DriveError extends Error {}

interface DriveFile {
  id: string;
  name: string;
  version: string;
  mimeType: string;
  createdTime?: string;
}

/** Short-lived access to the owner's Drive, kept in this instance's memory only, never stored. */
const tokens = new Map<string, { token: string; until: number }>();

async function accessFor(s: Server, conn: StorageRow, now: number): Promise<string | "broken"> {
  const kept = tokens.get(conn.id);
  if (kept && kept.until > now) return kept.token;
  const access = await googleAccess(s.config.google!, await storageKey(s, conn), s.fetch ?? ((i, init) => fetch(i, init)));
  if (access === "broken") {
    await s.db.run("UPDATE storage_connections SET status = 'broken', statusAt = ? WHERE id = ?", [toUtcIso(now), conn.id]);
    tokens.delete(conn.id);
    return "broken";
  }
  // A minute's margin, so a token is never used as it expires.
  tokens.set(conn.id, { token: access.accessToken, until: now + (access.expiresIn - 60) * 1000 });
  return access.accessToken;
}

/** The mark the app puts on the Touchdown folder, so it is found wherever the user moves it (storage drive.ts). */
const MARK = "appProperties has { key='touchdown' and value='log' }";

/**
 * The log's folder in the owner's Drive: the one the connection keeps, else found by its mark (the oldest, as the app
 * uses) and kept on the connection.
 */
async function logFolder(s: Server, conn: StorageRow, token: string): Promise<string | null> {
  if (conn.location) return conn.location;
  const [found] = await children(s, token, null, `${MARK} and mimeType = '${FOLDER}'`);
  if (!found) return null;
  await s.db.run("UPDATE storage_connections SET location = ? WHERE id = ?", [found.id, conn.id]);
  conn.location = found.id;
  return found.id;
}

/** The log's tables/ and tracks/ folders, by the connection; kept in memory. */
const folders = new Map<string, { location: string; tables: string; tracks: string }>();

async function foldersOf(s: Server, conn: StorageRow, token: string): Promise<{ tables: string; tracks: string } | null> {
  const location = await logFolder(s, conn, token);
  if (!location) return null;
  const kept = folders.get(conn.id);
  if (kept && kept.location === location) return kept;
  const subs = await children(s, token, location, `mimeType = '${FOLDER}'`);
  const tables = subs.find((f) => f.name === "tables")?.id;
  const tracks = subs.find((f) => f.name === "tracks")?.id ?? "";
  if (!tables) return null;
  const out = { location, tables, tracks };
  folders.set(conn.id, out);
  return out;
}

async function drive(s: Server, token: string, url: string): Promise<Response> {
  const res = await (s.fetch ?? fetch)(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new DriveError(`Google Drive answered ${res.status}.`);
  return res;
}

/** Every file in a folder (or, with no parent, anywhere), with its version, oldest first: one request for tables/. */
async function children(s: Server, token: string, parent: string | null, also?: string): Promise<DriveFile[]> {
  const out: DriveFile[] = [];
  let page = "";
  do {
    const q = [parent && `'${parent}' in parents`, "trashed = false", also].filter(Boolean).join(" and ");
    const params = new URLSearchParams({ q, fields: "nextPageToken,files(id,name,version,mimeType,createdTime)", pageSize: "1000", orderBy: "createdTime", spaces: "drive" });
    if (page) params.set("pageToken", page);
    const res = await drive(s, token, `${DRIVE}?${params}`);
    const b = (await res.json()) as { files?: DriveFile[]; nextPageToken?: string };
    out.push(...(b.files ?? []));
    page = b.nextPageToken ?? "";
  } while (page);
  return out.sort((a, b) => (a.createdTime ?? "").localeCompare(b.createdTime ?? ""));
}

async function download(s: Server, token: string, id: string): Promise<string> {
  return (await drive(s, token, `${DRIVE}/${encodeURIComponent(id)}?alt=media`)).text();
}
