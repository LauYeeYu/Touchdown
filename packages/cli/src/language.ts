// The CLI's language (docs/34, "Language"): the system's locale, as other command-line tools read it, not a setting of
// Touchdown's. Set before the first message. In Chinese a gap goes between Chinese characters and Latin letters or
// digits: the web pages draw it themselves (CSS text-autospace), a terminal does not.

import { locale, matchLocale, setLocale } from "@touchdown/i18n/cli";

/**
 * The system's languages, best first: LC_ALL, else LC_MESSAGES, else LANG (POSIX), with GNU's LANGUAGE list before it
 * unless the locale is "C" or "POSIX". On Windows, which has none of these, the runtime's own locale. "zh_TW.UTF-8" is
 * read as zh-TW. None of them, or "C", is UK English, the source: elsewhere the runtime's locale comes from the same
 * variables, and without them it is ICU's "en-US-POSIX", which says nothing about a language.
 */
export function systemLocales(env: Record<string, string | undefined> = process.env, platform: string = process.platform): string[] {
  const posix = env.LC_ALL || env.LC_MESSAGES || env.LANG || "";
  const plain = /^(C|POSIX)([._@]|$)/.test(posix);
  const out = [...(env.LANGUAGE && !plain ? env.LANGUAGE.split(":") : []), ...(posix && !plain ? [posix] : [])];
  if (platform === "win32") {
    try {
      out.push(Intl.DateTimeFormat().resolvedOptions().locale);
    } catch {
      // No runtime locale: UK English.
    }
  }
  return out.map((l) => l.split(".")[0]!.split("@")[0]!).filter(Boolean);
}

const HAN = /\p{Script=Han}/u;
const LATIN = /[A-Za-z0-9]/;
const needsGap = (a: string, b: string) => (HAN.test(a) && LATIN.test(b)) || (LATIN.test(a) && HAN.test(b));
// A command or an option after Chinese gets its gap too: "用./touchdown undo", "加上--yes".
const GAPS = /(\p{Script=Han})(?=[A-Za-z0-9]|\.\/|--)|([A-Za-z0-9])(?=\p{Script=Han})/gu;

/**
 * Text with a space between Chinese characters and Latin letters or digits, as a page draws it: "共14个航班" reads
 * "共 14 个航班", and before a command or an option. Terminal colour codes are left as they are, and a gap is found
 * across them.
 */
export function autospace(text: string): string {
  const parts = text.split(/(\x1b\[[0-9;]*m)/);
  // A gap across colour codes goes into the text that is not coloured, as a page would leave it.
  let styled = false;
  let before: { i: number; styled: boolean } | null = null;
  parts.forEach((part, i) => {
    if (!part) return;
    if (part.startsWith("\x1b[")) {
      styled = !/^\x1b\[(0|22|23|24|39|49)?(;(0|22|23|24|39|49))*m$/.test(part);
      return;
    }
    let out = part.replace(GAPS, (_, han: string | undefined, latin: string | undefined) => `${han ?? latin} `);
    if (before) {
      const prev = parts[before.i]!;
      if (needsGap(prev[prev.length - 1]!, out[0]!)) {
        if (before.styled && !styled) out = ` ${out}`;
        else parts[before.i] = `${prev} `;
      }
    }
    parts[i] = out;
    before = { i, styled };
  });
  return parts.join("");
}

/** The interface's language from the system, and in Chinese the gaps added to what is printed for people. */
export async function useSystemLanguage(argv: readonly string[]): Promise<void> {
  await setLocale(matchLocale(systemLocales()));
  // JSON is for programs: its strings are left exactly as made.
  if (!locale().startsWith("zh") || argv.includes("--json")) return;
  for (const stream of [process.stdout, process.stderr]) {
    const write = stream.write.bind(stream) as (chunk: unknown, ...rest: unknown[]) => boolean;
    stream.write = ((chunk: unknown, ...rest: unknown[]) => write(typeof chunk === "string" ? autospace(chunk) : chunk, ...rest)) as typeof stream.write;
  }
}
