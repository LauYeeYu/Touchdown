// The message files: the generated types are current, every file is loaded, translations match the source, every
// key is used, and the copy keeps the writing rules (AGENTS.md, "Writing rules").

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { formatSource, generate, GENERATED, readSource, SOURCE_DIR } from "../scripts/messages.ts";
import { EN_GB } from "./catalog.ts";
import { CLI_MESSAGES } from "./cli.ts";
import { SERVER_MESSAGES } from "./server.ts";
import { messageArgs, parseMessage } from "./message.ts";

const REPO = join(SOURCE_DIR, "..", "..", "..", "..");
const MESSAGES = join(SOURCE_DIR, "..");
const source = readSource();

/** Every message in a file set, as "ns.key" → text. */
function flat(files: Map<string, Record<string, string>>): Map<string, string> {
  const out = new Map<string, string>();
  for (const [ns, m] of files) for (const [k, v] of Object.entries(m)) out.set(`${ns}.${k}`, v);
  return out;
}

function codeFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === "dist" || name.startsWith(".")) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) codeFiles(p, out);
    // A key only a test uses is unused.
    else if (/\.(ts|tsx)$/.test(name) && !/\.(generated|test)\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}

describe("message files", () => {
  it("have current generated types (npm run messages)", () => {
    expect(readFileSync(GENERATED, "utf8")).toBe(generate(source));
  });

  it("are formatted, invisible characters escaped (npm run messages)", () => {
    for (const [ns, messages] of source) expect(readFileSync(join(SOURCE_DIR, `${ns}.json`), "utf8"), ns).toBe(formatSource(messages));
  });

  it("are all loaded, the CLI's and the server's by their own programs only", () => {
    const parts = { "packages/cli/src": Object.keys(CLI_MESSAGES), "packages/server/src": Object.keys(SERVER_MESSAGES) };
    expect([...Object.keys(EN_GB), ...Object.values(parts).flat()].sort()).toEqual([...source.keys()].sort());
    for (const [dir, names] of Object.entries(parts)) {
      const entry = dir === "packages/cli/src" ? "@touchdown/i18n/cli" : "@touchdown/i18n/server";
      for (const file of [join(REPO, "apps"), join(REPO, "packages")].flatMap((d) => codeFiles(d))) {
        const text = readFileSync(file, "utf8");
        const inside = relative(REPO, file).startsWith(dir);
        // Inside the program, messages come through its entry, which adds them. Outside, its messages are not used.
        if (inside) expect(text.includes('from "@touchdown/i18n";'), `${relative(REPO, file)} imports @touchdown/i18n, not ${entry}`).toBe(false);
        else if (!relative(REPO, file).startsWith("packages/i18n/")) for (const ns of names) expect(new RegExp(`["'\`]${ns}\\.`).test(text), `${relative(REPO, file)} uses ${ns}.*`).toBe(false);
      }
    }
  });

  it("use keys of letters, digits, dots, hyphens and underscores", () => {
    for (const key of flat(source).keys()) expect(key).toMatch(/^[a-z][A-Za-z0-9]*(\.[A-Za-z0-9_-]+)+$/);
  });

  it("are matched by every translation, argument for argument", () => {
    const src = flat(source);
    for (const tag of readdirSync(MESSAGES).filter((d) => d !== "en-GB" && statSync(join(MESSAGES, d)).isDirectory())) {
      const files = readSource(join(MESSAGES, tag));
      expect([...files.keys()].every((ns) => source.has(ns)), `${tag}: a file the source does not have`).toBe(true);
      for (const [key, text] of flat(files)) {
        const original = src.get(key);
        expect(original, `${tag}: ${key} is not in the source`).toBeDefined();
        const args = [...messageArgs(parseMessage(text)).keys()].sort();
        expect(args, `${tag}: ${key}`).toEqual([...messageArgs(parseMessage(original!)).keys()].sort());
      }
    }
  });

  it("are all used", () => {
    const code = [join(REPO, "apps"), join(REPO, "packages")].flatMap((d) => codeFiles(d)).map((f) => readFileSync(f, "utf8"));
    const text = code.join("\n");
    // A key put together at run time, `labels.cabin.${value}`, uses every key under its prefix.
    const prefixes = [...text.matchAll(/`([a-z][A-Za-z0-9]*\.[A-Za-z0-9_.-]*)\$\{/g)].map((m) => m[1]!);
    const unused = [...flat(source).keys()].filter((key) => !text.includes(`"${key}"`) && !text.includes(`'${key}'`) && !text.includes(`\`${key}\``) && !prefixes.some((p) => key.startsWith(p)));
    expect(unused, `unused in ${relative(REPO, MESSAGES)}`).toEqual([]);
  });

  it("keep the writing rules: no semicolons, no question-word openers but for questions", () => {
    const opener = /^(What|Who|Whose|Where|When|Why|Which|How)\b/;
    for (const [key, text] of flat(source)) {
      const sentences = text.split(/(?<=[.!?])\s+|[{}]/).map((s) => s.trim());
      expect(text.includes(";") && !key.startsWith("cli"), `${key}: a semicolon`).toBe(false);
      for (const s of sentences) if (opener.test(s)) expect(s.trimEnd().endsWith("?"), `${key}: "${s}" opens with a question word`).toBe(true);
    }
  });
});
