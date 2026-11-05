// Lists text in code files that looks like words for people, not yet a message: JSX text, attributes people read
// (aria-label, title, placeholder, alt, label), and string or template literals that read as a phrase. A guide for
// moving text into messages, not a test: it finds code that only looks like words too.
//
//   npx tsx packages/i18n/scripts/leftovers.ts apps/web/src/pages/Flights.tsx packages/core/src/view

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

function files(path: string, out: string[] = []): string[] {
  if (statSync(path).isDirectory()) {
    for (const name of readdirSync(path)) if (name !== "node_modules" && !name.startsWith(".")) files(join(path, name), out);
  } else if (/\.(ts|tsx)$/.test(path) && !/\.(test|generated)\.ts$/.test(path)) out.push(path);
  return out;
}

const JSX_TEXT = />([^<>{}]*[A-Za-z]{2,}[^<>{}]*)</g;
const ATTRIBUTE = /\b(aria-label|title|placeholder|alt|label|aria-description|aria-roledescription)=(["'])([^"']*[A-Za-z]{2,}[^"']*)\2/g;
// A capital, a word, then a space and another word: "Your log", "Not found". Code rarely reads like that.
const PHRASE = /(["'`])([A-Z][a-z]+[,.]? [^"'`]*?)\1/g;

let found = 0;
for (const arg of process.argv.slice(2)) {
  for (const file of files(arg)) {
    const lines = readFileSync(file, "utf8").split("\n");
    lines.forEach((line, i) => {
      const trimmed = line.trim();
      if (trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*") || /console\.(debug|log)\(/.test(line)) return;
      const hits = new Set<string>();
      for (const re of [JSX_TEXT, ATTRIBUTE, PHRASE]) {
        re.lastIndex = 0;
        for (const m of line.matchAll(re)) {
          const text = (m[3] ?? m[2] ?? m[1] ?? "").trim();
          if (text && !/^[\w-]+\.[\w.-]+$/.test(text)) hits.add(text);
        }
      }
      for (const h of hits) {
        found++;
        console.log(`${file}:${i + 1}: ${h.length > 100 ? `${h.slice(0, 100)}…` : h}`);
      }
    });
  }
}
if (!found) console.log("Nothing found.");
