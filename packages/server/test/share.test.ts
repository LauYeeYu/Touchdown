// Share links on the server (docs/32-modes-and-sharing.md, "Sharing"): the owner makes and stops them; anyone with
// the address reads what the link shows, picked out of the owner's log in Google Drive when it is opened. The fake
// Drive here keeps a made-up log in the JSON tables layout and records every request, so the tests can check that a
// link never reads a file in private/.

import { describe, expect, it } from "vitest";
import { attachTrack, FILE_TABLES, RefIndex, saveFlight, saveSighting, Store, stringifyTableFile, tableFilePath, toTableFile } from "@touchdown/core";
import { loadRefTables } from "@touchdown/refdata";
import { handle, memoryCache, TERMS_VERSION, type Server } from "../src/index.ts";
import { sealToken } from "../src/crypto.ts";
import { sqliteFile } from "../src/node.ts";

const SITE = "https://touchdown.example";
const SETUP = "a-long-setup-secret-for-tests";
const KEY = Buffer.alloc(32, 7).toString("base64");
const keyOf = (password: string) => Buffer.from(password.padEnd(32, "#").slice(0, 32)).toString("base64url");
const FOLDER_MIME = "application/vnd.google-apps.folder";
// Made-up private values that no link may show.
const TICKET = "0009990000401/1";
const BOOKING = "ZZ4PNR";
const ref = new RefIndex(loadRefTables());

type Jar = { cookie: string | null };

async function call(s: Server, jar: Jar, method: string, path: string, body?: unknown, extra: Record<string, string> = {}) {
  const headers: Record<string, string> = { Accept: "application/json", ...extra };
  if (method !== "GET") headers.Origin = SITE;
  if (jar.cookie) headers.Cookie = jar.cookie;
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const res = await handle(new Request(SITE + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }), s);
  for (const set of res.headers.getSetCookie()) if (set.startsWith("td_session=")) jar.cookie = /Max-Age=0/.test(set) ? null : set.split(";")[0]!;
  const text = await res.text();
  let json: Record<string, unknown> = {};
  try {
    json = JSON.parse(text) as Record<string, unknown>;
  } catch {
    // not JSON
  }
  return { status: res.status, json, text, res };
}

/** A Google Drive holding one Touchdown folder, answering the few requests the server makes. */
function fakeDrive() {
  const files = new Map<string, { id: string; name: string; parent: string; mimeType: string; version: number; content: string }>();
  let next = 0;
  const add = (parent: string, name: string, content: string, mimeType = "application/json") => {
    // As long as Google's ids are.
    const id = `fakeDriveFile${String(++next).padStart(20, "0")}`;
    files.set(id, { id, name, parent, mimeType, version: 1, content });
    return id;
  };
  const root = add("root", "Touchdown", "", FOLDER_MIME);
  const folder = (name: string) => [...files.values()].find((f) => f.parent === root && f.name === name)?.id ?? add(root, name, "", FOLDER_MIME);
  /** Write a file at a path in the Touchdown folder, as a device's sync does: a new version each time. */
  const write = (path: string, content: string) => {
    const [dir, name] = path.includes("/") ? (path.split("/") as [string, string]) : ["", path];
    const parent = dir ? folder(dir) : root;
    const f = [...files.values()].find((x) => x.parent === parent && x.name === name);
    if (f) {
      f.content = content;
      f.version++;
    } else add(parent, name, content);
  };
  const pathOf = (id: string) => {
    const f = files.get(id)!;
    const p = files.get(f.parent);
    return p && p.id !== root ? `${p.name}/${f.name}` : f.name;
  };
  const downloads: string[] = [];
  const lists: string[] = [];
  const drive = { marked: true };
  const handler = async (url: URL): Promise<Response> => {
    if (url.pathname === "/drive/v3/files") {
      const q = url.searchParams.get("q")!;
      // The Touchdown folder, found by the mark the app puts on it.
      if (q.includes("appProperties has { key='touchdown' and value='log' }")) {
        lists.push("(mark)");
        return Response.json({ files: drive.marked ? [{ id: root, name: "Touchdown", version: "1", mimeType: FOLDER_MIME, createdTime: "2026-01-01T00:00:00Z" }] : [] });
      }
      const parent = /'([^']+)' in parents/.exec(q)![1]!;
      const name = /name = '([^']+)'/.exec(q)?.[1];
      const onlyFolders = q.includes(`mimeType = '${FOLDER_MIME}'`);
      lists.push(files.get(parent)?.name ?? parent);
      const found = [...files.values()].filter((f) => f.parent === parent && (!name || f.name === name) && (!onlyFolders || f.mimeType === FOLDER_MIME));
      return Response.json({ files: found.map((f) => ({ id: f.id, name: f.name, version: String(f.version), mimeType: f.mimeType })) });
    }
    const m = url.pathname.match(/^\/drive\/v3\/files\/([^/]+)$/);
    if (m && url.searchParams.get("alt") === "media") {
      const f = files.get(decodeURIComponent(m[1]!));
      if (!f) return new Response("not found", { status: 404 });
      downloads.push(pathOf(f.id));
      return new Response(f.content);
    }
    return new Response("not found", { status: 404 });
  };
  return { root, write, handler, downloads, lists, drive };
}

