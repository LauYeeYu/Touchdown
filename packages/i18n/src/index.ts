// The interface's words (G12, docs/31-ui.md, "Language"). Every sentence, label and unit the web app, the share page,
// the sign-in pages, the CLI and the server show is a message in `messages/<language>/`, looked up by key:
//
//   t("flights.title")                         "Flights"
//   t("common.count.flights", { count: 3 })     "3 flights"
//
// The keys and each message's arguments are typed from the UK English files (`npm run messages` writes
// `messages.generated.ts`), so a missing key or argument is a type error. Dates and numbers are formatted for the
// language the messages are in (`locale()`).

import { EN_GB, type Catalog } from "./catalog.ts";
import { formatNodes, parseMessage, type MessageNode } from "./message.ts";
import type { MessageArgs } from "./messages.generated.ts";

export { parseMessage, messageArgs, numberFormat, MessageSyntaxError, type MessageNode } from "./message.ts";
export type { Catalog } from "./catalog.ts";

export const SOURCE_LOCALE = "en-GB";

/**
 * The languages the interface can be shown in, by BCP 47 tag: the name each gives itself, its messages, and the other
 * regional ways its speakers write dates, offered beside its own and ISO 8601 (`dateStyles`).
 */
export const LOCALES = {
  "en-GB": { name: "English (UK)", dates: ["en-US"], load: async (): Promise<Catalog> => EN_GB },
} satisfies Record<string, { name: string; dates: string[]; load: () => Promise<Catalog> }>;

export type Locale = keyof typeof LOCALES;

export type MessageKey = keyof MessageArgs;

type Args<K extends MessageKey> = MessageArgs[K];
type ValueKeys<K extends MessageKey> = Exclude<keyof Args<K>, `<${string}>`>;
type TagNames<K extends MessageKey> = keyof Args<K> extends infer P ? (P extends `<${infer N}>` ? N : never) : never;
type Value<M, Rich> = M extends "number" ? number : M extends "choice" ? string : string | number | Rich;

/** A message's arguments. In rich text (`rich`), an argument may also be a rendered part, such as an element. */
export type Params<K extends MessageKey, Rich = never> = { [P in ValueKeys<K>]: Value<Args<K>[P], Rich> };

/** How a rich message's tags are rendered: `{ b: (text) => <b>{text}</b> }`. */
export type Tags<K extends MessageKey, R> = { [N in TagNames<K>]: (parts: (string | R)[]) => R };

type PlainRest<K extends MessageKey> = [ValueKeys<K>] extends [never] ? [] : [params: Params<K>];
type RichRest<K extends MessageKey, R> = [TagNames<K>] extends [never]
  ? [ValueKeys<K>] extends [never]
    ? []
    : [params: Params<K, R>]
  : [params: Params<K, R>, tags: Tags<K, R>];

/** The source language's messages: the shared ones, and those a program adds for itself (`addMessages`). */
const SOURCE: Catalog = { ...EN_GB };

let current: { locale: Locale; catalog: Catalog } = { locale: SOURCE_LOCALE, catalog: EN_GB };
let dateStyle: DateStyle = "language";
const parsed = new Map<string, MessageNode[]>();
const warned = new Set<string>();

function warn(what: string) {
  if (warned.has(what)) return;
  warned.add(what);
  console.warn(`Messages: ${what}`);
}

/** The language messages, dates and numbers are shown in. */
export function locale(): Locale {
  return current.locale;
}

/** Show the interface in `locale`, from now on. Pages already drawn keep their words, so the web app reloads after. */
export async function setLocale(locale: Locale): Promise<void> {
  const catalog = await LOCALES[locale].load();
  current = { locale, catalog };
  parsed.clear();
  if (!dateStyles().includes(dateStyle)) dateStyle = "language";
}

/**
 * How dates are written, apart from the language (docs/31-ui.md, "Language"): the language's own way, another
 * regional way of the same language (a BCP 47 tag, "en-US" for "Mar 15, 2025"), or ISO 8601 ("2025-03-15"). Month
 * and weekday names stay in the language. Times are 24-hour in every style.
 */
