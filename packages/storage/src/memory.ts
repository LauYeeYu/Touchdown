// A folder held in memory: for tests, and for trying sync without an account.

import type { FileAdapter, FileInfo } from "./types.ts";

export class MemoryFolder implements FileAdapter {
  readonly files = new Map<string, { data: Uint8Array; version: string }>();
  private counter = 0;
  /** Awaited before every operation. Tests set it to interleave devices. */
  pause: () => Promise<void> = async () => {};

  async list(dir: string): Promise<FileInfo[]> {
    await this.pause();
    const prefix = dir ? `${dir}/` : "";
    const out: FileInfo[] = [];
    for (const [path, f] of this.files) {
      const name = path.slice(prefix.length);
      if (path.startsWith(prefix) && !name.includes("/")) out.push({ name, version: f.version });
    }
    return out;
  }

  async read(path: string) {
    await this.pause();
    const f = this.files.get(path);
    return f ? { data: f.data.slice(), version: f.version } : null;
  }

  async write(path: string, data: Uint8Array) {
    await this.pause();
    const version = `v${++this.counter}`;
    this.files.set(path, { data: data.slice(), version });
    return { version };
  }

  async remove(path: string) {
    await this.pause();
    this.files.delete(path);
  }
}
