import { describe, expect, it } from "vitest";
import { ClickRenewal, clickRenewal, RENEW_MS, renewsOnClick, type Renewal } from "./renewal.ts";

const NOW = Date.UTC(2026, 10, 16, 12);
const MINUTE = 60_000;

/** A page to click on, and Google as the renewal sees it: `answer` settles the window that is open. */
function setUp(over: Partial<{ expiresAt: number | null; online: boolean; canAsk: boolean }> = {}) {
  const page = new EventTarget();
  const state = { expiresAt: NOW + 5 * MINUTE, online: true, canAsk: true, ...over };
  const calls = { renew: 0, renewed: 0, failed: [] as unknown[] };
  let answer: { ok: () => void; fail: (e: unknown) => void } | null = null;
  const r: Renewal = {
    expiresAt: () => state.expiresAt,
    online: () => state.online,
    canAsk: () => state.canAsk,
    renew: () => {
      calls.renew++;
      return new Promise<void>((resolve, reject) => (answer = { ok: resolve, fail: reject }));
    },
    renewed: () => void calls.renewed++,
    failed: (e) => void calls.failed.push(e),
    now: () => NOW,
  };
  const click = () => page.dispatchEvent(new Event("click"));
  /** Google answers, and the renewal hears it. */
  const settle = async (ok: boolean) => {
    const a = answer!;
    answer = null;
    if (ok) a.ok();
    else a.fail(new Error("closed"));
    await new Promise((resolve) => setTimeout(resolve, 0));
  };
  return { page, state, calls, r, click, settle };
}

describe("click renewal of Private mode's Google Drive access", () => {
  it("renews on a click once the access has less than ten minutes left, and not before", async () => {
    const s = setUp({ expiresAt: NOW + RENEW_MS + MINUTE });
    new ClickRenewal(s.page, s.r);
    s.click();
    expect(s.calls.renew).toBe(0);
    s.state.expiresAt = NOW + RENEW_MS - MINUTE;
    s.click();
    expect(s.calls.renew).toBe(1);
    await s.settle(true);
    expect(s.calls.renewed).toBe(1);
  });

  it("renews on a click once the access has run out, or when there is none", async () => {
    const s = setUp({ expiresAt: NOW - MINUTE });
    new ClickRenewal(s.page, s.r);
    s.click();
    expect(s.calls.renew).toBe(1);
    await s.settle(true);
    s.state.expiresAt = null;
    s.click();
    expect(s.calls.renew).toBe(2);
  });

  it("tries nothing offline, and renews on the first click once the connection is back", async () => {
    const s = setUp({ online: false });
    new ClickRenewal(s.page, s.r);
    s.click();
    s.click();
    expect(s.calls.renew).toBe(0);
    s.state.online = true;
    s.click();
    expect(s.calls.renew).toBe(1);
  });

  it("opens one renewal at a time, however many clicks come while it is open", async () => {
    const s = setUp();
    new ClickRenewal(s.page, s.r);
    s.click();
    s.click();
    s.click();
    expect(s.calls.renew).toBe(1);
    await s.settle(true);
    // Renewed: the access now ends in an hour, so a click asks nothing.
    s.state.expiresAt = NOW + 60 * MINUTE;
    s.click();
    expect(s.calls.renew).toBe(1);
  });

  it("does not try again after Google needed the user, until the access changes another way", async () => {
    const s = setUp({ expiresAt: NOW - MINUTE });
    new ClickRenewal(s.page, s.r);
    s.click();
    await s.settle(false);
    expect(s.calls.failed).toHaveLength(1);
    s.click();
    s.click();
    expect(s.calls.renew).toBe(1);
    // Signed in from the "Sign in" bar or in another tab, then nearly over again.
    s.state.expiresAt = NOW + 5 * MINUTE;
    s.click();
    expect(s.calls.renew).toBe(2);
  });

  it("tries again after a renewal that failed for want of the network", async () => {
    const s = setUp();
    new ClickRenewal(s.page, s.r);
    s.click();
    s.state.online = false;
    await s.settle(false);
    s.state.online = true;
    s.click();
    expect(s.calls.renew).toBe(2);
  });

  it("waits for Google's script, and stops listening when stopped", () => {
    const s = setUp({ canAsk: false });
    const renewal = new ClickRenewal(s.page, s.r);
    s.click();
    expect(s.calls.renew).toBe(0);
    s.state.canAsk = true;
    renewal.stop();
    s.click();
    expect(s.calls.renew).toBe(0);
  });

  it("renews in Private mode with Google Drive only, not in Standard, Local or with a directory", () => {
    expect(renewsOnClick({ mode: "private", adapter: "gdrive" })).toBe(true);
    for (const c of [{ mode: "standard", adapter: "gdrive" }, { mode: "local" }, { mode: "private", adapter: "localfs" }]) {
      expect(renewsOnClick(c)).toBe(false);
      const s = setUp({ expiresAt: null });
      expect(clickRenewal(c, s.page, s.r)).toBeNull();
      s.click();
      expect(s.calls.renew).toBe(0);
    }
    const s = setUp({ expiresAt: null });
    expect(clickRenewal({ mode: "private", adapter: "gdrive" }, s.page, s.r)).not.toBeNull();
    s.click();
    expect(s.calls.renew).toBe(1);
  });
});
