// The password never leaves the browser (docs/33-accounts-and-sign-in.md, "Passwords"): it is turned into a key
// with Argon2id here, and only the key is sent. The salt is the site's id and the email address, so it needs no
// request about the account.

import { argon2id } from "hash-wasm";

export const MIN_PASSWORD = 10;

const b64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

/** The key the server checks: Argon2id (19 MiB, 2 passes), 32 bytes in base64url. Takes a fraction of a second. */
export async function passwordKey(password: string, email: string, siteId: string): Promise<string> {
  const salt = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`touchdown-password|${siteId}|${email.trim().toLowerCase()}`)));
  const key = await argon2id({ password, salt, parallelism: 1, iterations: 2, memorySize: 19_456, hashLength: 32, outputType: "binary" });
  return b64url(key);
}

/** What is wrong with a new password, or null. */
export function passwordProblem(password: string, repeated: string): string | null {
  if (password.length < MIN_PASSWORD) return `Use at least ${MIN_PASSWORD} characters.`;
  if (password !== repeated) return "The two passwords are not the same.";
  return null;
}
