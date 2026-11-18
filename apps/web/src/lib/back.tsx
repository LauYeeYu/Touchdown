// Which visit each visit was opened from (docs/31-ui.md, "Going back"), so a page's link back to its list goes back to
// the visit of the list it came from, as Back would, and the list shows as it was left (lib/viewState.ts). Kept per
// browser history entry, by its key, in session storage, so a reload keeps it too. It never leaves the browser.

import type { MouseEvent, ReactNode } from "react";
import { useRouter, type RouterHistory } from "@tanstack/react-router";
import { Link } from "./link.tsx";

const STORAGE_KEY = "touchdown.trail";
const MAX_VISITS = 500;

/** A visit: its page's path and the visit it was opened from, if that was in this tab and this app. */
type Visit = { path: string; from?: string };
type Location = RouterHistory["location"];

let visits: Map<string, Visit> | null = null;

function all(): Map<string, Visit> {
  if (visits) return visits;
  visits = new Map();
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (raw) for (const [k, v] of Object.entries(JSON.parse(raw) as Record<string, Visit>)) visits.set(k, v);
  } catch {
    // No session storage: the visits last until the tab closes or reloads.
  }
  return visits;
}

function keep(key: string, visit: Visit) {
  const m = all();
  m.delete(key);
  m.set(key, visit);
  // Oldest first: drop long-gone history entries.
  while (m.size > MAX_VISITS) m.delete(m.keys().next().value!);
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(Object.fromEntries(m)));
  } catch {
    // Storage full or blocked: the links still work until the tab reloads.
  }
}

const keyOf = (l: Location) => l.state.__TSR_key ?? l.state.key;

/** Records each visit of a router's history and the visit it was opened from. Once per router. */
export function keepTrail(history: RouterHistory) {
  let current = history.location;
  const first = keyOf(current);
  if (first && !all().has(first)) keep(first, { path: current.pathname });
  history.subscribe(({ location, action }) => {
    const key = keyOf(location);
    const was = keyOf(current);
    if (key && action.type === "PUSH") keep(key, { path: location.pathname, ...(was ? { from: was } : {}) });
    // In place of the visit it replaces, opened from where that one was.
    else if (key && action.type === "REPLACE") {
      const from = was ? all().get(was)?.from : undefined;
      keep(key, { path: location.pathname, ...(from ? { from } : {}) });
    }
    // Back or forward to a visit from before this page loaded.
    else if (key && !all().has(key)) keep(key, { path: location.pathname });
    current = location;
  });
}

/**
 * How many visits back the list at `list` is, when this visit was opened from it through pages beneath it only (a
 * type's page from its manufacturer's, from the types), else 0: opened from elsewhere, or from before this tab loaded.
 */
export function stepsBackTo(history: RouterHistory, list: string): number {
  const m = all();
  let key = m.get(keyOf(history.location) ?? "")?.from;
  for (let steps = 1; key && steps <= MAX_VISITS; steps++) {
    const visit = m.get(key);
    if (!visit) return 0;
    if (visit.path === list) return steps;
    if (!visit.path.startsWith(`${list}/`)) return 0;
    key = visit.from;
  }
  return 0;
}

/**
 * A page's link back to the page it belongs under (the crumb: a type's to the types, a flight's to the flights, a
 * flight's form to the flight): back to that page's visit it was opened from, as it was left, else that page afresh. A
 * click with a modifier key opens it as a link does.
 */
export function BackLink({ to, params, className, children }: { to: string; params?: Record<string, string>; className?: string; children: ReactNode }) {
  const router = useRouter();
  const onClick = (e: MouseEvent) => {
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const steps = stepsBackTo(router.history, router.buildLocation({ to, params } as never).pathname);
    if (!steps) return;
    e.preventDefault();
    router.history.go(-steps);
  };
  return (
    <Link {...({ to, params } as { to: "/" })} className={className} onClick={onClick}>
      {children}
    </Link>
  );
}
