// The sign-in pages (docs/33-accounts-and-sign-in.md): one page for signing in, joining, a new password and setup,
// served without a session. A link to the site lands on it, so its head carries the site's preview for chat apps (Open
// Graph): the picture the build names in it (apps/web/scripts/site-preview.ts), made whole with the site's address, and
// the line under the title in the request's language.

import { t } from "@touchdown/i18n/server";
import { SIGNIN_FILES, siteOrigin, type Server } from "./handler.ts";
import { attr } from "./share.ts";

/** The sign-in pages' one page, with the site's preview in its head. */
export async function signinPage(request: Request, s: Server, url: URL): Promise<Response> {
  const file = new URL(`${SIGNIN_FILES}signin.html`, url);
  if (request.method !== "GET") return s.assets.fetch(new Request(file, { method: request.method, headers: request.headers }));
  // Asked for whole: the page's head differs by language, so the file's own ETag no longer names it.
  const headers = new Headers(request.headers);
  for (const h of ["If-None-Match", "If-Modified-Since"]) headers.delete(h);
  const page = await s.assets.fetch(new Request(file, { headers }));
  if (!page.ok) return page;
  const origin = siteOrigin(s, url);
  const html = (await page.text())
    .replace(/(<meta property="og:image" content=")(\/[^"]*)"/, (_, start: string, path: string) => `${start}${attr(origin + path)}"`)
    .replace("</head>", `<meta property="og:url" content="${attr(`${origin}/`)}"><meta property="og:description" content="${attr(t("server.preview.site"))}"></head>`);
  const out = new Headers(page.headers);
  for (const h of ["Content-Length", "ETag", "Content-Encoding", "Last-Modified"]) out.delete(h);
  out.set("Vary", "Accept-Language");
  return new Response(html, { status: page.status, headers: out });
}
