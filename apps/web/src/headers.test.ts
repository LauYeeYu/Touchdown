import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { THEME_SCRIPT_HASH } from "@touchdown/server/headers";

it("allows the theme script in both pages by its hash", () => {
  for (const page of ["../index.html", "../signin.html"]) {
    const html = readFileSync(new URL(page, import.meta.url), "utf8");
    const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => `sha256-${createHash("sha256").update(m[1]!).digest("base64")}`);
    expect(scripts, page).toEqual([THEME_SCRIPT_HASH]);
  }
});
