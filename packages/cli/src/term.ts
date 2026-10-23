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
