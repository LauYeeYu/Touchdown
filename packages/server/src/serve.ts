// Touchdown's server on any machine (docs/33-accounts-and-sign-in.md, "Hosting"): the built app behind the
// sign-in, with a SQLite file. Run it with `npm run serve` after building the web app, behind a web server that
// handles HTTPS. Plain Node (22.18 or later runs this TypeScript file as it is).
//
// Settings, from the environment:
//   TOUCHDOWN_ORIGINS   the site's addresses, comma-separated (https://touchdown.example.org)
//   TOUCHDOWN_DB        the SQLite file (default data/private/server.sqlite)
//   TOUCHDOWN_DIST      the built app (default apps/web/dist)
//   HOST, PORT          where to listen (default 127.0.0.1:8787)
//   SETUP_TOKEN         the secret for /setup, the first account
//   GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET   signing in with Google, and Standard mode (optional)
//   TOKEN_KEY           encrypts Standard mode's storage keys: 32 random bytes, base64 (optional; no Standard without)
//   TOUCHDOWN_INSECURE_COOKIES=1   cookies without Secure, only for trying it over plain http

import { existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, extname, join, normalize, resolve, sep } from "node:path";
import { handle, type Assets } from "./handler.ts";
import { sqliteFile } from "./node.ts";

const ROOT = resolve(import.meta.dirname, "../../..");
const env = process.env;
const dist = resolve(env.TOUCHDOWN_DIST ?? join(ROOT, "apps/web/dist"));
const dbFile = resolve(env.TOUCHDOWN_DB ?? join(ROOT, "data/private/server.sqlite"));
const port = Number(env.PORT ?? 8787);
const host = env.HOST ?? "127.0.0.1";
const origins = (env.TOUCHDOWN_ORIGINS ?? `http://${host}:${port}`).split(",").map((o) => o.trim()).filter(Boolean);

if (!existsSync(join(dist, "index.html"))) {
  console.error(`No built app in ${dist}. Run npm run build -w @touchdown/web first.`);
  process.exit(1);
}
mkdirSync(dirname(dbFile), { recursive: true });

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".webmanifest": "application/manifest+json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".woff2": "font/woff2",
  ".map": "application/json",
  ".wasm": "application/wasm",
};

/** The built files, as Cloudflare's static assets serve them: a missing page gets index.html (the app's routes). */
const assets: Assets = {
  async fetch(request) {
    const path = decodeURIComponent(new URL(request.url).pathname);
    const file = normalize(join(dist, path));
    const inside = file === dist || file.startsWith(dist + sep);
    const found = inside && existsSync(file) && statSync(file).isFile() ? file : null;
    if (!found) {
      if (extname(path)) return new Response("Not found", { status: 404 });
      return new Response(readFileSync(join(dist, "index.html")), { headers: { "Content-Type": TYPES[".html"]! } });
    }
    return new Response(readFileSync(found), { headers: { "Content-Type": TYPES[extname(found)] ?? "application/octet-stream" } });
  },
};

const server = {
  db: sqliteFile(dbFile),
  assets,
  config: {
    origins,
    setupToken: env.SETUP_TOKEN,
    google: env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET ? { clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET } : undefined,
    secureCookies: env.TOUCHDOWN_INSECURE_COOKIES !== "1",
    tokenKey: env.TOKEN_KEY,
  },
};

createServer(async (req, res) => {
  try {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const headers = new Headers();
    for (const [k, v] of Object.entries(req.headers)) if (typeof v === "string") headers.set(k, v);
    const request = new Request(new URL(req.url ?? "/", origins[0]), { method: req.method, headers, body: chunks.length ? Buffer.concat(chunks) : undefined });
    const response = await handle(request, server);
    res.statusCode = response.status;
    response.headers.forEach((v, k) => k !== "set-cookie" && res.setHeader(k, v));
    const cookies = response.headers.getSetCookie();
    if (cookies.length) res.setHeader("Set-Cookie", cookies);
    res.end(req.method === "HEAD" ? undefined : Buffer.from(await response.arrayBuffer()));
  } catch (e) {
    // No request details in the log: addresses show which aircraft someone looks at.
    console.error("Request failed:", (e as Error).message);
    res.statusCode = 500;
    res.end("Server error");
  }
}).listen(port, host, () => {
  console.log(`Touchdown at http://${host}:${port} (site addresses: ${origins.join(", ")}); database ${dbFile}`);
  if (!env.SETUP_TOKEN) console.log("No SETUP_TOKEN: /setup cannot make the first account.");
});
