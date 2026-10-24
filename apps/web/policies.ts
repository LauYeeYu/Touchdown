// The privacy policy and the terms (PRIVACY.md and TERMS.md at the repository root) as the site's pages /privacy and
// /terms, which open without a session (docs/33-accounts-and-sign-in.md). Built with the sign-in pages
// (vite.signin.config.ts); the dev server makes them on request. The Markdown files stay the only source.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { marked } from "marked";

const ROOT = resolve(import.meta.dirname, "../..");
const REPOSITORY = "https://github.com/LauYeeYu/Touchdown/blob/master/";

export const POLICIES = { privacy: "PRIVACY.md", terms: "TERMS.md" } as const;
export type Policy = keyof typeof POLICIES;

/** Links between the two files go to the site's pages; links to other repository files go to GitHub. */
function linkTarget(href: string): string {
  if (href === "PRIVACY.md") return "/privacy";
  if (href === "TERMS.md") return "/terms";
  if (!/^[a-z]+:/i.test(href) && !href.startsWith("/") && !href.startsWith("#")) return REPOSITORY + href;
  return href;
}

/** The theme script of index.html, exactly, so the Content Security Policy's hash allows it here too. */
export function themeScript(): string {
  const html = readFileSync(resolve(import.meta.dirname, "index.html"), "utf8");
  const m = html.match(/ {4}<script>[\s\S]*?<\/script>/);
  if (!m) throw new Error("index.html has no theme script");
  return m[0];
}

export function policyHtml(page: Policy, stylesheet: string): string {
  const md = readFileSync(resolve(ROOT, POLICIES[page]), "utf8");
  const title = md.match(/^# (.+)$/m)?.[1] ?? "Touchdown";
  const body = marked.parse(md.replace(/\]\(([^)\s]+)\)/g, (_, href: string) => `](${linkTarget(href)})`), { async: false });
  return `<!doctype html>
<html lang="en-GB">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
    <meta name="color-scheme" content="light dark" />
    <meta name="theme-color" content="#f2ede2" />
    <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
    <link rel="stylesheet" href="${stylesheet}" />
    <title>${title}</title>
${themeScript()}
  </head>
  <body>
    <header class="masthead">
      <div class="page masthead__bar">
        <a class="wordmark" href="/">TOUCHDOWN</a>
      </div>
    </header>
    <main id="view" class="page page--form policy">
${body}
      <p class="policy__links"><a href="/privacy">Privacy policy</a> · <a href="/terms">Terms of service</a> · <a href="/signin">Sign in</a></p>
    </main>
  </body>
</html>
`;
}
