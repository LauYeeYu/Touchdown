// Saving something the app made (a backup, a CSV, a check request) as a file in the browser's downloads, or handing a
// file to the system's share sheet (an image or a video of a map).

export function download(name: string, data: BlobPart, type: string) {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Whether this browser can hand a file of this name and type to the system's share sheet (Web Share with files): most
 * phones' browsers, Safari, and Chrome and Edge on Windows and ChromeOS. Firefox on a computer cannot.
 */
export function canShareFile(name: string, type: string): boolean {
  try {
    return typeof navigator.share === "function" && typeof navigator.canShare === "function" && navigator.canShare({ files: [new File([""], name, { type })] });
  } catch {
    return false;
  }
}

/**
 * Hand a file to the system's share sheet. "shared" once it was sent somewhere, "cancelled" when the sheet was closed,
 * and "again" when the browser wants a fresh press first: a press lets a page open the sheet only for a moment, and
 * the file may have taken longer to make. `direct` is a file shared straight from the press, with nothing made first:
 * a browser that refuses it means it, and that is thrown, as is anything else it refuses.
 */
export async function shareFile(file: File, direct: boolean): Promise<"shared" | "cancelled" | "again"> {
  if (!direct && navigator.userActivation && !navigator.userActivation.isActive) return "again";
  try {
    await navigator.share({ files: [file] });
    return "shared";
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") return "cancelled";
    if (e instanceof DOMException && e.name === "NotAllowedError" && !direct) return "again";
    throw e;
  }
}
