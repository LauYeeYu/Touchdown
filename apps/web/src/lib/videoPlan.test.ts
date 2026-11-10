import { describe, expect, it } from "vitest";
import { camAt, camFor, dateClock, lerpCam, planMoves, ramped, smoother, tickerChanges, timeline, type Cam, type Rect } from "./videoPlan.ts";

const DAY = 86_400_000;
const day = (n: number) => Date.UTC(2025, 0, 1) + n * DAY;

describe("a video's motion", () => {
  it("moves along a path from rest to rest, steadily between, never backwards", () => {
    expect(ramped(0)).toBe(0);
    expect(ramped(1)).toBeCloseTo(1, 10);
    let last = -1;
    const speeds: number[] = [];
    for (let i = 0; i <= 1000; i++) {
      const v = ramped(i / 1000);
      expect(v).toBeGreaterThanOrEqual(last);
      if (i) speeds.push(v - last);
      last = v;
    }
    // At rest at both ends, and the same speed all through the middle.
    expect(speeds[0]!).toBeLessThan(speeds[500]! / 100);
    expect(speeds[speeds.length - 1]!).toBeLessThan(speeds[500]! / 100);
    expect(Math.abs(speeds[300]! - speeds[700]!)).toBeLessThan(1e-9);
    expect(smoother(0)).toBe(0);
    expect(smoother(1)).toBe(1);
  });
});

describe("a period's timeline", () => {
  const when = [day(0), day(0.2), day(30), day(31), day(200), day(201)];
  const tl = timeline(when, [0.2, 0.9, 0.5, 0.5, 1, 0.1], [1.6, 26]);

  it("draws the flights in order, inside the span, each starting after the last", () => {
    expect(tl.slots[0]!.start).toBe(1.6);
    for (let i = 1; i < tl.slots.length; i++) expect(tl.slots[i]!.start).toBeGreaterThan(tl.slots[i - 1]!.start);
    expect(tl.to).toBeLessThanOrEqual(26 + 1e-9);
  });

  it("gives a quiet stretch more time than a connection, but not in proportion", () => {
    const gap = (i: number) => tl.slots[i + 1]!.start - tl.slots[i]!.start;
    expect(gap(1)).toBeGreaterThan(gap(0));
    expect(gap(3)).toBeGreaterThan(gap(1));
    // 169 days against 29: much less than six times as long.
    expect(gap(3) / gap(1)).toBeLessThan(3);
    // A connection still gets room to be seen.
    expect(gap(0)).toBeGreaterThan(0.4);
  });

  it("moves the ticker's date forward evenly between flights, and never back", () => {
    const clock = dateClock(tl.slots, when);
    expect(clock(0)).toBe(when[0]);
    expect(clock(tl.slots[2]!.start)).toBe(when[2]);
    let last = 0;
    for (let t = 0; t < 30; t += 0.05) {
      const d = clock(t)!;
      expect(d).toBeGreaterThanOrEqual(last);
      last = d;
    }
    expect(clock(30)).toBe(when[5]);
    expect(dateClock(tl.slots, when.map(() => null))(5)).toBeNull();
  });

  it("changes its words no faster than they can be read, and ends on the right ones", () => {
    const label = (t: number) => String(Math.floor(t * 10));
    const changes = tickerChanges(label, 0, 3);
    for (let i = 1; i < changes.length; i++) expect(changes[i]!.t - changes[i - 1]!.t).toBeGreaterThanOrEqual(0.45 - 1e-9);
    expect(changes[changes.length - 1]!.text).toBe(label(3));
  });
});

describe("a flat map's camera", () => {
  const area: Rect = [100, 200, 1820, 880];
  const frame: Rect = [0, 0, 1920, 1080];
  const view = (cam: Cam, x: number, y: number) => [(x - cam.cx) * cam.k + (area[0] + area[2]) / 2, (y - cam.cy) * cam.k + (area[1] + area[3]) / 2];

  it("frames what is shown with room around it, never wider than the final view", () => {
    const cam = camFor([900, 500, 1000, 560], area, frame);
    expect(cam.k).toBeGreaterThan(1);
    for (const [x, y] of [[900, 500], [1000, 560]]) {
      const [sx, sy] = view(cam, x!, y!);
      expect(sx).toBeGreaterThan(area[0]);
      expect(sx).toBeLessThan(area[2]);
      expect(sy).toBeGreaterThan(area[1]);
      expect(sy).toBeLessThan(area[3]);
    }
    expect(camFor([0, 0, 5000, 5000], area, frame).k).toBe(1);
  });

  it("does not show beyond the final drawing's edge", () => {
    const cam = camFor([10, 500, 30, 520], area, frame);
    const [left] = view(cam, 0, 0);
    expect(left).toBeLessThanOrEqual(0 + 1e-9);
  });

  it("keeps on the screen what it showed while it widens to show more", () => {
    const small = camFor([900, 500, 1000, 560], area, frame);
    const big = camFor([300, 300, 1600, 800], area, frame);
    for (let s = 0; s <= 1; s += 0.05) {
      const cam = lerpCam(small, big, s);
      for (const [x, y] of [[900, 500], [1000, 560]]) {
        const [sx, sy] = view(cam, x!, y!);
        expect(sx).toBeGreaterThanOrEqual(area[0] - 1e-6);
        expect(sx).toBeLessThanOrEqual(area[2] + 1e-6);
        expect(sy).toBeGreaterThanOrEqual(area[1] - 1e-6);
        expect(sy).toBeLessThanOrEqual(area[3] + 1e-6);
      }
    }
  });

  it("makes one move at a time, each from where the last ended, skipping views already passed", () => {
    const a = camFor([900, 500, 1000, 560], area, frame);
    const b = camFor([700, 400, 1100, 600], area, frame);
    const c = camFor([300, 300, 1600, 800], area, frame);
    const plan = planMoves(
      [
        { t: 0, cam: a },
        { t: 2, cam: b },
        { t: 2.3, cam: c },
        { t: 9, cam: c },
      ],
      area,
    );
    expect(plan.moves[0]!.from).toEqual(a);
    for (let i = 1; i < plan.moves.length; i++) {
      expect(plan.moves[i]!.t0).toBeGreaterThanOrEqual(plan.moves[i - 1]!.t1);
      expect(plan.moves[i]!.from).toEqual(plan.moves[i - 1]!.to);
    }
    expect(camAt(plan, 0)).toEqual(a);
    expect(camAt(plan, 100)).toEqual(c);
  });
});
