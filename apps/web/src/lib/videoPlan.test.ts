import { geoDistance, geoInterpolate, geoOrthographic } from "d3-geo";
import { describe, expect, it } from "vitest";
import { camAt, camFor, dateClock, lerpCam, planMoves, ramped, routeCamera, smoother, tickerChanges, timeline, type Cam, type Rect } from "./videoPlan.ts";

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

  it("gives a connection room to be seen, and the time before a quiet stretch only a little more", () => {
    const gap = (i: number) => tl.slots[i + 1]!.start - tl.slots[i]!.start;
    expect(gap(0)).toBeGreaterThan(0.4);
    expect(gap(1)).toBeGreaterThan(gap(0));
    // 169 days against 29: about the same.
    expect(gap(3) / gap(1)).toBeLessThan(1.1);
  });

  it("shares the time by events, so a busy month takes longer than a quiet half year", () => {
    // Eight flights in March, then one in October and one in December.
    const march = Array.from({ length: 8 }, (_, i) => day(59 + 3 * i));
    const busy = timeline([...march, day(280), day(340)], Array(10).fill(0.5), [1.6, 40]);
    const start = (i: number) => busy.slots[i]!.start;
    expect(start(8) - start(0)).toBeGreaterThan(5 * (start(9) - start(8)));
  });

  it("gives a day of spotting less time than a flight", () => {
    const when = [day(0), day(10), day(20), day(30)];
    const mixed = timeline(when, [0, 0, 0, 0], [1.6, 20], [1, 0.5, 1, 1]);
    const gap = (i: number) => mixed.slots[i + 1]!.start - mixed.slots[i]!.start;
    expect(gap(1)).toBeLessThan(gap(0));
    expect(gap(1)).toBeLessThan(gap(2));
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

describe("a flight's globe camera", () => {
  // A made-up long route far from its great circle: south-east first, across an ocean, then north-east.
  const waypoints: [number, number][] = [[116, 40], [128, 34], [142, 33], [175, 40], [-160, 52], [-130, 55], [-95, 47], [-71, 42]];
  const at: [number, number][] = [waypoints[0]!];
  for (let i = 1; i < waypoints.length; i++) {
    const gc = geoInterpolate(waypoints[i - 1]!, waypoints[i]!);
    const steps = Math.ceil((geoDistance(waypoints[i - 1]!, waypoints[i]!) * 6371) / 25);
    for (let k = 1; k <= steps; k++) at.push(gc(k / steps) as [number, number]);
  }
  const km = new Float64Array(at.length);
  for (let i = 1; i < at.length; i++) km[i] = km[i - 1]! + geoDistance(at[i - 1]!, at[i]!) * 6371;
  const total = km[at.length - 1]!;
  const [width, height] = [1485, 480];
  const flying = 10.8;
  const [from, to] = [1.05, 1.2 + 0.45 * flying];
  const near = Math.min(1100, 0.15 * total);
  const cam = routeCamera({ at, km, width, height, near, reach: (t) => near + (total - near) * smoother((t - from) / (to - from)), from, to });
  const aircraft = (t: number) => {
    const s = ramped((t - 1.2) / flying) * total;
    let i = 0;
    while (i + 1 < at.length - 1 && km[i + 1]! <= s) i++;
    return geoInterpolate(at[i]!, at[i + 1]!)(Math.min(1, (s - km[i]!) / Math.max(1e-9, km[i + 1]! - km[i]!))) as [number, number];
  };
  const screen = (t: number, p: [number, number]) => {
    const v = cam.at(t);
    const proj = geoOrthographic().rotate([-v.centre[0], -v.centre[1]]).scale(v.r).translate([width / 2 + v.off[0] * v.r, height / 2 + v.off[1] * v.r]);
    return { xy: proj(p)!, front: geoDistance(p, v.centre) < Math.PI / 2 };
  };
  const frames = Array.from({ length: 15 * 60 }, (_, i) => i / 60);

  it("keeps the aircraft in the view all the way, however far it strays from the great circle", () => {
    for (const t of frames) {
      const { xy, front } = screen(t, aircraft(t));
      expect(front).toBe(true);
      expect(xy[0]).toBeGreaterThan(0.03 * width);
      expect(xy[0]).toBeLessThan(0.97 * width);
      expect(xy[1]).toBeGreaterThan(0.03 * height);
      expect(xy[1]).toBeLessThan(0.97 * height);
    }
  });

  it("starts on the departure, ends on the whole route, and only widens between", () => {
    const start = screen(0, at[0]!).xy;
    expect(Math.abs(start[0] - width / 2)).toBeLessThan(0.1 * width);
    expect(Math.abs(start[1] - height / 2)).toBeLessThan(0.1 * height);
    for (const p of [at[0]!, at[at.length - 1]!]) {
      const { xy } = screen(15, p);
      expect(xy[0]).toBeGreaterThan(0);
      expect(xy[0]).toBeLessThan(width);
    }
    for (let i = 1; i < frames.length; i++) expect(cam.at(frames[i]!).r).toBeLessThanOrEqual(cam.at(frames[i - 1]!).r * (1 + 1e-9));
    expect(cam.at(0)).toEqual(cam.at(cam.moving[0]));
    expect(cam.at(15)).toEqual(cam.at(cam.moving[1]));
  });

  it("moves the ground on the screen without a jerk", () => {
    // A point on the ground: its speed on the screen changes a little from one frame to the next, never at once.
    const p = at[Math.floor(at.length / 3)]!;
    const pos = frames.map((t) => screen(t, p).xy);
    const speed = pos.slice(1).map((q, i) => Math.hypot(q[0] - pos[i]![0], q[1] - pos[i]![1]));
    const fastest = Math.max(...speed);
    for (let i = 1; i < pos.length - 1; i++) {
      const ax = pos[i + 1]![0] - 2 * pos[i]![0] + pos[i - 1]![0];
      const ay = pos[i + 1]![1] - 2 * pos[i]![1] + pos[i - 1]![1];
      expect(Math.hypot(ax, ay)).toBeLessThan(0.1 * fastest);
    }
  });
});
