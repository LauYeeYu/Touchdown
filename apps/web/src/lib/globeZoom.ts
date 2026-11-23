// The globe's zoom (components/Globe.tsx), as Google Maps and Flightradar24 zoom their maps: about the place under the
// pointer, which stays under it, a wheel's notch twice as near and eased, a pinch as far as the fingers spread.

type LonLat = [number, number];
const RAD = Math.PI / 180;

/** A wheel's notch, the + and − buttons and keys: twice as near, or as far. */
export const STEP = 2;
/** A trackpad's pinch zooms as the fingers' spread to this power: at 1 it follows the fingers, as a touch screen's does. */
export const PINCH = 1;
/** Pixels of scrolling that zoom one STEP, a mouse's notch in Chrome and Edge. */
const NOTCH = 100;
/** macOS gives a mouse's notch as a multiple of this many pixels, and a trackpad's scrolling never is one. */
const MAC_NOTCH = 4.000244140625;

/**
 * A wheel event's zoom: the factor, and whether it is eased, as a wheel's turning is, or taken at once, as a trackpad's
 * pinch is, to follow the fingers. Chrome, Edge and Firefox give a trackpad's pinch as a wheel with Ctrl, its delta
 * −100·ln of the fingers' spread, in steps of a few pixels. One event zooms one STEP at most, so a mouse's wheel with
 * Ctrl does not leap.
 */
export function wheelZoom(e: { deltaY: number; deltaMode: number; ctrlKey: boolean }, pageHeight: number): { factor: number; ease: boolean } {
  const mac = e.deltaMode === 0 && e.deltaY !== 0 && e.deltaY % MAC_NOTCH === 0;
  const px = mac ? Math.sign(e.deltaY) * NOTCH : e.deltaY * (e.deltaMode === 1 ? 40 : e.deltaMode === 2 ? pageHeight : 1);
  const small = Math.abs(px) < NOTCH / 2;
  const pinch = e.ctrlKey && !mac && small;
  const factor = Math.exp(-px * (pinch ? PINCH / 100 : Math.log(STEP) / NOTCH));
  return { factor: Math.min(STEP, Math.max(1 / STEP, factor)), ease: !pinch };
}

/**
 * The globe's turn [λ, φ] (d3's rotate, without roll) that shows `p` at (u, v): its offset from the globe's centre in
 * radii, v upwards. Of the turns that can, the nearest `rot`. Null when none can, as for a place near a pole put far
 * to one side, which only a rolled globe would show there.
 */
export function turnFor(p: LonLat, u: number, v: number, rot: [number, number]): [number, number] | null {
  const lat = p[1] * RAD;
  const c = Math.cos(lat);
  if (Math.abs(u) > c) return null;
  let best: [number, number] | null = null;
  // The place's longitude once turned, then the tilt that brings it to v on the near side.
  for (const l of [Math.asin(u / c), Math.PI - Math.asin(u / c)]) {
    const a = Math.sin(lat);
    const b = c * Math.cos(l);
    const r = Math.hypot(a, b);
    if (r < 1e-9 || Math.abs(v) > r) continue;
    let phi = (Math.atan2(b, a) - Math.acos(v / r)) / RAD;
    phi -= 360 * Math.round(phi / 360);
    if (Math.abs(phi) > 89) continue;
    let lambda = l / RAD - p[0];
    lambda += 360 * Math.round((rot[0] - lambda) / 360);
    if (!best || Math.hypot(lambda - rot[0], phi - rot[1]) < Math.hypot(best[0] - rot[0], best[1] - rot[1])) best = [lambda, phi];
  }
  return best;
}