export type DateStyle = "language" | "iso" | (string & {});

/** The date styles the current language offers, its own first. */
export function dateStyles(): DateStyle[] {
  return ["language", ...LOCALES[current.locale].dates, "iso"];
}

export function getDateStyle(): DateStyle {
  return dateStyle;
}

/** Write dates in `style` from now on. A style the language does not offer is its own way. */
export function setDateStyle(style: DateStyle): void {
  dateStyle = dateStyles().includes(style) ? style : "language";
}

/** The locale dates are written in, or "iso". */
export function dateLocale(): string {
  return dateStyle === "language" ? current.locale : dateStyle;
}

/**
 * Add a program's own messages in the source language: the CLI's and the server's (`./cli`, `./server`), which the
 * web pages do not load. A translation of them would be added the same way, by language.
 */
export function addMessages(part: Catalog): void {
  Object.assign(SOURCE, part);
}

/** The best of the interface's languages for a list in order of preference (`navigator.languages`, `LANG`). */
export function matchLocale(requested: readonly string[]): Locale {
  const tags = Object.keys(LOCALES) as Locale[];
  for (const r of requested) {
    const exact = tags.find((t) => t.toLowerCase() === r.toLowerCase());
    if (exact) return exact;
  }
  for (const r of requested) {
    const lang = r.split(/[-_]/)[0]!.toLowerCase();
    const same = tags.find((t) => t.split("-")[0]!.toLowerCase() === lang);
    if (same) return same;
  }
  return SOURCE_LOCALE;
}

function source(key: string): string | undefined {
  const dot = key.indexOf(".");
  if (dot < 0) return undefined;
  const ns = key.slice(0, dot);
  const name = key.slice(dot + 1);
  return current.catalog[ns]?.[name] ?? SOURCE[ns]?.[name];
}

function nodes(key: string): MessageNode[] | null {
  let n = parsed.get(key);
  if (n) return n;
  const text = source(key);
  if (text === undefined) {
    warn(`no message "${key}"`);
    return null;
  }
  try {
    n = parseMessage(text);
  } catch (e) {
    warn(`"${key}" could not be read: ${(e as Error).message}`);
    n = [text];
  }
  parsed.set(key, n);
  return n;
}

function format<R>(key: string, values: Record<string, unknown> | undefined, tags?: Record<string, (parts: (string | R)[]) => R>): (string | R)[] {
  const n = nodes(key);
  if (!n) return [key];
  return formatNodes<R>(n, { locale: current.locale, values: values ?? {}, ...(tags ? { tags } : {}), missing: (name) => warn(`"${key}" has no value for ${name}`) });
}

/** A message as plain text. A tag in it gives its text. */
export function t<K extends MessageKey>(key: K, ...[params]: PlainRest<K>): string {
  return format<never>(key, params as Record<string, unknown> | undefined).join("");
}

/**
 * A message whose key is put together at run time (`labels.cabin.${value}`): not checked by the types, so `has`
 * says first whether it exists, or the caller knows every value has one.
 */
export function tDynamic(key: string, params?: Record<string, unknown>): string {
  return format<never>(key, params).join("");
}

/** Whether a message with this key exists. */
export function has(key: string): key is MessageKey {
  return source(key) !== undefined;
}

/** A message as parts: text, and the caller's own parts for rich arguments and tags. The web app's `tx` renders them. */
export function rich<K extends MessageKey, R>(key: K, ...[params, tags]: RichRest<K, R>): (string | R)[] {
  return format<R>(key, params as Record<string, unknown> | undefined, tags as Record<string, (parts: (string | R)[]) => R> | undefined);
}

/** A list in the language's words: "a, b and c" (conjunction), "a, b or c" (disjunction), "a, b, c" (unit). */
export function list(items: readonly string[], type: "conjunction" | "disjunction" | "unit" = "conjunction"): string {
  return new Intl.ListFormat(current.locale, { style: "long", type }).format(items);
}
