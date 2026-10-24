// A folder on this computer as a file adapter (docs/12, "File adapters"), for a log the web app syncs through a
// folder. The folder may sit inside Dropbox, OneDrive or iCloud Drive; the CLI reads and writes it like any other.

import { mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import type { FileAdapter, FileInfo } from "@touchdown/storage";

const missing = (e: unknown) => (e as NodeJS.ErrnoException).code === "ENOENT" || (e as NodeJS.ErrnoException).code === "ENOTDIR";

export class NodeFolder implements FileAdapter {
  readonly root: string;

  constructor(root: string) {
    this.root = resolve(root);
  }

  /** The full path of a path below the folder; leaving the folder is refused. */
  private full(path: string): string {
    const full = resolve(this.root, path);
    const rel = relative(this.root, full);
    if (rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) throw new Error(`Not a path in the Touchdown folder: ${path}`);
    return full;
  }

  private static version(path: string): string {
    const s = statSync(path);
    return `${Math.round(s.mtimeMs)}-${s.size}`;
  }

  async list(dir: string): Promise<FileInfo[]> {
    const at = this.full(dir);
    try {
      return readdirSync(at, { withFileTypes: true })
        .filter((e) => e.isFile() && !e.name.startsWith("."))
        .map((e) => ({ name: e.name, version: NodeFolder.version(join(at, e.name)) }));
    } catch (e) {
      if (missing(e)) return [];
      throw e;
    }
  }

  async read(path: string) {
    const at = this.full(path);
    try {
      return { data: new Uint8Array(readFileSync(at)), version: NodeFolder.version(at) };
    } catch (e) {
      if (missing(e)) return null;
      throw e;
    }
  }

  /** Written to a hidden file first and renamed, so a reader never sees half a file. */
  async write(path: string, data: Uint8Array) {
    const at = this.full(path);
    mkdirSync(dirname(at), { recursive: true });
    const temp = join(dirname(at), `.${basename(at)}.${randomBytes(4).toString("hex")}.tmp`);
    writeFileSync(temp, data);
    renameSync(temp, at);
    return { version: NodeFolder.version(at) };
  }

  async remove(path: string) {
    rmSync(this.full(path), { force: true });
  }
}
