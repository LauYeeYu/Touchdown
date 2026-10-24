// Response headers for every page and file the site serves (docs/30-architecture.md, "Deployment"). The server
// sets them, and `vite preview` uses the same ones, so the built app can be tried locally under the same policy.

/** The theme script inline in index.html, allowed by its hash. A test checks it against the file. */
export const THEME_SCRIPT_HASH = "sha256-9jcCkNSpCiFGIOUt2MFygNMOy98D457hWXLkNtbugHE=";

// What the app reaches outside its own address: Google's sign-in and the Drive API (Private mode),
// planespotters.net's photos, and Cloudflare Web Analytics, whose script Cloudflare adds to every page (docs/30). Google's sign-in script also adds an inline style for its own sign-in button, which
// Touchdown does not use; the browser blocks it and reports it, and the popup sign-in works without it.
const CSP = [
  "default-src 'self'",
  // WebAssembly (the password hash, later SQLite) may be compiled; JavaScript eval stays forbidden.
  `script-src 'self' '${THEME_SCRIPT_HASH}' 'wasm-unsafe-eval' https://accounts.google.com/gsi/client https://static.cloudflareinsights.com`,
  "style-src 'self' https://accounts.google.com/gsi/style",
  "img-src 'self' data: blob: https://*.plnspttrs.net",
  "font-src 'self'",
  "connect-src 'self' https://www.googleapis.com https://accounts.google.com/gsi/ https://api.planespotters.net https://cloudflareinsights.com",
  "frame-src https://accounts.google.com/gsi/",
  "worker-src 'self'",
  "manifest-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

export const SECURITY_HEADERS: Record<string, string> = {
  "Content-Security-Policy": CSP,
  "Strict-Transport-Security": "max-age=31536000",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  // Google's sign-in popup talks back to this page, so the opener is kept for popups.
  "Cross-Origin-Opener-Policy": "same-origin-allow-popups",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=(), browsing-topics=()",
  "X-Robots-Tag": "noindex, nofollow",
};

/** A copy of a response with the security headers, and caching that suits it. */
export function withHeaders(res: Response, path: string): Response {
  const out = new Response(res.body, res);
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) out.headers.set(k, v);
  if ((out.headers.get("Content-Type") ?? "").startsWith("text/html")) {
    // The page is checked with the server on every visit, so a new deployment is picked up at once.
    out.headers.set("Cache-Control", "no-cache");
  } else if (path.startsWith("/assets/") && res.ok) {
    // Built files carry a content hash in their names.
    out.headers.set("Cache-Control", "public, max-age=31536000, immutable");
  }
  return out;
}
