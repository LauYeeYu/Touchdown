// The Cloudflare Worker that serves Touchdown (docs/33-accounts-and-sign-in.md, "Hosting"): a thin wrapper around
// the server in packages/server, with Cloudflare's D1 database and the built app as static assets. The same server
// runs on any machine with Node (packages/server/src/node.ts).

import { d1Database, handle, type Assets, type D1Like, type Database, type ShareCache } from "@touchdown/server";

export interface Env {
  ASSETS: Assets;
  DB: D1Like;
  /** The site's addresses, comma-separated; the first is used in links. */
  SITE_ORIGINS: string;
  /** Secrets, set with `wrangler secret put`. */
  SETUP_TOKEN?: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  /** Encrypts Standard mode's storage keys: 32 random bytes, base64. */
  TOKEN_KEY?: string;
}

// One wrapper per binding, so the tables are checked once per Worker instance, not on every request.
const databases = new WeakMap<D1Like, Database>();

/**
 * A share link's content, kept in Cloudflare's cache in this data centre under the versions of the files it came from
 * (docs/32, "Reading the log live"). The keys are addresses on the site that only this Worker asks for; a visitor
 * asking for one meets the sign-in, as for any other address.
 */
function shareCache(origin: string): ShareCache {
  // Cloudflare's cache for this data centre, which the DOM's types do not have.
  const cache = (caches as unknown as { default: Cache }).default;
  const key = (k: string) => new Request(`${origin}/__share-cache/${encodeURIComponent(k)}`);
  return {
    get: async (k) => (await cache.match(key(k)))?.text() ?? null,
    put: async (k, v) => cache.put(key(k), new Response(v, { headers: { "Cache-Control": "max-age=86400" } })),
  };
}

export default {
  fetch(request: Request, env: Env): Promise<Response> {
    let db = databases.get(env.DB);
    if (!db) databases.set(env.DB, (db = d1Database(env.DB)));
    const origins = env.SITE_ORIGINS.split(",").map((o) => o.trim()).filter(Boolean);
    return handle(request, {
      db,
      assets: env.ASSETS,
      cache: shareCache(origins[0] ?? new URL(request.url).origin),
      config: {
        origins,
        setupToken: env.SETUP_TOKEN,
        google: env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET ? { clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET } : undefined,
        tokenKey: env.TOKEN_KEY,
      },
    });
  },
};
