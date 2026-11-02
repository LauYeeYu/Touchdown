// The service worker (docs/30, "Offline"): it keeps the app's own files, so the app opens without a network. The log
// is not here: it is in the browser's database, and sync sends what changed once the network returns. Built on its
// own as a plain script (vite.sw.config.ts), which fills in the build's files and version.

import { CACHE_PREFIX, routeFor, SHELL } from "./policy.ts";

/** The app's files, as addresses from the site's root, and a version made from their contents. */
declare const __OFFLINE_FILES__: string[];
declare const __OFFLINE_VERSION__: string;

// The worker's own events, which the DOM's types do not have.
interface WaitEvent extends Event {
  waitUntil(work: Promise<unknown>): void;
}
interface RequestEvent extends WaitEvent {
  readonly request: Request;
  respondWith(answer: Promise<Response>): void;
}
interface WorkerScope {
  addEventListener(type: "install" | "activate", listener: (e: WaitEvent) => void): void;
  addEventListener(type: "fetch", listener: (e: RequestEvent) => void): void;
  skipWaiting(): Promise<void>;
  readonly clients: { claim(): Promise<void> };
  readonly location: Location;
}

const scope = self as unknown as WorkerScope;
const CACHE = `${CACHE_PREFIX}${__OFFLINE_VERSION__}`;
const FILES = new Set(__OFFLINE_FILES__);

// Every file is fetched again with the session, as the gate asks. One that does not come back whole (signed out
// meanwhile, or a redirect to the sign-in page) stops the install, and the worker before this one stays.
scope.addEventListener("install", (e) =>
  e.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      try {
        await Promise.all(
          [...FILES].map(async (path) => {
            const res = await fetch(new Request(path, { cache: "no-cache", redirect: "error", credentials: "same-origin" }));
            if (!res.ok) throw new Error(`${path} answered ${res.status}.`);
            await cache.put(path, res);
          }),
        );
      } catch (err) {
        await caches.delete(CACHE);
        throw err;
      }
      // A new version takes over at once, so a page opened offline is never older than one opened online.
      await scope.skipWaiting();
    })(),
  ),
);

scope.addEventListener("activate", (e) =>
  e.waitUntil(
    (async () => {
      for (const name of await caches.keys()) if (name.startsWith(CACHE_PREFIX) && name !== CACHE) await caches.delete(name);
      await scope.clients.claim();
    })(),
  ),
);

scope.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== scope.location.origin) return;
  const route = routeFor(url.pathname, req.mode, FILES);
  if (route === "page") {
    e.respondWith(fetch(req).catch(async () => (await caches.match(SHELL, { cacheName: CACHE })) ?? Response.error()));
  } else if (route === "file") {
    // Stylesheets carry the build's stamp (`?v=…`), which the cache does not need.
    e.respondWith(caches.match(req, { cacheName: CACHE, ignoreSearch: true }).then((hit) => hit ?? fetch(req)));
  }
});
