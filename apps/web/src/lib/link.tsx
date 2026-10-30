// Links between the app's pages, which the share page shows too (docs/32-modes-and-sharing.md, "The public page"). A
// link shows only some pages: one flight, or an aircraft with its flights. A link to a page outside it is plain text,
// so a visitor is never sent to a page the link does not show.

import { createContext, useContext, type ReactNode } from "react";
import { Link as RouterLink } from "@tanstack/react-router";

/** Whether a page is part of what is shown: its route ("/flights/$id") and its parameters. */
export type LinkScope = (to: string, params: Record<string, string> | undefined) => boolean;

export const LinkScopeContext = createContext<LinkScope | null>(null);

/** Whether the page a link or a click leads to is shown here. Everything is, in the app. */
export function useReachable(): LinkScope {
  const scope = useContext(LinkScopeContext);
  return scope ?? (() => true);
}

function ScopedLink(props: { to?: string; params?: unknown; className?: string; children?: ReactNode }) {
  const scope = useContext(LinkScopeContext);
  if (scope && !scope(String(props.to ?? ""), props.params as Record<string, string> | undefined)) {
    const children = typeof props.children === "function" ? null : props.children;
    return <span className={props.className ? `${props.className} is-unlinked` : "is-unlinked"}>{children}</span>;
  }
  return <RouterLink {...(props as Parameters<typeof RouterLink>[0])} />;
}

export const Link = ScopedLink as unknown as typeof RouterLink;
