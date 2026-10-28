// Google Drive as a file adapter (docs/12, "Google Drive details"): Drive API v3 over HTTPS with the `drive.file`
// scope, so Touchdown sees only the files it created. Plain `fetch`, so the browser and the CLI share it; getting a
// token is the app's part (Google's popup in the browser, `touchdown storage drive` in the CLI).
//
// Drive finds files by id, and a folder may hold two files with the same name. Paths are looked up by name, and
// when two devices create the same file at the same moment, the older one is used and the newer one removed.

import type { FileAdapter, FileInfo } from "./types.ts";

/** The user has to sign in to their storage again before sync can go on. */
export class SignInNeeded extends Error {
  constructor(message = "Sign in again to sync.") {
    super(message);
    this.name = "SignInNeeded";
  }
}

/** A request Google Drive answered with an error. */
export class DriveError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "DriveError";
  }
}

export interface DriveAuth {
  /** A current access token. Throws SignInNeeded when the user has to sign in again. */
  token(): Promise<string>;
  /** Drive refused this token (expired or revoked): it must not be returned again. */
  refused(token: string): void;
}

export interface DriveOptions {
  fetch?: typeof fetch;
  /** Waits between retries; tests make it instant. */
  wait?: (ms: number) => Promise<void>;
  now?: () => number;
  /** Requests sent at once; the rest wait their turn. */
  concurrency?: number;
}

const API = "https://www.googleapis.com/drive/v3";
const UPLOAD = "https://www.googleapis.com/upload/drive/v3";
const FOLDER = "application/vnd.google-apps.folder";
const FIELDS = "id,name,mimeType,md5Checksum,version,createdTime";
/** Marks the Touchdown folder, so it is found wherever the user moves it and whatever they rename it to. */
const MARK = { key: "touchdown", value: "log" };
/** Drive's simple and multipart uploads take up to 5 MB; larger files go up as resumable uploads. */
const SIMPLE_MAX = 5 * 1024 * 1024;
/** A folder listed this recently is trusted to say which files and folders are not there. */
const LISTING_MS = 30_000;
const RETRIES = 4;
/**
 * Drive states no limit on requests at once, only on quota units a minute (325,000 a user; a download costs 5). 64
 * downloads at once were answered without a rate limit, and a browser sends them over one HTTP/2 connection.
 */
const CONCURRENCY = 64;

interface DriveFile {
  id: string;
  name: string;
  mimeType?: string;
  md5Checksum?: string;
  version?: string;
  createdTime?: string;
}

const encoder = new TextEncoder();
const quote = (s: string) => `'${s.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
const versionOf = (f: DriveFile) => f.md5Checksum ?? f.version ?? "";
const typeOf = (path: string) => (path.endsWith(".json") ? "application/json" : "application/octet-stream");
/** Oldest first; the id breaks ties, so every device picks the same file. */
const oldestFirst = (a: DriveFile, b: DriveFile) => (a.createdTime ?? "").localeCompare(b.createdTime ?? "") || a.id.localeCompare(b.id);

function split(path: string): { dir: string; name: string } {
  const at = path.lastIndexOf("/");
  return at < 0 ? { dir: "", name: path } : { dir: path.slice(0, at), name: path.slice(at + 1) };
}

function multipart(meta: object, data: Uint8Array, type: string) {
  const boundary = `touchdown-${Math.random().toString(36).slice(2)}`;
  const head = encoder.encode(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n--${boundary}\r\nContent-Type: ${type}\r\n\r\n`);
  const tail = encoder.encode(`\r\n--${boundary}--`);
  const body = new Uint8Array(head.length + data.length + tail.length);
  body.set(head);
  body.set(data, head.length);
  body.set(tail, head.length + data.length);
  return { body, type: `multipart/related; boundary=${boundary}` };
}

/** At most `size` at once; the rest wait their turn, in order. */
class Slots {
  private free: number;
  private readonly waiting: (() => void)[] = [];

  constructor(size: number) {
    this.free = size;
  }

  async run<T>(fn: () => Promise<T>): Promise<T> {
    if (this.free > 0) this.free--;
    else await new Promise<void>((resolve) => this.waiting.push(resolve));
    try {
      return await fn();
    } finally {
      const next = this.waiting.shift();
      if (next) next();
      else this.free++;
    }
  }
}