/** A made-up log written to the fake Drive as the JSON tables backend lays it out. */
function writeLog(drive: ReturnType<typeof fakeDrive>, store: Store) {
  drive.write("manifest.json", JSON.stringify({ schema: "touchdown", schemaVersion: 7, backend: "json_tables", tables: {}, lastWriter: "dev_test" }));
  for (const t of FILE_TABLES) drive.write(tableFilePath(t), stringifyTableFile(toTableFile(store, t)));
  const points = toTableFile(store, "track_points");
  const byTrack = new Map<string, Record<string, unknown>[]>();
  for (const r of points.rows) byTrack.set(String(r.trackId), [...(byTrack.get(String(r.trackId)) ?? []), r]);
  for (const [trackId, rows] of byTrack) drive.write(`tracks/${trackId}.json`, stringifyTableFile({ ...points, rows }));
}

async function site() {
  let t = Date.parse("2026-10-24T09:00:00Z");
  const drive = fakeDrive();
  const google = { broken: false, refreshed: 0 };
  const s: Server = {
    db: sqliteFile(":memory:"),
    config: { origins: [SITE], setupToken: SETUP, google: { clientId: "client", clientSecret: "secret" }, tokenKey: KEY },
    now: () => t,
    cache: memoryCache(),
    assets: { fetch: async (req) => new Response(`file ${new URL(req.url).pathname}`, { headers: { "Content-Type": "text/html" } }) },
    fetch: async (input, init) => {
      const url = new URL(String(input));
      if (url.host === "oauth2.googleapis.com") {
        google.refreshed++;
        return google.broken ? Response.json({ error: "invalid_grant" }, { status: 400 }) : Response.json({ access_token: "access-1", expires_in: 3599 });
      }
      if (url.host === "www.googleapis.com") {
        expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer access-1");
        return drive.handler(url);
      }
      return new Response("not found", { status: 404 });
    },
  };
  const owner: Jar = { cookie: null };
  expect((await call(s, owner, "POST", "/auth/setup", { setupToken: SETUP, name: "Owner", email: "owner@example.org", key: keyOf("owner password") })).status).toBe(200);
  const me = (await call(s, owner, "GET", "/auth/me")).json;
  // Standard mode connected, as Settings does through Google (tested in server.test.ts).
  const id = "conn-1";
  const sealed = await sealToken(KEY, JSON.stringify({ refresh_token: "refresh-1" }), `${id}|${me.id}`);
  await s.db.run(
    `INSERT INTO storage_connections (id, accountId, backend, format, location, externalAccount, scope, tokenCiphertext, tokenIv, tokenKeyId, tokenFormat, status, statusAt, createdAt, lastUsedAt)
     VALUES (?, ?, 'gdrive', 'json_tables', NULL, 'owner@gmail.example', 'drive.file', ?, ?, '1', 1, 'ok', ?, ?, NULL)`,
    [id, String(me.id), sealed.ciphertext, sealed.iv, "2026-10-24T09:00:00Z", "2026-10-24T09:00:00Z"],
  );
  await call(s, owner, "POST", "/api/storage/terms", { version: TERMS_VERSION });

  const store = new Store({ deviceId: "dev_test", now: () => t });
  const shared = saveFlight(store, ref, { scheduledDate: "2026-03-14", flightNumber: "XY401", fromRaw: "EGLL", toRaw: "KJFK", registrationRaw: "G-ZZSC", typeCode: "A359", seat: "12A", ticketNumber: TICKET, bookingRef: BOOKING }).row;
  const other = saveFlight(store, ref, { scheduledDate: "2026-04-02", flightNumber: "XY402", fromRaw: "KJFK", toRaw: "EGLL", registrationRaw: "G-ZZSC", typeCode: "A359" }).row;
  saveSighting(store, ref, { seenOn: "2026-05-01", airportRaw: "EGLL", registrationRaw: "G-ZZSC", typeCode: "A359" });
  const points = Array.from({ length: 5 }, (_, i) => ({ t: 1773500000 + i * 60, lat: 51.47 + i * 0.1, lon: -0.45 - i * 0.5, altitudeFt: 30000, groundSpeedKt: 450, headingDeg: 280 }));
  attachTrack(store, shared.id, points, { provider: "fr24_csv", attribution: "Track data: test", coverage: "partial" });
  attachTrack(store, other.id, points, { provider: "fr24_csv", attribution: "Track data: test", coverage: "partial" });
  writeLog(drive, store);
  return { s, owner, drive, google, store, shared, other, tick: (ms: number) => (t += ms) };
}

