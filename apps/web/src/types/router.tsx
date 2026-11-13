// The public aircraft types pages' routes (docs/31-ui.md, "Aircraft types"): the app's own types pages at the app's
// own addresses, so a link to one opens the same page signed in or not. Links to the app's other pages are plain text
// here (lib/link.tsx).

import { createRootRoute, createRoute, createRouter } from "@tanstack/react-router";
import type { LinkScope } from "../lib/link.tsx";
import { Types } from "../pages/Types.tsx";
import { TypePage } from "../pages/TypePage.tsx";
import { TypeCompare } from "../pages/TypeCompare.tsx";
import { NotFound } from "../pages/NotFound.tsx";
import { TypesShell } from "./Shell.tsx";

/** The pages shown here: the types pages, nothing from the app. */
export const typesScope: LinkScope = (to) => to === "/types" || to.startsWith("/types/");

export function typesRouter() {
  const root = createRootRoute({ component: TypesShell, notFoundComponent: () => <NotFound /> });
  const list = createRoute({ getParentRoute: () => root, path: "/types", component: Types });
  const one = createRoute({ getParentRoute: () => root, path: "/types/$code", component: TypePage });
  // As the app's route, which the page reads its two types from.
  const compare = createRoute({
    getParentRoute: () => root,
    path: "/types/compare",
    component: TypeCompare,
    validateSearch: (s: Record<string, unknown>): { a?: string; b?: string } => ({ ...(typeof s.a === "string" ? { a: s.a } : {}), ...(typeof s.b === "string" ? { b: s.b } : {}) }),
  });
  return createRouter({ routeTree: root.addChildren([list, compare, one]), defaultPreload: false, scrollRestoration: true });
}
