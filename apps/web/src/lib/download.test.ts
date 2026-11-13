import { afterEach, describe, expect, it, vi } from "vitest";
import { canShareFile, shareFile } from "./download.ts";

/** A browser's `navigator` with a share sheet that does what `share` does, and a press that is or is not still fresh. */
function browser(share: (data: ShareData) => Promise<void>, fresh: boolean | null, canShare: (data: ShareData) => boolean = () => true) {
  const calls: ShareData[] = [];
  vi.stubGlobal("navigator", {
    share: (data: ShareData) => {
      calls.push(data);
      return share(data);
    },
    canShare,
    userActivation: fresh === null ? undefined : { isActive: fresh, hasBeenActive: true },
  });
  return calls;
}

const file = () => new File(["made-up image"], "touchdown-all.png", { type: "image/png" });
const refused = (name: string) => () => Promise.reject(new DOMException("refused", name));

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("sharing an image or a video", () => {
  it("hands the file to the share sheet, and tells a closed sheet from a sent file", async () => {
    const calls = browser(() => Promise.resolve(), true);
    expect(await shareFile(file(), true)).toBe("shared");
    expect(calls[0]!.files![0]!.name).toBe("touchdown-all.png");
    browser(refused("AbortError"), true);
    expect(await shareFile(file(), true)).toBe("cancelled");
  });

  it("asks for another press when making the file took longer than the press lasts, without opening the sheet", async () => {
    const calls = browser(() => Promise.resolve(), false);
    expect(await shareFile(file(), false)).toBe("again");
    expect(calls).toHaveLength(0);
    // A browser that still counts the press but refuses after the wait (Safari), or cannot say whether it counts.
    browser(refused("NotAllowedError"), true);
    expect(await shareFile(file(), false)).toBe("again");
    browser(refused("NotAllowedError"), null);
    expect(await shareFile(file(), false)).toBe("again");
  });

  it("passes on a refusal of a file shared straight from the press, so a second press is not asked for forever", async () => {
    browser(refused("NotAllowedError"), true);
    await expect(shareFile(file(), true)).rejects.toThrow("refused");
    browser(refused("DataError"), true);
    await expect(shareFile(file(), false)).rejects.toThrow("refused");
  });

  it("offers sharing only where the browser can share a file of that type", () => {
    browser(() => Promise.resolve(), true, (d) => d.files![0]!.type === "video/mp4");
    expect(canShareFile("touchdown-all.mp4", "video/mp4")).toBe(true);
    expect(canShareFile("touchdown-all.svg", "image/svg+xml")).toBe(false);
    browser(() => Promise.resolve(), true, () => {
      throw new TypeError("no files");
    });
    expect(canShareFile("touchdown-all.png", "image/png")).toBe(false);
    vi.stubGlobal("navigator", {});
    expect(canShareFile("touchdown-all.png", "image/png")).toBe(false);
  });
});
