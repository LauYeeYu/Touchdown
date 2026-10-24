// Google Drive as a file adapter (docs/12, "Google Drive details"): Drive API v3 over HTTPS with the `drive.file`
// scope, so Touchdown sees only the files it created. Plain `fetch`, so the browser and the CLI share it; getting a
// token is the app's part (Google's popup in the browser, `touchdown login` in the CLI).
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
}

const API = "https://www.googleapis.com/drive/v3";
const UPLOAD = "https://www.googleapis.com/upload/drive/v3";
const FOLDER = "application/vnd.google-apps.folder";
const FIELDS = "id,name,md5Checksum,version,createdTime";
/** Marks the Touchdown folder, so it is found wherever the user moves it and whatever they rename it to. */
const MARK = { key: "touchdown", value: "log" };
/** Drive's simple and multipart uploads take up to 5 MB; larger files go up as resumable uploads. */
const SIMPLE_MAX = 5 * 1024 * 1024;
/** A folder listed this recently is trusted to say which files are not there. */
const LISTING_MS = 30_000;
const RETRIES = 4;

interface DriveFile {
  id: string;
  name: string;
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

export class GoogleDrive implements FileAdapter {
  private readonly fetch: typeof fetch;
  private readonly wait: (ms: number) => Promise<void>;
  private readonly now: () => number;
  /** Folder ids by path below the Touchdown folder ("" is the Touchdown folder itself). */
  private readonly dirs = new Map<string, string>();
  /** Files by path, from the last listing or lookup. */
  private readonly known = new Map<string, DriveFile>();
  /** When each folder was last listed. */
  private readonly listed = new Map<string, number>();

  constructor(
    private readonly auth: DriveAuth,
    options: DriveOptions = {},
  ) {
    this.fetch = options.fetch ?? ((input, init) => fetch(input, init));
    this.wait = options.wait ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.now = options.now ?? Date.now;
  }

  /** The signed-in account's email address. */
  async account(): Promise<string> {
    const about = (await this.json(`${API}/about?fields=user(emailAddress)`)) as { user?: { emailAddress?: string } };
    return about.user?.emailAddress ?? "";
  }

  async list(dir: string): Promise<FileInfo[]> {
    const parent = await this.dir(dir, false);
    if (!parent) {
      this.listed.set(dir, this.now());
      return [];
    }
    const files = await this.children(parent, `mimeType != ${quote(FOLDER)}`);
    const prefix = dir ? `${dir}/` : "";
    for (const path of [...this.known.keys()]) if (split(path).dir === dir) this.known.delete(path);
    const out: FileInfo[] = [];
    for (const f of files) {
      const path = prefix + f.name;
      if (this.known.has(path)) continue;
      this.known.set(path, f);
      out.push({ name: f.name, version: versionOf(f) });
    }
    this.listed.set(dir, this.now());
    return out;
  }

  async read(path: string) {
    for (let attempt = 0; attempt < 2; attempt++) {
      const f = await this.find(path);
      if (!f) return null;
      const res = await this.call(`${API}/files/${f.id}?alt=media`);
      if (res.status === 404) {
        this.forget(path);
        continue;
      }
      await this.check(res);
      return { data: new Uint8Array(await res.arrayBuffer()), version: versionOf(f) };
    }
    return null;
  }

  async write(path: string, data: Uint8Array) {
    const f = await this.find(path);
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
    const parent = await this.dir(dir, false);
    if (!parent) return;
    for (const f of await this.children(parent, `name = ${quote(name)} and mimeType != ${quote(FOLDER)}`)) await this.delete(f.id);
  }

  // ---------- paths ----------

  private forget(path: string) {
    this.known.delete(path);
    this.listed.delete(split(path).dir);
  }

  /** The file at a path, or null. A folder listed moments ago answers without asking Drive. */
  private async find(path: string): Promise<DriveFile | null> {
    const hit = this.known.get(path);
    if (hit) return hit;
    const { dir, name } = split(path);
    const at = this.listed.get(dir);
    if (at !== undefined && this.now() - at < LISTING_MS) return null;
    const parent = await this.dir(dir, false);
    if (!parent) return null;
    const [f] = await this.children(parent, `name = ${quote(name)} and mimeType != ${quote(FOLDER)}`);
    if (f) this.known.set(path, f);
    return f ?? null;
  }

  /** The id of a folder: "" is the Touchdown folder, others are below it. With `create`, made when missing. */
  private async dir(path: string, create: boolean): Promise<string | null> {
    const cached = this.dirs.get(path);
    if (cached) return cached;
    let parent: string | null = null;
    let match: string;
    let meta: { name: string; parents?: string[]; appProperties?: Record<string, string> };
    if (path) {
      const { dir, name } = split(path);
      parent = await this.dir(dir, create);
      if (!parent) return null;
      match = `name = ${quote(name)} and mimeType = ${quote(FOLDER)}`;
      meta = { name, parents: [parent] };
    } else {
      // Made in My Drive the first time, and found by its mark wherever the user moves it.
      match = `appProperties has { key=${quote(MARK.key)} and value=${quote(MARK.value)} } and mimeType = ${quote(FOLDER)}`;
      meta = { name: "Touchdown", appProperties: { [MARK.key]: MARK.value } };
    }
    let [f] = await this.children(parent, match);
    if (!f && create) {
      const made = await this.makeFolder(meta);
      // Another device may have made it just now: the older one is used by everyone.
      [f] = await this.children(parent, match);
      if (f && f.id !== made.id) await this.delete(made.id);
      f ??= made;
    }
    if (f) this.dirs.set(path, f.id);
    return f?.id ?? null;
  }

  // ---------- Drive requests ----------

  /** Files matching a query, oldest first; in one folder unless `parent` is null. */
  private async children(parent: string | null, match: string): Promise<DriveFile[]> {
    const q = `${parent ? `${quote(parent)} in parents and ` : ""}trashed = false and ${match}`;
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
    const start = await this.call(url, {
      method,
      headers: { "Content-Type": "application/json; charset=UTF-8", "X-Upload-Content-Type": type, "X-Upload-Content-Length": String(data.length) },
      body: JSON.stringify(meta),
    });
    await this.check(start);
    const session = start.headers.get("Location");
    if (!session) throw new Error("Google Drive did not start the upload.");
    return (await this.json(session, { method: "PUT", headers: { "Content-Type": type }, body: data as BufferSource })) as DriveFile;
  }

  private async delete(id: string) {
    const res = await this.call(`${API}/files/${id}`, { method: "DELETE" });
    if (res.status !== 404) await this.check(res);
  }

  private async json(url: string, init: RequestInit = {}): Promise<unknown> {
    const res = await this.call(url, init);
    await this.check(res);
    return res.json();
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

  /** One request with the current token: a refused token is dropped once, and rate limits and server errors are retried. */
  private async call(url: string, init: RequestInit = {}): Promise<Response> {
    let renewed = false;
    for (let attempt = 0; ; attempt++) {
      const token = await this.auth.token();
      const res = await this.fetch(url, { ...init, headers: { ...(init.headers as Record<string, string>), Authorization: `Bearer ${token}` } });
      if (res.status === 401) {
        this.auth.refused(token);
        if (renewed) throw new SignInNeeded();
        renewed = true;
        continue;
      }
      if (attempt < RETRIES && (await GoogleDrive.retryable(res))) {
        await this.wait(1000 * 2 ** attempt);
        continue;
      }
      return res;
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