export class GoogleDrive implements FileAdapter {
  private readonly fetch: typeof fetch;
  private readonly wait: (ms: number) => Promise<void>;
  private readonly now: () => number;
  private readonly slots: Slots;
  /** Folder ids by path below the Touchdown folder ("" is the Touchdown folder itself). */
  private readonly dirs = new Map<string, string>();
  /** Files by path, from the last listing or lookup. */
  private readonly known = new Map<string, DriveFile>();
  /** When each folder was last listed, its files and folders. */
  private readonly listed = new Map<string, number>();
  /** Lookups and listings under way, shared by everything that asks for the same one meanwhile. */
  private readonly lookups = new Map<string, Promise<string | null>>();
  private readonly scans = new Map<string, Promise<DriveFile[]>>();
  /** Counts this adapter's own writes and removals, and when each path last had one, so a listing begun before one does not undo it. */
  private changes = 0;
  private readonly changedAt = new Map<string, number>();
  private pendingToken: Promise<string> | null = null;

  constructor(
    private readonly auth: DriveAuth,
    options: DriveOptions = {},
  ) {
    this.fetch = options.fetch ?? ((input, init) => fetch(input, init));
    this.wait = options.wait ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.now = options.now ?? Date.now;
    this.slots = new Slots(options.concurrency ?? CONCURRENCY);
  }

  /** The signed-in account's email address. */
  async account(): Promise<string> {
    const about = (await this.json(`${API}/about?fields=user(emailAddress)`)) as { user?: { emailAddress?: string } };
    return about.user?.emailAddress ?? "";
  }

  async list(dir: string): Promise<FileInfo[]> {
    return (await this.scan(dir)).map((f) => ({ name: f.name, version: versionOf(f) }));
  }

  async read(path: string) {
    for (let attempt = 0; attempt < 2; attempt++) {
      const f = await this.find(path);
      if (!f) return null;
      const data = await this.call(`${API}/files/${f.id}?alt=media`, {}, async (res) => {
        if (res.status === 404) return null;
        await this.check(res);
        return new Uint8Array(await res.arrayBuffer());
      });
      if (data) return { data, version: versionOf(f) };
      this.forget(path);
    }
    return null;
  }

  async write(path: string, data: Uint8Array) {
    const f = await this.find(path);
    this.touch(path);
    if (f) {
      const updated = await this.upload(f.id, data, typeOf(path));
      if (updated) {
        this.known.set(path, updated);
        return { version: versionOf(updated) };
      }
      this.forget(path);
    }
    const { dir, name } = split(path);
    const parent = (await this.dir(dir, true))!;
    const created = await this.create(parent, name, data, typeOf(path));
    // Another device may have created the same file just now: the older one is used by everyone.
    const [first] = await this.children(parent, `name = ${quote(name)} and mimeType != ${quote(FOLDER)}`);
    let kept = created;
    if (first && first.id !== created.id) {
      kept = (await this.upload(first.id, data, typeOf(path))) ?? created;
      if (kept !== created) await this.delete(created.id);
    }
    this.known.set(path, kept);
    return { version: versionOf(kept) };
  }

  async remove(path: string) {
    const { dir, name } = split(path);
    this.forget(path);
    this.touch(path);
    const parent = await this.dir(dir, false);
    if (!parent) return;
    for (const f of await this.children(parent, `name = ${quote(name)} and mimeType != ${quote(FOLDER)}`)) await this.delete(f.id);
  }

  // ---------- paths ----------

  private forget(path: string) {
    this.known.delete(path);
    this.listed.delete(split(path).dir);
  }

  private touch(path: string) {
    this.changedAt.set(path, ++this.changes);
  }

  private fresh(dir: string) {
    const at = this.listed.get(dir);
    return at !== undefined && this.now() - at < LISTING_MS;
  }

  /** The file at a path, or null. A folder listed moments ago answers without asking Drive. */
  private async find(path: string): Promise<DriveFile | null> {
    const hit = this.known.get(path);
    if (hit) return hit;
    const { dir, name } = split(path);
    if (this.fresh(dir)) return null;
    // The Touchdown folder holds few files: one request finds them all, and its folders.
    if (!dir) {
      await this.scan("");
      return this.known.get(path) ?? null;
    }
    const parent = await this.dir(dir, false);
    if (!parent) return null;
    const [f] = await this.children(parent, `name = ${quote(name)} and mimeType != ${quote(FOLDER)}`);
    if (f) this.known.set(path, f);
    return f ?? null;
  }

  /** Every file and folder in a folder, in one request: the files answer `find`, the folders' ids are kept. Returns the files, the oldest of each name. */
  private scan(dir: string): Promise<DriveFile[]> {
    let p = this.scans.get(dir);
    if (!p) {
      p = this.listAll(dir).finally(() => this.scans.delete(dir));
      this.scans.set(dir, p);
    }
    return p;
  }

