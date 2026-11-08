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

/** A translation's files, written into `translations/` by `npm run messages`, as a catalog. */
const translation = async (module: Promise<{ default: Catalog }>): Promise<Catalog> => (await module).default;

/**
 * The languages the interface can be shown in, by BCP 47 tag: the name each gives itself, its messages, and the other
 * regional ways its speakers write dates, offered beside its own and ISO 8601 (`dateStyles`). A translation is loaded
 * only when it is chosen. A message it lacks is shown in UK English: en-US has only the messages spelt differently.
 * The CLI's and the server's own files are added by those programs (`addTranslations`).
 */
export const LOCALES = {
  "en-GB": { name: "English (UK)", dates: ["en-US"], load: async (): Promise<Catalog> => EN_GB },
  "en-US": { name: "English (US)", dates: ["en-GB"], load: () => translation(import("./translations/en-US.generated.ts")) },
  "de-DE": { name: "Deutsch", dates: [], load: () => translation(import("./translations/de-DE.generated.ts")) },
  "zh-CN": { name: "简体中文", dates: [], load: () => translation(import("./translations/zh-CN.generated.ts")) },
  "zh-TW": { name: "繁體中文", dates: [], load: () => translation(import("./translations/zh-TW.generated.ts")) },
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
let parsed = new Map<string, MessageNode[]>();
/** A program's own files in each language (`addTranslations`): the CLI's and the server's. */
const programs: Partial<Record<Locale, () => Promise<Catalog>>>[] = [];
/**
 * For a program answering many people at once (the server): every language loaded, and the language of the request
 * being answered (`useRequestLocale`). Unset, messages are in the language set with `setLocale`.
 */
let requestLocale: (() => Locale | undefined) | null = null;
const loaded = new Map<Locale, { catalog: Catalog; parsed: Map<string, MessageNode[]> }>();

/** The language, its messages and their parsed forms, for the message being made now. */
function now(): { locale: Locale; catalog: Catalog; parsed: Map<string, MessageNode[]> } {
  const asked = requestLocale?.();
  const other = asked && asked !== current.locale ? loaded.get(asked) : undefined;
  return other ? { locale: asked!, ...other } : { ...current, parsed };
}

/** A language's messages: the shared files, and those of the program running (`addTranslations`). */
async function catalogFor(locale: Locale): Promise<Catalog> {
  const parts = await Promise.all([LOCALES[locale].load(), ...programs.map((p) => p[locale]?.() ?? Promise.resolve({}))]);
  return Object.assign({}, ...parts) as Catalog;
}
/** The source language's parsed messages, kept apart for `inSourceLanguage`. */
const parsedSource = new Map<string, MessageNode[]>();
const warned = new Set<string>();

function warn(what: string) {
  if (warned.has(what)) return;
  warned.add(what);
  console.warn(`Messages: ${what}`);
}

/** The language messages, dates and numbers are shown in. */
export function locale(): Locale {
  return now().locale;
}

/** Show the interface in `locale`, from now on. Pages already drawn keep their words, so the web app reloads after. */
export async function setLocale(locale: Locale): Promise<void> {
  const catalog = await catalogFor(locale);
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
  return ["language", ...LOCALES[now().locale].dates, "iso"];
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
  return dateStyle === "language" || requestLocale ? now().locale : dateStyle;
}

/**
 * Add a program's own messages in the source language: the CLI's and the server's (`./cli`, `./server`), which the
 * web pages do not load. Their translations are added with `addTranslations`.
 */
export function addMessages(part: Catalog): void {
  Object.assign(SOURCE, part);
}

/** Add a program's own messages in other languages, each loaded when its language is chosen. */
export function addTranslations(part: Partial<Record<Locale, () => Promise<Catalog>>>): void {
  programs.push(part);
}

/**
 * Load every language, then make each message in the language `which` gives for the request being answered (the
 * server keeps it per request, in its async context), else in the one set with `setLocale`.
 */
export async function useRequestLocale(which: () => Locale | undefined): Promise<void> {
  for (const l of Object.keys(LOCALES) as Locale[]) if (!loaded.has(l)) loaded.set(l, { catalog: await catalogFor(l), parsed: new Map() });
  requestLocale = which;
}

/**
 * The best of the interface's languages for an Accept-Language header ("de-CH,de;q=0.9,en;q=0.8"), in its order of
 * preference. With none of them, UK English.
 */
export function localeOfHeader(header: string | null | undefined): Locale {
  const asked = (header ?? "")
    .split(",")
    .map((part, i) => {
      const [tag, ...params] = part.trim().split(";");
      const q = Number(params.find((p) => p.trim().startsWith("q="))?.trim().slice(2) ?? 1);
      return { tag: tag!.trim(), q: Number.isFinite(q) ? q : 0, i };
    })
    .filter((x) => x.tag && x.tag !== "*" && x.q > 0)
    .sort((a, b) => b.q - a.q || a.i - b.i);
  return matchLocale(asked.map((x) => x.tag));
}

/**
 * Run `make` with messages, dates and numbers in UK English, whatever the interface's language, and go back after. For
 * what is written for a program rather than shown, such as the agent check's request, whose instructions are in
 * English (docs/22). The log itself holds values and codes, not words, so it reads the same in every language.
 */
export function inSourceLanguage<T>(make: () => T): T {
  const was = { current, dateStyle, parsed, requestLocale };
  current = { locale: SOURCE_LOCALE, catalog: EN_GB };
  dateStyle = "language";
  parsed = parsedSource;
  requestLocale = null;
  try {
    return make();
  } finally {
    ({ current, dateStyle, parsed, requestLocale } = was);
  }
}

/**
 * The best of the interface's languages for a list in order of preference (`navigator.languages`): the first one
 * asked for that the interface has in some form. Within a language, the same region and script, then the same script
 * (Chinese of Hong Kong is written in Traditional characters, so it gets zh-TW), then the first listed (en-AU gets
 * en-GB). With none of them, UK English.
 */
export function matchLocale(requested: readonly string[]): Locale {
  const ours = (Object.keys(LOCALES) as Locale[]).map((tag) => ({ tag, full: new Intl.Locale(tag).maximize() }));
  for (const r of requested) {
    let want: Intl.Locale;
    try {
      want = new Intl.Locale(r.replace(/_/g, "-")).maximize();
    } catch {
      continue; // Not a language tag ("C", "POSIX").
    }
    const same = ours.filter((o) => o.full.language === want.language);
    const pick = same.find((o) => o.full.script === want.script && o.full.region === want.region) ?? same.find((o) => o.full.script === want.script) ?? same[0];
    if (pick) return pick.tag;
  }
  return SOURCE_LOCALE;
}

/**
 * What goes between two sentences shown one after the other: a space, or nothing in Chinese, whose full stop (。) is
 * as wide as a character and leaves its own room.
 */
export function sentenceGap(): string {
  return now().locale.startsWith("zh") ? "" : " ";
}

/**
 * What goes between two words or values the code sets side by side (a date and its weekday): a space, or nothing in
 * Chinese, where the page draws its own narrow gap between Chinese and Latin letters (CSS text-autospace).
 */
export function wordGap(): string {
  return now().locale.startsWith("zh") ? "" : " ";
}

/**
 * A label as it reads inside a sentence. English lower-cases its first letter ("Flight number" in "Set the flight
 * number"), unless the label opens with a code or a name in capitals ("ICAO code"). German keeps the capitals of its
 * nouns, and Chinese has none.
 */
export function inSentence(label: string): string {
  return now().locale.startsWith("en") && /^\p{Lu}\p{Ll}/u.test(label) ? label.charAt(0).toLowerCase() + label.slice(1) : label;
}

function source(key: string, catalog = now().catalog): string | undefined {
  const dot = key.indexOf(".");
  if (dot < 0) return undefined;
  const ns = key.slice(0, dot);
  const name = key.slice(dot + 1);
  return catalog[ns]?.[name] ?? SOURCE[ns]?.[name];
}

function nodes(key: string): MessageNode[] | null {
  const { catalog, parsed } = now();
  let n = parsed.get(key);
  if (n) return n;
  const text = source(key, catalog);
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
  return formatNodes<R>(n, { locale: now().locale, values: values ?? {}, ...(tags ? { tags } : {}), missing: (name) => warn(`"${key}" has no value for ${name}`) });
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

/** Values set side by side with no "and": "a, b, c", in Chinese "a、b、c". */
export function series(items: readonly string[]): string {
  return items.join(now().locale.startsWith("zh") ? "、" : ", ");
}

/** A label before its value in a line: "Airline: Lufthansa", in Chinese "航空公司：汉莎航空". */
export function labelled(label: string, value: string): string {
  return now().locale.startsWith("zh") ? `${label}：${value}` : `${label}: ${value}`;
}

/** A list in the language's words: "a, b and c" (conjunction), "a, b or c" (disjunction), "a, b, c" (unit). */
export function list(items: readonly string[], type: "conjunction" | "disjunction" | "unit" = "conjunction"): string {
  return new Intl.ListFormat(now().locale, { style: "long", type }).format(items);
}
