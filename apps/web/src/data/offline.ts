// The app's offline copy (docs/30, "Offline"): a service worker that keeps the app's files, so a signed-in browser
// opens the app without a network. Signing out removes it, with the account the app would open offline.

import { CACHE_PREFIX } from "../offline/policy.ts";
import { forgetAccount } from "./account.ts";

/** Keep the app's files for offline use. Only in the built app, and only once signed in, so its files pass the gate. */
export function keepOffline(): void {
  if (import.meta.env.DEV || !("serviceWorker" in navigator)) return;
  // The worker's own file is always asked for again, so a new deployment's worker is found at once.
  void navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" }).catch(() => undefined);
}

/** Remove the offline copy and the account it opens. After this, the app opens only online, after signing in. */
export async function forgetOffline(): Promise<void> {
  forgetAccount();
  try {
    const registrations = (await navigator.serviceWorker?.getRegistrations()) ?? [];
    await Promise.all(registrations.map((r) => r.unregister()));
    const names = (await globalThis.caches?.keys()) ?? [];
    await Promise.all(names.filter((n) => n.startsWith(CACHE_PREFIX)).map((n) => caches.delete(n)));
  } catch {
    // Storage the browser does not allow: there is nothing to remove.
  }
}
