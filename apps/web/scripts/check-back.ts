// Checks that every page of the app comes back as it was left (docs/31-ui.md, "Going back"), on its own, so a page
// whose filter, tab, "Show all" or list page is lost on Back is found without anyone trying it by hand. On each page it
// changes what the page offers to change (scripts/check-back.page.js: choices, tabs, selects, checkboxes, toggles,
// disclosures, a list's pages, the search) and scrolls, follows a link to another page, comes back with Back, and then
// with the page's link back to its list where the other page has one, and compares. A control is found by its role and
// state (aria-checked, aria-selected, aria-pressed, aria-expanded, aria-current), so a new control needs them to be
// checked, as it needs them anyway for a screen reader.
//
// Runs against the dev server (`npm run dev -w @touchdown/web`, with its local backup) in a headless Chrome of its own,
// with a throwaway profile, and leaves out the pages that are forms or change the log. Exit 0 when every page comes
// back as left, 1 when one does not, 2 when it cannot run.
//
//   npm run check-back -w @touchdown/web [-- --url http://127.0.0.1:5173] [--only /types,/flights] [--chrome PATH]

import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** Pages left out: forms, whose fields are a draft and not a view, and pages that change the log or the account. */
const LEFT_OUT = new Set(["/flights/new", "/flights/$id/edit", "/spotting/new", "/spotting/session", "/spotting/$id/edit", "/import", "/settings", "/shares"]);

/**
 * Each page is checked three ways: only scrolled, with every control changed (once on each of its tabs), and with only
 * the search.
 */
const HOW = ["scroll", "controls", "search"] as const;

type Report = { href: string; how: (typeof HOW)[number]; tab?: number; tabs: number; route: string | null; changed: string[]; left: string | null; back: string[]; linkBack: { label: string; lost: string[] } | null; notes: string[] };

function option(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : undefined;
}

function findChrome(): string | null {
  const given = option("--chrome") ?? process.env.TOUCHDOWN_CHROME;
  const places = given
    ? [given]
    : process.platform === "darwin"
      ? ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/Applications/Chromium.app/Contents/MacOS/Chromium"]
      : ["/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/usr/bin/chromium", "/usr/bin/chromium-browser"];
  return places.find((p) => existsSync(p)) ?? null;
}

/** One tab, through the DevTools protocol. */
class Tab {
  private id = 0;
  private pending = new Map<number, (m: { result?: unknown; error?: { message: string } }) => void>();
  readonly errors: string[] = [];
  constructor(private ws: WebSocket) {
    ws.addEventListener("message", (e) => {
      const m = JSON.parse(String(e.data)) as { id?: number; method?: string; params?: { exceptionDetails?: { exception?: { description?: string }; text?: string } } };
      if (m.id && this.pending.has(m.id)) {
        this.pending.get(m.id)!(m as never);
        this.pending.delete(m.id);
      } else if (m.method === "Runtime.exceptionThrown") {
        const d = m.params?.exceptionDetails;
        this.errors.push((d?.exception?.description ?? d?.text ?? "error").split("\n")[0]!);
      }
    });
  }
  send(method: string, params: Record<string, unknown> = {}): Promise<{ result?: unknown; error?: { message: string } }> {
    return new Promise((resolve) => {
      const i = ++this.id;
      this.pending.set(i, resolve);
      this.ws.send(JSON.stringify({ id: i, method, params }));
    });
  }
  /** An expression's value, awaited, or a failure after `ms`. */
  async value<T>(expression: string, ms = 120_000): Promise<T> {
    const r = (await Promise.race([
      this.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`no answer in ${ms / 1000} s: ${expression}`)), ms)),
    ])) as { result?: { result?: { value?: T }; exceptionDetails?: { exception?: { description?: string } } }; error?: { message: string } };
    if (r.error) throw new Error(r.error.message);
    if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description ?? "error in the page");
    return r.result?.result?.value as T;
  }
}