const make = (t: Awaited<ReturnType<typeof site>>, body: Record<string, unknown>) => call(t.s, t.owner, "POST", "/api/shares", body);
const open = (s: Server, path: string, ip = "203.0.113.7") => call(s, { cookie: null }, "GET", path, undefined, { "CF-Connecting-IP": ip });

describe("making share links", () => {
  it("needs Standard and the current terms, makes one link per thing, lists and stops them", async () => {
    const t = await site();
    await t.s.db.run("DELETE FROM consents");
    expect((await make(t, { kind: "flight", subject: t.shared.id })).json).toMatchObject({ terms: TERMS_VERSION });
    await call(t.s, t.owner, "POST", "/api/storage/terms", { version: TERMS_VERSION });

    expect((await make(t, { kind: "flight", subject: "../../etc" })).status).toBe(400);
    expect((await make(t, { kind: "boarding pass", subject: t.shared.id })).status).toBe(400);
    // No log in the Drive yet: no link.
    t.drive.drive.marked = false;
    expect((await make(t, { kind: "flight", subject: t.shared.id })).status).toBe(409);
    t.drive.drive.marked = true;
    const made = await make(t, { kind: "flight", subject: t.shared.id });
    expect(made.status).toBe(201);
    expect(String(made.json.url)).toMatch(new RegExp(`^${SITE}/p/[A-Za-z0-9_-]{22}$`));
    expect((await make(t, { kind: "flight", subject: t.shared.id })).json.id).toBe(made.json.id);
    const log = await make(t, { kind: "log" });
    expect((await make(t, { kind: "log" })).json.id).toBe(log.json.id);
    expect(((await call(t.s, t.owner, "GET", "/api/shares")).json.shares as unknown[]).length).toBe(2);
    expect((await call(t.s, { cookie: null }, "GET", "/api/shares")).status).toBe(401);

    expect((await call(t.s, t.owner, "DELETE", `/api/shares/${made.json.id}`)).status).toBe(200);
    expect((await open(t.s, `/p/${made.json.id}/content`)).status).toBe(404);
    expect((await call(t.s, t.owner, "DELETE", "/api/shares")).json).toMatchObject({ stopped: 1 });
    expect((await call(t.s, t.owner, "GET", "/api/shares")).json.shares).toEqual([]);
  });

  it("stops every link when the owner leaves Standard", async () => {
    const t = await site();
    const made = await make(t, { kind: "flight", subject: t.shared.id });
    await call(t.s, t.owner, "POST", "/api/storage/disconnect");
    expect((await open(t.s, `/p/${made.json.id}/content`)).status).toBe(404);
    expect(await t.s.db.first("SELECT id FROM shares")).toBeNull();
  });
});

