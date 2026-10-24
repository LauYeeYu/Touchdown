// Checking Cloudflare Access's sign-in token (docs/30-architecture.md, "Access gate"). Access sits in front of the
// whole site; the Worker checks its token on every request as well, so a mistake in the Access setup leads to a
// refusal, not an open site.

export interface AccessConfig {
  /** The Zero Trust team's address, https://<team>.cloudflareaccess.com. */
  teamDomain: string;
  /** The Access application's audience (AUD) tag. */
  audience: string;
}

interface Jwk {
  kid: string;
  kty: string;
  alg?: string;
  n: string;
  e: string;
}

/** Keys are fetched again after this long, or sooner when a token names a key not seen yet. */
const KEYS_MS = 60 * 60_000;
/** But not more often than this, so made-up key ids cannot make the Worker fetch on every request. */
const REFETCH_MS = 30_000;
/** Clock difference allowed between Cloudflare's servers. */
const SKEW_S = 60;

const decoder = new TextDecoder();

function base64url(s: string): Uint8Array {
  const b = atob(s.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (s.length % 4)) % 4));
  return Uint8Array.from(b, (c) => c.charCodeAt(0));
}

function part<T>(s: string): T | null {
  try {
    return JSON.parse(decoder.decode(base64url(s))) as T;
  } catch {
    return null;
  }
}

export class AccessCheck {
  private keys = new Map<string, CryptoKey>();
  private fetchedAt = 0;

  constructor(
    private readonly config: AccessConfig,
    private readonly fetcher: typeof fetch = (input, init) => fetch(input, init),
    private readonly now: () => number = Date.now,
  ) {}

  /** The signed-in user's email address when the request carries a valid token; otherwise null. */
  async verify(request: Request): Promise<string | null> {
    const { teamDomain, audience } = this.config;
    if (!teamDomain || !audience) return null;
    const token = request.headers.get("Cf-Access-Jwt-Assertion");
    if (!token) return null;
    const [h, p, s] = token.split(".");
    if (!h || !p || !s) return null;
    const header = part<{ alg?: string; kid?: string }>(h);
    const payload = part<{ aud?: string | string[]; iss?: string; exp?: number; nbf?: number; iat?: number; email?: string }>(p);
    if (!header || !payload || header.alg !== "RS256" || !header.kid) return null;

    const key = await this.key(header.kid);
    if (!key) return null;
    let signature: Uint8Array;
    try {
      signature = base64url(s);
    } catch {
      return null;
    }
    const signed = new TextEncoder().encode(`${h}.${p}`);
    if (!(await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, signature as BufferSource, signed))) return null;

    const t = this.now() / 1000;
    const audiences = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
    if (!audiences.includes(audience)) return null;
    if (payload.iss !== teamDomain) return null;
    if (typeof payload.exp !== "number" || payload.exp < t - SKEW_S) return null;
    if (typeof payload.nbf === "number" && payload.nbf > t + SKEW_S) return null;
    if (typeof payload.iat === "number" && payload.iat > t + SKEW_S) return null;
    return payload.email ?? "";
  }

  private async key(kid: string): Promise<CryptoKey | null> {
    const age = this.now() - this.fetchedAt;
    if (age > KEYS_MS || (!this.keys.has(kid) && age > REFETCH_MS)) await this.refresh();
    return this.keys.get(kid) ?? null;
  }

  private async refresh() {
    this.fetchedAt = this.now();
    const res = await this.fetcher(`${this.config.teamDomain}/cdn-cgi/access/certs`);
    if (!res.ok) return;
    const body = (await res.json()) as { keys?: Jwk[] };
    const keys = new Map<string, CryptoKey>();
    for (const k of body.keys ?? []) {
      if (k.kty !== "RSA" || (k.alg && k.alg !== "RS256")) continue;
      keys.set(k.kid, await crypto.subtle.importKey("jwk", { kty: "RSA", n: k.n, e: k.e, alg: "RS256", ext: true }, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]));
    }
    // A failed fetch keeps the keys there were.
    if (keys.size) this.keys = keys;
  }
}
