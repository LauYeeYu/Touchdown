// The browser's title for a page (its tab, its history). The types pages each have their own, the one the server gives
// the address when it serves it (packages/server/src/types.ts); every other page has the app's name. A page that sets its
// own puts the app's name back when it is left, so the title never stays a page's after it.

import { useEffect } from "react";

/** The app's name: the title of a page without one of its own, as in index.html. */
export const APP_TITLE = "Touchdown";

/** The page's own title in the browser while it shows, or the app's name for null. */
export function usePageTitle(title: string | null): void {
  useEffect(() => {
    document.title = title ?? APP_TITLE;
    return () => {
      document.title = APP_TITLE;
    };
  }, [title]);
}
