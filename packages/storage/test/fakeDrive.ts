// Google Drive in memory: answers the Drive API v3 requests GoogleDrive makes, closely enough to test it. Not a
// general fake; queries are understood only in the forms GoogleDrive writes.

import { createHash } from "node:crypto";

const FOLDER = "application/vnd.google-apps.folder";

interface FakeFile {
  id: string;
  name: string;
  parents: string[];
  mimeType: string;
  data: Uint8Array;
  md5: string;
  version: number;
  createdTime: string;
  appProperties: Record<string, string>;
  trashed: boolean;
}

const md5 = (data: Uint8Array) => createHash("md5").update(data).digest("hex");
const unquote = (s: string) => s.replace(/\\(.)/g, "$1");
const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });
const error = (status: number, reason: string, message = reason) => json({ error: { code: status, message, errors: [{ reason, message }] } }, status);

function bytes(body: unknown): Uint8Array {
  if (body == null) return new Uint8Array();
  if (typeof body === "string") return new TextEncoder().encode(body);
  if (body instanceof Uint8Array) return body.slice();
  throw new Error("Unexpected body");
}

export class FakeDrive {
  readonly files = new Map<string, FakeFile>();
  /** Tokens Drive accepts. */
  readonly tokens = new Set(["good"]);
  /** Statuses (or a status and a reason) to answer the next requests with instead of handling them. */
  failures: (number | [number, string])[] = [];
  /** Every request, as "METHOD path?query". */
  readonly log: string[] = [];
  /** Awaited before every request. Tests set it to interleave devices. */
  pause: () => Promise<void> = async () => {};
  readonly account = "pilot@example.com";
  private ids = 0;
  private clock = Date.parse("2026-01-01T00:00:00Z");
  private sessions = new Map<string, { id: string | null; meta: Partial<FakeFile> }>();

  fetch = async (input: string | URL | Request, init: RequestInit = {}): Promise<Response> => {
    await this.pause();
    const url = new URL(String(input));
    const method = init.method ?? "GET";
    this.log.push(`${method} ${url.pathname}${url.search}`);
    const auth = new Headers(init.headers).get("Authorization") ?? "";
    if (!this.tokens.has(auth.replace(/^Bearer /, ""))) return error(401, "authError", "Invalid Credentials");
    const failure = this.failures.shift();
    if (failure !== undefined) {
      const [status, reason] = typeof failure === "number" ? [failure, "backendError"] : failure;
      return error(status, reason);
    }
    return this.handle(method, url, init);
  };

  private handle(method: string, url: URL, init: RequestInit): Response {
    const path = url.pathname;
    const fileId = path.match(/\/files\/([^/]+)$/)?.[1];
    if (url.host === "upload.fake") return this.finishUpload(path, bytes(init.body));
    if (method === "GET" && path === "/drive/v3/about") return json({ user: { emailAddress: this.account } });
    if (method === "GET" && path === "/drive/v3/files") return this.list(url.searchParams.get("q") ?? "");
    if (method === "GET" && fileId) {
      const f = this.live(fileId);
      return f ? new Response(f.data.slice(), { status: 200 }) : error(404, "notFound");
    }
    if (method === "POST" && path === "/drive/v3/files") {
      const meta = JSON.parse(String(init.body)) as Partial<FakeFile>;
      return json(this.out(this.add(meta, new Uint8Array())));
    }
    if (method === "DELETE" && fileId) {
      if (!this.live(fileId)) return error(404, "notFound");
      this.files.delete(fileId);
      return new Response(null, { status: 204 });
    }
    const type = url.searchParams.get("uploadType");
    if (type === "resumable") {
      const session = `s${this.sessions.size + 1}`;
      if (fileId && !this.live(fileId)) return error(404, "notFound");
      this.sessions.set(session, { id: fileId ?? null, meta: JSON.parse(String(init.body)) as Partial<FakeFile> });
      return new Response(null, { status: 200, headers: { Location: `https://upload.fake/${session}` } });
    }
    if (method === "POST" && type === "multipart") {
      const { meta, data } = this.parseMultipart(new Headers(init.headers).get("Content-Type") ?? "", bytes(init.body));
      return json(this.out(this.add(meta, data)));
    }
    if (method === "PATCH" && type === "media" && fileId) {
      const f = this.live(fileId);
      if (!f) return error(404, "notFound");
      this.setData(f, bytes(init.body));
      return json(this.out(f));
    }
    return error(400, "badRequest", `Not handled: ${method} ${path}`);
  }

