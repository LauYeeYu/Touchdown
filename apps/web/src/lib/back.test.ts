import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import type { RouterHistory } from "@tanstack/react-router";
import { keepTrail, stepsBackTo } from "./back.tsx";

/** A history as the router's, moved by hand: each visit a new key. */
function fakeHistory(first: string) {
  let n = 0;
  const visit = (pathname: string) => ({ pathname, state: { __TSR_key: `k${++n}-${Math.random()}`, __TSR_index: 0 } });
  const stack = [visit(first)];
  let at = 0;
  const subscribers: ((a: { location: unknown; action: { type: string } }) => void)[] = [];
  const history = {
    get location() {
      return stack[at]!;
    },
    subscribe: (cb: (typeof subscribers)[number]) => {
      subscribers.push(cb);
      return () => {};
    },
  } as unknown as RouterHistory;
  const tell = (type: string) => subscribers.forEach((cb) => cb({ location: stack[at], action: { type } }));
  return {
    history,
    push(path: string) {
      stack.splice(at + 1, Infinity, visit(path));
      at++;
      tell("PUSH");
    },
    replace(path: string) {
      stack[at] = visit(path);
      tell("REPLACE");
    },
    back() {
      at--;
      tell("BACK");
    },
  };
}

describe("a page's link back to its list", () => {
  it("goes back to the list's visit through the pages beneath it", () => {
    const h = fakeHistory("/types");
    keepTrail(h.history);
    h.push("/types/manufacturers/airbus");
    h.push("/types/A320");
    expect(stepsBackTo(h.history, "/types")).toBe(2);
    h.replace("/types/A321");
    expect(stepsBackTo(h.history, "/types")).toBe(2);
    h.back();
    expect(stepsBackTo(h.history, "/types")).toBe(1);
  });

  it("opens the list afresh when the page was opened from elsewhere", () => {
    const h = fakeHistory("/types");
    keepTrail(h.history);
    h.push("/aircraft/a1");
    h.push("/types/A320");
    expect(stepsBackTo(h.history, "/types")).toBe(0);
    const fresh = fakeHistory("/types/B738");
    keepTrail(fresh.history);
    expect(stepsBackTo(fresh.history, "/types")).toBe(0);
  });
});

/** The web app's components, as source. */
function sources(dir = join(import.meta.dirname, "..")): { file: string; text: string }[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const path = join(dir, e.name);
    if (e.isDirectory()) return sources(path);
    return e.name.endsWith(".tsx") ? [{ file: relative(join(import.meta.dirname, ".."), path), text: readFileSync(path, "utf8") }] : [];
  });
}

describe("going back (docs/31, \"Going back\"), in the source", () => {
  it("links a crumb back with BackLink, so the list comes back as it was left", () => {
    const plain = sources().flatMap(({ file, text }) =>
      [...text.matchAll(/<nav className="crumbs"[\s\S]*?<\/nav>/g)].filter((m) => /<(BackLink|Link|button)\b/.exec(m[0])?.[1] === "Link").map(() => file),
    );
    expect(plain).toEqual([]);
  });
});
