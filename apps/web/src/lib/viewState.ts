// How a page was left: its filters, search, sort, tab and page number (docs/31-ui.md, "Going back"). Kept per
// browser history entry, so Back shows the page as it was, while opening the page afresh from the navigation
// starts clean. Kept in session storage, so a reload keeps it too; it never leaves the browser.

import { useCallback, useReducer } from "react";
import { useRouterState } from "@tanstack/react-router";

const STORAGE_KEY = "touchdown.view";
const MAX_VALUES = 500;

let values: Map<string, unknown> | null = null;

function all(): Map<string, unknown> {
  if (values) return values;
  values = new Map();
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (raw) for (const [k, v] of Object.entries(JSON.parse(raw) as Record<string, unknown>)) values.set(k, v);
  } catch {
    // No session storage: the values last until the tab closes or reloads.
  }
  return values;
}

function save() {
  const m = all();
  // Oldest first: drop the values of long-gone history entries.
  while (m.size > MAX_VALUES) m.delete(m.keys().next().value!);
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(Object.fromEntries(m)));
  } catch {
    // Storage full or blocked: Back still works until the tab reloads.
  }
}

/**
 * Like useState, but kept with the current history entry. Values must survive JSON (no Sets or Maps). With `choices`,
 * a kept value that is none of them gives `initial`: one kept before a tab or a chip was renamed or removed, which a
 * reload of that entry would otherwise show as no tab chosen and nothing under it.
 */
export function useViewState<T>(name: string, initial: T, choices?: readonly T[]): [T, (v: T | ((prev: T) => T)) => void] {
  const entry = useRouterState({ select: (s) => s.location.state.__TSR_key ?? s.location.href });
  const key = `${entry}|${name}`;
  const [, rerender] = useReducer((n: number) => n + 1, 0);
  const m = all();
  const kept = () => (m.has(key) && (!choices || choices.includes(m.get(key) as T)) ? (m.get(key) as T) : initial);
  const value = kept();
  const set = useCallback(
    (v: T | ((prev: T) => T)) => {
      const prev = kept();
      const next = typeof v === "function" ? (v as (p: T) => T)(prev) : v;
      m.delete(key);
      m.set(key, next);
      save();
      rerender();
    },
    // `initial` and `choices` are constants at every call site.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [key],
  );
  return [value, set];
}
