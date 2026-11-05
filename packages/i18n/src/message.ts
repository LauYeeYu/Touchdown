// The messages' syntax: a subset of ICU MessageFormat, the format translation tools read (docs/31-ui.md, "Language").
//
//   {name}                                    an argument, put in as given
//   {count, number}                           a number, formatted for the language
//   {count, plural, one {# flight} other {# flights}}
//                                             a plural: `=N` cases first, then the language's plural category;
//                                             `#` is the number, formatted for the language
//   {count, selectordinal, one {#st} other {#th}}
//   {kind, select, flight {…} other {…}}      a choice by value
//   <b>text</b>                               a span the caller renders (bold, a link); in plain text, its text
//
// An apostrophe is text, except that '' is one apostrophe, and an apostrophe before {, }, # or < starts quoted text
// that runs to the next single apostrophe ("'{'" is a brace), as in ICU.

export type MessageNode =
  | string
  | { type: "arg"; name: string; number: boolean }
  | { type: "plural"; name: string; ordinal: boolean; options: Record<string, MessageNode[]> }
  | { type: "select"; name: string; options: Record<string, MessageNode[]> }
  | { type: "pound" }
  | { type: "tag"; name: string; children: MessageNode[] };

export class MessageSyntaxError extends Error {}

const PLURAL_KEYS = new Set(["zero", "one", "two", "few", "many", "other"]);
const NAME = /[A-Za-z_][A-Za-z0-9_]*/y;
const TAG_NAME = /[A-Za-z][A-Za-z0-9-]*/y;

/** Parse a message. Throws a MessageSyntaxError naming the place. */
export function parseMessage(source: string): MessageNode[] {
  let i = 0;

  const fail = (what: string): never => {
    throw new MessageSyntaxError(`${what} at ${i} in "${source}"`);
  };
  const space = () => {
    while (i < source.length && /\s/.test(source[i]!)) i++;
  };
  const word = (re: RegExp): string => {
    re.lastIndex = i;
    const m = re.exec(source);
    if (!m) fail("a name was expected");
    i += m![0].length;
    return m![0];
  };
  const expect = (c: string) => {
    if (source[i] !== c) fail(`"${c}" was expected`);
    i++;
  };

  /** Text and parts up to the end, a closing brace, or the closing tag `closing`. */
  function nodes(inPlural: boolean, closing: string | null): MessageNode[] {
    const out: MessageNode[] = [];
    let text = "";
    const flush = () => {
      if (text) out.push(text);
      text = "";
    };
    while (i < source.length) {
      const c = source[i]!;
      if (c === "'") {
        const next = source[i + 1];
        if (next === "'") {
          text += "'";
          i += 2;
        } else if (next === "{" || next === "}" || next === "<" || (next === "#" && inPlural)) {
          i++;
          for (;;) {
            if (i >= source.length) fail("a quote is not closed");
            if (source[i] === "'") {
              if (source[i + 1] === "'") {
                text += "'";
                i += 2;
                continue;
              }
              i++;
              break;
            }
            text += source[i++];
          }
        } else {
          text += c;
          i++;
        }
      } else if (c === "{") {
        flush();
        out.push(argument());
      } else if (c === "}") {
        break;
      } else if (c === "#" && inPlural) {
        flush();
        out.push({ type: "pound" });
        i++;
      } else if (c === "<" && source[i + 1] === "/") {
        if (closing === null) fail("a closing tag has no opening tag");
        break;
      } else if (c === "<" && /[A-Za-z]/.test(source[i + 1] ?? "")) {
        flush();
        i++;
        const name = word(TAG_NAME);
        expect(">");
        const children = nodes(inPlural, name);
        if (!source.startsWith(`</${name}>`, i)) fail(`</${name}> was expected`);
        i += name.length + 3;
        out.push({ type: "tag", name, children });
      } else {
        text += c;
        i++;
      }
    }
    flush();
    return out;
  }

  function options(inPlural: boolean, keys: (k: string) => boolean): Record<string, MessageNode[]> {
    const out: Record<string, MessageNode[]> = {};
    space();
    while (source[i] !== "}") {
      if (i >= source.length) fail("a brace is not closed");
      let key: string;
      if (source[i] === "=") {
        i++;
        key = `=${word(/\d+/y)}`;
      } else key = word(NAME);
      if (!keys(key)) fail(`"${key}" is not a case here`);
      if (key in out) fail(`"${key}" is given twice`);
      space();
      expect("{");
      out[key] = nodes(inPlural, null);
      expect("}");
      space();
    }
    if (!("other" in out)) fail("an other case is required");
    return out;
  }

  function argument(): MessageNode {
    expect("{");
    space();
    const name = word(NAME);
    space();
    if (source[i] === "}") {
      i++;
      return { type: "arg", name, number: false };
    }
    expect(",");
    space();
    const kind = word(NAME);
    space();
    let node: MessageNode;
    if (kind === "number") node = { type: "arg", name, number: true };
    else if (kind === "plural" || kind === "selectordinal") {
      expect(",");
      node = { type: "plural", name, ordinal: kind === "selectordinal", options: options(true, (k) => k.startsWith("=") || PLURAL_KEYS.has(k)) };
    } else if (kind === "select") {
      expect(",");
      node = { type: "select", name, options: options(false, (k) => !k.startsWith("=")) };
    } else return fail(`"${kind}" is not an argument type`);
    space();
    expect("}");
    return node;
  }

  const out = nodes(false, null);
  if (i < source.length) fail(source[i] === "}" ? "a brace is not opened" : "unexpected text");
  return out;
}

