// A minimal Chrome DevTools Protocol client for one tab of a Chrome the user started with
// --remote-debugging-port and signed in to (used for Flightradar24, docs/13-reference-data.md).

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class ChromeTab {
  private id = 0;
  private pending = new Map<number, (v: unknown) => void>();
  private loaded: (() => void) | null = null;

  private constructor(
    private ws: WebSocket,
    private port: number,
    private targetId: string,
  ) {
    ws.onmessage = (e) => {
      const m = JSON.parse(String(e.data)) as { id?: number; method?: string; result?: unknown };
      if (m.id && this.pending.has(m.id)) {
        this.pending.get(m.id)!(m.result);
        this.pending.delete(m.id);
      } else if (m.method === "Page.loadEventFired") this.loaded?.();
    };
  }

  /** Open a new tab in the Chrome listening on `port`; null when no such Chrome is running. */
  static async open(port: number): Promise<ChromeTab | null> {
    const res = await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: "PUT" }).catch(() => null);
    if (!res?.ok) return null;
    const t = (await res.json()) as { id: string; webSocketDebuggerUrl: string };
    const ws = new WebSocket(t.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      ws.onopen = resolve;
      ws.onerror = reject;
    });
    const tab = new ChromeTab(ws, port, t.id);
    await tab.send("Page.enable");
    return tab;
  }

  send(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
    return new Promise((resolve) => {
      const i = ++this.id;
      this.pending.set(i, resolve);
      this.ws.send(JSON.stringify({ id: i, method, params }));
    });
  }

  /** Load a page and wait for its load event (at most `timeoutMs`), then `settleMs` more for scripts. */
  async goto(url: string, timeoutMs = 30_000, settleMs = 1500): Promise<void> {
    const done = new Promise<void>((r) => (this.loaded = r));
    await this.send("Page.navigate", { url });
    await Promise.race([done, sleep(timeoutMs)]);
    this.loaded = null;
    await sleep(settleMs);
  }

  async evaluate<T>(expression: string): Promise<T> {
    const r = (await this.send("Runtime.evaluate", { expression, returnByValue: true })) as { result?: { value?: T } };
    return r.result?.value as T;
  }

  async close(): Promise<void> {
    await fetch(`http://127.0.0.1:${this.port}/json/close/${this.targetId}`).catch(() => null);
    this.ws.close();
  }
}
