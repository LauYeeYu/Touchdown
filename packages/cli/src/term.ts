// Terminal output shared by the commands: colours (off when not a terminal or with NO_COLOR), counts, durations,
// fixed-width cells and word wrapping.

export const colour = !!process.stdout.isTTY && !process.env.NO_COLOR;
const paint = (code: string) => (s: string) => (colour ? `\x1b[${code}m${s}\x1b[0m` : s);
export const bold = paint("1");
export const dim = paint("2");
export const green = paint("32");
export const red = paint("31");
export const yellow = paint("33");

export const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString("en-GB")} ${n === 1 ? one : many}`;

export const duration = (ms: number) => {
  const s = Math.round(ms / 1000);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s`;
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
  if (!stdin.isTTY) return Promise.reject(new Error("A private value can be typed only at a terminal. Give it in the JSON instead."));
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
