// The aircraft types pages (docs/31-ui.md, "Aircraft types"): the types pages' one page for every address, the same for
// everyone.

import type { Server } from "./handler.ts";

/**
 * The aircraft types pages' own build (docs/31-ui.md, "Aircraft types"): reference data only, one page the same for
 * everyone. Its script opens the app in its place for a signed-in visitor.
 */
export const TYPES_FILES = "/types-files/";
/** The types pages: the list, Compare, a type by its code, and a manufacturer's types and a family's by its name's slug. */
export const TYPES_PAGES = /^\/types(?:\/compare|\/[A-Za-z0-9]{1,8}|\/(?:manufacturers|families)\/[a-z0-9-]{1,80})?\/?$/;

/** /types and the pages under it, which `TYPES_PAGES` lets through without a session. */
export function typesPage(request: Request, s: Server, url: URL): Promise<Response> {
  return s.assets.fetch(new Request(new URL(`${TYPES_FILES}types.html`, url), { method: request.method, headers: request.headers }));
}