describe("opening a share link", () => {
  it("serves the page, and the same not-found for a link that never existed", async () => {
    const t = await site();
    const made = await make(t, { kind: "flight", subject: t.shared.id });
    const page = await open(t.s, `/p/${made.json.id}`);
    expect(page.status).toBe(200);
    expect(page.text).toBe("file /share-files/share.html");
    expect(page.res.headers.get("Referrer-Policy")).toBe("no-referrer");
    expect(page.res.headers.get("X-Robots-Tag")).toContain("noindex");
    expect(page.res.headers.get("Cache-Control")).toContain("no-transform");
    // No analytics and no Google on a shared page.
    expect(page.res.headers.get("Content-Security-Policy")).not.toContain("cloudflareinsights");
    expect(page.res.headers.get("Content-Security-Policy")).not.toContain("google");
    const missing = await open(t.s, "/p/AAAAAAAAAAAAAAAAAAAAAA");
    expect(missing.status).toBe(404);
    expect(missing.text).toBe(page.text);
    expect((await open(t.s, "/p/AAAAAAAAAAAAAAAAAAAAAA/content")).json).toEqual({ error: "not-found" });
    expect((await open(t.s, "/share-files/assets/share-1.js")).status).toBe(200);
  });

  it("sends only what the link shows, never reads private/, and counts the opening", async () => {
    const t = await site();
    const made = await make(t, { kind: "flight", subject: t.shared.id });
    const r = await open(t.s, `/p/${made.json.id}/content`);
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ format: "touchdown-share", kind: "flight", subject: t.shared.id, gone: false });
    const tables = r.json.tables as Record<string, Record<string, unknown>[]>;
    expect(tables.flights).toEqual([expect.objectContaining({ flightNumber: "XY401", seat: "12A" })]);
    expect(r.text).not.toContain(TICKET);
    expect(r.text).not.toContain(BOOKING);
    expect(r.text).not.toContain("XY402");
    expect(t.drive.downloads.every((p) => p.startsWith("tables/"))).toBe(true);
    expect(t.drive.lists).not.toContain("private");
    expect((await call(t.s, t.owner, "GET", "/api/shares")).json.shares).toMatchObject([{ timesOpened: 1, lastOpenedAt: "2026-10-24T09:00:00Z" }]);
    // The page alone (a chat app's preview) is not counted.
    await open(t.s, `/p/${made.json.id}`);
    expect((await call(t.s, t.owner, "GET", "/api/shares")).json.shares).toMatchObject([{ timesOpened: 1 }]);
  });

  it("shows the log as it is now: cached until a file changes, then read again", async () => {
    const t = await site();
    const made = await make(t, { kind: "flight", subject: t.shared.id });
    await open(t.s, `/p/${made.json.id}/content`);
    const read = t.drive.downloads.length;
    await open(t.s, `/p/${made.json.id}/content`);
    expect(t.drive.downloads.length).toBe(read);

    // An edit reaches the storage, from any device.
    t.tick(60_000);
    saveFlight(t.store, ref, { ...t.store.get("flights", t.shared.id)!, seat: "30K" }, t.shared.id);
    writeLog(t.drive, t.store);
    const after = await open(t.s, `/p/${made.json.id}/content`);
    expect(t.drive.downloads.length).toBeGreaterThan(read);
    expect((after.json.tables as Record<string, Record<string, unknown>[]>).flights![0]).toMatchObject({ seat: "30K" });

    // Deleted: the link stays, and says so.
    t.store.remove("flights", t.shared.id);
    writeLog(t.drive, t.store);
    expect((await open(t.s, `/p/${made.json.id}/content`)).json).toMatchObject({ gone: true, tables: {} });
  });

  it("says a link is not available when the key no longer works, and works again once connected", async () => {
    const t = await site();
    const made = await make(t, { kind: "flight", subject: t.shared.id });
    await t.s.db.run("UPDATE storage_connections SET status = 'broken'");
    const r = await open(t.s, `/p/${made.json.id}/content`);
    expect(r.status).toBe(503);
    expect(r.json).toEqual({ error: "not-available" });
    await t.s.db.run("UPDATE storage_connections SET status = 'ok'");
    expect((await open(t.s, `/p/${made.json.id}/content`)).status).toBe(200);
  });

  it("gives a flight's track only for a flight the link shows", async () => {
    const t = await site();
    const flight = await make(t, { kind: "flight", subject: t.shared.id });
    const track = await open(t.s, `/p/${flight.json.id}/tracks/${t.shared.id}`);
    expect(track.status).toBe(200);
    expect((track.json.points as unknown[]).length).toBe(5);
    expect((await open(t.s, `/p/${flight.json.id}/tracks/${t.other.id}`)).status).toBe(404);
    const log = await make(t, { kind: "log" });
    expect((await open(t.s, `/p/${log.json.id}/tracks/${t.other.id}`)).status).toBe(200);
    expect(t.drive.downloads.every((p) => p.startsWith("tables/") || p.startsWith("tracks/"))).toBe(true);
  });

  it("limits how often one address may ask", async () => {
    const t = await site();
    const statuses: number[] = [];
    for (let i = 0; i < 125; i++) statuses.push((await open(t.s, "/p/AAAAAAAAAAAAAAAAAAAAAA", "198.51.100.9")).status);
    expect(statuses.slice(0, 120).every((x) => x === 404)).toBe(true);
    expect(statuses.at(-1)).toBe(429);
    expect((await open(t.s, "/p/AAAAAAAAAAAAAAAAAAAAAA", "198.51.100.10")).status).toBe(404);
  });
});
