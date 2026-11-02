import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { offlineFiles } from "./files.ts";
import { routeFor } from "./policy.ts";

describe("the offline worker's routes", () => {
  const files = new Set(["/index.html", "/assets/index-abc.js", "/boot.css", "/manifest.webmanifest"]);

  it("serves the app's own files from its cache", () => {
    expect(routeFor("/assets/index-abc.js", "no-cors", files)).toBe("file");
    expect(routeFor("/boot.css", "no-cors", files)).toBe("file");
    expect(routeFor("/manifest.webmanifest", "cors", files)).toBe("file");
  });

  it("opens the app's pages from the network first, with the cached page offline", () => {
    for (const path of ["/", "/flights", "/flights/01M687WJWYJHMG38DRPHYJJZ44", "/aircraft/abc", "/stats", "/settings", "/import"]) expect(routeFor(path, "navigate", files), path).toBe("page");
  });

  it("leaves the sign-in pages, the server's requests and share links alone", () => {
    for (const path of ["/signin", "/signin/", "/setup", "/join/abc", "/reset/abc", "/privacy", "/terms", "/auth/me", "/api/storage/token", "/p/abcdefghijklmnopqrstuv", "/share-files/share.html", "/signin-files/signin.html", "/cli/login", "/sw.js"]) {
      expect(routeFor(path, "navigate", files), path).toBe("pass");
    }
    expect(routeFor("/auth/me", "cors", files)).toBe("pass");
    expect(routeFor("/api/shares", "same-origin", files)).toBe("pass");
  });

  it("does not take addresses that only start like a public page for one", () => {
    expect(routeFor("/signing-notes", "navigate", files)).toBe("page");
    expect(routeFor("/pages", "navigate", files)).toBe("page");
  });
});

describe("the files the offline worker keeps", () => {
  let dir = "";
  afterEach(() => rmSync(dir, { recursive: true, force: true }));
  const build = (extra: Record<string, string> = {}) => {
    dir = mkdtempSync(join(tmpdir(), "touchdown-offline-"));
    const write = (path: string, text: string) => {
      mkdirSync(join(dir, path, ".."), { recursive: true });
      writeFileSync(join(dir, path), text);
    };
    for (const [path, text] of Object.entries({ "index.html": "<html>", "assets/index-abc.js": "app", "assets/index-abc.js.map": "{}", "boot.css": "a{}", "signin-files/signin.html": "x", "share-files/share.html": "y", "sw.js": "old", ...extra })) write(path, text);
    return dir;
  };

  it("lists the app's files, without source maps, the sign-in and share pages' files or itself", () => {
    expect(offlineFiles(build()).files).toEqual(["/assets/index-abc.js", "/boot.css", "/index.html"]);
  });

  it("gets a new version when a file changes, and keeps it otherwise", () => {
    const a = offlineFiles(build()).version;
    rmSync(dir, { recursive: true, force: true });
    const b = offlineFiles(build()).version;
    rmSync(dir, { recursive: true, force: true });
    const c = offlineFiles(build({ "boot.css": "a{color:red}" })).version;
    expect(b).toBe(a);
    expect(c).not.toBe(a);
  });

  it("refuses a folder without the app's page", () => {
    dir = mkdtempSync(join(tmpdir(), "touchdown-offline-"));
    expect(() => offlineFiles(dir)).toThrow(/index\.html/);
  });
});