  private finishUpload(path: string, data: Uint8Array) {
    const session = this.sessions.get(path.slice(1));
    if (!session) return error(404, "notFound");
    if (!session.id) return json(this.out(this.add(session.meta, data)));
    const f = this.live(session.id);
    if (!f) return error(404, "notFound");
    this.setData(f, data);
    return json(this.out(f));
  }

  private list(q: string) {
    const parent = q.match(/^'([^']+)' in parents/)?.[1];
    const name = q.match(/name = '((?:[^'\\]|\\.)*)'/)?.[1];
    const type = q.match(/mimeType (!=|=) '([^']+)'/);
    const mark = q.match(/appProperties has \{ key='([^']+)' and value='([^']+)' \}/);
    const files = [...this.files.values()]
      .filter((f) => !f.trashed)
      .filter((f) => !parent || f.parents.includes(parent))
      .filter((f) => name === undefined || f.name === unquote(name))
      .filter((f) => !type || (type[1] === "=" ? f.mimeType === type[2] : f.mimeType !== type[2]))
      .filter((f) => !mark || f.appProperties[mark[1]!] === mark[2])
      .sort((a, b) => a.createdTime.localeCompare(b.createdTime));
    return json({ files: files.map((f) => this.out(f)) });
  }

  private parseMultipart(contentType: string, body: Uint8Array) {
    const boundary = contentType.match(/boundary=(.+)$/)?.[1];
    if (!boundary) throw new Error("No boundary");
    const text = Buffer.from(body).toString("latin1");
    const parts = text.split(`--${boundary}`).slice(1, -1);
    const content = (part: string) => part.slice(part.indexOf("\r\n\r\n") + 4, part.length - 2);
    return { meta: JSON.parse(content(parts[0]!)) as Partial<FakeFile>, data: new Uint8Array(Buffer.from(content(parts[1]!), "latin1")) };
  }

  private add(meta: Partial<FakeFile>, data: Uint8Array): FakeFile {
    const f: FakeFile = {
      id: `f${++this.ids}`,
      name: meta.name ?? "Untitled",
      parents: meta.parents ?? ["root"],
      mimeType: meta.mimeType ?? "application/octet-stream",
      data,
      md5: md5(data),
      version: 1,
      createdTime: new Date(++this.clock).toISOString(),
      appProperties: meta.appProperties ?? {},
      trashed: false,
    };
    this.files.set(f.id, f);
    return f;
  }

  private setData(f: FakeFile, data: Uint8Array) {
    f.data = data;
    f.md5 = md5(data);
    f.version++;
  }

  private live(id: string) {
    const f = this.files.get(id);
    return f && !f.trashed ? f : undefined;
  }

  private out(f: FakeFile) {
    return { id: f.id, name: f.name, md5Checksum: f.mimeType === FOLDER ? undefined : f.md5, version: String(f.version), createdTime: f.createdTime };
  }

  // ---------- for tests ----------

  /** The Touchdown folder, or undefined. */
  root(): FakeFile | undefined {
    return [...this.files.values()].filter((f) => !f.trashed && f.appProperties.touchdown === "log").sort((a, b) => a.createdTime.localeCompare(b.createdTime))[0];
  }

  /** Every live file at a path below the Touchdown folder, oldest first. */
  at(path: string): FakeFile[] {
    let parents = [this.root()?.id ?? ""];
    const parts = path.split("/");
    for (const [i, part] of parts.entries()) {
      const found = [...this.files.values()]
        .filter((f) => !f.trashed && f.name === part && f.parents.some((p) => parents.includes(p)) && (i < parts.length - 1) === (f.mimeType === FOLDER))
        .sort((a, b) => a.createdTime.localeCompare(b.createdTime));
      if (i === parts.length - 1) return found;
      parents = found.map((f) => f.id);
    }
    return [];
  }

  current(path: string): Uint8Array | undefined {
    return this.at(path)[0]?.data;
  }

  /** Replace a file's content behind every device's back. */
  overwrite(path: string, data: Uint8Array) {
    const f = this.at(path)[0];
    if (!f) throw new Error(`No file at ${path}`);
    this.setData(f, data);
  }
}
