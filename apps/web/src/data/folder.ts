// A folder on this computer through the browser's File System Access API (Chrome and Edge on a computer): the
// local-folder adapter (docs/12, "File adapters"). The folder may sit inside Dropbox, OneDrive, iCloud Drive or
// Google Drive for desktop, which then carry it to the user's other computers.

import type { FileAdapter, FileInfo } from "@touchdown/storage";

// Parts of the API that TypeScript's DOM library does not describe yet.
type Access = { mode: "readwrite" };
type Folder = FileSystemDirectoryHandle & {
  queryPermission?(d: Access): Promise<PermissionState>;
  requestPermission?(d: Access): Promise<PermissionState>;
  entries(): AsyncIterableIterator<[string, FileSystemHandle]>;
};
declare global {
  interface Window {
    showDirectoryPicker?(options?: { id?: string; mode?: "read" | "readwrite" }): Promise<FileSystemDirectoryHandle>;
  }
}

const READ_WRITE: Access = { mode: "readwrite" };

/** Whether this browser can sync through a folder. */
export const canUseFolders = () => typeof window.showDirectoryPicker === "function";

const missing = (e: unknown) => e instanceof DOMException && (e.name === "NotFoundError" || e.name === "TypeMismatchError");

async function has(dir: FileSystemDirectoryHandle, name: string, kind: "file" | "directory") {
  try {
    if (kind === "file") await dir.getFileHandle(name);
    else await dir.getDirectoryHandle(name);
    return true;
  } catch (e) {
    if (missing(e)) return false;
    throw e;
  }
}

/**
 * Ask the user for a folder. A Touchdown folder is used as it is; any other folder gets (or already has) a
 * "Touchdown" folder inside it. Null when the user closes the picker.
 */
export async function pickFolder(): Promise<{ folder: FileSystemDirectoryHandle; name: string } | null> {
  let picked: FileSystemDirectoryHandle;
  try {
    picked = await window.showDirectoryPicker!({ id: "touchdown", mode: "readwrite" });
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") return null;
    throw e;
  }
  if (await has(picked, "manifest.json", "file")) return { folder: picked, name: picked.name };
  const folder = await picked.getDirectoryHandle("Touchdown", { create: true });
  return { folder, name: `${picked.name}/Touchdown` };
}

/** Whether the folder holds a Touchdown log already. */
export const holdsLog = (folder: FileSystemDirectoryHandle) => has(folder, "manifest.json", "file");

/**
 * Whether Touchdown may read and write the folder. Browsers forget the permission between visits; asking again
 * needs a click, so `ask` is only true inside one.
 */
export async function folderAllowed(folder: FileSystemDirectoryHandle, ask: boolean): Promise<boolean> {
  const f = folder as Folder;
  if (!f.queryPermission) return true;
  if ((await f.queryPermission(READ_WRITE)) === "granted") return true;
  return ask && !!f.requestPermission && (await f.requestPermission(READ_WRITE)) === "granted";
}

export class LocalFolder implements FileAdapter {
  constructor(private readonly root: FileSystemDirectoryHandle) {}

  private async dir(parts: string[], create: boolean): Promise<FileSystemDirectoryHandle | null> {
    let d = this.root;
    for (const part of parts) {
      try {
        d = await d.getDirectoryHandle(part, { create });
      } catch (e) {
        if (missing(e)) return null;
        throw e;
      }
    }
    return d;
  }

  private async file(path: string, create: boolean): Promise<FileSystemFileHandle | null> {
    const parts = path.split("/");
    const name = parts.pop()!;
    const dir = await this.dir(parts, create);
    if (!dir) return null;
    try {
      return await dir.getFileHandle(name, { create });
    } catch (e) {
      if (missing(e)) return null;
      throw e;
    }
  }

  private static version(f: File) {
    return `${f.lastModified}-${f.size}`;
  }

  async list(path: string): Promise<FileInfo[]> {
    const dir = await this.dir(path ? path.split("/") : [], false);
    if (!dir) return [];
    const out: FileInfo[] = [];
    for await (const [name, handle] of (dir as Folder).entries()) {
      if (handle.kind === "file") out.push({ name, version: LocalFolder.version(await (handle as FileSystemFileHandle).getFile()) });
    }
    return out;
  }

  async read(path: string) {
    const handle = await this.file(path, false);
    if (!handle) return null;
    const f = await handle.getFile();
    return { data: new Uint8Array(await f.arrayBuffer()), version: LocalFolder.version(f) };
  }

  async write(path: string, data: Uint8Array) {
    const handle = (await this.file(path, true))!;
    const out = await handle.createWritable();
    await out.write(data as BufferSource);
    await out.close();
    return { version: LocalFolder.version(await handle.getFile()) };
  }

  async remove(path: string) {
    const parts = path.split("/");
    const name = parts.pop()!;
    const dir = await this.dir(parts, false);
    try {
      await dir?.removeEntry(name);
    } catch (e) {
      if (!missing(e)) throw e;
    }
  }
}
