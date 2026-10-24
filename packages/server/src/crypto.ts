// Random tokens, hashes and comparisons with the Web Crypto API, which both Cloudflare Workers and Node have.

const encoder = new TextEncoder();

export function b64url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function fromB64url(s: string): Uint8Array {
  const b = atob(s.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (s.length % 4)) % 4));
  return Uint8Array.from(b, (c) => c.charCodeAt(0));
}

/** A 256-bit random token, base64url (43 characters). */
export const randomToken = (): string => b64url(crypto.getRandomValues(new Uint8Array(32)));

/** The form of a token, and of the browser's password key: 32 bytes in base64url. */
export const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

export async function sha256(data: Uint8Array | string): Promise<Uint8Array> {
  const bytes = typeof data === "string" ? encoder.encode(data) : data;
  return new Uint8Array(await crypto.subtle.digest("SHA-256", bytes as BufferSource));
}

/** What the server stores for a token: its SHA-256, base64url. */
export const hashToken = async (token: string): Promise<string> => b64url(await sha256(token));

/** Compare two strings in time that depends only on their length. */
export function sameString(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * The stored form of the browser's password key (docs/33, "Passwords"): SHA-256 of a per-account random salt and
 * the key. The key is already the output of Argon2id, so one fast hash is enough here.
 */
export async function passwordHash(salt: string, key: string): Promise<string> {
  const s = fromB64url(salt);
  const k = fromB64url(key);
  const both = new Uint8Array(s.length + k.length);
  both.set(s);
  both.set(k, s.length);
  return b64url(await sha256(both));
}

export const newSalt = (): string => b64url(crypto.getRandomValues(new Uint8Array(16)));

/**
 * Standard mode's storage keys (docs/32, "What the server stores"): AES-256-GCM under TOKEN_KEY, a server secret
 * (32 random bytes, base64). The row's ids are bound in as additional data, so a ciphertext cannot be moved to
 * another row or account.
 */
async function aesKey(secret: string): Promise<CryptoKey> {
  const raw = fromB64url(secret.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""));
  if (raw.length !== 32) throw new Error("TOKEN_KEY must be 32 bytes, base64.");
  return crypto.subtle.importKey("raw", raw as BufferSource, "AES-GCM", false, ["encrypt", "decrypt"]);
}

export async function sealToken(secret: string, plain: string, bound: string): Promise<{ ciphertext: string; iv: string }> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt({ name: "AES-GCM", iv: iv as BufferSource, additionalData: encoder.encode(bound) as BufferSource }, await aesKey(secret), encoder.encode(plain) as BufferSource);
  return { ciphertext: b64url(new Uint8Array(data)), iv: b64url(iv) };
}

export async function openToken(secret: string, sealed: { ciphertext: string; iv: string }, bound: string): Promise<string> {
  const data = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: fromB64url(sealed.iv) as BufferSource, additionalData: encoder.encode(bound) as BufferSource },
    await aesKey(secret),
    fromB64url(sealed.ciphertext) as BufferSource,
  );
  return new TextDecoder().decode(data);
}