/** What a message takes: "number" for a plural or a number, "choice" for a select, "text" otherwise, and its tags. */
export function messageArgs(nodes: MessageNode[], into = new Map<string, "number" | "choice" | "text" | "tag">()): Map<string, "number" | "choice" | "text" | "tag"> {
  const set = (name: string, kind: "number" | "choice" | "text" | "tag") => {
    const had = into.get(name);
    // A number used as text is still a number.
    if (!had || had === "text") into.set(name, kind);
  };
  for (const n of nodes) {
    if (typeof n === "string" || n.type === "pound") continue;
    if (n.type === "arg") set(n.name, n.number ? "number" : "text");
    else if (n.type === "tag") {
      set(`<${n.name}>`, "tag");
      messageArgs(n.children, into);
    } else {
      set(n.name, n.type === "plural" ? "number" : "choice");
      for (const o of Object.values(n.options)) messageArgs(o, into);
    }
  }
  return into;
}

export interface FormatContext<R> {
  locale: string;
  values: Record<string, unknown>;
  /** Renders a tag's parts. Without one, a tag gives its parts as they are. */
  tags?: Record<string, (parts: (string | R)[]) => R>;
  missing: (name: string) => void;
}

const numberFormats = new Map<string, Intl.NumberFormat>();
const pluralRules = new Map<string, Intl.PluralRules>();

export function numberFormat(locale: string): Intl.NumberFormat {
  let f = numberFormats.get(locale);
  if (!f) numberFormats.set(locale, (f = new Intl.NumberFormat(locale)));
  return f;
}

function pluralRule(locale: string, ordinal: boolean): Intl.PluralRules {
  const key = `${locale}|${ordinal}`;
  let r = pluralRules.get(key);
  if (!r) pluralRules.set(key, (r = new Intl.PluralRules(locale, { type: ordinal ? "ordinal" : "cardinal" })));
  return r;
}

/**
 * Format parsed nodes. Strings next to each other are joined, so a message with no tags and no rich values gives
 * one string.
 */
export function formatNodes<R>(nodes: MessageNode[], ctx: FormatContext<R>, pound: number | null = null): (string | R)[] {
  const out: (string | R)[] = [];
  const push = (v: string | R) => {
    if (typeof v === "string" && typeof out[out.length - 1] === "string") out[out.length - 1] += v;
    else if (v !== "") out.push(v);
  };
  for (const n of nodes) {
    if (typeof n === "string") push(n);
    else if (n.type === "pound") push(pound === null ? "#" : numberFormat(ctx.locale).format(pound));
    else if (n.type === "arg") {
      if (!(n.name in ctx.values)) {
        ctx.missing(n.name);
        push(`{${n.name}}`);
        continue;
      }
      const v = ctx.values[n.name];
      if (n.number && typeof v === "number") push(numberFormat(ctx.locale).format(v));
      else if (typeof v === "string" || typeof v === "number" || typeof v === "bigint") push(String(v));
      else if (v === null || v === undefined || typeof v === "boolean") push("");
      else push(v as R);
    } else if (n.type === "tag") {
      const parts = formatNodes(n.children, ctx, pound);
      const render = ctx.tags?.[n.name];
      if (render) push(render(parts));
      else for (const p of parts) push(p);
    } else if (n.type === "plural") {
      const v = ctx.values[n.name];
      if (typeof v !== "number") {
        ctx.missing(n.name);
        for (const p of formatNodes(n.options.other!, ctx, pound)) push(p);
        continue;
      }
      const branch = n.options[`=${v}`] ?? n.options[pluralRule(ctx.locale, n.ordinal).select(v)] ?? n.options.other!;
      for (const p of formatNodes(branch, ctx, v)) push(p);
    } else {
      const v = ctx.values[n.name];
      if (!(n.name in ctx.values)) ctx.missing(n.name);
      const branch = n.options[String(v)] ?? n.options.other!;
      for (const p of formatNodes(branch, ctx, pound)) push(p);
    }
  }
  return out;
}