  private async listAll(dir: string): Promise<DriveFile[]> {
    const since = this.changes;
    const parent = await this.dir(dir, false);
    if (!parent) {
      this.listed.set(dir, this.now());
      return [];
    }
    const all = await this.children(parent);
    const prefix = dir ? `${dir}/` : "";
    // A file this adapter wrote or removed while the listing was on its way is known better here than in it.
    const mine = (path: string) => (this.changedAt.get(path) ?? 0) > since;
    for (const path of [...this.known.keys()]) if (split(path).dir === dir && !mine(path)) this.known.delete(path);
    const files: DriveFile[] = [];
    for (const f of all) {
      const path = prefix + f.name;
      if (f.mimeType === FOLDER) {
        if (!this.dirs.has(path)) this.dirs.set(path, f.id);
        continue;
      }
      if (files.some((x) => x.name === f.name)) continue;
      files.push(f);
      if (!mine(path)) this.known.set(path, f);
    }
    this.listed.set(dir, this.now());
    return files;
  }

  /** The id of a folder: "" is the Touchdown folder, others are below it. With `create`, made when missing. */
  private dir(path: string, create: boolean): Promise<string | null> {
    const cached = this.dirs.get(path);
    if (cached) return Promise.resolve(cached);
    const key = `${create ? "+" : "-"}${path}`;
    let p = this.lookups.get(key);
    if (!p) {
      p = this.lookUp(path, create).finally(() => this.lookups.delete(key));
      this.lookups.set(key, p);
    }
    return p;
  }

  private async lookUp(path: string, create: boolean): Promise<string | null> {
    let parent: string | null = null;
    let match: string;
    let meta: { name: string; parents?: string[]; appProperties?: Record<string, string> };
    if (path) {
      const { dir, name } = split(path);
      parent = await this.dir(dir, create);
      if (!parent) return null;
      // Its parent's files and folders are listed in one request, so the log's other folders are known too. A folder
      // not known yet may have been made since the last listing.
      await this.scan(dir);
      const found = this.dirs.get(path);
      if (found || !create) return found ?? null;
      match = `name = ${quote(name)} and mimeType = ${quote(FOLDER)}`;
      meta = { name, parents: [parent] };
    } else {
      // Made in My Drive the first time, and found by its mark wherever the user moves it.
      match = `appProperties has { key=${quote(MARK.key)} and value=${quote(MARK.value)} } and mimeType = ${quote(FOLDER)}`;
      meta = { name: "Touchdown", appProperties: { [MARK.key]: MARK.value } };
      const [f] = await this.children(null, match);
      if (f || !create) {
        if (f) this.dirs.set(path, f.id);
        return f?.id ?? null;
      }
    }
    const made = await this.makeFolder(meta);
    // Another device may have made it just now: the older one is used by everyone.
    const [f] = await this.children(parent, match);
    if (f && f.id !== made.id) await this.delete(made.id);
    const id = f?.id ?? made.id;
    this.dirs.set(path, id);
    return id;
  }

  // ---------- Drive requests ----------

  /** Files and folders matching a query, oldest first; in one folder unless `parent` is null. */
  private async children(parent: string | null, match?: string): Promise<DriveFile[]> {
    const q = [parent && `${quote(parent)} in parents`, "trashed = false", match].filter(Boolean).join(" and ");
    const out: DriveFile[] = [];
    let page: string | undefined;
    do {
      const params = new URLSearchParams({ q, fields: `nextPageToken,files(${FIELDS})`, pageSize: "1000", orderBy: "createdTime", spaces: "drive" });
      if (page) params.set("pageToken", page);
      const res = (await this.json(`${API}/files?${params}`)) as { files?: DriveFile[]; nextPageToken?: string };
      out.push(...(res.files ?? []));
      page = res.nextPageToken;
    } while (page);
    return out.sort(oldestFirst);
  }

  private async makeFolder(meta: { name: string; parents?: string[]; appProperties?: Record<string, string> }): Promise<DriveFile> {
    return (await this.json(`${API}/files?fields=${FIELDS}`, {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=UTF-8" },
      body: JSON.stringify({ ...meta, mimeType: FOLDER }),
    })) as DriveFile;
  }

