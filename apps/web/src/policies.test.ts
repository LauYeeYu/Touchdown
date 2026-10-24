import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { THEME_SCRIPT_HASH } from "@touchdown/server/headers";
import { policyHtml } from "../policies.ts";

it("builds the policy pages with the allowed theme script and links that work on the site", () => {
  for (const page of ["privacy", "terms"] as const) {
    const html = policyHtml(page, "/signin-files/assets/signin.css");
    const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => `sha256-${createHash("sha256").update(m[1]!).digest("base64")}`);
    expect(scripts, page).toEqual([THEME_SCRIPT_HASH]);
    expect(html).toContain("<h1>Touchdown");
    expect(html).not.toMatch(/href="(PRIVACY|TERMS|LICENSE|NOTICE)(\.md)?"/);
  }
  expect(policyHtml("terms", "x.css")).toContain('href="/privacy"');
  expect(policyHtml("terms", "x.css")).toContain('href="https://github.com/LauYeeYu/Touchdown/blob/master/LICENSE"');
});
