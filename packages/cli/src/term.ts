// Terminal output shared by the commands: colours (off when not a terminal or with NO_COLOR), coloured messages,
// lists, durations, fixed-width cells and word wrapping.

import { locale, rich, t, type MessageKey, type Params, type Tags } from "@touchdown/i18n/cli";

export const colour = !!process.stdout.isTTY && !process.env.NO_COLOR;
const paint = (code: string) => (s: string) => (colour ? `\x1b[${code}m${s}\x1b[0m` : s);
export const bold = paint("1");
export const dim = paint("2");
export const green = paint("32");
export const red = paint("31");
export const yellow = paint("33");

/**
 * A message with its tags painted in the terminal's colours: `tc("cliWrite.backup.wrote", { … }, { green })` for
 * "<green>Wrote</green> a backup …". The colours stay in code; the message marks the words they cover.
 */
export function tc<K extends MessageKey>(key: K, params: Params<K>, tags: { [N in keyof Tags<K, string>]: (s: string) => string }): string {
  const render = Object.fromEntries(Object.entries(tags).map(([name, colourOf]) => [name, (parts: string[]) => (colourOf as (s: string) => string)(parts.join(""))]));
  return (rich as unknown as (key: string, params: unknown, tags: unknown) => string[])(key, params, render).join("");
}

/** Items side by side, in the language's way: "1 flight, 2 sightings". */
export const units = (items: string[]) => new Intl.ListFormat(locale(), { style: "short", type: "unit" }).format(items);

export const duration = (ms: number) => {
  const s = Math.round(ms / 1000);
  return s < 60 ? t("cli.duration.seconds", { s }) : t("cli.duration.minutes", { m: Math.floor(s / 60), s: String(s % 60).padStart(2, "0") });
};

/** Pad or cut to n characters. */
export const fit = (s: string, n: number) => (s.length <= n ? s.padEnd(n) : s.slice(0, n - 1) + "…");

export const wrap = (s: string, n: number): string[] => {
  const lines: string[] = [];
  let line = "";
  for (const word of s.split(/\s+/).filter(Boolean)) {
    if (line && line.length + 1 + word.length > n) {
      lines.push(line);
      line = word;
    } else line = line ? `${line} ${word}` : word;
  }
  return line ? [...lines, line] : lines;
};

/** Columns to wrap text to: the terminal's width within 60–120. */
export const width = () => Math.max(60, Math.min(120, process.stdout.columns ?? 100));

/**
 * Ask for a value without showing it as it is typed: ticket numbers and booking references (docs/34, "Private
 * fields"). Only at a terminal; the question goes to stderr so that stdout stays the command's output.
 */
export function askHidden(question: string): Promise<string> {
  const stdin = process.stdin;
  if (!stdin.isTTY) return Promise.reject(new Error(t("cli.privateNeedsTerminal")));
  return new Promise((resolve) => {
    let value = "";
    const finish = (code?: number) => {
      stdin.off("data", onData);
      stdin.setRawMode(false);
      stdin.pause();
      process.stderr.write("\n");
      if (code !== undefined) process.exit(code);
      resolve(value.trim());
    };
    const onData = (chunk: string) => {
      for (const ch of chunk) {
        if (ch === "\r" || ch === "\n") return finish();
        if (ch === "\u0003") return finish(130);
        if (ch === "\u007f" || ch === "\b") value = value.slice(0, -1);
        else if (ch >= " ") value += ch;
      }
    };
    process.stderr.write(question);
    stdin.setRawMode(true);
    stdin.setEncoding("utf8");
    stdin.resume();
    stdin.on("data", onData);
  });
}
