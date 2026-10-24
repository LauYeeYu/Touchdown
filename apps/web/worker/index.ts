// The Worker that serves Touchdown (docs/30-architecture.md, "Deployment"): the built app from static assets, and
// later the lookup service under /api/. Cloudflare Access signs users in before a request gets here; the Worker
// checks Access's token on every request as well and refuses anything without a valid one.

import { AccessCheck } from "./access.ts";
import { withHeaders } from "./headers.ts";

export interface Env {
  ASSETS: { fetch(request: Request): Promise<Response> };
  /** https://<team>.cloudflareaccess.com; until it is set, every request is refused. */
  ACCESS_TEAM_DOMAIN: string;
  /** The Access application's audience (AUD) tag; until it is set, every request is refused. */
  ACCESS_AUD: string;
}

let check: { key: string; access: AccessCheck } | null = null;

function accessFor(env: Env): AccessCheck {
  const key = `${env.ACCESS_TEAM_DOMAIN}|${env.ACCESS_AUD}`;
  if (check?.key !== key) check = { key, access: new AccessCheck({ teamDomain: env.ACCESS_TEAM_DOMAIN, audience: env.ACCESS_AUD }) };
  return check.access;
}

function plain(status: number, text: string, path: string): Response {
  return withHeaders(new Response(text, { status, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } }), path);
}

export async function handle(request: Request, env: Env, access: AccessCheck = accessFor(env)): Promise<Response> {
  const path = new URL(request.url).pathname;
  let user: string | null;
  try {
    user = await access.verify(request);
  } catch {
    // Access's keys could not be fetched: refuse rather than let the request through.
    return plain(503, "Sign-in could not be checked. Try again in a minute.", path);
  }
  if (user === null) return plain(403, "Sign in to use Touchdown.", path);
  if (path.startsWith("/api/")) return plain(404, "Not found.", path);
  return withHeaders(await env.ASSETS.fetch(request), path);
}

export default { fetch: (request: Request, env: Env) => handle(request, env) };
