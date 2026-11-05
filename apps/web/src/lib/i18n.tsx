// Messages with parts in them (docs/31-ui.md, "Language"): `t()` from @touchdown/i18n gives plain text, `tx()` gives
// React parts, for a message with a tag (<b>, <link>) or an argument that is an element.
//
//   tx("shell.emptyLog.guide", {}, { link: (text) => <Link to="/guide">{text}</Link> })
//   tx("shell.emptyLog.synced", { name: <b>{c.name}</b> })

import { createElement, Fragment, type ReactNode } from "react";
import { getDateStyle, LOCALES, locale, matchLocale, rich, setDateStyle, setLocale, type DateStyle, type Locale, type MessageKey, type Params } from "@touchdown/i18n";

type TagNames<K extends MessageKey> = Parameters<typeof rich<K, ReactNode>>[2] extends infer T ? (T extends Record<string, unknown> ? keyof T : never) : never;
type Rest<K extends MessageKey> = [TagNames<K>] extends [never]
  ? [keyof Params<K, ReactNode>] extends [never]
    ? []
    : [params: Params<K, ReactNode>]
  : [params: Params<K, ReactNode>, tags: { [N in TagNames<K>]: (text: ReactNode) => ReactNode }];

/** A message as React parts. Each tag's renderer gets the tag's parts as one node. */
export function tx<K extends MessageKey>(key: K, ...[params, tags]: Rest<K>): ReactNode {
  const wrapped = tags && Object.fromEntries(Object.entries(tags as Record<string, (text: ReactNode) => ReactNode>).map(([name, render]) => [name, (parts: ReactNode[]) => render(createElement(Fragment, null, ...parts))]));
  const parts = (rich as (key: string, params?: unknown, tags?: unknown) => ReactNode[])(key, params, wrapped);
  return parts.length === 1 && typeof parts[0] === "string" ? parts[0] : createElement(Fragment, null, ...parts);
}

const SAVED_LANGUAGE = "touchdown.language";
const SAVED_DATES = "touchdown.dateFormat";

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null; // Storage blocked: the defaults decide.
  }
}

/**
 * Choose the interface's language and date format before the first page is drawn: those chosen in this browser, else
 * the best of the browser's languages and its own way of writing dates. Sets the page's `lang`.
 */
export async function startLanguage(): Promise<void> {
  const saved = read(SAVED_LANGUAGE);
  const wanted = saved && saved in LOCALES ? (saved as Locale) : matchLocale(navigator.languages ?? [navigator.language]);
  if (wanted !== locale()) await setLocale(wanted);
  setDateStyle(read(SAVED_DATES) ?? "language");
  document.documentElement.lang = locale();
}

/** Keep a date format in this browser and use it from now on. Pages drawn before keep theirs until drawn again. */
export function chooseDateStyle(style: DateStyle): void {
  setDateStyle(style);
  try {
    if (getDateStyle() === "language") localStorage.removeItem(SAVED_DATES);
    else localStorage.setItem(SAVED_DATES, getDateStyle());
  } catch {
    // Storage blocked: the choice lasts until the page is closed.
  }
}