async function main(): Promise<number> {
  const base = (option("--url") ?? "http://127.0.0.1:5173").replace(/\/$/, "");
  const only = option("--only")?.split(",").map((s) => s.trim());
  const up = await fetch(base, { signal: AbortSignal.timeout(5000) }).then((r) => r.ok).catch(() => false);
  if (!up) {
    console.error(`No dev server at ${base}. Start it with: npm run dev -w @touchdown/web`);
    return 2;
  }
  const chrome = findChrome();
  if (!chrome) {
    console.error("No Chrome found. Give one with --chrome PATH or TOUCHDOWN_CHROME.");
    return 2;
  }
  const profile = mkdtempSync(join(tmpdir(), "touchdown-check-back-"));
  const browser = spawn(chrome, ["--headless=new", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "--no-first-run", "--no-default-browser-check", "--disable-extensions", "--mute-audio", "--window-size=1280,900", "about:blank"], { stdio: ["ignore", "ignore", "pipe"] });
  try {
    const endpoint = await new Promise<string>((resolve, reject) => {
      let err = "";
      browser.stderr!.on("data", (d: Buffer) => {
        err += d;
        const m = /DevTools listening on (ws:\/\/\S+)/.exec(err);
        if (m) resolve(m[1]!);
      });
      browser.on("exit", (code) => reject(new Error(`Chrome stopped (${code})`)));
      setTimeout(() => reject(new Error("Chrome did not start")), 20_000);
    });
    const port = new URL(endpoint).port;
    const target = (await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: "PUT" })).json()) as { webSocketDebuggerUrl: string };
    const ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      ws.addEventListener("open", resolve);
      ws.addEventListener("error", reject);
    });
    const tab = new Tab(ws);
    await tab.send("Runtime.enable");
    await tab.send("Page.enable");
    await tab.send("Page.addScriptToEvaluateOnNewDocument", { source: readFileSync(join(import.meta.dirname, "check-back.page.js"), "utf8") });
    await tab.send("Page.navigate", { url: `${base}/` });
    // The app opens its data first: a first open of the local backup takes a while.
    for (let waited = 0; !(await tab.value<boolean>("!!window.__backCheck?.ready()").catch(() => false)); waited += 500) {
      if (waited > 120_000) throw new Error("the app did not open in two minutes");
      await new Promise((r) => setTimeout(r, 500));
    }
    await tab.value("__backCheck.settle(1000, 20000)");

    // Each route once: its own path, or a page of it found linked from a page checked before it.
    const routes = await tab.value<{ id: string; path: string }[]>("__backCheck.routes()");
    const found = new Map<string, string>();
    for (const r of routes) if (!r.path.includes("$")) found.set(r.id, r.path);
    const done = new Set<string>();
    const reports: Report[] = [];
    const wanted = (r: { id: string; path: string }) => !LEFT_OUT.has(r.path) && (!only || only.some((o) => r.path === o || r.path.startsWith(`${o}/`)));
    for (let progress = true; progress; ) {
      progress = false;
      for (const r of routes) {
        const href = found.get(r.id);
        if (!href || done.has(r.id) || !wanted(r)) continue;
        done.add(r.id);
        progress = true;
        const round = (how: (typeof HOW)[number], tabAt?: number) => tab.value<Report>(`__backCheck.check(${JSON.stringify(href)}, ${JSON.stringify(how)}, ${tabAt ?? "undefined"})`);
        for (const how of HOW) {
          const first = await round(how, how === "controls" ? 0 : undefined);
          // A route that sends elsewhere (the map, the globe) is the page it sends to, checked as that.
          if (first.route !== r.id) break;
          const more: Report[] = [];
          for (let i = 1; how === "controls" && i < first.tabs; i++) more.push(await round(how, i));
          for (const report of [first, ...more]) {
            if (report.notes.includes("no search")) continue;
            reports.push(report);
            print(report);
          }
        }
        for (const [id, link] of Object.entries(await tab.value<Record<string, string>>("__backCheck.links()"))) if (!found.has(id)) found.set(id, link);
      }
    }
    const missed = routes.filter((r) => wanted(r) && !done.has(r.id)).map((r) => r.path);
    if (missed.length) console.log(`\nNot checked (no page of it linked from those checked): ${missed.join(", ")}`);
    if (tab.errors.length) console.log(`\nErrors in the page:\n${[...new Set(tab.errors)].map((e) => `  ${e}`).join("\n")}`);
    const bad = reports.filter((r) => r.back.length || r.linkBack?.lost.length);
    const pages = new Set(reports.map((r) => r.route)).size;
    console.log(bad.length ? `\n${new Set(bad.map((r) => r.route)).size} of ${pages} pages are not as they were left.` : `\nAll ${pages} pages come back as they were left.`);
    ws.close();
    return bad.length ? 1 : 0;
  } finally {
    browser.kill();
    await new Promise((r) => setTimeout(r, 500));
    rmSync(profile, { recursive: true, force: true });
  }
}

function print(r: Report) {
  const lost = r.back.length || r.linkBack?.lost.length;
  console.log(`\n${lost ? "✗" : "✓"} ${r.route} (${r.href}), ${r.how === "scroll" ? "scrolled" : r.how === "search" ? "searched" : "every control changed"}`);
  if (r.changed.length) console.log(`  changed: ${r.changed.join("; ")}`);
  for (const n of r.notes) console.log(`  ${n}`);
  if (r.left) console.log(`  left for ${r.left}`);
  if (r.left) console.log(r.back.length ? `  Back lost:\n${r.back.map((x) => `    ${x}`).join("\n")}` : "  Back: as left");
  if (r.linkBack) console.log(r.linkBack.lost.length ? `  "${r.linkBack.label}" lost:\n${r.linkBack.lost.map((x) => `    ${x}`).join("\n")}` : `  "${r.linkBack.label}": as left`);
}

main().then(
  (code) => process.exit(code),
  (e: unknown) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(2);
  },
);
