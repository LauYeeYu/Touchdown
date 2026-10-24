import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { AccessCheck } from "./access.ts";
import { THEME_SCRIPT_HASH } from "./headers.ts";
import { handle, type Env } from "./index.ts";

const TEAM = "https://example-team.cloudflareaccess.com";
const AUD = "aud-0123456789abcdef";
const NOW = Date.parse("2026-10-23T12:00:00Z");

const b64url = (data: Uint8Array | string) => Buffer.from(data).toString("base64url");

async function keyPair(kid: string) {
  const pair = (await crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"])) as CryptoKeyPair;
  const jwk = (await crypto.subtle.exportKey("jwk", pair.publicKey)) as JsonWebKey;
  return { kid, privateKey: pair.privateKey, jwk: { kid, kty: "RSA", alg: "RS256", n: jwk.n!, e: jwk.e! } };
}

type Key = Awaited<ReturnType<typeof keyPair>>;

async function token(key: Key, claims: Record<string, unknown> = {}) {
  const t = NOW / 1000;
  const header = b64url(JSON.stringify({ alg: "RS256", kid: key.kid, typ: "JWT" }));
  const payload = b64url(JSON.stringify({ aud: [AUD], iss: TEAM, email: "pilot@example.com", iat: t - 60, nbf: t - 60, exp: t + 3600, type: "app", ...claims }));
  const sig = new Uint8Array(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key.privateKey, new TextEncoder().encode(`${header}.${payload}`)));
  return `${header}.${payload}.${b64url(sig)}`;
}

function certs(keys: Key[], calls: string[] = []): typeof fetch {
  return async (input) => {
    calls.push(String(input));
    if (String(input) !== `${TEAM}/cdn-cgi/access/certs`) return new Response("no", { status: 404 });
    return Response.json({ keys: keys.map((k) => k.jwk) });
  };
}

const request = (path: string, jwt?: string) => new Request(`https://touchdown.example${path}`, { headers: jwt ? { "Cf-Access-Jwt-Assertion": jwt } : {} });

const env: Env = {
  ACCESS_TEAM_DOMAIN: TEAM,
  ACCESS_AUD: AUD,
  ASSETS: {
    async fetch(req: Request) {
      const path = new URL(req.url).pathname;
      if (path.startsWith("/assets/")) return new Response("js", { headers: { "Content-Type": "text/javascript" } });
      return new Response("<!doctype html>", { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "public, max-age=0, must-revalidate" } });
    },
  },
};

describe("the Access check", () => {
  it("lets a valid token through and names the user", async () => {
    const key = await keyPair("k1");
    const access = new AccessCheck({ teamDomain: TEAM, audience: AUD }, certs([key]), () => NOW);
    expect(await access.verify(request("/", await token(key)))).toBe("pilot@example.com");
  });

  it("refuses a missing, malformed, foreign, expired or misaddressed token", async () => {
    const key = await keyPair("k1");
    const other = await keyPair("k1");
    const access = new AccessCheck({ teamDomain: TEAM, audience: AUD }, certs([key]), () => NOW);
    const t = NOW / 1000;
    for (const jwt of [
      undefined,
      "not-a-token",
      "a.b.c",
      await token(other),
      await token(key, { exp: t - 600 }),
      await token(key, { nbf: t + 600 }),
      await token(key, { aud: ["another-app"] }),
      await token(key, { iss: "https://another-team.cloudflareaccess.com" }),
      (await token(key)).replace(/\.[^.]+$/, ".AAAA"),
    ]) {
      expect(await access.verify(request("/", jwt))).toBeNull();
    }
  });

  it("refuses everything until the team and audience are set", async () => {
    const key = await keyPair("k1");
    const access = new AccessCheck({ teamDomain: "", audience: "" }, certs([key]), () => NOW);
    expect(await access.verify(request("/", await token(key)))).toBeNull();
  });

  it("fetches the keys again for a new key id, but not on every request", async () => {
    const old = await keyPair("k1");
    const fresh = await keyPair("k2");
    const calls: string[] = [];
    let keys = [old];
    let now = NOW;
    const access = new AccessCheck({ teamDomain: TEAM, audience: AUD }, (input, init) => certs(keys, calls)(input, init), () => now);
    expect(await access.verify(request("/", await token(old)))).not.toBeNull();
    keys = [old, fresh];
    // Within 30 seconds of the last fetch a new key id is not fetched for.
    expect(await access.verify(request("/", await token(fresh)))).toBeNull();
    now += 31_000;
    expect(await access.verify(request("/", await token(fresh)))).not.toBeNull();
    expect(calls).toHaveLength(2);
  });
});

describe("the Worker", () => {
  it("refuses a request without a valid token, with the security headers", async () => {
    const key = await keyPair("k1");
    const res = await handle(request("/flights"), env, new AccessCheck({ teamDomain: TEAM, audience: AUD }, certs([key]), () => NOW));
    expect(res.status).toBe(403);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(res.headers.get("Content-Security-Policy")).toContain("frame-ancestors 'none'");
  });

  it("serves the app with the headers and caching that suit each file", async () => {
    const key = await keyPair("k1");
    const access = new AccessCheck({ teamDomain: TEAM, audience: AUD }, certs([key]), () => NOW);
    const jwt = await token(key);

    const page = await handle(request("/aircraft/G-ABCD", jwt), env, access);
    expect(page.status).toBe(200);
    expect(page.headers.get("Cache-Control")).toBe("no-cache");
    expect(page.headers.get("Strict-Transport-Security")).toBeTruthy();
    expect(page.headers.get("Cross-Origin-Opener-Policy")).toBe("same-origin-allow-popups");

    const file = await handle(request("/assets/index-abc123.js", jwt), env, access);
    expect(file.headers.get("Cache-Control")).toBe("public, max-age=31536000, immutable");

    expect((await handle(request("/api/lookup", jwt), env, access)).status).toBe(404);
  });

  it("refuses when Access's keys cannot be fetched", async () => {
    const key = await keyPair("k1");
    const access = new AccessCheck({ teamDomain: TEAM, audience: AUD }, async () => Promise.reject(new Error("offline")), () => NOW);
    expect((await handle(request("/", await token(key)), env, access)).status).toBe(503);
  });

  it("allows the theme script in index.html by its hash", () => {
    const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
    const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => `sha256-${createHash("sha256").update(m[1]!).digest("base64")}`);
    expect(scripts).toEqual([THEME_SCRIPT_HASH]);
  });
});
