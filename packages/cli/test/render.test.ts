import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { findChrome, pixelsOf, renderOptions } from "../src/render.ts";

const opts = (args: string[], values: Record<string, string> = {}, flags: string[] = []) => renderOptions(args, new Map(Object.entries(values)), new Set(flags));

describe("touchdown render's choices", () => {
  it("takes a flight, an aircraft, or the log or a year of it", () => {
    expect(opts(["flight", "XY123@2025-04-02"])).toMatchObject({ subject: { kind: "flight", ref: "XY123@2025-04-02" }, size: "landscape", fourK: false, seconds: null, fps: 60, theme: "light", view: "route", codes: false });
    expect(opts(["aircraft", "G-ABCD"])).toMatchObject({ subject: { kind: "aircraft", ref: "G-ABCD" } });
    expect(opts(["log"])).toMatchObject({ subject: { kind: "log", year: "all" } });
    expect(opts(["log", "2025"])).toMatchObject({ subject: { kind: "log", year: "2025" } });
    expect(typeof opts(["flight"])).toBe("string");
    expect(typeof opts(["log", "last-year"])).toBe("string");
    expect(typeof opts(["sighting", "x"])).toBe("string");
  });

  it("checks each choice, and allows ten minutes where the app allows two", () => {
    expect(opts(["log"], { "--seconds": "600", "--fps": "30", "--theme": "dark", "--view": "follow", "--size": "portrait" }, ["--4k", "--codes"])).toMatchObject({ seconds: 600, fps: 30, theme: "dark", view: "follow", size: "portrait", fourK: true, codes: true });
    for (const [option, value] of [["--seconds", "601"], ["--seconds", "9"], ["--seconds", "12.5"], ["--fps", "25"], ["--theme", "sepia"], ["--view", "cockpit"], ["--size", "wide"]]) {
      expect(typeof opts(["log"], { [option!]: value! }), `${option} ${value}`).toBe("string");
    }
  });

  it("makes 4K twice as wide and high as the app's sizes", () => {
    expect(pixelsOf({ size: "landscape", fourK: false })).toEqual([1920, 1080]);
    expect(pixelsOf({ size: "landscape", fourK: true })).toEqual([3840, 2160]);
    expect(pixelsOf({ size: "square", fourK: true })).toEqual([2160, 2160]);
    expect(pixelsOf({ size: "portrait", fourK: true })).toEqual([2160, 3840]);
  });
});

describe("finding Chrome", () => {
  it("takes the one given, else one on the PATH, and says when there is none", () => {
    const dir = mkdtempSync(join(tmpdir(), "touchdown-chrome-"));
    try {
      const given = join(dir, "my-chrome");
      writeFileSync(given, "");
      expect(findChrome(given, {}, "linux")).toBe(given);
      expect(findChrome(join(dir, "missing"), {}, "linux")).toBeNull();
      expect(findChrome(undefined, { TOUCHDOWN_CHROME: given }, "linux")).toBe(given);
      mkdirSync(join(dir, "bin"));
      writeFileSync(join(dir, "bin", "chromium"), "");
      expect(findChrome(undefined, { PATH: join(dir, "bin") }, "linux")).toBe(join(dir, "bin", "chromium"));
      expect(findChrome(undefined, { PATH: join(dir, "nothing-here") }, "linux")).toBeNull();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
