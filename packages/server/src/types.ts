// The aircraft types pages (docs/31-ui.md, "Aircraft types"): the types pages' one page for every address, the same for
// everyone, with the address's own preview for chat apps in its head (Open Graph), in the request's language: its
// title, the line under it and its picture. The types pages' build makes them (apps/web/scripts/type-previews.ts).

import { locale, type Locale } from "@touchdown/i18n/server";
import { siteOrigin, type Assets, type Server } from "./handler.ts";
import { attr } from "./share.ts";

/**
 * The aircraft types pages' own build (docs/31-ui.md, "Aircraft types"): reference data only, one page the same for
 * everyone. Its script opens the app in its place for a signed-in visitor.
 */
export const TYPES_FILES = "/types-files/";
/** The types pages: the list, Compare, a type by its code, and a manufacturer's types and a family's by its name's slug. */
export const TYPES_PAGES = /^\/types(?:\/compare|\/[A-Za-z0-9]{1,8}|\/(?:manufacturers|families)\/[a-z0-9-]{1,80})?\/?$/;

/** A page's title, the line under it and its picture's address in PREVIEWS, by the page's address. */
export type TypePreviews = Record<string, [title: string, description: string, image: string]>;

const PREVIEWS = `${TYPES_FILES}previews/`;
/**
 * The files a language's previews are split into, by address, so a request reads a small one: on Cloudflare's free plan
 * a request has 10 ms of the processor, and a Worker's instance that keeps them is often new.
 */
const PREVIEW_FILES = 16;

/** The file in PREVIEWS that has a page's preview in a language. */
export function previewFile(lang: Locale, page: string): string {
  let h = 0;
  for (let i = 0; i < page.length; i++) h = (h * 31 + page.charCodeAt(i)) >>> 0;
  return `${lang}-${h % PREVIEW_FILES}.json`;
}

/** The previews' files read so far, kept by a server (a Worker's instance). */
const kept = new WeakMap<Assets, Map<string, Promise<TypePreviews | null>>>();

/** A page's preview in a language, from its file. */
async function previewOf(s: Server, url: URL, lang: Locale, page: string): Promise<TypePreviews[string] | undefined> {
  let files = kept.get(s.assets);
  if (!files) kept.set(s.assets, (files = new Map()));
  const name = previewFile(lang, page);
  let read = files.get(name);
  if (!read) {
    read = s.assets
      .fetch(new Request(new URL(PREVIEWS + name, url)))
      .then(async (res) => (res.ok ? ((await res.json()) as TypePreviews) : null))
      .catch(() => null);
    files.set(name, read);
    // One that could not be read is asked for again next time.
    void read.then((p) => p ?? files.delete(name));
  }
  return (await read)?.[page];
}

/** A page's address as the previews name it: without a slash at the end, a type's code in capitals. */
function pageOf(path: string): string {
  const page = path.replace(/\/$/, "");
  const code = /^\/types\/([A-Za-z0-9]{1,8})$/.exec(page)?.[1];
  return code && code !== "compare" ? `/types/${code.toUpperCase()}` : page;
}

/** /types and the pages under it, which `TYPES_PAGES` lets through without a session. */
export async function typesPage(request: Request, s: Server, url: URL): Promise<Response> {
  const file = new URL(`${TYPES_FILES}types.html`, url);
  if (request.method !== "GET") return s.assets.fetch(new Request(file, { method: request.method, headers: request.headers }));
  // Asked for whole: the page's head differs by address and language, so the file's own ETag no longer names it.
  const headers = new Headers(request.headers);
  for (const h of ["If-None-Match", "If-Modified-Since"]) headers.delete(h);
  const page = await s.assets.fetch(new Request(file, { headers }));
  const lang = locale();
  let path = pageOf(url.pathname);
  const found = page.ok ? await previewOf(s, url, lang, path) : undefined;
  if (!found) return page;
  let [title, description, image] = found;
  if (path === "/types/compare") {
    // The line names the two types asked for, else there is none.
    const [a, b] = ["a", "b"].map((k) => url.searchParams.get(k)?.toUpperCase() ?? "");
    const [first, second] = (await Promise.all([a, b].map((c) => (c ? previewOf(s, url, lang, `/types/${c}`) : undefined)))).map((p) => p?.[0]);
    description = first && second ? description.replace("{first}", first).replace("{second}", second) : "";
    if (first && second) path += `?a=${encodeURIComponent(a!)}&b=${encodeURIComponent(b!)}`;
  }
  const origin = siteOrigin(s, url);
  const tags = [
    `<meta property="og:type" content="website">`,
    `<meta property="og:site_name" content="Touchdown">`,
    `<meta property="og:url" content="${attr(origin + path)}">`,
    `<meta property="og:title" content="${attr(title)}">`,
    description ? `<meta property="og:description" content="${attr(description)}">` : "",
    `<meta property="og:image" content="${attr(origin + PREVIEWS + image)}">`,
    `<meta property="og:image:width" content="1200">`,
    `<meta property="og:image:height" content="630">`,
    `<meta name="twitter:card" content="summary_large_image">`,
  ].join("");
  // The file's own title and preview, for the list in UK English, give way to the page's.
  const html = (await page.text())
    .replace(/<meta property="og:[^>]*>\s*/g, "")
    .replace(/<title>[^<]*<\/title>/, `<title>${attr(title)}</title>`)
    .replace("</head>", `${tags}</head>`);
  const out = new Headers(page.headers);
  for (const h of ["Content-Length", "ETag", "Content-Encoding", "Last-Modified"]) out.delete(h);
  out.set("Vary", "Accept-Language");
  return new Response(html, { status: page.status, headers: out });
}