  private async create(parent: string, name: string, data: Uint8Array, type: string): Promise<DriveFile> {
    const meta = { name, parents: [parent], mimeType: type };
    if (data.length > SIMPLE_MAX) return this.resumable("POST", `${UPLOAD}/files?uploadType=resumable&fields=${FIELDS}`, meta, data, type);
    const { body, type: contentType } = multipart(meta, data, type);
    return (await this.json(`${UPLOAD}/files?uploadType=multipart&fields=${FIELDS}`, { method: "POST", headers: { "Content-Type": contentType }, body: body as BufferSource })) as DriveFile;
  }

  /** Replace a file's content; null when the file is gone. */
  private async upload(id: string, data: Uint8Array, type: string): Promise<DriveFile | null> {
    try {
      if (data.length > SIMPLE_MAX) return await this.resumable("PATCH", `${UPLOAD}/files/${id}?uploadType=resumable&fields=${FIELDS}`, {}, data, type);
      return (await this.json(`${UPLOAD}/files/${id}?uploadType=media&fields=${FIELDS}`, { method: "PATCH", headers: { "Content-Type": type }, body: data as BufferSource })) as DriveFile;
    } catch (e) {
      if (e instanceof DriveError && e.status === 404) return null;
      throw e;
    }
  }

  private async resumable(method: "POST" | "PATCH", url: string, meta: object, data: Uint8Array, type: string): Promise<DriveFile> {
    const init = {
      method,
      headers: { "Content-Type": "application/json; charset=UTF-8", "X-Upload-Content-Type": type, "X-Upload-Content-Length": String(data.length) },
      body: JSON.stringify(meta),
    };
    const session = await this.call(url, init, async (res) => {
      await this.check(res);
      return res.headers.get("Location");
    });
    if (!session) throw new Error("Google Drive did not start the upload.");
    return (await this.json(session, { method: "PUT", headers: { "Content-Type": type }, body: data as BufferSource })) as DriveFile;
  }

  private async delete(id: string) {
    await this.call(`${API}/files/${id}`, { method: "DELETE" }, async (res) => {
      if (res.status !== 404) await this.check(res);
    });
  }

  private json(url: string, init: RequestInit = {}): Promise<unknown> {
    return this.call(url, init, async (res) => {
      await this.check(res);
      return res.json();
    });
  }

  private async check(res: Response) {
    if (res.ok) return;
    let message = res.statusText;
    let reason = "";
    try {
      const body = (await res.json()) as { error?: { message?: string; errors?: { reason?: string }[] } };
      message = body.error?.message ?? message;
      reason = body.error?.errors?.[0]?.reason ?? "";
    } catch {
      // Not JSON: keep the status text.
    }
    if (res.status === 403 && (reason === "insufficientPermissions" || reason === "insufficientFilePermissions")) {
      throw new SignInNeeded("Touchdown needs permission to use its files in Google Drive. Sign in again and allow it.");
    }
    throw new DriveError(res.status, `Google Drive: ${message}`);
  }

  /** A current token. Requests sent at once wait for one answer, so the app asks for one token, not one each. */
  private token(): Promise<string> {
    this.pendingToken ??= this.auth.token().finally(() => (this.pendingToken = null));
    return this.pendingToken;
  }

  /**
   * One request with the current token, when a slot is free; `take` reads the answer before the slot is given up. A
   * refused token is dropped once, and rate limits and server errors are retried, waiting outside the slot.
   */
  private async call<T>(url: string, init: RequestInit, take: (res: Response) => Promise<T>): Promise<T> {
    let renewed = false;
    for (let attempt = 0; ; attempt++) {
      const token = await this.token();
      const step = await this.slots.run(async (): Promise<{ value: T } | { again: "token" | "wait" }> => {
        const res = await this.fetch(url, { ...init, headers: { ...(init.headers as Record<string, string>), Authorization: `Bearer ${token}` } });
        if (res.status === 401) return { again: "token" };
        if (attempt < RETRIES && (await GoogleDrive.retryable(res))) return { again: "wait" };
        return { value: await take(res) };
      });
      if ("value" in step) return step.value;
      if (step.again === "wait") {
        await this.wait(1000 * 2 ** attempt);
        continue;
      }
      this.auth.refused(token);
      if (renewed) throw new SignInNeeded();
      renewed = true;
    }
  }

  private static async retryable(res: Response): Promise<boolean> {
    if (res.status === 429 || res.status >= 500) return true;
    if (res.status !== 403) return false;
    try {
      const body = (await res.clone().json()) as { error?: { errors?: { reason?: string }[] } };
      const reason = body.error?.errors?.[0]?.reason;
      return reason === "userRateLimitExceeded" || reason === "rateLimitExceeded";
    } catch {
      return false;
    }
  }
}
