// The Cloudflare Worker that serves Touchdown (docs/33-accounts-and-sign-in.md, "Hosting"): a thin wrapper around
// the server in packages/server, with Cloudflare's D1 database and the built app as static assets. The same server
// runs on any machine with Node (packages/server/src/node.ts).

import { d1Database, handle, type Assets, type D1Like, type Database } from "@touchdown/server";

export interface Env {
  ASSETS: Assets;
  DB: D1Like;
  /** The site's addresses, comma-separated; the first is used in links. */
  SITE_ORIGINS: string;
  /** Secrets, set with `wrangler secret put`. */
  SETUP_TOKEN?: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
}

// One wrapper per binding, so the tables are checked once per Worker instance, not on every request.
const databases = new WeakMap<D1Like, Database>();

export default {
  fetch(request: Request, env: Env): Promise<Response> {
    let db = databases.get(env.DB);
    if (!db) databases.set(env.DB, (db = d1Database(env.DB)));
    return handle(request, {
      db,
      assets: env.ASSETS,
      config: {
        origins: env.SITE_ORIGINS.split(",").map((o) => o.trim()).filter(Boolean),
        setupToken: env.SETUP_TOKEN,
        google: env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET ? { clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET } : undefined,
      },
    });
  },
};
