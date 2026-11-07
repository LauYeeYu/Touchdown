// Messages with parts in them (docs/31-ui.md, "Language"): `t()` from @touchdown/i18n gives plain text, `tx()` gives
// React parts, for a message with a tag (<b>, <link>) or an argument that is an element.
//
//   tx("shell.emptyLog.guide", {}, { link: (text) => <Link to="/guide">{text}</Link> })
//   tx("shell.emptyLog.synced", { name: <b>{c.name}</b> })

import { cloneElement, createElement, Fragment, isValidElement, type ReactNode } from "react";
import { LOCALES, locale, matchLocale, rich, setDateStyle, setLocale, type Locale, type MessageKey, type Params } from "@touchdown/i18n";

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

// The log's language and date format as this browser last saw them, for the pages drawn before the log is open.
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
 * Choose the interface's language and date format before the first page is drawn: those the log chose, as this
 * browser last saw them, else the best of the browser's languages and its own way of writing dates. Sets the page's
 * `lang`. Once the log is open, `followLog` puts the log's own choice in place.
 */
export async function startLanguage(): Promise<void> {
  const saved = read(SAVED_LANGUAGE);
  const wanted = saved && saved in LOCALES ? (saved as Locale) : matchLocale(navigator.languages ?? [navigator.language]);
  if (wanted !== locale()) await setLocale(wanted);
  setDateStyle(read(SAVED_DATES) ?? "language");
  document.documentElement.lang = locale();
}

/** The log's language and date format (`settings`). Empty: this browser's languages, the language's own way. */
export interface LanguageChoice {
  language: string | null;
  dateFormat: string | null;
}

/**
 * Follow the language and date format chosen in the log, for every device (docs/31-ui.md, "Language"), and keep them
 * in this browser for the pages drawn before the log is open: the loading screen and the sign-in pages. With `now`,
 * before the first page is drawn, the language changes too. Later, a language chosen on another device waits for the
 * next load, since changing it redraws every word. The date format changes at once: pages drawn after use it.
 */
export async function followLog(choice: LanguageChoice, now = false): Promise<void> {
  const chosen = choice.language && choice.language in LOCALES ? (choice.language as Locale) : null;
  keep(SAVED_LANGUAGE, chosen);
  keep(SAVED_DATES, choice.dateFormat);
  if (now) {
    const wanted = chosen ?? matchLocale(navigator.languages ?? [navigator.language]);
    if (wanted !== locale()) await setLocale(wanted);
    document.documentElement.lang = locale();
  }
  setDateStyle(choice.dateFormat ?? "language");
}

function keep(key: string, value: string | null) {
  try {
    if (value) localStorage.setItem(key, value);
    else localStorage.removeItem(key);
  } catch {
    // Storage blocked: the log's choice still applies, once the log is open.
  }
}

/** The text of rendered parts: strings, and the children of elements (a figure, a link). */
function textOf(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (isValidElement(node)) return textOf((node.props as { children?: ReactNode }).children);
  return "";
}

/** The parts without the full stop that ends them, and whether there was one. */
function dropStop(node: ReactNode): [ReactNode, boolean] {
  if (typeof node === "string") return /。\s*$/.test(node) ? [node.replace(/。(\s*)$/, "$1"), true] : [node, false];
  if (Array.isArray(node)) {
    for (let i = node.length - 1; i >= 0; i--) {
      const [part, done] = dropStop(node[i] as ReactNode);
      if (done) return [[...node.slice(0, i), part, ...node.slice(i + 1)], true];
      if (textOf(node[i] as ReactNode).trim()) break;
    }
    return [node, false];
  }
  if (isValidElement(node)) {
    const children = (node.props as { children?: ReactNode }).children;
    const [part, done] = dropStop(children);
    return done ? [cloneElement(node, undefined, ...(Array.isArray(part) ? part : [part])), true] : [node, false];
  }
  return [node, false];
}

/**
 * A page's summary, shown as its heading. Chinese ends a heading of one sentence without its full stop (。), as a
 * headline does, and keeps the stops of a summary of several sentences, as in running text.
 */
export function headline(node: ReactNode): ReactNode {
  if (!locale().startsWith("zh")) return node;
  const stops = textOf(node).match(/[。！？]/g)?.length ?? 0;
  return stops === 1 ? dropStop(node)[0] : node;
}
