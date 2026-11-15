// What the service worker does with each request (docs/30, "Offline"). Shared by the worker (sw.ts) and the app
// (data/offline.ts), and tested on its own: the worker's file is built separately (vite.sw.config.ts).

/** The worker's caches are named with this, then the build's version. */
export const CACHE_PREFIX = "touchdown-app-";

/** The copy of the app's page that opens when the network cannot be reached. */
export const SHELL = "/index.html";

/**
 * Addresses that are not the app's own pages: the server answers them, or another build does. They are never served
 * from the cache, so the sign-in pages, the API and share links behave offline as they would without the worker.
 */
const NOT_APP = /^\/(auth|api|p|share-files|signin-files|types-files|cli|__share-cache)(\/|$)|^\/(signin|setup|privacy|terms)\/?$|^\/(join|reset)\//;

/** The built files, whose names carry a hash of their contents. */
const BUILT = /^\/assets\//;

/**
 * How the worker's install fetches a file. A built file may come from the browser's own cache, where the page has just
 * put the ones it opened with: its name changes with its contents, so a copy there is the same file. Any other file,
 * the app's page among them, is asked for again.
 */
export function installCache(path: string): RequestCache {
  return BUILT.test(path) ? "default" : "no-cache";
}

/** A file's address ends in an extension, as the server tells files from the app's pages (packages/server serve.ts). */
const FILE = /\.[A-Za-z0-9]+$/;

/**
 * - "page": an app page, from the network first, and from the cache when the network cannot be reached. Online,
 *   the server's sign-in gate still decides.
 * - "file": one of the app's own files, from the cache, else the network.
 * - "pass": left to the browser.
 */
export type Route = "page" | "file" | "pass";

export function routeFor(path: string, mode: RequestMode, files: ReadonlySet<string>): Route {
  if (files.has(path)) return "file";
  if (mode === "navigate" && !NOT_APP.test(path) && !FILE.test(path)) return "page";
  return "pass";
}
